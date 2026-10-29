/**
 * Stan macierzy z dysku — wspólny odczyt dla `bench status` i
 * `bench backlog`. Nic tu nie jest deklaracją: komórka (zadanie × model)
 * to katalogi attempts/ i results/, a świeżość oceny to porównanie
 * stempli result.json z erą oceny WYLICZONĄ z bieżącej instancji
 * (ten sam klucz, którym report/leaderboard grupują wyniki).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { BenchConfig } from "../schemas/config.ts";
import { hashTaskDir, rubricVersionStamp } from "./era.ts";
import { loadTask } from "./instance.ts";
import { sanitize } from "./prepare.ts";
import { EVALUATING_FILE, heartbeatAgeS, readProgress, type Progress } from "./progress.ts";

export interface TrialState {
  trial: number;
  state: "done" | "running" | "stale" | "infra";
  cost_usd: number | null;
  started_at: string | null;
  /** fresh = ocena w bieżącej erze oceny; old = ocena z innej ery (stale_reasons). */
  evaluated: "fresh" | "old" | null;
  /** Dlaczego ocena jest nieświeża — puste dla fresh / braku oceny. */
  stale_reasons: string[];
  total: number | null;
  /** Ocena w toku (żywy evaluating.json — `bench evaluate` właśnie ocenia tę próbę). */
  evaluating: boolean;
  /** Puls próby w toku (progress.json od `bench attempt`); null = brak pulsu. */
  progress: Progress | null;
  /** Wiek pulsu z kontenera w sekundach — duży przy próbie "w toku" = coś utknęło. */
  heartbeat_age_s: number | null;
  /** Dlaczego próba jest infra: "zatrzymana: <powód>" / "kill sygnałem" / "awaria infrastruktury". */
  infra_reason: string | null;
}

export interface CellStatus {
  task: string;
  model: string;
  target: number;
  trials: TrialState[];
  aborted: number;
  superseded: number;
}

/**
 * Bieżąca era OCENY zadania — te pola stempli, które `bench evaluate`
 * zapisałby teraz (memory_limit_mb to era wykonania, pochodzi z próby,
 * więc nie decyduje o świeżości oceny).
 */
export interface EvalEra {
  scoring_version: string;
  task_hash: string;
  judge_model: string;
  rubric_version: string;
  /** Ścieżka oceny bieżącej ery: judge.mode z configu, "none" dla zadań bez sędziego. */
  judge_mode: string;
  pass_threshold: number;
}

export const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

