/**
 * bench attempt — LOKALNE wykonanie prób macierzy model × zadanie × próba,
 * produkujące ZACHOWANE PRÓBY (kontrakt: .bench-kit/ATTEMPT_FORMAT.md).
 * Wykonanie nie wie nic o rubrykach — ocena to osobny proces
 * (`bench evaluate`), uruchamialny wielokrotnie.
 *
 * Przebieg:
 * 1. Plan: docelowa liczba prób per komórka (model × zadanie); istniejące
 *    zachowane próby (attempt.json) się liczą — domyślnie DOGANIAMY braki
 *    (top-up), niczego nie nadpisując. Projekcja kosztu z historii
 *    results/ + sufit budżetu na CAŁY bieg macierzy (defaults.max_cost_usd
 *    albo --max-cost).
 * 2. Przygotowanie (jedyny etap z siecią): obraz bazowy + obraz zadania
 *    (repo@pin + overlay + commit startowy, lib/prepare.ts).
 * 3. Próby: każda w jednorazowym kontenerze z pustym stanem harnessu
 *    (OpenCode / Claude Code / Codex — prefiks id modelu, lib/harness.ts);
 *    /bench/trial.sh → agent.log, patch.diff, metrics.json (koszt/tokeny
 *    ze stanu harnessu tej próby), execution.json, workspace/ (stan po
 *    pracy agenta — ZAWSZE zachowywany, poza gitem). Koszt harnessów bez
 *    wiarygodnego własnego kosztu runner wycenia z tokenów
 *    (lib/pricing.ts) — cena ustalona PRZED startem, inaczej odmowa.
 * 4. Runner dokłada attempt.json (format 1) — metadane próby.
 *
 * Próba raz opłacona nigdy nie jest wyrzucana: `--force` (re-run mimo
 * istniejących prób) przenosi stary katalog do
 * trial-<n>.superseded-<stempel>/ zamiast go kasować.
 *
 * Wiele procesów `bench attempt` naraz (per model, w tle, na dwóch
 * maszynach ze wspólnym drzewem): numer próby jest zajmowany markerem
 * running.json PRZED startem kontenera (zapis atomowy), więc niezależne
 * wywołania doganiają braki bez koordynacji; stan macierzy pokazuje
 * `bench status`.
 *
 * Retry 1× przy przejściowej awarii providera (5xx/429) i killu
 * sygnałowym (OOM) — artefakty pierwszego podejścia zostają obok.
 *
 * Sekrety modeli przechodzą do kontenera wyłącznie przez env
 * (*_API_KEY oraz OPENCODE_*), nigdy nie są zapiekane w obraz.
 *
 * Użycie:
 *   bench attempt [<zadanie> <model>]
 *                 [--tasks x,y] [--models a,b] [--trials n]
 *                 [--trial-index n] [--force] [--parallel n] [--smoke]
 *                 [--max-cost <usd>] [--out <dir>] [--plan-out <plik>] [--prepared]
 *                 [--engine docker|podman] [--root <dir>]
 *
 * `--smoke` = sprawdzenie rur: 1 próba, tylko pierwszy model z listy.
 * `--trial-index n` = dokładnie próba nr n (chirurgiczny re-run z --force).
 * `--plan-out <plik>` = sam plan i projekcja kosztu jako JSON, bez silnika
 *   i bez prób (wejście supervisora `bench run`).
 * `--prepared` = użyj istniejących obrazów (bazowego i zadania), zamiast
 *   je budować — supervisor `bench run` przygotowuje je raz na bieg.
 *
 * Próba w toku jest widoczna z hosta: kontener ma nazwę (running.json →
 * container), puls z kontenera (heartbeat.json) runner co kilkanaście
 * sekund przepisuje do progress.json z kosztem wycenionym jak po próbie.
 * stop.json w katalogu próby (`bench run cancel`, budżet supervisora) =
 * prośba o zatrzymanie: runner przerywa agenta SIGINT-em, a próba jest
 * zachowana z `stopped` i wyłączona z oceny.
 * Domyślny cel: attempts/ w korzeniu instancji (kanoniczne drzewo prób).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig, loadTask } from "../lib/instance.ts";
import { baseImageTag, detectEngine, engineMemoryBytes, ensureBaseImage, resourceLimitArgs, sh, shAsync, signalFromExit } from "../lib/containers.ts";
import { hashTaskDir } from "../lib/era.ts";
import { runningMarkerState, writeRunMarker } from "../lib/matrix.ts";
import { imageExists, prepareTaskImage, sanitize, type PreparedTask } from "../lib/prepare.ts";
import {
  PROGRESS_INTERVAL_MS,
  STOP_GRACE_S,
  clearTransient,
  containerName,
  readJsonFile,
  readStopRequest,
  refreshProgress,
  stopAgentArgs,
  writeJsonAtomic,
  type StopRequest,
} from "../lib/progress.ts";
import { harnessVersion, parseModelId, type HarnessModel } from "../lib/harness.ts";
import {
  catalogSlugFor,
  costPolicy,
  fetchOpenRouterCatalog,
  finalizeCost,
  priceTokens,
  resolvePrice,
  type Catalog,
  type Price,
  type ResolvedPrice,
  type Tokens,
} from "../lib/pricing.ts";
import { ATTEMPT_FORMAT_VERSION } from "../schemas/attempt.ts";
import type { Task } from "../schemas/task.ts";

interface Options {
  root: string;
  models: string[] | null;
  tasks: string[] | null;
  trials: number | null;
  trialIndex: number | null;
  force: boolean;
  parallel: number | null;
  smoke: boolean;
  maxCost: number | null;
  out: string | null;
  planOut: string | null;
  prepared: boolean;
  engine: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = {
    root: process.cwd(),
    models: null,
    tasks: null,
    trials: null,
    trialIndex: null,
    force: false,
    parallel: null,
    smoke: false,
    maxCost: null,
    out: null,
    planOut: null,
    prepared: false,
    engine: null,
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) return null;
    const value = () => args[++i];
    if (arg === "--models") opts.models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--tasks") opts.tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") opts.trials = Number(value());
    else if (arg === "--trial-index") opts.trialIndex = Number(value());
    else if (arg === "--force") opts.force = true;
    else if (arg === "--parallel") opts.parallel = Number(value());
    else if (arg === "--smoke") opts.smoke = true;
    else if (arg === "--max-cost") opts.maxCost = Number(value());
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--plan-out") opts.planOut = resolve(value() ?? "");
    else if (arg === "--prepared") opts.prepared = true;
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else if (arg.startsWith("--")) return null;
    else positional.push(arg);
  }
  // Cukier "jedna komenda od zera do próby": bench attempt <zadanie> <model>.
  if (positional.length === 2) {
    if (opts.tasks || opts.models) return null;
    opts.tasks = [positional[0] as string];
    opts.models = [positional[1] as string];
  } else if (positional.length !== 0) return null;
  if (opts.trials !== null && (!Number.isInteger(opts.trials) || opts.trials < 1)) return null;
  if (opts.trialIndex !== null && (!Number.isInteger(opts.trialIndex) || opts.trialIndex < 1)) return null;
  if (opts.parallel !== null && (!Number.isInteger(opts.parallel) || opts.parallel < 1)) return null;
  if (opts.maxCost !== null && (!Number.isFinite(opts.maxCost) || opts.maxCost <= 0)) return null;
  if (opts.trialIndex !== null && (opts.trials !== null || opts.smoke)) return null;
  if (opts.smoke && opts.trials !== null && opts.trials !== 1) return null;
  return opts;
}

/**
 * Przejściowa awaria providera (HTTP 5xx / rate limit) daje `agent exit 1`
 * po ~sekundzie i pustą próbę — sygnał jest w agent.log, więc podnosimy go
 * do attempt.json zamiast kazać triage'owi czytać logi.
 */
