/**
 * Kolejka biegu `bench run` — stan na dysku, jeden pisarz (supervisor).
 *
 * attempts/.runs/<id>/
 * ├── plan.json        # plan i projekcja kosztu (`bench attempt --plan-out`)
 * ├── run.json         # stan biegu + zadań (job), przepisywany atomowo przez supervisora
 * ├── events.jsonl     # dziennik przejść faz (append-only)
 * ├── control.json     # polecenie dla supervisora (pause / resume / cancel) — pisze CLI
 * ├── supervisor.log   # wyjście procesu supervisora
 * └── jobs/<job>.{attempt,evaluate}.log   # wyjście procesów-dzieci
 *
 * Katalog .runs/ ma własny .gitignore (lib/matrix.ts) — nic stąd nie
 * trafia do repo. Zachowane próby i wyniki żyją tam, gdzie zawsze
 * (attempts/<zadanie>/…, results/…); kolejka tylko je zleca i śledzi.
 *
 * Funkcje decyzyjne (dopuszczenie, budżet, żywotność, kolejność) są czyste
 * — testy: .github/tests/units.test.mjs.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { sanitize } from "./prepare.ts";
import { pidAlive } from "./matrix.ts";
import { readJsonFile, writeJsonAtomic, type Progress } from "./progress.ts";

export type JobPhase =
  | "queued"
  | "starting"
  | "running"
  | "eval-queued"
  | "evaluating"
  | "done"
  | "failed"
  | "skipped"
  | "cancelled";

export const ACTIVE_PHASES: JobPhase[] = ["starting", "running", "evaluating"];
export const TERMINAL_PHASES: JobPhase[] = ["done", "failed", "skipped", "cancelled"];

export interface JobResult {
  passed: boolean;
  total: number;
  pass_reason: string;
}

export interface Job {
  /** `<zadanie>__<model>__t<n>` — nazwa logów w jobs/. */
  id: string;
  task: string;
  model: string;
  trial: number;
  /** Katalog próby względem korzenia instancji. */
  dir: string;
  timeout_s: number;
  memory_mb: number | null;
  projected_usd: number | null;
  phase: JobPhase;
  /** Dlaczego czeka / czym się skończyło (dla człowieka). */
  reason: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  eval_started_at: string | null;
  /** Koszt zachowanej próby (metrics.json) — także zatrzymanej: pieniądze wydane. */
  cost_usd: number | null;
  live: Progress | null;
  heartbeat_age_s: number | null;
  result: JobResult | null;
}

export type RunStatus = "preparing" | "running" | "paused" | "cancelling" | "done" | "cancelled" | "failed";

export interface RunOptions {
  tasks: string[] | null;
  models: string[] | null;
  trials: number | null;
  parallel: number;
  eval_parallel: number;
  evaluate: boolean;
  budget_usd: number | null;
  engine: string | null;
}

export interface RunState {
  id: string;
  created_at: string;
  /** Puls supervisora — przepisywany co tick; stary = supervisor nie żyje. */
  updated_at: string;
  host: string;
  pid: number | null;
  status: RunStatus;
  /** Dlaczego bieg przestał zlecać próby: "budżet" / "cancel" / null. */
  stop_reason: string | null;
  options: RunOptions;
  projection: { projected_usd: number; projection_unknown: number; estimated_trials: number };
  /** Koszt zakończonych prób biegu. */
  spent_usd: number;
  /** Koszt prób w toku (z pulsu). */
  live_usd: number;
  jobs: Job[];
}

export const runsDir = (root: string) => join(root, "attempts", ".runs");
export const runDir = (root: string, id: string) => join(runsDir(root), id);
export const runFile = (root: string, id: string) => join(runDir(root, id), "run.json");
export const jobLog = (root: string, id: string, job: string, kind: "attempt" | "evaluate") => join(runDir(root, id), "jobs", `${job}.${kind}.log`);

export const jobId = (task: string, model: string, trial: number) => `${sanitize(task)}__${sanitize(model)}__t${trial}`;