export const readJson = (p: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Era oceny zadania w bieżącym stanie instancji. Rubryka niedająca się
 * przeczytać (brak `version` bez fallbacku) nie wywraca odczytu stanu —
 * dostaje znacznik "?", a powód podaje `bench validate`.
 */
export function currentEvalEra(root: string, config: BenchConfig, task: string): EvalEra {
  const scoringVersion = readFileSync(join(root, ".bench-kit", "SCORING_VERSION"), "utf8").trim();
  let rubric = "?";
  let judgeMode: string = config.judge.mode;
  try {
    const loaded = loadTask(root, task);
    const judgeRefs = loaded.evaluation.filter((ref) => ref.startsWith("judge/"));
    rubric = rubricVersionStamp(root, judgeRefs, config.judge.rubric_version);
    if (!(loaded.weights.judge > 0 && judgeRefs.length > 0)) judgeMode = "none";
  } catch {
    // task.yaml / rubryka nieczytelne — validate powie dlaczego
  }
  return {
    scoring_version: scoringVersion,
    task_hash: hashTaskDir(join(root, "tasks", task)),
    judge_model: config.judge.model,
    rubric_version: rubric,
    judge_mode: judgeMode,
    pass_threshold: config.defaults.pass_threshold,
  };
}

/**
 * Powody, dla których wynik nie należy do bieżącej ery oceny (pusta lista
 * = świeży). Wyniki legacy bez scoring_version porównują się po
 * template_version — tak samo jak eraKey w lib/era.ts.
 */
export function staleReasons(stamps: Record<string, unknown>, era: EvalEra): string[] {
  const reasons: string[] = [];
  if (stamps.task_hash !== era.task_hash) reasons.push("zmienione zadanie");
  const scoring = stamps.scoring_version ?? stamps.template_version;
  if (scoring !== era.scoring_version) reasons.push(`scoring ${String(scoring)}→${era.scoring_version}`);
  if (stamps.judge_model !== era.judge_model) reasons.push(`sędzia ${String(stamps.judge_model)}→${era.judge_model}`);
  if (stamps.rubric_version !== era.rubric_version) {
    reasons.push(`rubryka ${String(stamps.rubric_version)}→${era.rubric_version}`);
  }
  // Ścieżka oceny i próg bramki — tylko dla wyników, które je stemplują
  // (starsze i tak różnią się wersją scoringu).
  if (stamps.judge_mode !== undefined && stamps.judge_mode !== era.judge_mode) {
    reasons.push(
      stamps.judge_mode === "human"
        ? `ocena człowieka (judge.mode = ${era.judge_mode}; chroniona przed nadpisaniem przez bench evaluate)`
        : `ścieżka oceny ${String(stamps.judge_mode)}→${era.judge_mode}`,
    );
  }
  if (stamps.pass_threshold !== undefined && stamps.pass_threshold !== era.pass_threshold) {
    reasons.push(`próg zaliczenia ${String(stamps.pass_threshold)}→${era.pass_threshold}`);
  }
  return reasons;
}

/** Czy proces o tym PID żyje na TEJ maszynie (EPERM = żyje, cudzy użytkownik). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Stan markera running.json — wspólna reguła bench attempt / status:
 * przeterminowany (started_at + timeout_s + 15 min minęło) albo — gdy
 * marker pochodzi z TEJ maszyny (host) — proces o jego PID już nie żyje
 * (zabity bench attempt nie sprząta markera). Marker z innej maszyny:
 * tylko reguła czasu (PID-u nie da się tam sprawdzić).
 */
export function runningMarkerState(
  marker: Record<string, unknown> | null,
  now: number = Date.now(),
  host: string = hostname(),
  isAlive: (pid: number) => boolean = pidAlive,
): "running" | "stale" {
  const started = Date.parse(String(marker?.started_at ?? ""));
  const timeoutS = typeof marker?.timeout_s === "number" ? marker.timeout_s : 0;
  if (!Number.isFinite(started)) return "stale";
  if (now > started + (timeoutS + 900) * 1000) return "stale";
  if (marker?.host === host && typeof marker.pid === "number" && !isAlive(marker.pid)) return "stale";
  return "running";
}

/**
 * Marker biegu `bench attempt` (attempts/.runs/<host>-<pid>.json): istnieje
 * od startu biegu, także w fazie przygotowania obrazów, gdy żadna próba nie
 * ma jeszcze running.json — bez niego `bench status --wait` uznawał bieg
 * za skończony, zanim się zaczął. Sprzątany przy wyjściu procesu; po
 * SIGKILL zostaje i jest martwy według tej samej reguły PID/czasu.
 */
const RUN_MARKER_TTL_S = 6 * 3600;

export function writeRunMarker(attemptsDir: string, info: Record<string, unknown>): string {
  const dir = join(attemptsDir, ".runs");
  mkdirSync(dir, { recursive: true });
  // Sam się ignoruje — działa też w instancjach, których .gitignore powstał
  // przed tym markerem (update nie dopisuje reguł do pliku firmy).
  writeFileSync(join(dir, ".gitignore"), "*\n");
  const path = join(dir, `${hostname()}-${process.pid}.json`);
  writeFileSync(
    path,
    JSON.stringify({ ...info, pid: process.pid, host: hostname(), started_at: new Date().toISOString(), timeout_s: RUN_MARKER_TTL_S }, null, 2) + "\n",
  );
  process.once("exit", () => rmSync(path, { force: true }));
  return path;
}

/** Liczba żywych biegów bench attempt dla tego katalogu attempts/. */
export function liveRuns(attemptsDir: string): number {
  const dir = join(attemptsDir, ".runs");
  if (!existsSync(dir)) return 0;
  let live = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    let marker: Record<string, unknown> | null = null;
    try {
      marker = JSON.parse(readFileSync(join(dir, entry), "utf8"));
    } catch {
      continue;
    }
    if (runningMarkerState(marker) === "running") live++;
  }
  return live;
}

