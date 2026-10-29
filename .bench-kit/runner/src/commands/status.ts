/**
 * bench status — stan macierzy z dysku: zachowane próby (attempts/),
 * próby w toku (running.json), oceny (results/). Tracker benchmarku to
 * pliki w drzewie instancji — ta komenda je tylko czyta, niczego nie
 * zmienia. Pozwala prowadzić bieg nieblokująco: `bench run` (albo
 * `bench attempt`) w tle lub na drugiej maszynie, a tu widać, co gotowe
 * do oceny, co właśnie robi każda próba w toku (puls: czynność, koszt
 * ~$, cisza pulsu), co jest oceniane i które biegi `bench run` trwają.
 *
 * Per komórka (zadanie × model): cel prób (defaults.trials), zachowane,
 * w toku, nieinterpretowalne (infra/kill), ocenione (results/ w bieżącej
 * erze oceny: task_hash + sędzia + wersje rubryk + scoring; ocena z innej
 * ery = "stara", z powodem — do re-oceny), koszt prób.
 *
 * Użycie: bench status [--tasks x,y] [--models a,b] [--json] [--root <dir>]
 *                     [--wait [--timeout <s>] [--interval <s>] [--until-evaluated]]
 * (bez argumentów: zadania z tasks/, modele z defaults.models + wszystkie
 *  modele obecne w attempts/)
 *
 * `--wait` blokuje do chwili, gdy w pokazanych komórkach nie ma prób
 * w toku (żywe markery running.json; przeterminowany albo z martwym PID-em
 * na tej maszynie = nie w toku), wypisując linię postępu przy każdej
 * zmianie, potem zwykłą tabelę. Zastępuje pętle `pgrep -f …`, które
 * łapią własną powłokę. `--until-evaluated` czeka dodatkowo, aż każda
 * zachowana próba ma świeżą ocenę. Kod 0 = bezczynne, 124 = --timeout.
 */
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { findInstanceRoot, isDemoTask, listTaskNames, loadConfig } from "../lib/instance.ts";
import { cellStatus, currentEvalEra, liveRuns, modelsInAttempts, type CellStatus } from "../lib/matrix.ts";
import { backlogStates } from "./backlog.ts";
import { activeRunLines } from "./run.ts";
import { QUIET_HEARTBEAT_S } from "../lib/progress.ts";

interface Options {
  root: string;
  tasks: string[] | null;
  models: string[] | null;
  json: boolean;
  wait: boolean;
  /** Sufit czekania w sekundach; null = bez limitu. */
  timeoutS: number | null;
  intervalS: number;
  untilEvaluated: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = {
    root: process.cwd(),
    tasks: null,
    models: null,
    json: false,
    wait: false,
    timeoutS: null,
    intervalS: 15,
    untilEvaluated: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--tasks") opts.tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--models") opts.models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else if (arg === "--wait") opts.wait = true;
    else if (arg === "--timeout") opts.timeoutS = Number(value());
    else if (arg === "--interval") opts.intervalS = Number(value());
    else if (arg === "--until-evaluated") opts.untilEvaluated = true;
    else return null;
  }
  if (opts.timeoutS !== null && !(Number.isFinite(opts.timeoutS) && opts.timeoutS > 0)) return null;
  if (!(Number.isFinite(opts.intervalS) && opts.intervalS > 0)) return null;
  // Flagi czekania bez --wait to pomyłka, nie cichy no-op.
  if (!opts.wait && (opts.timeoutS !== null || opts.untilEvaluated)) return null;
  return opts;
}

