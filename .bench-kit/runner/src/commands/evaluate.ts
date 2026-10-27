/**
 * bench evaluate — ocenia ZACHOWANE PRÓBY (kontrakt ATTEMPT_FORMAT.md)
 * i produkuje result.json w kanonicznym drzewie wyników `results/`
 * w repo instancji. Ocena jest procesem niezależnym od wykonania:
 * uruchamialna wielokrotnie, na dowolnej wersji rubryki/sędziego,
 * bez ponownego płacenia za wykonanie — nowa rubryka = re-ocena
 * zachowanych prób, nie nowy bieg macierzy.
 *
 * Przebieg per próba:
 * 1. Asercje nie-LLM-owe (static → tests → e2e): świeży kontener
 *    z obrazu zadania (odtwarzany z task.yaml, gdy nie ma go lokalnie),
 *    patch.diff nakładany na /workspace, asercje montowane :ro —
 *    izolacja z konstrukcji. Wynik → checks.json (guardy = FAKTY dla
 *    sędziego-z-narzędziami).
 * 2. Składowa judge:
 *    - `--verdict <plik>` (pojedyncza próba): werdykt przygotowany przez
 *      sędziego-agenta z narzędziami (bench-measure → RATE_ATTEMPT.md) albo
 *      człowieka — JSON w formacie rubryki; runner parsuje i liczy total
 *      z wag frontmattera. Autor jest obowiązkowy (`--judge-mode agent`
 *      + `--judge-model`, albo `--judge-mode human`) i trafia do stempli
 *      (`judge_mode`) — werdykty API, agenta i człowieka to różne ery,
 *    - bez --verdict: wywołanie API modelu sędziego (prompt.md +
 *      patch.diff + rubryka) — ścieżka automatyczna (CI/smoke),
 *    - `--skip-judge`: tylko guardy (krok 1 procedury rate-attempt);
 *      result.json nie powstaje, composant judge czeka na werdykt.
 *    Fold `--verdict` używa guardów z poprzedniego przebiegu (checks.json
 *    + checks.stamp.json), gdy są DOWODNIE świeże (lib/guard-stamp.ts:
 *    task_hash, asercje puli, id obrazu oceny, patch, limity); inaczej
 *    liczy je od nowa. `--rerun-guards` wymusza ponowne uruchomienie.
 * 3. result.json: scores, total = ważona suma (miara jakości), `passed` =
 *    BRAMKA: każdy guard z wagą > 0 na 1 ORAZ judge ≥ pass_threshold
 *    (guardy to fakty — nie da się ich "nadrobić" opinią sędziego), koszt/czas/tokeny
 *    z metrics.json, stemple er (scoring_version, task_hash BIEŻĄCY,
 *    judge_model, rubric_version, memory_limit_mb z próby). Era oceny
 *    jest ODKLEJONA od ery wykonania — rozjazd task_hash próby
 *    i bieżącego to głośny warning.
 * 4. Zapis: result.json + judge.json w katalogu próby ORAZ w
 *    results/<zadanie>/<model>/trial-<n>/ (commituje operator; git
 *    wersjonuje historię ocen). `--no-write-results` (smoke) nie zapisuje
 *    werdyktu NIGDZIE — wynik tylko na stdout; przy próbie zostają same
 *    fakty (checks.json + checks.stamp.json), żeby późniejszy
 *    sędzia-z-narzędziami nie zastał cudzego werdyktu.
 *
 * Próby z awarią infrastruktury (infra_failure) są pomijane z warningiem.
 *
 * Użycie:
 *   bench evaluate [--attempt <dir>]... [--attempts <dir>]
 *                  [--results <dir> | --no-write-results]
 *                  [--skip-judge | --verdict <plik> --judge-mode agent|human [--judge-model <id>] [--rerun-guards]]
 *                  [--no-deps-cache] [--engine docker|podman] [--root <dir>]
 * (bez argumentów: wszystkie zachowane próby z attempts/ w korzeniu)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { resolveAttemptPath } from "../lib/attempt-path.ts";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { hashTaskDir, rubricVersionStamp } from "../lib/era.ts";
import { judgeTrial, parseRubric, parseVerdict, type JudgeVerdict } from "../lib/judge.ts";
import { buildEvalPlan } from "../lib/reference.ts";
import { underlyingModel } from "../lib/harness.ts";
import { depsCacheArgs, detectEngine, ensureBaseImage, containerFailureMessage, resourceLimitArgs, sh } from "../lib/containers.ts";
import { fileSha256, GUARD_STAMP_FILE, guardFingerprint, guardStampFreshness, type GuardStamp } from "../lib/guard-stamp.ts";
import { imageExists, prepareTaskImage, sanitize } from "../lib/prepare.ts";
import { ATTEMPT_FORMAT_VERSION, AttemptSchema, type Attempt } from "../schemas/attempt.ts";
import { ResultSchema, type Result } from "../schemas/result.ts";
import type { Task } from "../schemas/task.ts";

interface Options {
  root: string;
  attempts: string[];
  attemptsDir: string | null;
  results: string | null;
  noWriteResults: boolean;
  skipJudge: boolean;
  verdict: string | null;
  /** Autor werdyktu z pliku: agent (rate-attempt) albo człowiek — część ery. */
  judgeMode: "agent" | "human" | null;
  /** Model, który (wg deklaracji) napisał werdykt agenta. */
  judgeModel: string | null;
  /** Pozwala ocenie API nadpisać wynik oceniony przez agenta/człowieka. */
  overwriteJudged: boolean;
  engine: string | null;
  noDepsCache: boolean;
  /** Fold --verdict: guardy od nowa mimo świeżego checks.json. */
  rerunGuards: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = {
    root: process.cwd(),
    attempts: [],
    attemptsDir: null,
    results: null,
    noWriteResults: false,
    skipJudge: false,
    verdict: null,
    judgeMode: null,
    judgeModel: null,
    overwriteJudged: false,
    engine: null,
    noDepsCache: false,
    rerunGuards: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    // Surowa ścieżka — rozwiązywana po znalezieniu korzenia (resolveAttemptPath:
    // względna wobec cwd albo korzenia, surowe id modelu → katalog sanitize).
    if (arg === "--attempt") opts.attempts.push(value() ?? "");
    else if (arg === "--attempts") opts.attemptsDir = resolve(value() ?? "");
    else if (arg === "--results") opts.results = resolve(value() ?? "");
    else if (arg === "--no-write-results") opts.noWriteResults = true;
    else if (arg === "--skip-judge") opts.skipJudge = true;
    else if (arg === "--verdict") opts.verdict = resolve(value() ?? "");
    else if (arg === "--judge-mode") {
      const mode = value();
      if (mode !== "agent" && mode !== "human") return null;
      opts.judgeMode = mode;
    } else if (arg === "--judge-model") opts.judgeModel = value() ?? null;
    else if (arg === "--overwrite-judged") opts.overwriteJudged = true;
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--no-deps-cache") opts.noDepsCache = true;
    else if (arg === "--rerun-guards") opts.rerunGuards = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (opts.attempts.length > 0 && opts.attemptsDir) return null;
  if (opts.verdict && opts.skipJudge) return null;
  // Werdykt z pliku bez deklaracji autora to werdykt bez proweniencji —
  // nie do odróżnienia od ręcznie wpisanego JSON-a. Autor jest wymagany.
  if (opts.verdict && !opts.judgeMode) return null;
  if (opts.judgeMode === "agent" && !opts.judgeModel) return null;
  if (!opts.verdict && (opts.judgeMode || opts.judgeModel)) return null;
  if (opts.rerunGuards && !opts.verdict) return null;
  return opts;
}