const PROVIDER_ERROR_PATTERN =
  /rate.?limit|overloaded|internal server error|bad gateway|service unavailable|(?:status(?: code)?|HTTP)[ :]*(?:429|5\d\d)\b/i;

function detectProviderError(
  trialDir: string,
  execution: { agent_exit: number; timed_out: boolean } | null,
  spec: HarnessModel,
): boolean {
  if (!execution || execution.timed_out || execution.agent_exit === 0) return false;
  const logPath = join(trialDir, "agent.log");
  if (!existsSync(logPath)) return false;
  const log = readFileSync(logPath, "utf8");
  if (spec.harness === "opencode") return PROVIDER_ERROR_PATTERN.test(log.slice(-8000));
  // Harnessy JSONL: tylko pola błędów (wynik is_error, turn.failed, error),
  // nie cała treść — agent czytający kod o rate limitach to nie awaria.
  const errors: string[] = [];
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "result" && event.is_error === true) errors.push(`${String(event.api_error_status ?? "")} ${String(event.result ?? "")}`);
      if (event.type === "turn.failed") errors.push(String((event.error as { message?: unknown } | undefined)?.message ?? ""));
      if (event.type === "error") errors.push(String(event.message ?? ""));
    } catch {
      // linia nie-JSON — pomijamy
    }
  }
  const stderrPath = join(trialDir, "agent.stderr.log");
  if (existsSync(stderrPath)) errors.push(readFileSync(stderrPath, "utf8").slice(-4000));
  return PROVIDER_ERROR_PATTERN.test(errors.join("\n").slice(-8000));
}

/**
 * Env przekazywany do kontenera próby: sekrety modeli + konfiguracja
 * OpenCode. Celowo NIE ANTHROPIC_* / CLAUDE_* / OPENAI_BASE_URL hosta —
 * operator, który sam pracuje w Claude Code, ma ich pełne env, a routing
 * próby ustala trial.sh z id modelu.
 */
function trialEnvNames(): string[] {
  return Object.keys(process.env).filter(
    // BENCH_OPENROUTER_BASE_URL: bramka/proxy firmy przed OpenRouter dla
    // Claude Code i Codexa (trial.sh); domyślnie https://openrouter.ai/api.
    (name) => /_API_KEY$/.test(name) || /^OPENCODE_/.test(name) || name === "BENCH_OPENROUTER_BASE_URL",
  );
}

/**
 * Stan prób komórki: `done` = zachowana (attempt.json), `running` =
 * w toku w INNYM procesie `bench attempt` (running.json bez attempt.json,
 * marker nieprzeterminowany). Marker w toku pozwala uruchamiać kilka
 * niezależnych `bench attempt` na tej samej instancji (per model, w tle,
 * na drugiej maszynie ze wspólnym drzewem) bez kolizji o trial-<n>.
 */
function existingTrials(cellDir: string): Map<number, "done" | "running"> {
  const found = new Map<number, "done" | "running">();
  if (!statSync(cellDir, { throwIfNoEntry: false })?.isDirectory()) return found;
  for (const name of readdirSync(cellDir)) {
    const match = name.match(/^trial-(\d+)$/);
    if (!match) continue;
    const dir = join(cellDir, name);
    if (existsSync(join(dir, "attempt.json"))) found.set(Number(match[1]), "done");
    else if (readRunningMarker(dir) === "running") found.set(Number(match[1]), "running");
  }
  return found;
}

/**
 * Marker próby w toku: running.json w katalogu próby, zapisywany PRZED
 * startem kontenera i usuwany po zapisie attempt.json. Przeterminowany
 * (started_at + timeout_s + zapas) = proces zginął bez sprzątania —
 * katalog jest odkładany do trial-<n>.aborted-<stempel>/ przy następnym
 * zajęciu numeru (artefakty częściowe zostają; opłacona praca nie ginie).
 * Marker z tej maszyny, którego proces (pid) nie żyje, też jest
 * przeterminowany — reguła wspólna z bench status (lib/matrix.ts).
 */
function readRunningMarker(trialDir: string): "running" | "stale" | null {
  const path = join(trialDir, "running.json");
  if (!existsSync(path)) return null;
  try {
    return runningMarkerState(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
  } catch {
    return "stale";
  }
}

/** ENOSPC albo EDQUOT (limit tmpfs per użytkownik; Node zgłasza go jako "Unknown system error -122"). */
export function isDiskFull(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | null;
  return !!e && (e.code === "ENOSPC" || e.code === "EDQUOT" || e.errno === -122 || /system error -122/.test(e.message ?? ""));
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

/**
 * JSON wypisany przez trial.sh; null, gdy go brak, jest pusty albo ucięty.
 * Pusty plik po skończonej próbie to niemal zawsze pełny dysk (zachowanie
 * workspace/ zjadło miejsce, potem heredoc zapisał 0 bajtów) — mówimy to
 * wprost, zamiast "Unexpected end of JSON input", które zabijało cały bieg.
 */
function readTrialJson<T = { agent_exit: number; timed_out: boolean; wall_duration_s: number }>(path: string, label: string): T | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    const why = text.trim() === "" ? "pusty" : "ucięty";
    console.error(
      `trial:  ${label} — ${basename(path)} ${why} (pełny dysk? sprawdź \`df -h\` dla katalogu attempts/ i koniec agent.log) — próba liczona jako awaria infrastruktury`,
    );
    return null;
  }
}