const elapsed = (iso: string | null): string => {
  const started = Date.parse(iso ?? "");
  if (!Number.isFinite(started)) return "?";
  const minutes = Math.round((Date.now() - started) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export interface NextStepInput {
  /** Wszystkie zadania instancji (nie tylko przefiltrowane --tasks). */
  allTasks: string[];
  /** Zachowane próby (attempt.json) w pokazanych komórkach. */
  preserved: number;
  running: number;
  /** Zachowane próby bez świeżej oceny. */
  toEvaluate: number;
  /** Próby brakujące do celu defaults.trials. */
  missing: number;
  /** Zlecenia z tasks/backlog.md jeszcze bez zadania (etap ordered z `bench backlog`). */
  pendingOrders?: number;
}

/**
 * Linia "następny krok" statusu. Zero prób to "jeszcze nic", nie "wszystko
 * ocenione"; instancja z samym zadaniem-demo potrzebuje prawdziwych zadań
 * (bench-create-task), a nie pełnej macierzy na demo.
 */
export function statusNextStep({ allTasks, preserved, running, toEvaluate, missing, pendingOrders = 0 }: NextStepInput): string {
  const demoOnly = allTasks.length > 0 && allTasks.every(isDemoTask);
  const defineHint = "zdefiniuj prawdziwe zadania skillem bench-create-task (kopanie zmergowanych PR-ów na zadania)";
  // Zlecenia już są (decyzje zapadły) — następny krok to budowa, nie kopanie od nowa.
  const buildHint = `zlecenia w tasks/backlog.md czekające na budowę: ${pendingOrders} → bench-create-task (zbuduj backlog)`;
  if (allTasks.length === 0) return pendingOrders > 0 ? `następny krok: ${buildHint}` : `następny krok: brak zadań — ${defineHint}`;
  const parts: string[] = [];
  if (toEvaluate > 0) parts.push(`${toEvaluate} zachowanych prób bez świeżej oceny → bench evaluate`);
  else if (preserved === 0) parts.push(running > 0 ? `jeszcze brak zachowanych prób (${running} w toku)` : "jeszcze brak zachowanych prób");
  else parts.push("wszystkie zachowane próby ocenione");
  if (demoOnly) {
    parts.push(
      `jedyne zadania to demo (${allTasks.join(", ")}) — mierzą rury, nie pracę firmy; ${defineHint}, zamiast dogrywać macierz na demo`,
    );
  } else if (missing > 0) {
    parts.push(`${missing} prób(y) brakuje do celu → bench run (dogania braki w tle, z oceną)`);
  }
  if (pendingOrders > 0) parts.push(buildHint);
  return `następny krok: ${parts.join("; ")}`;
}

/** Zlecenia czekające na budowę — parser `bench backlog`; uszkodzony backlog nie psuje statusu. */
function pendingOrderCount(root: string): number {
  try {
    return backlogStates(root).orders.filter((o) => o.stage === "ordered").length;
  } catch {
    return 0;
  }
}

export interface WaitProgress {
  running: number;
  /** Zachowane próby, które `bench evaluate` właśnie ocenia (żywy evaluating.json). */
  evaluating: number;
  preserved: number;
  target: number;
  /** Zachowane próby ze świeżą oceną. */
  evaluated: number;
}

/** Postęp macierzy do `--wait` — tylko z odczytu dysku (CellStatus). */
export function waitProgress(cells: CellStatus[]): WaitProgress {
  const trials = cells.flatMap((c) => c.trials);
  return {
    running: trials.filter((t) => t.state === "running").length,
    evaluating: trials.filter((t) => t.evaluating === true).length,
    preserved: trials.filter((t) => t.state === "done").length,
    target: cells.reduce((acc, c) => acc + c.target, 0),
    evaluated: trials.filter((t) => t.state === "done" && t.evaluated === "fresh").length,
  };
}

export const waitLine = (p: WaitProgress, untilEvaluated: boolean): string =>
  `${p.running} w toku, ${p.preserved}/${p.target} zachowanych` +
  (untilEvaluated ? `, ${p.evaluated}/${p.preserved} ocenionych` : "") +
  (p.evaluating ? `, ${p.evaluating} oceniane` : "");

/** Koniec czekania: nic w toku (i — z --until-evaluated — nic bez świeżej oceny ani w trakcie oceny). */
export const waitDone = (p: WaitProgress, untilEvaluated: boolean): boolean =>
  p.running === 0 && (!untilEvaluated || (p.evaluating === 0 && p.evaluated >= p.preserved));

/** Szczegół próby w toku: czynność z pulsu, koszt w trakcie, ostrzeżenie o ciszy pulsu. */
export function runningDetail(t: Pick<CellStatus["trials"][number], "progress" | "heartbeat_age_s">): string {
  const parts: string[] = [];
  if (t.progress?.activity) parts.push(t.progress.activity);
  if (typeof t.progress?.cost_usd === "number") parts.push(`~$${t.progress.cost_usd.toFixed(2)}`);
  if (t.heartbeat_age_s !== null && t.heartbeat_age_s > QUIET_HEARTBEAT_S) parts.push(`BRAK PULSU od ${t.heartbeat_age_s} s — utknęła?`);
  return parts.join(" · ");
}

export async function statusCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error(
      "usage: bench status [--tasks x,y] [--models a,b] [--json] [--root <dir>]\n" +
        "                    [--wait [--timeout <s>] [--interval <s>] [--until-evaluated]]",
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
    const allTasks = listTaskNames(root);
    const tasks = opts.tasks ?? allTasks;
    for (const name of tasks) {
      if (!allTasks.includes(name)) throw new Error(`nieznane zadanie: ${name}`);
    }
    const target = config.defaults.trials;
    let models: string[] = [];
    const collect = (): CellStatus[] => {
      // Modele z attempts/ liczone na nowo — bieg w tle może dołożyć komórkę.
      models = opts.models ?? [...new Set([...config.defaults.models, ...modelsInAttempts(root, tasks)])];
      const found: CellStatus[] = [];
      for (const task of tasks) {
        const era = currentEvalEra(root, config, task);
        for (const model of models) found.push(cellStatus(root, task, model, target, era));
      }
      return found;
    };
    let cells = collect();

    if (opts.wait) {
      const deadline = opts.timeoutS !== null ? Date.now() + opts.timeoutS * 1000 : null;
      let last = "";
      let idleSeen = 0;
      for (;;) {
        const progress = waitProgress(cells);
        // Bieg bench attempt bez próby w toku = przygotowanie obrazów (albo
        // luka między próbami): to nadal praca, nie koniec.
        const runs = liveRuns(join(root, "attempts"));
        const preparing = runs > 0 && progress.running === 0;
        const line = waitLine(progress, opts.untilEvaluated) + (preparing ? ` — bieg w toku (${runs}), żadna próba teraz nie biegnie (przygotowanie, kolejka albo ocena)` : "");
        // Przy --json postęp idzie na stderr — stdout zostaje czystym JSON-em.
        const say = opts.json ? console.error : console.log;
        if (last === "" && runs === 0 && progress.running === 0 && progress.preserved < progress.target) {
          say("info: nic nie jest w toku — żaden bench run / bench attempt nie biegnie dla tej instancji");
        }
        if (line !== last) say(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
        last = line;
        // Bezczynność potwierdzona dwoma odczytami: między końcem jednej
        // próby a markerem następnej (pool bench attempt) jest krótka luka.
        idleSeen = runs === 0 && waitDone(progress, opts.untilEvaluated) ? idleSeen + 1 : 0;
        if (idleSeen >= 2) break;
        if (deadline !== null && Date.now() >= deadline) {
          console.error(`error: --timeout ${opts.timeoutS}s minął — nadal ${line} (szczegóły: bench status)`);
          return 124;
        }
        const pauseMs = (idleSeen === 1 ? Math.min(opts.intervalS, 5) : opts.intervalS) * 1000;
        await sleep(deadline !== null ? Math.max(0, Math.min(pauseMs, deadline - Date.now())) : pauseMs);
        cells = collect();
      }
      if (!opts.json) console.log("");
    }

    if (opts.json) {
      console.log(JSON.stringify({ target_trials: target, cells }, null, 2));
      return 0;
    }

    const rows = cells.map((cell) => {
      const done = cell.trials.filter((t) => t.state === "done");
      const running = cell.trials.filter((t) => t.state === "running").length;
      const stale = cell.trials.filter((t) => t.state === "stale").length;
      const infra = cell.trials.filter((t) => t.state === "infra").length;
      const fresh = done.filter((t) => t.evaluated === "fresh").length;
      const old = done.filter((t) => t.evaluated === "old").length;
      const cost = done.reduce((acc, t) => acc + (t.cost_usd ?? 0), 0);
      const missing = Math.max(0, cell.target - done.length - running);
      const evaluated = `${fresh}/${done.length}${old ? ` (+${old} z innej ery)` : ""}`;
      const notes = [
        running ? `${running} w toku` : "",
        stale ? `${stale} PRZETERMINOWANE` : "",
        infra ? `${infra} infra` : "",
        cell.aborted ? `${cell.aborted} aborted` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        task: cell.task,
        model: cell.model,
        preserved: `${done.length}/${cell.target}`,
        evaluated,
        missing: String(missing),
        cost: `$${cost.toFixed(2)}`,
        notes,
      };
    });
    const headers = { task: "zadanie", model: "model", preserved: "zachowane", evaluated: "ocenione", missing: "brakuje", cost: "koszt prób", notes: "uwagi" };
    const keys = Object.keys(headers) as (keyof typeof headers)[];
    const width = Object.fromEntries(keys.map((k) => [k, Math.max(headers[k].length, ...rows.map((r) => r[k].length))])) as Record<keyof typeof headers, number>;
    const line = (r: Record<keyof typeof headers, string>) => keys.map((k) => r[k].padEnd(width[k])).join("  ").trimEnd();
    console.log(`bench status: ${tasks.length} zadań × ${models.length} modeli, cel ${target} prób(y) na komórkę (defaults.trials)\n`);
    console.log(line(headers));
    for (const row of rows) console.log(line(row));

    const running = cells.flatMap((c) => c.trials.filter((t) => t.state === "running").map((t) => ({ ...t, task: c.task, model: c.model })));
    const stale = cells.flatMap((c) => c.trials.filter((t) => t.state === "stale").map((t) => ({ ...t, task: c.task, model: c.model })));
    if (running.length > 0) {
      console.log("\nw toku:");
      for (const t of running) {
        const detail = runningDetail(t);
        console.log(`  ${t.task} × ${t.model} × próba ${t.trial} — od ${elapsed(t.started_at)}${detail ? ` · ${detail}` : ""}`);
      }
    }
    const evaluating = cells.flatMap((c) => c.trials.filter((t) => t.evaluating).map((t) => ({ ...t, task: c.task, model: c.model })));
    if (evaluating.length > 0) {
      console.log("\noceniane teraz (bench evaluate):");
      for (const t of evaluating) console.log(`  ${t.task} × ${t.model} × próba ${t.trial}`);
    }
    const runLines = activeRunLines(root);
    if (runLines.length > 0) {
      console.log("\nbiegi bench run (szczegóły: bench run status <id>):");
      for (const l of runLines) console.log(l);
    }
    if (stale.length > 0) {
      console.log("\nprzeterminowane markery (proces bench attempt zginął?) — następny bench run / bench attempt odłoży je do trial-N.aborted-*:");
      for (const t of stale) console.log(`  ${t.task} × ${t.model} × próba ${t.trial} — start ${t.started_at ?? "?"}`);
    }
    // Ocena z innej ery to nie "oceniona": zmiana rubryki / sędziego /
    // zadania wymaga RE-OCENY zachowanych prób — tu widać, których i dlaczego.
    const oldByReason = new Map<string, string[]>();
    for (const cell of cells) {
      for (const t of cell.trials) {
        if (t.evaluated !== "old") continue;
        const key = t.stale_reasons.join("; ");
        oldByReason.set(key, [...(oldByReason.get(key) ?? []), `${cell.task} × ${cell.model} × próba ${t.trial}`]);
      }
    }
    if (oldByReason.size > 0) {
      console.log("\nocenione w innej erze (do re-oceny zachowanych prób — bez nowego biegu):");
      for (const [reason, trials] of oldByReason) {
        console.log(`  ${reason}: ${trials.length} prób(y)${trials.length <= 3 ? ` — ${trials.join(", ")}` : ""}`);
      }
    }
    const toEvaluate = cells.reduce((acc, c) => acc + c.trials.filter((t) => t.state === "done" && t.evaluated !== "fresh").length, 0);
    // Demo obok prawdziwych zadań (instancja po update z szablonu ≤0.33)
    // nie jest celem do dogrania — liczy się tylko, gdy jest jedynym zadaniem.
    const countsToward = (task: string) => allTasks.every(isDemoTask) || !isDemoTask(task);
    const missing = rows.filter((r) => countsToward(r.task)).reduce((acc, r) => acc + Number(r.missing), 0);
    const preserved = cells.reduce((acc, c) => acc + c.trials.filter((t) => t.state === "done").length, 0);
    console.log(`\n${statusNextStep({ allTasks, preserved, running: running.length, toEvaluate, missing, pendingOrders: pendingOrderCount(root) })}`);
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
