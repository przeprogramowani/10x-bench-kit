/**
 * Stan macierzy z dysku — wspólny odczyt dla `bench status` i
 * `bench backlog`. Nic tu nie jest deklaracją: komórka (zadanie × model)
 * to katalogi attempts/ i results/, a świeżość oceny to porównanie
 * stempli result.json z erą oceny WYLICZONĄ z bieżącej instancji
 * (ten sam klucz, którym report/leaderboard grupują wyniki).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BenchConfig } from "../schemas/config.ts";
import { hashTaskDir, rubricVersionStamp } from "./era.ts";
import { loadTask } from "./instance.ts";
import { sanitize } from "./prepare.ts";

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
  try {
    const judgeRefs = loadTask(root, task).evaluation.filter((ref) => ref.startsWith("judge/"));
    rubric = rubricVersionStamp(root, judgeRefs, config.judge.rubric_version);
  } catch {
    // task.yaml / rubryka nieczytelne — validate powie dlaczego
  }
  return {
    scoring_version: scoringVersion,
    task_hash: hashTaskDir(join(root, "tasks", task)),
    judge_model: config.judge.model,
    rubric_version: rubric,
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
  return reasons;
}

/** Ta sama reguła przeterminowania co w bench attempt (timeout + 15 min). */
function runningState(marker: Record<string, unknown> | null): "running" | "stale" {
  const started = Date.parse(String(marker?.started_at ?? ""));
  const timeoutS = typeof marker?.timeout_s === "number" ? marker.timeout_s : 0;
  if (!Number.isFinite(started)) return "stale";
  return Date.now() > started + (timeoutS + 900) * 1000 ? "stale" : "running";
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
        trials.push({
          trial,
          state: attempt.infra_failure === true ? "infra" : "done",
          cost_usd: typeof metrics?.cost_usd === "number" ? metrics.cost_usd : null,
          started_at: typeof attempt.started_at === "string" ? attempt.started_at : null,
          evaluated: result ? (reasons.length === 0 ? "fresh" : "old") : null,
          stale_reasons: reasons,
          total: typeof result?.total === "number" ? result.total : null,
        });
      } else if (existsSync(join(dir, "running.json"))) {
        const marker = readJson(join(dir, "running.json"));
        trials.push({
          trial,
          state: runningState(marker),
          cost_usd: null,
          started_at: typeof marker?.started_at === "string" ? marker.started_at : null,
          evaluated: null,
          stale_reasons: [],
          total: null,
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