interface AttemptRef {
  dir: string;
  meta: Attempt;
}

/** Zachowane próby: katalogi z attempt.json parsującym się schematem. */
function findAttempts(dir: string): AttemptRef[] {
  const found: AttemptRef[] = [];
  const walk = (current: string) => {
    const attemptJson = join(current, "attempt.json");
    if (existsSync(attemptJson)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(attemptJson, "utf8"));
      } catch {
        console.error(`warn:  pomijam nieparsowalny ${attemptJson}`);
        return;
      }
      const parsed = AttemptSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`warn:  pomijam ${attemptJson} — nie spełnia schematu zachowanej próby (ATTEMPT_FORMAT.md)`);
        return;
      }
      if (parsed.data.format > ATTEMPT_FORMAT_VERSION) {
        console.error(
          `warn:  pomijam ${attemptJson} — format ${parsed.data.format} nowszy niż obsługiwany (${ATTEMPT_FORMAT_VERSION}); zaktualizuj kit`,
        );
        return;
      }
      found.push({ dir: current, meta: parsed.data });
      return;
    }
    if (existsSync(join(current, "running.json"))) {
      // Próba w toku (bench attempt jeszcze nie zapisał attempt.json) —
      // nie ma czego oceniać; stan i przeterminowane markery: bench status.
      console.error(`skip:  ${current} — próba w toku (running.json), ocena po zakończeniu`);
      return;
    }
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory() && !/\.(superseded|aborted)-/.test(name)) walk(full);
    }
  };
  walk(dir);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