export function cellStatus(root: string, task: string, model: string, target: number, era: EvalEra): CellStatus {
  const cellDir = join(root, "attempts", task, sanitize(model));
  const resultsCell = join(root, "results", task, sanitize(model));
  const trials: TrialState[] = [];
  let aborted = 0;
  let superseded = 0;
  if (isDir(cellDir)) {
    for (const name of readdirSync(cellDir).sort()) {
      if (/^trial-\d+\.aborted-/.test(name)) aborted++;
      if (/^trial-\d+\.superseded-/.test(name)) superseded++;
      const match = name.match(/^trial-(\d+)$/);
      if (!match) continue;
      const trial = Number(match[1]);
      const dir = join(cellDir, name);
      const attempt = readJson(join(dir, "attempt.json"));
      if (attempt) {
        const metrics = readJson(join(dir, "metrics.json"));
        const result = readJson(join(resultsCell, name, "result.json"));
        const reasons = result ? staleReasons((result.stamps ?? {}) as Record<string, unknown>, era) : [];
        const stopped = attempt.stopped as { reason?: unknown } | null | undefined;
        const evaluating = existsSync(join(dir, EVALUATING_FILE)) && runningMarkerState(readJson(join(dir, EVALUATING_FILE))) === "running";
        trials.push({
          trial,
          state: attempt.infra_failure === true ? "infra" : "done",
          cost_usd: typeof metrics?.cost_usd === "number" ? metrics.cost_usd : null,
          started_at: typeof attempt.started_at === "string" ? attempt.started_at : null,
          evaluated: result ? (reasons.length === 0 ? "fresh" : "old") : null,
          stale_reasons: reasons,
          total: typeof result?.total === "number" ? result.total : null,
          evaluating,
          progress: null,
          heartbeat_age_s: null,
          infra_reason:
            attempt.infra_failure !== true
              ? null
              : stopped
                ? `zatrzymana: ${String(stopped.reason ?? "?")}`
                : attempt.resource_kill === true
                  ? "kill sygnałem"
                  : "awaria infrastruktury",
        });
      } else if (existsSync(join(dir, "running.json"))) {
        const marker = readJson(join(dir, "running.json"));
        const progress = readProgress(dir);
        trials.push({
          trial,
          state: runningMarkerState(marker),
          cost_usd: null,
          started_at: typeof marker?.started_at === "string" ? marker.started_at : null,
          evaluated: null,
          stale_reasons: [],
          total: null,
          evaluating: false,
          progress,
          heartbeat_age_s: heartbeatAgeS(dir),
          infra_reason: null,
        });
      }
    }
  }
  return { task, model, target, trials, aborted, superseded };
}

/** Modele obecne w attempts/ (po polu model w attempt.json / running.json). */
export function modelsInAttempts(root: string, tasks: string[]): string[] {
  const found = new Set<string>();
  for (const task of tasks) {
    const taskDir = join(root, "attempts", task);
    if (!isDir(taskDir)) continue;
    for (const modelDir of readdirSync(taskDir)) {
      const cellDir = join(taskDir, modelDir);
      if (!isDir(cellDir)) continue;
      for (const name of readdirSync(cellDir)) {
        if (!/^trial-\d+$/.test(name)) continue;
        const meta = readJson(join(cellDir, name, "attempt.json")) ?? readJson(join(cellDir, name, "running.json"));
        if (typeof meta?.model === "string") {
          found.add(meta.model);
          break;
        }
      }
    }
  }
  return [...found];
}