/** Próbka historii kosztu zadania: zachowana próba (metrics.json) albo wynik (results/). */
export interface CostSample {
  model: string;
  /** null = koszt nieznany (cost_source null / brak) — nie wchodzi do median. */
  cost: number | null;
  /** Tokeny z metrics.json (z cache); null = brak (np. result.json nie trzyma cache). */
  tokens: Tokens | null;
}

/**
 * Historia kosztu zadania z dysku: zachowane próby (attempts/…/trial-N/
 * metrics.json + model z attempt.json) i wyniki (results/…/result.json)
 * — po jednej próbce na katalog trial-N (próba ma pierwszeństwo przed
 * swoim wynikiem). Próbki odłożone (.superseded/.aborted) pomijane.
 */
export function costSamples(attemptsDir: string, resultsDir: string, task: string): CostSample[] {
  const samples = new Map<string, CostSample>();
  const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
  const read = (p: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    } catch {
      return null; // nieparsowalny plik nie psuje projekcji
    }
  };
  const trialDirs = (base: string): [string, string][] =>
    isDir(join(base, task))
      ? readdirSync(join(base, task)).flatMap((cell) =>
          isDir(join(base, task, cell))
            ? readdirSync(join(base, task, cell))
                .filter((n) => /^trial-\d+$/.test(n))
                .map((n): [string, string] => [`${cell}/${n}`, join(base, task, cell, n)])
            : [],
        )
      : [];
  for (const [key, dir] of trialDirs(attemptsDir)) {
    const attempt = read(join(dir, "attempt.json"));
    const metrics = read(join(dir, "metrics.json"));
    if (typeof attempt?.model !== "string" || !metrics) continue;
    const tokens = (metrics.tokens ?? null) as Tokens | null;
    samples.set(key, {
      model: attempt.model,
      cost: typeof metrics.cost_usd === "number" && metrics.cost_source !== null ? metrics.cost_usd : null,
      tokens: typeof tokens?.input === "number" && typeof tokens.output === "number" ? tokens : null,
    });
  }
  for (const [key, dir] of trialDirs(resultsDir)) {
    if (samples.has(key)) continue;
    const result = read(join(dir, "result.json"));
    if (typeof result?.model !== "string") continue;
    // cost_source null = koszt nieznany (cost_usd 0 tylko z kontraktu) —
    // wliczony zaniżałby projekcję budżetu.
    const known = typeof result.cost_usd === "number" && result.cost_source !== null;
    samples.set(key, { model: result.model, cost: known ? (result.cost_usd as number) : null, tokens: null });
  }
  return [...samples.values()];
}

/**
 * Prior tokenów próby, gdy zadanie nie ma jeszcze żadnej zachowanej próby
 * z tokenami: rząd wielkości jednej sesji agenta kodującego (~10 min,
 * kilkadziesiąt tur; cache_read dominuje). Tylko do projekcji budżetu —
 * linia planu oznacza go jako SZACUNEK; koszt próby zawsze pochodzi
 * z jej metrics.json.
 */
export const TOKEN_PRIOR: Required<Tokens> = { input: 100_000, output: 20_000, cache_read: 3_000_000, cache_write: 0 };

export interface TrialProjection {
  usd: number;
  /**
   * history = mediana kosztu tej komórki; estimate = cena modelu × tokeny
   * (mediana tokenów zachowanych prób zadania albo TOKEN_PRIOR);
   * other-models = mediana kosztu innych modeli zadania (brak ceny).
   */
  basis: "history" | "estimate" | "other-models";
  /** Opis źródła do linii planu (dla estimate). */
  note: string;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * Projekcja kosztu jednej próby komórki: historia tej pary (zadanie ×
 * model) → szacunek z ceny modelu × tokeny → mediana innych modeli
 * zadania → null (brak podstaw).
 */
export function projectTrialCost(
  samples: CostSample[],
  model: string,
  price: Price | null,
  otherTasks: CostSample[] = [],
): TrialProjection | null {
  const own = median(samples.filter((s) => s.model === model && s.cost !== null).map((s) => s.cost as number));
  if (own !== null) return { usd: own, basis: "history", note: "" };
  // Ten sam model na innych zadaniach instancji: modele różnią się zużyciem
  // tokenów kilkukrotnie, więc tokeny innego modelu (np. jednego smoke'a)
  // zaniżają szacunek — bierzemy większą z dwóch liczb.
  const sameModel = otherTasks.filter((s) => s.model === model && s.cost !== null).map((s) => s.cost as number);
  const crossTask = median(sameModel);
  if (crossTask !== null) {
    const tokenBased = price ? projectTrialCost(samples, model, price) : null;
    if (!tokenBased || crossTask >= tokenBased.usd) {
      return { usd: crossTask, basis: "estimate", note: `mediana kosztu tego modelu na innych zadaniach (${sameModel.length} prób)` };
    }
    return tokenBased;
  }
  if (price) {
    const withTokens = samples.flatMap((s) => (s.tokens ? [s.tokens] : []));
    if (withTokens.length > 0) {
      const field = (k: keyof Tokens) => median(withTokens.map((t) => t[k] ?? 0)) ?? 0;
      const tokens = { input: field("input"), output: field("output"), cache_read: field("cache_read"), cache_write: field("cache_write") };
      return { usd: priceTokens(tokens, price), basis: "estimate", note: `mediana tokenów ${withTokens.length} zachowanych prób zadania` };
    }
    return { usd: priceTokens(TOKEN_PRIOR, price), basis: "estimate", note: "stały prior tokenów (TOKEN_PRIOR, brak prób zadania)" };
  }
  const others = median(samples.flatMap((s) => (s.cost !== null ? [s.cost] : [])));
  return others !== null ? { usd: others, basis: "other-models", note: "" } : null;
}

/** Do ilu prób "następny krok" wypisuje osobne `bench evaluate --attempt`. */
const EXPLICIT_EVALUATE_MAX = 3;

/**
 * Linia "następny krok" po biegu. Smoke (albo garść prób) ocenia się
 * dokładnie tymi próbami — gołe `bench evaluate` bierze WSZYSTKIE zachowane
 * próby instancji; większy bieg → forma zbiorcza.
 * Ścieżki względem korzenia instancji (absolutne, gdy --out poza nim).
 * Instancja z judge.mode agent ocenia wyniki sędzią-agentem (werdykt z pliku,
 * `bench evaluate --verdict`); smoke idzie wtedy przez sędziego API tylko jako dowód
 * ścieżki oceny — bez zapisu do results/.
 */
export function nextStepLine(root: string, produced: string[], smoke: boolean, judgeMode: "agent" | "api" = "api"): string {
  if (produced.length === 0) return "następny krok: bench status (w tym biegu nie zachowano żadnej próby)";
  const shown = produced.map((dir) => {
    const rel = relative(root, dir);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : dir;
  });
  if (judgeMode === "agent") {
    if (smoke) {
      return [
        "następny krok (dowód ścieżki oceny, sędzia API, bez zapisu do results/; wynik da sędzia-agent):",
        ...[...shown].sort().map((d) => `  bench evaluate --attempt ${d} --no-write-results`),
      ].join("\n");
    }
    return `następny krok: ocena ${produced.length} prób sędzią-agentem (\`bench evaluate --verdict … --judge-mode agent\` per próba; \`bench status\` liczy nieocenione)`;
  }
  if (smoke || produced.length <= EXPLICIT_EVALUATE_MAX) {
    return ["następny krok (ocena dokładnie tych prób → results/):", ...[...shown].sort().map((d) => `  bench evaluate --attempt ${d}`)].join("\n");
  }
  return "następny krok: bench evaluate (ocena zachowanych prób → results/)";
}

/** Plan biegu dla supervisora `bench run` (--plan-out). */
export interface PlanOut {
  jobs: Array<{ task: string; model: string; trial: number; timeout_s: number; memory_mb: number | null; projected_usd: number | null }>;
  projected_usd: number;
  budget_usd: number | null;
  /** Próby bez historii kosztu i bez ceny — projekcja ich nie obejmuje. */
  projection_unknown: number;
  /** Próby z SZACUNKIEM (brak historii w tej komórce). */
  estimated_trials: number;
}

function writePlanOut(path: string, plan: PlanOut): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(plan, null, 2) + "\n");
}

