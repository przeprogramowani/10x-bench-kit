/**
 * Próba i ocena W TOKU widziane z hosta — pliki przejściowe w katalogu
 * próby (ATTEMPT_FORMAT.md, "Próba w toku"), wspólne dla `bench attempt`,
 * `bench evaluate`, `bench status` i supervisora `bench run`:
 *
 * - heartbeat.json — puls z kontenera (docker/heartbeat.mjs, co ~20 s):
 *   czas, ostatnia czynność agenta, tokeny/koszt harnessu w trakcie,
 * - progress.json — ten puls przepisany przez `bench attempt` z kosztem
 *   wycenionym tą samą polityką co po próbie (lib/pricing.ts),
 * - stop.json — prośba o zatrzymanie próby (budżet supervisora,
 *   `bench run cancel`); `bench attempt` przerywa agenta SIGINT-em,
 * - evaluating.json — marker oceny w toku (`bench evaluate`).
 *
 * Żaden z nich nie przeżywa zakończenia swojego procesu w normalnym
 * biegu; po crashu zostają i są rozpoznawane jako martwe (PID/czas).
 */
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { costPolicy, finalizeCost, type ResolvedPrice, type Tokens } from "./pricing.ts";
import { sanitize } from "./prepare.ts";
import type { HarnessModel } from "./harness.ts";

export const HEARTBEAT_FILE = "heartbeat.json";
export const PROGRESS_FILE = "progress.json";
export const STOP_FILE = "stop.json";
export const EVALUATING_FILE = "evaluating.json";

/** Pliki przejściowe katalogu próby — nigdy nie należą do zachowanej próby ani do commita. */
export const TRANSIENT_ATTEMPT_FILES = [
  HEARTBEAT_FILE,
  `${HEARTBEAT_FILE}.tmp`,
  PROGRESS_FILE,
  `${PROGRESS_FILE}.tmp`,
  STOP_FILE,
  EVALUATING_FILE,
];

/** Co ile `bench attempt` przepisuje puls do progress.json i sprawdza stop.json. */
export const PROGRESS_INTERVAL_MS = 15_000;

/** Po tylu sekundach bez reakcji na SIGINT kontener zatrzymanej próby dostaje kill. */
export const STOP_GRACE_S = 90;

export interface Progress {
  at: string;
  elapsed_s: number | null;
  /** Liczba zdarzeń agenta (tury / elementy) — "czy coś się dzieje", nie metryka. */
  events: number | null;
  activity: string | null;
  tokens: Tokens | null;
  /** Koszt w trakcie wg polityki harnessu; null = nieznany (brak tokenów albo ceny). */
  cost_usd: number | null;
  cost_source: string | null;
}

export interface StopRequest {
  reason: string;
  requested_at: string;
  by: string;
}

export const readJsonFile = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Zapis atomowy (tmp + rename) — czytelnik nigdy nie widzi połowy pliku. */
export function writeJsonAtomic(path: string, data: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}

/** Nazwa kontenera próby — przez nią runner zatrzymuje agenta i sprząta po crashu. */
export function containerName(task: string, model: string, trial: number, attempt: number, pid: number = process.pid): string {
  return `bench-${sanitize(task)}-${sanitize(model)}-t${trial}-a${attempt}-${pid}`.slice(0, 200);
}

/** Argumenty silnika: SIGINT do `timeout` agenta (PID z /bench/agent.pid, trial.sh). */
export function stopAgentArgs(container: string): string[] {
  return ["exec", container, "sh", "-c", 'kill -INT "$(cat /bench/agent.pid)"'];
}

/**
 * Puls z kontenera → progress.json z kosztem wycenionym jak po próbie.
 * null, gdy pulsu jeszcze nie ma (pierwsze ~20 s próby).
 */
export function refreshProgress(trialDir: string, spec: HarnessModel, price: ResolvedPrice | null): Progress | null {
  const beat = readJsonFile<Record<string, unknown>>(join(trialDir, HEARTBEAT_FILE));
  if (!beat) return null;
  const metrics: Record<string, unknown> = { cost_usd: beat.cost_usd ?? null, cost_source: beat.cost_source ?? null, tokens: beat.tokens ?? null };
  if (metrics.tokens && costPolicy(spec) !== "harness") finalizeCost(metrics, spec, price);
  const progress: Progress = {
    at: typeof beat.at === "string" ? beat.at : new Date().toISOString(),
    elapsed_s: typeof beat.elapsed_s === "number" ? beat.elapsed_s : null,
    events: typeof beat.events === "number" ? beat.events : null,
    activity: typeof beat.activity === "string" ? beat.activity : null,
    tokens: (metrics.tokens as Tokens | null) ?? null,
    cost_usd: typeof metrics.cost_usd === "number" ? metrics.cost_usd : null,
    cost_source: typeof metrics.cost_source === "string" ? metrics.cost_source : null,
  };
  writeJsonAtomic(join(trialDir, PROGRESS_FILE), progress);
  return progress;
}

export const readProgress = (trialDir: string): Progress | null => readJsonFile<Progress>(join(trialDir, PROGRESS_FILE));

/** Wiek pulsu w sekundach (mtime heartbeat.json); null = brak pulsu. */
export function heartbeatAgeS(trialDir: string, now: number = Date.now()): number | null {
  const stat = statSync(join(trialDir, HEARTBEAT_FILE), { throwIfNoEntry: false });
  return stat ? Math.max(0, Math.round((now - stat.mtimeMs) / 1000)) : null;
}

export const readStopRequest = (trialDir: string): StopRequest | null => readJsonFile<StopRequest>(join(trialDir, STOP_FILE));

/** Prośba o zatrzymanie próby; pierwsza wygrywa (powód się nie nadpisuje). */
export function requestStop(trialDir: string, reason: string, by: string): boolean {
  try {
    writeFileSync(join(trialDir, STOP_FILE), JSON.stringify({ reason, requested_at: new Date().toISOString(), by }, null, 2) + "\n", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export function clearTransient(trialDir: string, names: string[] = TRANSIENT_ATTEMPT_FILES): void {
  for (const name of names) rmSync(join(trialDir, name), { force: true });
}

/** Marker oceny w toku — ta sama reguła żywotności co running.json (PID na tej maszynie, czas). */
export const EVALUATING_TTL_S = 2 * 3600;

export function writeEvaluatingMarker(trialDir: string): void {
  writeFileSync(
    join(trialDir, EVALUATING_FILE),
    JSON.stringify({ started_at: new Date().toISOString(), timeout_s: EVALUATING_TTL_S, pid: process.pid, host: hostname() }, null, 2) + "\n",
  );
}

export function hasEvaluatingMarker(trialDir: string): boolean {
  return existsSync(join(trialDir, EVALUATING_FILE));
}