const NON_JUDGE = ["static", "tests", "e2e"] as const;
type Component = (typeof NON_JUDGE)[number] | "judge";

/** Ocena asercji nie-LLM-owych w kontenerze; zwraca score per ref. */
function runChecksContainer(
  engine: string,
  root: string,
  trialDir: string,
  image: string,
  refs: string[],
  depsCache: boolean,
  memoryMb: number | null,
  pidsLimit: number | null,
): Map<string, number> {
  writeFileSync(join(trialDir, "eval-plan.json"), JSON.stringify(buildEvalPlan(root, refs), null, 2) + "\n");

  const mounts = refs.flatMap((ref) => ["-v", `${join(root, "evaluation-pool", ref)}:/bench/assertions/${ref}:ro`]);
  const result = spawnSync(
    engine,
    [
      "run",
      "--rm",
      "-v",
      `${trialDir}:/bench/out`,
      ...resourceLimitArgs(memoryMb, pidsLimit),
      ...depsCacheArgs(depsCache),
      ...mounts,
      image,
      "node",
      "/bench/evaluate.mjs",
    ],
    { encoding: "utf8", timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0 || !existsSync(join(trialDir, "checks.json"))) {
    // OOM w ocenie wyzerowałby miarę pracy i wyglądał jak porażka modelu —
    // kod sygnałowy nazywamy zamiast zgadywać.
    throw new Error(containerFailureMessage(result, memoryMb));
  }
  const checks = JSON.parse(readFileSync(join(trialDir, "checks.json"), "utf8")) as Record<string, { score: number }>;
  return new Map(refs.map((ref) => [ref, checks[ref]?.score ?? 0]));
}

/**
 * Werdykt z pliku (procedura rate-attempt skilla bench-measure): JSON w formacie rubryki —
 * pojedynczy obiekt (jedna rubryka zadania) albo mapa
 * { "<nazwa-rubryki>": <werdykt> } przy wielu rubrykach.
 */
function verdictFromFile(raw: string, ref: string, judgeRefs: string[], weights: Record<string, number> | null): JudgeVerdict {
  let source = raw;
  if (judgeRefs.length > 1) {
    const name = ref.split("/")[1] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = parsed[name] ?? parsed[ref];
    if (entry === undefined) {
      throw new Error(`plik werdyktu nie ma wpisu dla rubryki "${name}" (zadanie używa ${judgeRefs.length} rubryk — oczekiwano mapy nazwa → werdykt)`);
    }
    source = JSON.stringify(entry);
  }
  const verdict = parseVerdict(source, weights);
  return { ...verdict, finish_reason: null, usage: null };
}

export async function evaluateCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error(
      [
        "usage: bench evaluate [--attempt <dir>]... [--attempts <dir>]",
        "                      [--results <dir> | --no-write-results]",
        "                      [--skip-judge | --verdict <plik> --judge-mode agent|human [--judge-model <id>] [--rerun-guards] (z jednym --attempt)]",
        "                      [--overwrite-judged]",
        "                      [--no-deps-cache] [--engine docker|podman] [--root <dir>]",
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
    const templateVersion = readFileSync(join(root, ".bench-kit", "VERSION"), "utf8").trim();
    const scoringVersion = readFileSync(join(root, ".bench-kit", "SCORING_VERSION"), "utf8").trim();
    const resultsDir = opts.results ?? join(root, "results");

    let attempts: AttemptRef[];
    if (opts.attempts.length > 0) {
      const resolved = opts.attempts.map((raw) => resolveAttemptPath(root, raw));
      const missing = resolved.flatMap((r) => (r.ok ? [] : [r.error]));
      // Jawnie wskazana próba, której nie ma, to błąd — nie cichy pominięty argument.
      if (missing.length > 0) throw new Error(missing.join("\n"));
      attempts = resolved.flatMap((r) => {
        if (!r.ok) return [];
        const dir = r.dir;
        if (r.rewritten) console.log(`info:  --attempt → ${relative(root, dir) || dir} (id modelu → katalog komórki)`);
        const found = findAttempts(dir);
        if (found.length === 0) console.error(`warn:  brak zachowanej próby (attempt.json) w ${dir}`);
        return found;
      });
    } else {
      const dir = opts.attemptsDir ?? join(root, "attempts");
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`katalog prób nie istnieje: ${dir} — najpierw \`bench attempt\``);
      }
      attempts = findAttempts(dir);
    }
    if (attempts.length === 0) throw new Error("brak zachowanych prób do oceny");
    // Werdykt jest per próba: --attempt wskazujący katalog komórki znalazłby
    // kilka prób i przypisał im ten sam werdykt.
    if (opts.verdict && attempts.length !== 1) {
      throw new Error(`--verdict dotyczy jednej próby, a wskazane katalogi zawierają ${attempts.length} — podaj katalog trial-N`);
    }
    console.log(`bench evaluate: ${attempts.length} zachowanych prób(y)`);

    const verdictRaw = opts.verdict ? readFileSync(opts.verdict, "utf8") : null;
    // Sędzia jest stały (era): werdykt agenta musi pochodzić od modelu
    // sędziego z configu. Porównanie po tożsamości modelu — agent zna swój
    // model jako `claude-opus-5` / `anthropic/claude-opus-5`, config trzyma
    // `openrouter/anthropic/claude-opus-5`. To deklaracja, nie dowód — ale
    // jawna i zapisana w judge.json, zamiast domyślnego stempla configu.
    if (opts.judgeMode === "agent" && opts.judgeModel) {
      const want = underlyingModel(config.judge.model);
      const declared = opts.judgeModel.toLowerCase().replace(/-\d{8}$/, "").replace(/(\d)-(\d)/g, "$1.$2");
      const matches = want !== null && (underlyingModel(opts.judgeModel) === want || want.endsWith(`/${declared}`));
      if (!matches) {
        throw new Error(
          `werdykt agenta od "${opts.judgeModel}", a sędzią instancji jest ${config.judge.model} — ` +
            "werdykty innego modelu to inna era; uruchom ocenę modelem sędziego albo zmień judge.model (przez PR)",
        );
      }
    }
    const judgeMode: "api" | "agent" | "human" = opts.judgeMode ?? "api";
    // Kopia werdyktu przy próbie (result.json/judge.json) służy audytowi
    // i `bench report --run attempts/…` — ale tylko dla oceny, która trafia
    // też do results/. Smoke (--no-write-results) jest jednorazowym sprawdzeniem
    // rur: jego werdykt przy próbie wyglądałby jak ocena i podsunąłby się
    // sędziemu-z-narzędziami (rate-attempt) jako "poprzedni werdykt".
    const verdictAtAttempt = !opts.noWriteResults;

    const taskCache = new Map<string, { task: Task; hash: string }>();
    const preparedImages = new Set<string>();
    let engine: string | null = null;
    let failures = 0;
    let written = 0;

    for (const { dir, meta } of attempts) {
      const label = `${meta.task} × ${meta.model} × próba ${meta.trial}`;
      if (meta.infra_failure) {
        const why = meta.resource_kill
          ? "próba zabita sygnałem (nieinterpretowalna — patrz signal.json)"
          : "awaria infrastruktury w bench attempt, nie ma czego oceniać";
        console.error(`skip:  ${label} — ${why}`);
        continue;
      }
      // Werdykt agenta (z narzędziami) albo człowieka jest drogi i celowy —
      // masowe `bench evaluate` sędzią API nie może go po cichu nadpisać.
      if (!opts.verdict && !opts.skipJudge && !opts.noWriteResults && !opts.overwriteJudged) {
        const existing = join(resultsDir, meta.task, sanitize(meta.model), `trial-${meta.trial}`, "result.json");
        if (existsSync(existing)) {
          try {
            const mode = JSON.parse(readFileSync(existing, "utf8"))?.stamps?.judge_mode;
            if (mode === "agent" || mode === "human") {
              console.error(`skip:  ${label} — wynik oceniony ścieżką "${mode}"; sędzia API go nie nadpisze (--overwrite-judged, jeśli to świadoma decyzja)`);
              continue;
            }
          } catch {
            // nieczytelny wynik — ocena go zastąpi
          }
        }
      }
      // Drugi fold werdyktu na tę samą próbę zastępuje poprzedni — legalne
      // (poprawka werdyktu), ale nie po cichu: historię trzyma git.
      if (opts.verdict && !opts.noWriteResults) {
        const existing = join(resultsDir, meta.task, sanitize(meta.model), `trial-${meta.trial}`, "result.json");
        if (existsSync(existing)) {
          try {
            const prev = JSON.parse(readFileSync(existing, "utf8"));
            const mode = prev?.stamps?.judge_mode;
            if (mode === "agent" || mode === "human") {
              console.error(
                `warn:  ${label} — zastępuję istniejący werdykt (${mode}, total ${typeof prev.total === "number" ? prev.total.toFixed(3) : "?"}); ` +
                  "poprzedni zostaje w historii gita results/ — jeśli to pomyłka (drugi sędzia na tę samą próbę), cofnij plik",
              );
            }
          } catch {
            // nieczytelny wynik — ocena go zastąpi
          }
        }
      }
      try {
        let cached = taskCache.get(meta.task);
        if (!cached) {
          cached = { task: loadTask(root, meta.task), hash: hashTaskDir(join(root, "tasks", meta.task)) };
          taskCache.set(meta.task, cached);
        }
        const { task, hash } = cached;

        // Era oceny odklejona od ery wykonania — ale rozjazd definicji
        // zadania między próbą a oceną musi być głośny, nie cichy.
        if (hash !== meta.task_hash) {
          console.error(
            `warn:  ${label} — zadanie zmieniło się po wykonaniu próby (task_hash próby ${meta.task_hash.slice(0, 12)}… ≠ bieżący ${hash.slice(0, 12)}…); ` +
              "wynik dostanie stempel BIEŻĄCEJ definicji zadania",
          );
        }

        // składowe → listy refów z task.yaml
        const refsByComponent = new Map<Component, string[]>();
        for (const ref of task.evaluation) {
          const component = ref.split("/")[0] as Component;
          refsByComponent.set(component, [...(refsByComponent.get(component) ?? []), ref]);
        }

        // 1. static → tests → e2e w jednym kontenerze oceny
        const nonJudgeRefs = NON_JUDGE.flatMap((c) => refsByComponent.get(c) ?? []);
        let refScores = new Map<string, number>();
        if (nonJudgeRefs.length > 0) {
          engine ??= detectEngine(opts.engine);
          // Ocena jest niezależna od wykonania: obraz zadania odtwarzamy
          // z task.yaml, gdy nie ma go lokalnie (inna maszyna, prune).
          if (!preparedImages.has(meta.image) && !imageExists(engine, meta.image)) {
            const url = new Map(config.base_repos.map((r) => [r.name, r.url])).get(task.repo);
            if (!url) throw new Error(`repo "${task.repo}" nie istnieje w base_repos — uruchom \`bench validate\``);
            const baseImage = ensureBaseImage(engine, root);
            prepareTaskImage(engine, root, baseImage, meta.task, task, url);
          }
          preparedImages.add(meta.image);
          const memoryMb = task.memory_mb ?? config.resources.memory_mb ?? null;
          const pidsLimit = config.resources.pids_limit ?? null;
          const inspect = sh(engine, ["image", "inspect", "--format", "{{.Id}}", meta.image], { timeout: 30_000 });
          const imageId = inspect.status === 0 ? inspect.stdout.trim() : "";
          const fingerprint = imageId
            ? guardFingerprint(root, dir, { taskHash: hash, refs: nonJudgeRefs, imageId, memoryMb, pidsLimit })
            : null;
          const checksPath = join(dir, "checks.json");
          // Fold werdyktu (rate-attempt): guardy z --skip-judge sprzed chwili
          // są tym samym faktem — ponowny kontener to minuty bez informacji.
          let reused = false;
          if (opts.verdict && !opts.rerunGuards && fingerprint) {
            const stampPath = join(dir, GUARD_STAMP_FILE);
            let stamp: unknown = null;
            try {
              stamp = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, "utf8")) : null;
            } catch {
              // nieczytelny stempel = brak dowodu świeżości
            }
            const verdict = guardStampFreshness(stamp, fingerprint, fileSha256(checksPath));
            if (verdict.fresh) {
              const checks = JSON.parse(readFileSync(checksPath, "utf8")) as Record<string, { score: number }>;
              refScores = new Map(nonJudgeRefs.map((ref) => [ref, checks[ref]?.score ?? 0]));
              reused = true;
              console.log(`info:  guardy z ${relative(root, checksPath) || checksPath} (świeże) — bez ponownego uruchomienia (--rerun-guards wymusza)`);
            } else {
              console.log(`info:  guardy uruchamiane ponownie — ${verdict.reason}`);
            }
          }
          if (!reused) {
            refScores = runChecksContainer(
              engine,
              root,
              dir,
              meta.image,
              nonJudgeRefs,
              !opts.noDepsCache && config.evaluation.deps_cache,
              memoryMb,
              pidsLimit,
            );
            const stampPath = join(dir, GUARD_STAMP_FILE);
            const checksSha = fileSha256(checksPath);
            if (fingerprint && checksSha) {
              const stamp: GuardStamp = { ...fingerprint, checks_sha256: checksSha, created_at: new Date().toISOString() };
              writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + "\n");
            } else {
              // Bez id obrazu świeżości nie da się dowieść — stary stempel nie może przeżyć.
              rmSync(stampPath, { force: true });
            }
          }
        }
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
        const componentScore = (c: Component): number | null => {
          const refs = refsByComponent.get(c) ?? [];
          if (task.weights[c] === 0 || refs.length === 0) return null;
          return mean(refs.map((ref) => refScores.get(ref) ?? 0));
        };

        // Guard z wagą > 0 poniżej 1 = próba nie zalicza (bramka, krok 3).
        const redGuards = NON_JUDGE.flatMap((c) =>
          task.weights[c] > 0 ? (refsByComponent.get(c) ?? []).filter((ref) => (refScores.get(ref) ?? 0) < 1) : [],
        );

        // --skip-judge: guardy policzone (checks.json = fakty dla
        // sędziego-z-narzędziami), result.json jeszcze nie powstaje.
        // Składowe i czerwone guardy jak w linii PASS/FAIL pełnej oceny.
        if (opts.skipJudge && task.weights.judge > 0) {
          const components = NON_JUDGE.flatMap((c) => {
            const score = componentScore(c);
            return score === null ? [] : [`${c} ${score.toFixed(2)}`];
          });
          const refs = nonJudgeRefs.map((ref) => `${ref} ${(refScores.get(ref) ?? 0).toFixed(2)}`).join(", ");
          const summary = nonJudgeRefs.length ? `${components.join(", ") || "guardy z wagą 0"} — ${refs}` : "brak guardów";
          const gate = redGuards.length
            ? `czerwone guardy: ${redGuards.join(", ")} — próba nie zaliczy niezależnie od werdyktu`
            : "guardy zielone";
          console.log(`eval:  ${label} → guardy policzone (${summary}); ${gate}; składowa judge czeka na werdykt (rate-attempt / --verdict)`);
          continue;
        }

        // 2. składowa judge: werdykt agenta (--verdict) albo API sędziego
        let judgeScore: number | null = null;
        let judgeCostUsd: number | null = null;
        const judgeRefs = refsByComponent.get("judge") ?? [];
        if (task.weights.judge > 0 && judgeRefs.length > 0) {
          const verdicts = [];
          for (const ref of judgeRefs) {
            const rubricText = readFileSync(join(root, "evaluation-pool", "judge", `${ref.split("/")[1]}.md`), "utf8");
            if (verdictRaw !== null) {
              const { weights, problem } = parseRubric(rubricText);
              if (problem) throw new Error(`rubryka ${ref}: ${problem}`);
              const verdict = verdictFromFile(verdictRaw, ref, judgeRefs, weights);
              if (verdict.invalid_reason) {
                throw new Error(`werdykt z pliku dla ${ref} niepoprawny: ${verdict.invalid_reason} — popraw plik werdyktu (kontrakt formatu w rubryce)`);
              }
              verdicts.push({
                ref,
                source: "verdict-file",
                declared_by: { mode: judgeMode, model: opts.judgeModel ?? null },
                ...verdict,
              });
            } else {
              const taskPrompt = readFileSync(join(root, "tasks", meta.task, "prompt.md"), "utf8");
              const patchDiff = readFileSync(join(dir, "patch.diff"), "utf8");
              const verdict = await judgeTrial(config.judge.model, taskPrompt, patchDiff, rubricText, {
                maxTokens: config.judge.max_tokens,
              });
              // Niepoprawny werdykt sędziego to awaria OCENY, nie porażka
              // modelu — bez wyniku, zamiast zera wliczonego do pass rate.
              if (verdict.invalid_reason) {
                if (verdictAtAttempt) {
                  writeFileSync(join(dir, "judge.json"), JSON.stringify([{ ref, source: "api-judge", ...verdict }], null, 2) + "\n");
                }
                const audit = verdictAtAttempt ? "judge.json przy próbie" : `--no-write-results; surowa odpowiedź: ${verdict.raw.slice(-500)}`;
                throw new Error(`sędzia API zwrócił niepoprawny werdykt dla ${ref}: ${verdict.invalid_reason} — wynik nie zapisany (${audit})`);
              }
              verdicts.push({ ref, source: "api-judge", ...verdict });
            }
          }
          if (verdictAtAttempt) writeFileSync(join(dir, "judge.json"), JSON.stringify(verdicts, null, 2) + "\n");
          else {
            // Smoke: werdykt per kryterium (ocena rubryki przed macierzą) tylko na stdout.
            for (const v of verdicts) {
              console.log(`judge: ${label} — ${v.ref} (bez zapisu, --no-write-results):\n${JSON.stringify(v.parsed ?? v.raw, null, 2).replace(/^/gm, "  ")}`);
            }
          }
          judgeScore = mean(verdicts.map((v) => v.score));
          // Koszt sędziego osobno od kosztu próby; null = nieznany
          // (provider nie raportuje / werdykt agenta z pliku).
          const knownCosts = verdicts.flatMap((v) =>
            [v.usage?.cost_usd, v.first_attempt?.usage?.cost_usd].filter((c): c is number => typeof c === "number"),
          );
          judgeCostUsd = knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null;
        }

        // 3. result.json
        const scores = {
          static: componentScore("static"),
          tests: componentScore("tests"),
          e2e: componentScore("e2e"),
          judge: judgeScore,
        };
        const total = (Object.keys(scores) as Component[]).reduce(
          (acc, c) => acc + task.weights[c] * (scores[c] ?? 0),
          0,
        );
        // Zaliczenie = bramka, nie próg sumy: guard to fakt (czerwony build
        // nie jest "częściowo dobry"), więc żaden guard z wagą > 0 nie może
        // być poniżej 1, a sędzia musi sam przekroczyć próg. total zostaje
        // miarą jakości (mediany, rozkład), nie decyzją o zaliczeniu.
        const threshold = config.defaults.pass_threshold;
        const judgeGated = task.weights.judge > 0 && judgeRefs.length > 0;
        // Tolerancja na arytmetykę zmiennoprzecinkową: średnia 0.4/1.0/0.7
        // to 0.6999999999999998, a znaczy 0.7.
        const judgeBelow = judgeGated && (judgeScore ?? 0) < threshold - 1e-9;
        const passed = redGuards.length === 0 && !judgeBelow;
        const passReason = passed
          ? judgeGated
            ? `guardy zielone, judge ${(judgeScore ?? 0).toFixed(2)} ≥ ${threshold}`
            : "guardy zielone (zadanie bez sędziego)"
          : [
              redGuards.length ? `czerwone guardy: ${redGuards.join(", ")}` : "",
              judgeBelow ? `judge ${(judgeScore ?? 0).toFixed(2)} < ${threshold}` : "",
            ]
              .filter(Boolean)
              .join("; ");

        const metricsPath = join(dir, "metrics.json");
        const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, "utf8")) : {};
        const result: Result = ResultSchema.parse({
          task: meta.task,
          model: meta.model,
          trial: meta.trial,
          scores,
          total: Math.min(1, Math.max(0, total)),
          passed,
          pass_reason: passReason,
          cost_usd: metrics.cost_usd ?? 0,
          // null = koszt nieznany (harness bez kosztu i bez ceny) — cost_usd
          // ma wtedy 0 tylko z kontraktu schematu; konsumenci czytają to pole.
          cost_source: typeof metrics.cost_usd === "number" ? (metrics.cost_source ?? "harness") : null,
          judge_cost_usd: judgeCostUsd,
          duration_s: metrics.duration_s ?? 0,
          tokens: { input: metrics.tokens?.input ?? 0, output: metrics.tokens?.output ?? 0 },
          stamps: {
            template_version: templateVersion,
            scoring_version: scoringVersion,
            task_hash: hash,
            judge_model: config.judge.model,
            // Ścieżka oceny jest częścią ery: sędzia API (diff), sędzia-agent
            // z narzędziami (rate-attempt) i człowiek nie są wymienni.
            judge_mode: judgeGated ? judgeMode : "none",
            pass_threshold: threshold,
            context_files: meta.context_files?.policy ?? null,
            rubric_version: rubricVersionStamp(root, judgeRefs, config.judge.rubric_version),
            // Sufit zasobów obowiązujący W TRAKCIE próby (z attempt.json) —
            // "model się poprawił" i "daliśmy więcej RAM-u" nie mogą
            // wyglądać w wynikach identycznie.
            memory_limit_mb: meta.memory_limit_mb ?? null,
          },
        });
        const resultText = JSON.stringify(result, null, 2) + "\n";
        if (verdictAtAttempt) writeFileSync(join(dir, "result.json"), resultText);

        // 4. kanoniczne drzewo wyników w repo — result.json + werdykt
        // sędziego z uzasadnieniem; nadpisanie w miejscu = re-ocena
        // (historię wersji wyników trzyma git).
        if (!opts.noWriteResults) {
          const dest = join(resultsDir, meta.task, sanitize(meta.model), `trial-${meta.trial}`);
          mkdirSync(dest, { recursive: true });
          writeFileSync(join(dest, "result.json"), resultText);
          const judgePath = join(dir, "judge.json");
          if (existsSync(judgePath)) writeFileSync(join(dest, "judge.json"), readFileSync(judgePath));
          written++;
        }

        const summary = (Object.entries(scores) as [string, number | null][])
          .filter(([, v]) => v !== null)
          .map(([k, v]) => `${k} ${(v as number).toFixed(2)}`)
          .join(", ");
        console.log(`eval:  ${label} → total ${result.total.toFixed(3)} (${summary}) — ${result.passed ? "PASS" : "FAIL"}: ${result.pass_reason}`);
      } catch (err) {
        failures++;
        console.error(`eval:  ${label} — BŁĄD: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const resultsNote = written > 0 ? ` — ${written} wynik(ów) w ${resultsDir} (commituje operator; leaderboard czyta results/)` : "";
    console.log(
      `\nbench evaluate: gotowe${failures ? ` (prób z błędem oceny: ${failures} — powód w liniach BŁĄD wyżej; po naprawie oceń je ponownie tym samym poleceniem z --attempt <próba>)` : ""}${resultsNote}`,
    );
    return failures > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