export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `r-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function readRun(root: string, id: string): RunState | null {
  return readJsonFile<RunState>(runFile(root, id));
}

export function writeRun(root: string, run: RunState): void {
  writeJsonAtomic(runFile(root, run.id), run);
}

export function appendEvent(root: string, id: string, event: Record<string, unknown>): void {
  appendFileSync(join(runDir(root, id), "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

/** Biegi instancji, od najnowszego. */
export function listRuns(root: string): string[] {
  const dir = runsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("r-") && existsSync(join(dir, name, "run.json")))
    .sort()
    .reverse();
}

export type ControlAction = "pause" | "resume" | "cancel";

export function writeControl(root: string, id: string, action: ControlAction): void {
  writeJsonAtomic(join(runDir(root, id), "control.json"), { action, at: new Date().toISOString() });
}

/** Odczyt i skasowanie polecenia (tylko supervisor). */
export function takeControl(root: string, id: string): ControlAction | null {
  const path = join(runDir(root, id), "control.json");
  const control = readJsonFile<{ action?: string }>(path);
  if (!control) return null;
  rmSync(path, { force: true });
  return control.action === "pause" || control.action === "resume" || control.action === "cancel" ? control.action : null;
}

/** Puls supervisora starszy niż tyle sekund = supervisor nie żyje (także na innej maszynie). */
export const SUPERVISOR_STALE_S = 120;

/**
 * Żywotność supervisora: "finished" (bieg zakończony), "alive" albo
 * "dead" — PID z tej maszyny nie żyje albo puls ucichł.
 */
export function supervisorLiveness(
  run: Pick<RunState, "status" | "updated_at" | "host" | "pid">,
  now: number = Date.now(),
  host: string = hostname(),
  isAlive: (pid: number) => boolean = pidAlive,
): "alive" | "dead" | "finished" {
  if (run.status === "done" || run.status === "cancelled" || run.status === "failed") return "finished";
  if (run.host === host && run.pid !== null && !isAlive(run.pid)) return "dead";
  const beat = Date.parse(run.updated_at);
  if (!Number.isFinite(beat) || now - beat > SUPERVISOR_STALE_S * 1000) return "dead";
  return "alive";
}

/**
 * Kolejność zlecania: najpierw próba 1 każdej komórki, potem próba 2…
 * Bieg przerwany budżetem zostawia wtedy pomiar KAŻDEJ komórki,
 * a nie komplet prób kilku pierwszych.
 */
export function dispatchOrder<T extends { task: string; model: string; trial: number }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => a.trial - b.trial || a.task.localeCompare(b.task) || a.model.localeCompare(b.model));
}

/** Wydatek biegu: zakończone + w toku; przekroczenie = koniec zlecania i zatrzymanie prób w toku. */
export function budgetState(jobs: Pick<Job, "phase" | "cost_usd" | "live">[], budget: number | null) {
  const spent = jobs.reduce((acc, j) => acc + (j.cost_usd ?? 0), 0);
  const live = jobs
    .filter((j) => j.phase === "starting" || j.phase === "running")
    .reduce((acc, j) => acc + (j.live?.cost_usd ?? 0), 0);
  return { spent, live, over: budget !== null && spent + live > budget };
}

/** Szacunek pamięci próby bez jawnego limitu (resources.memory_mb / task.memory_mb) — tylko do dopuszczenia. */
export const DEFAULT_ADMISSION_MB = 2048;
/** Gdy nic z biegu nie pracuje, a pamięci brak — tyle czekamy, zanim dopuścimy próbę mimo wszystko. */
export const ADMISSION_GRACE_S = 120;

export interface AdmissionInput {
  /** Limit pamięci próby; null = brak jawnego limitu (szacunek DEFAULT_ADMISSION_MB). */
  needMb: number | null;
  /** Wolna pamięć maszyny silnika; null = nieznana (bez kontroli). */
  freeMb: number | null;
  /** Ile prób i ocen tego biegu właśnie pracuje. */
  ownActive: number;
  /** Od kiedy próba czeka na pamięć (ms epoch); null = nie czekała. */
  waitingSince: number | null;
  now?: number;
}

/**
 * Dopuszczenie próby do startu wg wolnej pamięci maszyny silnika.
 * Brak pamięci przy własnych próbach w toku = czekamy, aż któraś się
 * skończy. Brak pamięci, gdy z biegu nic nie pracuje (pamięć zjada coś
 * spoza benchmarku) = czekamy ADMISSION_GRACE_S z jawnym powodem, potem
 * startujemy z ostrzeżeniem — bieg bez nadzoru nie może wisieć w nieskończoność.
 */
export function admit({ needMb, freeMb, ownActive, waitingSince, now = Date.now() }: AdmissionInput): { admit: boolean; reason: string | null; forced: boolean } {
  if (freeMb === null) return { admit: true, reason: null, forced: false };
  const need = needMb ?? DEFAULT_ADMISSION_MB;
  if (freeMb >= need) return { admit: true, reason: null, forced: false };
  const what = `czeka na pamięć: potrzeba ${need} MiB${needMb === null ? " (szacunek — brak resources.memory_mb)" : ""}, wolne ${freeMb} MiB`;
  if (ownActive > 0) return { admit: false, reason: `${what} — ruszy po zakończeniu próby/oceny w toku`, forced: false };
  const waited = waitingSince === null ? 0 : (now - waitingSince) / 1000;
  if (waited >= ADMISSION_GRACE_S) return { admit: true, reason: null, forced: true };
  return {
    admit: false,
    reason: `${what} — pamięć zajmuje coś spoza biegu (inne kontenery?); start mimo to za ${Math.ceil(ADMISSION_GRACE_S - waited)} s`,
    forced: false,
  };
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 ** 2,
  gb: 1e9,
  gib: 1024 ** 3,
  tb: 1e12,
  tib: 1024 ** 4,
};

/** "1.23GiB / 7.6GiB" (docker/podman stats MemUsage) → bajty użyte; null = nieczytelne. */
export function parseMemUsage(line: string): number | null {
  const match = line.trim().match(/^([\d.]+)\s*([a-z]+)/i);
  if (!match) return null;
  const unit = UNITS[(match[2] as string).toLowerCase()];
  const value = Number(match[1]);
  return unit && Number.isFinite(value) ? value * unit : null;
}

export function phaseCounts(jobs: Pick<Job, "phase">[]): Record<JobPhase, number> {
  const counts = Object.fromEntries(
    ["queued", "starting", "running", "eval-queued", "evaluating", "done", "failed", "skipped", "cancelled"].map((p) => [p, 0]),
  ) as Record<JobPhase, number>;
  for (const job of jobs) counts[job.phase]++;
  return counts;
}

/** Krótka linia stanu biegu (status, `bench status`). */
export function runSummaryLine(run: RunState): string {
  const c = phaseCounts(run.jobs);
  const passed = run.jobs.filter((j) => j.result?.passed).length;
  const parts = [
    c.starting + c.running ? `${c.starting + c.running} w toku` : "",
    c.queued ? `${c.queued} w kolejce` : "",
    c["eval-queued"] + c.evaluating ? `${c["eval-queued"] + c.evaluating} do oceny/oceniane` : "",
    c.done ? `${c.done} gotowe (${passed} PASS)` : "",
    c.failed ? `${c.failed} nieudane` : "",
    c.skipped ? `${c.skipped} pominięte` : "",
    c.cancelled ? `${c.cancelled} anulowane` : "",
  ].filter(Boolean);
  const budget = run.options.budget_usd !== null ? ` / $${run.options.budget_usd}` : "";
  const live = run.live_usd > 0 ? ` (+$${run.live_usd.toFixed(2)} w toku)` : "";
  return `${parts.join(" · ") || "brak zadań"} — koszt $${run.spent_usd.toFixed(2)}${live}${budget}`;
}

export function ensureRunDir(root: string, id: string): string {
  const dir = runDir(root, id);
  mkdirSync(join(dir, "jobs"), { recursive: true });
  // .runs/ sam się ignoruje (jak markery biegów w lib/matrix.ts).
  if (!existsSync(join(runsDir(root), ".gitignore"))) writeFileSync(join(runsDir(root), ".gitignore"), "*\n");
  return dir;
}

export const readText = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