/** Istniejący obraz zadania (--prepared) — start-sha czytany z obrazu; null = trzeba zbudować. */
function existingTaskImage(engine: string, name: string, task: Task): PreparedTask | null {
  const image = `bench-task-${sanitize(name)}:latest`;
  if (!imageExists(engine, image)) return null;
  const read = sh(engine, ["run", "--rm", image, "cat", "/bench/start-sha"], { timeout: 120_000 });
  const startSha = read.stdout?.trim() ?? "";
  if (read.status !== 0 || !/^[0-9a-f]{40}$/.test(startSha)) return null;
  console.log(`prepare: ${name} → ${image} (przygotowany przez supervisora)`);
  return { name, task, image, startSha };
}

export async function attemptCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error(
      [
        "usage: bench attempt [<zadanie> <model>] [--tasks x,y] [--models a,b]",
        "                     [--trials n | --trial-index n] [--force] [--parallel n]",
        "                     [--smoke] [--max-cost <usd>] [--out <dir>] [--plan-out <plik>] [--prepared]",
        "                     [--engine docker|podman] [--root <dir>]",
      ].join("\n"),
    );
    return 2;
  }

  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  try {
    const config = loadConfig(root);
    const kitVersion = readFileSync(join(root, ".bench-kit", "VERSION"), "utf8").trim();
    let models = opts.models ?? config.defaults.models;
    let trials = opts.trials ?? config.defaults.trials;
    if (opts.smoke) {
      // Smoke = sprawdzenie rur, nie pomiar: 1 próba, jeden model.
      trials = 1;
      models = models.slice(0, 1);
      // Podpowiedź tylko, gdy model wziął się z defaults.models — jawne --models już wskazało.
      console.log(`smoke: 1 próba × ${models[0]}${opts.models ? "" : " (tani model wskaż przez --models)"}`);
    }
    const allTasks = listTaskNames(root);
    const taskNames = opts.tasks ?? allTasks;
    for (const name of taskNames) {
      if (!allTasks.includes(name)) throw new Error(`nieznane zadanie: ${name}`);
    }
    if (taskNames.length === 0) throw new Error("brak zadań do uruchomienia");

    const outDir = opts.out ?? join(root, "attempts");
    const resultsDir = join(root, "results");
    mkdirSync(outDir, { recursive: true });

    // --- plan macierzy: top-up braków, nie re-run opłaconych prób ---
    interface PlannedCell {
      task: string;
      model: string;
      numbers: number[];
      skipped: number;
      running: number;
    }
    const plan: PlannedCell[] = [];
    for (const task of taskNames) {
      for (const model of models) {
        const cellDir = join(outDir, task, sanitize(model));
        const existing = existingTrials(cellDir);
        let numbers: number[];
        if (opts.trialIndex !== null) {
          const state = existing.get(opts.trialIndex);
          if (state === "running") {
            throw new Error(`${task} × ${model}: próba trial-${opts.trialIndex} jest W TOKU w innym procesie bench attempt (running.json) — poczekaj albo sprawdź \`bench status\``);
          }
          if (state === "done" && !opts.force) {
            throw new Error(
              `${task} × ${model}: próba trial-${opts.trialIndex} już istnieje — ` +
                "zachowane próby nie są nadpisywane; --force odkłada starą do trial-N.superseded-* i wykonuje nową",
            );
          }
          numbers = [opts.trialIndex];
        } else {
          // Próby w toku nigdy nie są dublowane — także przy --force.
          numbers = Array.from({ length: trials }, (_, i) => i + 1).filter((n) => existing.get(n) !== "running" && (opts.force || !existing.has(n)));
        }
        const inRange = [...existing.entries()].filter(([n]) => n <= trials);
        plan.push({
          task,
          model,
          numbers,
          skipped: opts.force ? 0 : inRange.filter(([, s]) => s === "done").length,
          running: inRange.filter(([, s]) => s === "running").length,
        });
      }
    }
    const totalPlanned = plan.reduce((acc, c) => acc + c.numbers.length, 0);
    const totalSkipped = plan.reduce((acc, c) => acc + c.skipped, 0);
    const totalRunning = plan.reduce((acc, c) => acc + c.running, 0);
    if (totalSkipped > 0) {
      console.log(`plan:   ${totalSkipped} zachowanych prób już na dysku — doganiam tylko braki (--force wymusza re-run)`);
    }
    if (totalRunning > 0) {
      console.log(`plan:   ${totalRunning} prób(y) w toku w innym procesie bench attempt — pomijam (stan: bench status)`);
    }
    if (totalPlanned === 0) {
      console.log("bench attempt: wszystkie zaplanowane próby już zachowane lub w toku — nic do zrobienia");
      if (opts.planOut) writePlanOut(opts.planOut, { jobs: [], projected_usd: 0, budget_usd: opts.maxCost ?? config.defaults.max_cost_usd ?? null, projection_unknown: 0, estimated_trials: 0 });
      return 0;
    }

    // --- harnessy i ceny: ustalone PRZED wydaniem pieniędzy ---
    // Model, którego kosztu nie da się policzyć, nie startuje: koszt
    // nieznany to budżet, który nie działa, i $0 w ekonomii bench-analysis.
    const harnessSpecs = new Map<string, HarnessModel>();
    for (const model of new Set(plan.filter((c) => c.numbers.length > 0).map((c) => c.model))) {
      harnessSpecs.set(model, parseModelId(model));
    }
    // Historia kosztu per zadanie (zachowane próby + results/) — do projekcji;
    // komórka bez własnej historii potrzebuje ceny modelu (szacunek), także
    // dla harnessu raportującego koszt sam (OpenCode).
    const samplesByTask = new Map<string, CostSample[]>();
    for (const cell of plan) {
      if (cell.numbers.length > 0 && !samplesByTask.has(cell.task)) samplesByTask.set(cell.task, costSamples(outDir, resultsDir, cell.task));
    }
    // Historia innych zadań instancji — szacunek dla modelu nowego w zadaniu.
    const otherTaskSamples = (task: string): CostSample[] => {
      const dirs = [join(outDir), resultsDir].filter((d) => existsSync(d));
      const names = new Set(dirs.flatMap((d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name)));
      names.delete(task);
      return [...names].flatMap((n) => costSamples(outDir, resultsDir, n));
    };
    const lacksHistory = (cell: { task: string; model: string }) =>
      !(samplesByTask.get(cell.task) ?? []).some((s) => s.model === cell.model && s.cost !== null);
    const estimateModels = new Set(plan.filter((c) => c.numbers.length > 0 && lacksHistory(c)).map((c) => c.model));
    const needsCatalog = [...harnessSpecs.values()].some(
      (s) => (costPolicy(s) !== "harness" || estimateModels.has(s.id)) && !config.pricing?.[s.id],
    );
    let catalog: Catalog | null = null;
    let catalogError: string | null = null;
    if (needsCatalog) {
      try {
        catalog = await fetchOpenRouterCatalog();
      } catch (err) {
        catalogError = err instanceof Error ? err.message : String(err);
      }
    }
    const prices = new Map<string, ResolvedPrice | null>();
    /** Ceny tylko do szacunku projekcji (harness z własnym kosztem, komórka bez historii). */
    const estimatePrices = new Map<string, ResolvedPrice | null>();
    for (const spec of harnessSpecs.values()) {
      const policy = costPolicy(spec);
      if (policy === "harness") {
        if (estimateModels.has(spec.id)) estimatePrices.set(spec.id, resolvePrice(spec, config, catalog));
        continue;
      }
      const price = resolvePrice(spec, config, catalog);
      prices.set(spec.id, price);
      const why = catalogError
        ? `katalog cen OpenRouter niedostępny (${catalogError})`
        : `brak "${catalogSlugFor(spec) ?? spec.cliModel}" w katalogu OpenRouter`;
      if (price) {
        console.log(
          `price:  ${spec.id} → ${price.source} ($${price.input}/$${price.output} za 1M in/out)` +
            (policy === "harness-or-priced" ? " — tylko gdy harness nie poda kosztu (timeout)" : ""),
        );
      } else if (policy === "priced") {
        throw new Error(
          `${spec.id}: ${spec.harness} nie raportuje wiarygodnego kosztu, a cena modelu jest nieznana — ${why}; ` +
            `dodaj pricing["${spec.id}"] (USD za 1M tokenów: input, output, cache_read) w bench.config.yaml`,
        );
      } else {
        console.error(
          `warn:   ${spec.id}: brak ceny zapasowej (${why}) — próba przerwana timeoutem nie dostanie kosztu; ` +
            `rozważ pricing["${spec.id}"] w bench.config.yaml`,
        );
      }
    }

    // --- projekcja kosztu + sufit budżetu na cały bieg macierzy ---
    // Komórka bez historii kosztu dostaje SZACUNEK z ceny modelu × tokeny,
    // żeby budżet działał już przy pierwszym pomiarze.
    const budget = opts.maxCost ?? config.defaults.max_cost_usd ?? null;
    let projectedTotal = 0;
    let estimatedTotal = 0;
    let estimatedTrials = 0;
    let projectionUnknown = 0;
    const perTrialUsd = new Map<string, number | null>();
    for (const cell of plan) {
      if (cell.numbers.length === 0) continue;
      const price = prices.get(cell.model) ?? estimatePrices.get(cell.model) ?? null;
      const perTrial = projectTrialCost(samplesByTask.get(cell.task) ?? [], cell.model, price, otherTaskSamples(cell.task));
      perTrialUsd.set(`${cell.task}\0${cell.model}`, perTrial?.usd ?? null);
      if (perTrial === null) {
        projectionUnknown += cell.numbers.length;
        continue;
      }
      projectedTotal += perTrial.usd * cell.numbers.length;
      if (perTrial.basis === "estimate") {
        estimatedTotal += perTrial.usd * cell.numbers.length;
        estimatedTrials += cell.numbers.length;
        console.log(
          `plan:   SZACUNEK ${cell.task} × ${cell.model}: ~$${perTrial.usd.toFixed(2)}/próbę ` +
            `(brak historii kosztu w tym zadaniu; ${perTrial.note.startsWith("mediana kosztu") ? perTrial.note : `cena ${price?.source ?? "?"} × ${perTrial.note}`})`,
        );
      }
    }
    const projectionNote = [
      estimatedTrials > 0
        ? ` (w tym ~$${estimatedTotal.toFixed(2)} SZACUNKU dla ${estimatedTrials} prób bez historii w tym zadaniu — modele różnią się zużyciem tokenów kilkukrotnie, realny koszt bywa 2–5× wyższy; twardym sufitem jest budżet biegu)`
        : "",
      projectionUnknown > 0 ? ` + ${projectionUnknown} prób bez historii kosztu i bez ceny modelu (projekcja niepełna)` : "",
    ].join("");
    console.log(
      `plan:   ${totalPlanned} prób do wykonania; projekcja kosztu ~$${projectedTotal.toFixed(2)}${projectionNote}` +
        (budget !== null ? `; budżet biegu: $${budget}` : "; budżet biegu: brak (ustaw defaults.max_cost_usd)"),
    );
    if (budget !== null && projectedTotal > budget) {
      console.error(
        `warn:   projekcja ($${projectedTotal.toFixed(2)}) przekracza budżet biegu ($${budget}) — ` +
          "runner przerwie zlecanie prób po przekroczeniu sumy kosztów; zawęź macierz albo podnieś budżet świadomie",
      );
    }

    if (opts.planOut) {
      const jobs = plan.flatMap((cell) => {
        const task = loadTask(root, cell.task);
        return cell.numbers.map((trial) => ({
          task: cell.task,
          model: cell.model,
          trial,
          timeout_s: task.timeout_s,
          memory_mb: task.memory_mb ?? config.resources.memory_mb ?? null,
          projected_usd: perTrialUsd.get(`${cell.task}\0${cell.model}`) ?? null,
        }));
      });
      writePlanOut(opts.planOut, { jobs, projected_usd: projectedTotal, budget_usd: budget, projection_unknown: projectionUnknown, estimated_trials: estimatedTrials });
      return 0;
    }

    const engine = detectEngine(opts.engine);
    console.log(`bench attempt: macierz ${models.length} model(i) × ${taskNames.length} zadań → ${outDir} (engine: ${engine})`);

    writeRunMarker(outDir, { tasks: taskNames, models });

    // --- przygotowanie: obraz bazowy + obrazy zadań (jedyny etap z siecią) ---
    // --prepared (supervisor `bench run`): obrazy zbudował supervisor raz na
    // bieg — próba bierze istniejące, bez sieci i bez równoległych buildów.
    const baseImage = opts.prepared && imageExists(engine, baseImageTag(root)) ? baseImageTag(root) : ensureBaseImage(engine, root);
    console.log(`prepare: obraz bazowy ${baseImage}`);

    const repoUrls = new Map(config.base_repos.map((r) => [r.name, r.url]));
    const prepared = new Map<string, PreparedTask>();
    const taskHashes = new Map<string, string>();
    for (const name of new Set(plan.filter((c) => c.numbers.length > 0).map((c) => c.task))) {
      const task = loadTask(root, name);
      const url = repoUrls.get(task.repo);
      if (!url) throw new Error(`tasks/${name}: repo "${task.repo}" nie istnieje w base_repos — uruchom \`bench validate\``);
      const existing = opts.prepared ? existingTaskImage(engine, name, task) : null;
      prepared.set(name, existing ?? prepareTaskImage(engine, root, baseImage, name, task, url));
      taskHashes.set(name, hashTaskDir(join(root, "tasks", name)));
    }

    // --- próby: pool --parallel, bez sieci do repo ---
    const envArgs = trialEnvNames().flatMap((name) => ["-e", name]);
    let spentUsd = 0;
    let overBudget = false;
    let failures = 0;
    let resourceKills = 0;
    let stoppedCount = 0;
    /** Katalogi prób zachowanych w tym biegu (attempt.json zapisany) — do "następny krok". */
    const produced: string[] = [];

    interface TrialSpec {
      name: string;
      task: Task;
      image: string;
      startSha: string;
      model: string;
      harness: HarnessModel;
      trial: number;
      memoryMb: number | null;
      limitArgs: string[];
    }
    const specs: TrialSpec[] = [];
    for (const cell of plan) {
      if (cell.numbers.length === 0) continue;
      const { task, image, startSha } = prepared.get(cell.task) as PreparedTask;
      // Jawny limit zasobów próby: default instancji, nadpisanie per zadanie;
      // wartość idzie do attempt.json i stempli ery.
      const memoryMb = task.memory_mb ?? config.resources.memory_mb ?? null;
      const limitArgs = resourceLimitArgs(memoryMb, config.resources.pids_limit ?? null);
      for (const trial of cell.numbers) {
        specs.push({ name: cell.task, task, image, startSha, model: cell.model, harness: harnessSpecs.get(cell.model) as HarnessModel, trial, memoryMb, limitArgs });
      }
    }

    const parallel = Math.min(opts.parallel ?? config.defaults.parallel, specs.length);
    if (parallel > 1) {
      console.log(`parallel: pool ${parallel} równoczesnych prób`);
      // Sufit per kontener to nie rezerwacja, ale równoczesne piki pamięci
      // sumują się — przekroczenie pamięci maszyny grozi OOM killerem
      // jądra (nieatrybuowalne SIGKILL-e prób). Ostrzegamy, nie blokujemy.
      const maxMemoryMb = Math.max(...specs.map((s) => s.memoryMb ?? 0));
      const machineBytes = engineMemoryBytes(engine);
      if (maxMemoryMb > 0 && machineBytes !== null && parallel * maxMemoryMb * 1024 * 1024 > machineBytes) {
        console.error(
          `warn:  ${parallel} × limit ${maxMemoryMb} MiB > pamięć maszyny silnika (${Math.round(machineBytes / 1024 / 1024)} MiB) — ` +
            "równoczesne piki grożą OOM; zmniejsz --parallel / defaults.parallel albo limity pamięci",
        );
      }
    }

    const runTrial = async ({ name, task, image, startSha, model, harness, trial, memoryMb, limitArgs }: TrialSpec) => {
      const trialDir = join(outDir, name, sanitize(model), `trial-${trial}`);
      const label = `${name} × ${model} × próba ${trial}`;
      // Zachowane próby są nienaruszalne: re-run (--force / --trial-index)
      // odkłada starą próbę obok zamiast ją kasować.
      if (existsSync(join(trialDir, "attempt.json"))) {
        const s = stamp();
        renameSync(trialDir, `${trialDir}.superseded-${s}`);
        console.log(`trial:  ${label} — poprzednia próba odłożona do trial-${trial}.superseded-${s}/`);
      } else {
        // Marker w toku: cudzy i żywy = ktoś inny wykonuje tę próbę (plan
        // był chwilę temu — wyścig dwóch procesów); przeterminowany =
        // proces zginął — artefakty częściowe odkładamy, numer zajmujemy.
        const marker = readRunningMarker(trialDir);
        if (marker === "running") {
          console.log(`trial:  ${label} — w toku w innym procesie bench attempt, pomijam`);
          return;
        }
        if (marker === "stale") {
          const s = stamp();
          renameSync(trialDir, `${trialDir}.aborted-${s}`);
          console.error(`trial:  ${label} — przeterminowany marker w toku (proces zginął?); artefakty częściowe odłożone do trial-${trial}.aborted-${s}/`);
        }
      }
      mkdirSync(trialDir, { recursive: true });
      const startedAt = new Date().toISOString();
      // Zajęcie numeru próby atomowo (flag wx): przegrany wyścig = pomiń.
      try {
        writeFileSync(
          join(trialDir, "running.json"),
          JSON.stringify({ task: name, model, trial, started_at: startedAt, timeout_s: task.timeout_s, pid: process.pid, host: hostname() }, null, 2) + "\n",
          { flag: "wx" },
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          console.log(`trial:  ${label} — właśnie zajęta przez inny proces bench attempt, pomijam`);
          return;
        }
        throw err;
      }

      // Retry 1× przy przejściowej awarii providera — pusta próba
      // z HTTP 500 wliczona do median to pomiar pogody, nie modelu.
      // Ta sama mechanika dla kodów sygnałowych 128+N: SIGKILL bez
      // timeoutu to prawie zawsze wyczerpanie zasobów.
      let execution: { agent_exit: number; timed_out: boolean; wall_duration_s: number } | null = null;
      let infraFailure = false;
      let providerError = false;
      let resourceKill = false;
      let stopped: StopRequest | null = null;
      let attempts = 0;
      const runningPath = join(trialDir, "running.json");
      for (;;) {
        attempts++;
        // Zatrzymanie zlecone, zanim kontener wystartował — nic nie płacimy.
        stopped = readStopRequest(trialDir);
        if (stopped) {
          console.log(`trial:  ${label} — ZATRZYMANA przed startem (${stopped.reason})`);
          break;
        }
        const container = containerName(name, model, trial, attempts);
        const marker = readJsonFile<Record<string, unknown>>(runningPath);
        if (marker) writeJsonAtomic(runningPath, { ...marker, container, attempt: attempts });
        console.log(`trial:  ${label} …`);
        // Puls próby (heartbeat.json z kontenera) → progress.json z kosztem;
        // stop.json → SIGINT do agenta, po STOP_GRACE_S kill kontenera.
        let stopSentAt: number | null = null;
        const watch = setInterval(() => {
          try {
            refreshProgress(trialDir, harness, prices.get(model) ?? null);
            const stop = readStopRequest(trialDir);
            if (!stop) return;
            if (stopSentAt === null) {
              if (sh(engine, stopAgentArgs(container), { timeout: 30_000 }).status === 0) {
                stopSentAt = Date.now();
                console.log(`trial:  ${label} — zatrzymywanie (${stop.reason}): SIGINT do agenta`);
              }
            } else if (Date.now() - stopSentAt > STOP_GRACE_S * 1000) {
              sh(engine, ["kill", container], { timeout: 30_000 });
            }
          } catch {
            // puls nie może przerwać próby
          }
        }, PROGRESS_INTERVAL_MS);
        const result = await shAsync(
          engine,
          [
            "run",
            "--rm",
            "--name",
            container,
            "-v",
            `${trialDir}:/bench/out`,
            ...limitArgs,
            ...envArgs,
            image,
            "/bench/trial.sh",
            String(task.timeout_s),
            harness.harness,
            harness.route,
            harness.cliModel,
          ],
          { timeout: (task.timeout_s + 300) * 1000 },
        );
        clearInterval(watch);
        stopped = readStopRequest(trialDir);

        const executionPath = join(trialDir, "execution.json");
        execution = readTrialJson(executionPath, label);
        infraFailure = !stopped && (result.status !== 0 || !execution);
        providerError = !infraFailure && !stopped && detectProviderError(trialDir, execution, harness);
        // Zatrzymana próba kończy się SIGINT-em (exit 130) — to nie kill zasobowy.
        const signal = !infraFailure && !providerError && !stopped && execution && !execution.timed_out ? signalFromExit(execution.agent_exit) : null;
        if (stopped) {
          stoppedCount++;
          console.error(
            `trial:  ${label} — ZATRZYMANA (${stopped.reason}, zlecił: ${stopped.by}); artefakty częściowe zachowane, próba wyłączona z oceny`,
          );
          break;
        }
        if ((providerError || signal) && attempts === 1) {
          const kind = providerError ? "provider-error" : "signal-kill";
          const archive = join(trialDir, `${kind}-attempt-${attempts}`);
          mkdirSync(archive);
          clearTransient(trialDir, ["heartbeat.json", "heartbeat.json.tmp", "progress.json", "progress.json.tmp"]);
          for (const entry of readdirSync(trialDir)) {
            if (entry === "running.json" || /^(provider-error|signal-kill)-attempt-/.test(entry)) continue;
            renameSync(join(trialDir, entry), join(archive, entry));
          }
          const why = providerError
            ? "awaria providera (5xx/429 w agent.log)"
            : `agent zabity sygnałem (exit ${execution?.agent_exit} = ${signal?.name}${signal?.likely_oom ? ", prawdopodobnie OOM" : ""})`;
          console.error(`trial:  ${label} — ${why}, retry próby; pierwsze podejście: ${archive}`);
          continue;
        }
        if (signal) {
          // Zabita także po retry: nieinterpretowalna — infra_failure
          // wyłącza ją z oceny (bench evaluate pomija), zamiast wliczać
          // zero albo przypadkowy wynik do median.
          resourceKill = true;
          resourceKills++;
          const logPath = join(trialDir, "agent.log");
          const logTail = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-4000) : null;
          writeFileSync(
            join(trialDir, "signal.json"),
            JSON.stringify(
              {
                agent_exit: execution?.agent_exit,
                signal: signal.signal,
                signal_name: signal.name,
                likely_oom: signal.likely_oom,
                memory_limit_mb: memoryMb,
                hint: signal.likely_oom
                  ? memoryMb !== null
                    ? `SIGKILL przy limicie ${memoryMb} MiB — podnieś resources.memory_mb / task.memory_mb albo zapiecz środowisko polem prepare w task.yaml`
                    : "SIGKILL bez jawnego limitu — najpewniej OOM killer maszyny silnika; ustaw resources.memory_mb (atrybucja) i sprawdź pamięć maszyny (bench doctor)"
                  : "kod sygnałowy bez timeoutu — sprawdź agent.log i stabilność środowiska",
                agent_log_tail: logTail,
              },
              null,
              2,
            ) + "\n",
          );
          console.error(
            `trial:  ${label} — ZABITA sygnałem ${signal.name} także po retry (${signal.likely_oom ? "prawdopodobnie OOM" : "przyczyna nieznana"}); ` +
              `próba nieinterpretowalna, wyłączona z oceny; diagnostyka: ${trialDir}/signal.json`,
          );
        } else if (infraFailure) {
          failures++;
          writeFileSync(join(trialDir, "container.log"), (result.stdout ?? "") + (result.stderr ?? ""));
          console.error(`trial:  ${label} — AWARIA infrastruktury (kod ${result.status}); szczegóły: ${trialDir}/container.log`);
        } else if (execution && execution.timed_out) {
          console.log(`trial:  ${label} — TIMEOUT po ${task.timeout_s}s (artefakty częściowe zapisane)`);
        } else if (execution) {
          const note = providerError ? ", provider_error także po retry" : "";
          console.log(`trial:  ${label} — zakończona (agent exit ${execution.agent_exit}, ${execution.wall_duration_s}s${note})`);
        }
        break;
      }

      // Pliki instrukcji, które agent zastał (trial.sh) → attempt.json.
      const contextList = join(trialDir, "context-files.txt");
      const contextFiles = existsSync(contextList)
        ? readFileSync(contextList, "utf8").split("\n").filter(Boolean)
        : null;
      rmSync(contextList, { force: true });

      // trial.sh usuwa uciętą kopię workspace/ i zostawia znacznik.
      const workspaceMarker = join(trialDir, "workspace-incomplete.txt");
      const workspaceCut = existsSync(workspaceMarker);
      // Bez kontenera (zatrzymana przed startem, awaria silnika) workspace'u po prostu nie ma.
      const workspacePreserved = !workspaceCut && existsSync(join(trialDir, "workspace"));
      if (workspaceCut) {
        rmSync(workspaceMarker, { force: true });
        console.error(
          `trial:  ${label} — workspace/ NIE zachowany (pełny dysk?); patch.diff i metryki są całe — ` +
            "ocena statyczna i testy działają, sędzia-z-narzędziami nie ma czego badać; zwolnij miejsce i powtórz próbę (--trial-index)",
        );
      }

      // Koszt wg polityki harnessu (lib/pricing.ts): wycena z tokenów tam,
      // gdzie harness nie daje wiarygodnego kosztu — ze źródłem w metrics.json.
      const metricsFile = join(trialDir, "metrics.json");
      const metrics = readTrialJson<Record<string, unknown>>(metricsFile, label);
      if (metrics) {
        const note = finalizeCost(metrics, harness, prices.get(model) ?? null);
        if (note) {
          writeFileSync(metricsFile, JSON.stringify(metrics, null, 2) + "\n");
          console.log(`cost:   ${label} — ${note}`);
        }
      }

      writeFileSync(
        join(trialDir, "attempt.json"),
        JSON.stringify(
          {
            format: ATTEMPT_FORMAT_VERSION,
            task: name,
            model,
            harness: { name: harness.harness, version: harnessVersion(root, harness.harness), route: harness.route },
            context_files: contextFiles === null ? null : { present: contextFiles, policy: config.defaults.context_files },
            trial,
            image,
            start_sha: startSha,
            pinned_commit: task.commit,
            task_hash: taskHashes.get(name),
            kit_version: kitVersion,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            timeout_s: task.timeout_s,
            memory_limit_mb: memoryMb,
            infra_failure: infraFailure || resourceKill || stopped !== null,
            provider_error: providerError,
            resource_kill: resourceKill,
            stopped,
            attempts,
            execution,
            workspace_preserved: workspacePreserved,
          },
          null,
          2,
        ) + "\n",
      );
      // attempt.json zapisany = próba zachowana; marker w toku i pliki pulsu schodzą.
      rmSync(join(trialDir, "running.json"), { force: true });
      clearTransient(trialDir, ["heartbeat.json", "heartbeat.json.tmp", "progress.json", "progress.json.tmp", "stop.json"]);
      produced.push(trialDir);

      // Budżet biegu: nie zlecaj kolejnych prób, gdy suma przekroczy limit
      // (pool sprawdza flagę przed startem każdej próby; próby już
      // biegnące kończą się normalnie).
      if (budget !== null) {
        spentUsd += typeof metrics?.cost_usd === "number" ? metrics.cost_usd : 0;
        if (spentUsd > budget && !overBudget) {
          overBudget = true;
          console.error(
            `budget: przekroczony sufit biegu ($${spentUsd.toFixed(4)} > $${budget}) — nie zlecam kolejnych prób; ` +
              "wykonane próby są zachowane do oceny (bench evaluate); podnieś budżet, jeśli to świadoma decyzja",
          );
        }
      }
    };

    // Pool: `parallel` torów zdejmuje próby z listy w kolejności macierzy;
    // przekroczony budżet zatrzymuje zlecanie nowych, nie ubija biegnących.
    // Błąd jednej próby (np. zapis na pełny dysk) nie zabija biegu: próba
    // liczy się jako awaria infrastruktury; pełny dysk zatrzymuje zlecanie
    // nowych prób — wydane pieniądze i zachowane próby zostają.
    let nextSpec = 0;
    let diskFull = false;
    await Promise.all(
      Array.from({ length: parallel }, async () => {
        while (nextSpec < specs.length && !overBudget && !diskFull) {
          const spec = specs[nextSpec++] as TrialSpec;
          try {
            await runTrial(spec);
          } catch (err) {
            failures++;
            const label = `${spec.name} × ${spec.model} × próba ${spec.trial}`;
            if (isDiskFull(err)) {
              diskFull = true;
              console.error(
                `trial:  ${label} — PEŁNY DYSK (${(err as NodeJS.ErrnoException).code ?? "errno -122"}) — nie zlecam kolejnych prób; ` +
                  "zwolnij miejsce (`df -h` dla attempts/ i TMPDIR; tmpfs ma też limit per użytkownik), potem `bench attempt` dokończy brakujące próby",
              );
            } else {
              console.error(`trial:  ${label} — błąd runnera: ${err instanceof Error ? err.message : String(err)} — próba liczona jako awaria infrastruktury`);
            }
          }
        }
      }),
    );

    // Przekroczenie budżetu PO ostatniej próbie niczego nie ucina — pieniądze
    // już wydane, próby zachowane; głośny warning zamiast wywrotki. Kod 1
    // dopiero, gdy budżet realnie pominął zaplanowane próby.
    const skippedByBudget = diskFull ? 0 : specs.length - nextSpec;
    const skippedByDisk = diskFull ? specs.length - nextSpec : 0;
    const budgetNote = budget !== null ? `, koszt prób $${spentUsd.toFixed(4)}/$${budget}` : "";
    const killNote =
      (resourceKills
        ? ` (${resourceKills} prób ZABITYCH sygnałem — nieinterpretowalne, wyłączone z oceny; diagnostyka w signal.json, próby do powtórzenia po naprawie zasobów)`
        : "") + (stoppedCount ? ` (${stoppedCount} prób ZATRZYMANYCH na żądanie — wyłączone z oceny; powód w attempt.json → stopped)` : "");
    const status = diskFull
      ? `PRZERWANE (pełny dysk) — ${skippedByDisk} prób(y) niezlecone`
      : overBudget
      ? skippedByBudget > 0
        ? `PRZERWANE (budżet) — ${skippedByBudget} prób(y) niezlecone`
        : "gotowe (budżet przekroczony po ostatniej próbie — nic nie pominięto)"
      : "gotowe";
    console.log(
      `\nbench attempt: ${status} → ${outDir}${failures ? ` (${failures} prób z awarią infrastruktury)` : ""}${killNote}${budgetNote}` +
        `\n${nextStepLine(root, produced, opts.smoke, config.judge.mode)}`,
    );
    return failures > 0 || resourceKills > 0 || skippedByBudget > 0 || skippedByDisk > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
