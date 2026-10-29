/**
 * bench run — bieg macierzy pod nadzorem: kolejka na dysku, supervisor
 * w tle, jeden proces-dziecko na próbę, ocena każdej próby zaraz po niej.
 *
 *   bench run [--tasks x,y] [--models a,b] [--trials n] [--parallel n]
 *             [--eval-parallel n] [--max-cost <usd>] [--no-evaluate]
 *             [--foreground] [--engine docker|podman] [--root <dir>]
 *   bench run status [<id>] [--json] [--watch [--interval <s>]]
 *   bench run list
 *   bench run pause|resume|cancel [<id>]
 *
 * Start: plan i projekcja kosztu (`bench attempt --plan-out`), bramka
 * budżetu PRZED wydaniem pieniędzy (projekcja > budżet = odmowa), potem
 * supervisor odłączony od terminala — komenda wraca od razu z id biegu.
 *
 * Supervisor (lib/queue.ts — stan w attempts/.runs/<id>/):
 * - obrazy (bazowy + zadań) budowane RAZ na bieg; próby biorą gotowe
 *   (`bench attempt --prepared`),
 * - każda próba to osobny proces `bench attempt --trial-index n`: crash,
 *   OOM czy zawieszenie jednego procesu kończy tę próbę, nie bieg,
 * - po zachowanej próbie od razu `bench evaluate --attempt <próba>`
 *   (osobna pula, --eval-parallel),
 * - dopuszczenie wg wolnej pamięci maszyny silnika: próba, która się nie
 *   mieści, czeka w kolejce z powodem widocznym w `bench run status`,
 * - budżet liczony na żywo (koszt zakończonych + puls prób w toku):
 *   przekroczenie zatrzymuje zlecanie I próby w toku (stop.json),
 * - polecenia pause / resume / cancel przez control.json; SIGINT/SIGTERM
 *   supervisora = cancel.
 *
 * Supervisor, który zginął, nie zabiera prób: dzieci kończą swoje, a
 * `bench run resume <id>` uruchamia nowego, który odtwarza stan z dysku
 * (zachowane próby → ocena, żywe markery → obserwacja, reszta → kolejka).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { detectEngine, engineMemoryBytes, ensureBaseImage, sh } from "../lib/containers.ts";
import { prepareTaskImage, sanitize } from "../lib/prepare.ts";
import { readJson, runningMarkerState, writeRunMarker } from "../lib/matrix.ts";
import { heartbeatAgeS, readProgress, requestStop } from "../lib/progress.ts";
import {
  ACTIVE_PHASES,
  TERMINAL_PHASES,
  admit,
  appendEvent,
  budgetState,
  dispatchOrder,
  ensureRunDir,
  jobId,
  jobLog,
  listRuns,
  newRunId,
  parseMemUsage,
  phaseCounts,
  readRun,
  readText,
  runDir,
  runSummaryLine,
  supervisorLiveness,
  takeControl,
  writeControl,
  writeRun,
  type Job,
  type JobPhase,
  type RunState,
} from "../lib/queue.ts";
import type { PlanOut } from "./attempt.ts";

const TICK_MS = 2_000;
/** Pamięć maszyny silnika próbkujemy rzadziej niż tick — `stats` trwa sekundy. */
const MEMORY_SAMPLE_MS = 10_000;
/** Zapas ponad timeout próby, po którym proces-dziecko uznajemy za zawieszony. */
const ATTEMPT_SLACK_S = 900;
const DEFAULT_EVAL_PARALLEL = 2;

interface StartOptions {
  root: string;
  tasks: string[] | null;
  models: string[] | null;
  trials: number | null;
  parallel: number | null;
  evalParallel: number | null;
  maxCost: number | null;
  evaluate: boolean;
  foreground: boolean;
  engine: string | null;
  supervise: string | null;
}

const USAGE = [
  "usage: bench run [--tasks x,y] [--models a,b] [--trials n] [--parallel n] [--eval-parallel n]",
  "                 [--max-cost <usd>] [--no-evaluate] [--foreground] [--engine docker|podman] [--root <dir>]",
  "       bench run status [<id>] [--json] [--watch [--interval <s>]] [--root <dir>]",
  "       bench run list [--root <dir>]",
  "       bench run pause|resume|cancel [<id>] [--root <dir>]",
].join("\n");

/** Ten sam CLI w procesie-dziecku (src/index.ts przez strip-types albo dist/index.js). */
function selfArgs(args: string[]): string[] {
  return [...process.execArgv, process.argv[1] as string, ...args];
}

function parseStart(args: string[]): StartOptions | null {
  const opts: StartOptions = {
    root: process.cwd(),
    tasks: null,
    models: null,
    trials: null,
    parallel: null,
    evalParallel: null,
    maxCost: null,
    evaluate: true,
    foreground: false,
    engine: null,
    supervise: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--tasks") opts.tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--models") opts.models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") opts.trials = Number(value());
    else if (arg === "--parallel") opts.parallel = Number(value());
    else if (arg === "--eval-parallel") opts.evalParallel = Number(value());
    else if (arg === "--max-cost") opts.maxCost = Number(value());
    else if (arg === "--no-evaluate") opts.evaluate = false;
    else if (arg === "--foreground") opts.foreground = true;
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else if (arg === "--supervise") opts.supervise = value() ?? null;
    else return null;
  }
  const positiveInt = (n: number | null) => n === null || (Number.isInteger(n) && n > 0);
  if (!positiveInt(opts.trials) || !positiveInt(opts.parallel) || !positiveInt(opts.evalParallel)) return null;
  if (opts.maxCost !== null && !(Number.isFinite(opts.maxCost) && opts.maxCost > 0)) return null;
  return opts;
}

export async function runCommand(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === "status" || sub === "list" || sub === "pause" || sub === "resume" || sub === "cancel") {
    return manageCommand(sub, args.slice(1));
  }
  const opts = parseStart(args);
  if (!opts) {
    console.error(USAGE);
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    if (opts.supervise) return await supervise(root, opts.supervise);
    return await start(root, opts);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// --- start: plan, bramka budżetu, supervisor w tle --------------------------

async function start(root: string, opts: StartOptions): Promise<number> {
  const config = loadConfig(root);
  const id = newRunId();
  const dir = ensureRunDir(root, id);
  const planPath = join(dir, "plan.json");
  const planArgs = ["attempt", "--root", root, "--plan-out", planPath];
  if (opts.tasks) planArgs.push("--tasks", opts.tasks.join(","));
  if (opts.models) planArgs.push("--models", opts.models.join(","));
  if (opts.trials !== null) planArgs.push("--trials", String(opts.trials));
  if (opts.maxCost !== null) planArgs.push("--max-cost", String(opts.maxCost));
  const planned = spawnSync(process.execPath, selfArgs(planArgs), { stdio: "inherit" });
  const plan = planned.status === 0 ? (readJson(planPath) as unknown as PlanOut | null) : null;
  if (!plan) {
    rmSync(dir, { recursive: true, force: true });
    console.error("error: plan biegu nie powstał (powód wyżej) — nic nie wystartowało");
    return 1;
  }
  if (plan.jobs.length === 0) {
    rmSync(dir, { recursive: true, force: true });
    console.log("bench run: nic do zrobienia — wszystkie próby zachowane lub w toku (stan: bench status)");
    return 0;
  }
  // Bramka budżetu PRZED wydaniem pieniędzy: podniesienie budżetu to decyzja człowieka.
  if (plan.budget_usd !== null && plan.projected_usd > plan.budget_usd) {
    rmSync(dir, { recursive: true, force: true });
    console.error(
      `error: projekcja ~$${plan.projected_usd.toFixed(2)} przekracza budżet biegu $${plan.budget_usd} — ` +
        "zawęź macierz (--tasks / --models / --trials) albo świadomie podnieś budżet (--max-cost / defaults.max_cost_usd)",
    );
    return 3;
  }

  const now = new Date().toISOString();
  const jobs: Job[] = dispatchOrder(plan.jobs).map((j) => ({
    id: jobId(j.task, j.model, j.trial),
    task: j.task,
    model: j.model,
    trial: j.trial,
    dir: relative(root, join(root, "attempts", j.task, sanitize(j.model), `trial-${j.trial}`)),
    timeout_s: j.timeout_s,
    memory_mb: j.memory_mb,
    projected_usd: j.projected_usd,
    phase: "queued",
    reason: null,
    queued_at: now,
    started_at: null,
    finished_at: null,
    eval_started_at: null,
    cost_usd: null,
    live: null,
    heartbeat_age_s: null,
    result: null,
  }));
  const run: RunState = {
    id,
    created_at: now,
    updated_at: now,
    host: hostname(),
    pid: null,
    status: "preparing",
    stop_reason: null,
    options: {
      tasks: opts.tasks,
      models: opts.models,
      trials: opts.trials,
      parallel: opts.parallel ?? config.defaults.parallel,
      eval_parallel: opts.evalParallel ?? DEFAULT_EVAL_PARALLEL,
      evaluate: opts.evaluate,
      budget_usd: plan.budget_usd,
      engine: opts.engine,
    },
    projection: { projected_usd: plan.projected_usd, projection_unknown: plan.projection_unknown, estimated_trials: plan.estimated_trials },
    spent_usd: 0,
    live_usd: 0,
    jobs,
  };
  writeRun(root, run);
  appendEvent(root, id, { event: "created", jobs: jobs.length, projected_usd: plan.projected_usd, budget_usd: plan.budget_usd });

  if (opts.foreground) return supervise(root, id);
  launchSupervisor(root, id);
  console.log(
    [
      "",
      `bench run: ${id} wystartował w tle — ${jobs.length} prób(y), projekcja ~$${plan.projected_usd.toFixed(2)}` +
        (plan.budget_usd !== null ? ` / budżet $${plan.budget_usd}` : " (bez budżetu)"),
      `  stan:       bench run status ${id}   (--watch na żywo, --json dla skryptów)`,
      `  sterowanie: bench run pause|resume|cancel ${id}`,
      `  log:        ${relative(root, join(runDir(root, id), "supervisor.log"))}`,
    ].join("\n"),
  );
  return 0;
}

function launchSupervisor(root: string, id: string): void {
  const log = openSync(join(runDir(root, id), "supervisor.log"), "a");
  const child = spawn(process.execPath, selfArgs(["run", "--supervise", id, "--root", root]), {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
}

// --- supervisor ---------------------------------------------------------------

interface Live {
  child: ChildProcess;
  kind: "attempt" | "evaluate";
  exit: number | null | undefined;
}

async function supervise(root: string, id: string): Promise<number> {
  const config = loadConfig(root);
  const loaded = readRun(root, id);
  if (!loaded) throw new Error(`bieg ${id} nie istnieje (attempts/.runs/${id}/run.json)`);
  const run: RunState = loaded;
  const say = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  const event = (e: Record<string, unknown>) => appendEvent(root, id, e);
  const abs = (job: Job) => join(root, job.dir);
  const children = new Map<string, Live>();
  const waitingSince = new Map<string, number>();
  let memory: { at: number; freeMb: number | null } = { at: 0, freeMb: null };

  run.pid = process.pid;
  run.host = hostname();
  writeRunMarker(join(root, "attempts"), { run: id });
  let signals = 0;
  const onSignal = () => {
    signals++;
    if (signals > 1) process.exit(130);
    say("sygnał — anuluję bieg (próby w toku dostają stop, drugi sygnał kończy supervisora od razu)");
    cancel("cancel (sygnał supervisora)");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const setPhase = (job: Job, phase: JobPhase, reason: string | null = null) => {
    if (job.phase === phase && job.reason === reason) return;
    job.phase = phase;
    job.reason = reason;
    if (TERMINAL_PHASES.includes(phase)) job.finished_at = new Date().toISOString();
    event({ job: job.id, phase, ...(reason ? { reason } : {}) });
    say(`${job.task} × ${job.model} × próba ${job.trial}: ${phase}${reason ? ` — ${reason}` : ""}`);
  };

  function cancel(reason: string) {
    if (run.status === "cancelling" || TERMINAL_PHASES.includes(run.status as JobPhase)) return;
    run.status = "cancelling";
    run.stop_reason ??= reason;
    for (const job of run.jobs) {
      if (job.phase === "queued") setPhase(job, "cancelled", reason);
      if (job.phase === "eval-queued") setPhase(job, "cancelled", `${reason} — ocena pominięta; bench evaluate --attempt ${job.dir}`);
      if (job.phase === "starting" || job.phase === "running") requestStop(abs(job), reason, `bench run ${id}`);
    }
  }

  /** Zachowana próba (attempt.json) → koszt, potem ocena albo powód porażki. */
  const attemptFinished = (job: Job) => {
    const attempt = readJson(join(abs(job), "attempt.json"));
    if (!attempt) return false;
    const metrics = readJson(join(abs(job), "metrics.json"));
    job.cost_usd = typeof metrics?.cost_usd === "number" ? metrics.cost_usd : null;
    job.live = null;
    job.heartbeat_age_s = null;
    if (attempt.infra_failure === true) {
      const stopped = attempt.stopped as { reason?: string } | null | undefined;
      setPhase(
        job,
        "failed",
        stopped
          ? `zatrzymana (${stopped.reason ?? "?"}) — wyłączona z oceny`
          : attempt.resource_kill === true
            ? `zabita sygnałem po retry (OOM?) — ${job.dir}/signal.json`
            : `awaria infrastruktury — ${job.dir}/container.log`,
      );
    } else if (run.options.evaluate && run.status !== "cancelling") {
      setPhase(job, "eval-queued");
    } else {
      setPhase(job, "done", run.options.evaluate ? "bez oceny (bieg anulowany) — bench evaluate --attempt " + job.dir : "bez oceny (--no-evaluate)");
    }
    return true;
  };

  const tail = (path: string, pattern: RegExp) => {
    const lines = readText(path).split("\n").filter((l) => pattern.test(l));
    return lines.length ? (lines[lines.length - 1] as string).trim().slice(0, 400) : null;
  };

  // Odtworzenie stanu z dysku — wznowienie po martwym supervisorze albo pierwszy start.
  for (const job of run.jobs) {
    if (TERMINAL_PHASES.includes(job.phase)) continue;
    if (job.phase === "evaluating") {
      job.phase = "eval-queued";
      continue;
    }
    if (job.phase === "eval-queued") continue;
    if (attemptFinished(job)) continue;
    const marker = readJson(join(abs(job), "running.json"));
    if (marker && runningMarkerState(marker) === "running") setPhase(job, "running", "obserwowana (proces bench attempt sprzed wznowienia)");
    else if (job.phase !== "queued") setPhase(job, "queued", "ponownie w kolejce (wznowienie)");
  }

  // Obrazy raz na bieg — próby biorą gotowe (`bench attempt --prepared`).
  const engine = detectEngine(run.options.engine);
  run.status = "preparing";
  writeRun(root, { ...run, updated_at: new Date().toISOString() });
  const queuedTasks = [...new Set(run.jobs.filter((j) => j.phase === "queued").map((j) => j.task))];
  if (queuedTasks.length > 0) {
    say(`przygotowanie: obraz bazowy + ${queuedTasks.length} obraz(y) zadań (silnik: ${engine})`);
    const baseImage = ensureBaseImage(engine, root);
    const urls = new Map(config.base_repos.map((r) => [r.name, r.url]));
    for (const name of queuedTasks) {
      try {
        const task = loadTask(root, name);
        const url = urls.get(task.repo);
        if (!url) throw new Error(`repo "${task.repo}" nie istnieje w base_repos`);
        prepareTaskImage(engine, root, baseImage, name, task, url);
        event({ event: "prepared", task: name });
      } catch (err) {
        const why = `przygotowanie obrazu: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`;
        for (const job of run.jobs) if (job.task === name && job.phase === "queued") setPhase(job, "failed", why);
      }
    }
  }
  if (run.status === "preparing") run.status = "running";
  event({ event: "running" });

  const machineMb = (() => {
    const bytes = engineMemoryBytes(engine);
    return bytes === null ? null : Math.round(bytes / 1024 / 1024);
  })();
  const freeMemoryMb = (): number | null => {
    if (machineMb === null) return null;
    if (Date.now() - memory.at < MEMORY_SAMPLE_MS) return memory.freeMb;
    const stats = sh(engine, ["stats", "--no-stream", "--format", "{{.MemUsage}}"], { timeout: 30_000 });
    const used = stats.status === 0 ? stats.stdout.split("\n").reduce((acc, line) => acc + (parseMemUsage(line) ?? 0), 0) : null;
    memory = { at: Date.now(), freeMb: used === null ? null : Math.max(0, machineMb - Math.round(used / 1024 / 1024)) };
    return memory.freeMb;
  };

  const launch = (job: Job, kind: "attempt" | "evaluate") => {
    const args =
      kind === "attempt"
        ? ["attempt", "--root", root, "--tasks", job.task, "--models", job.model, "--trial-index", String(job.trial), "--prepared"]
        : ["evaluate", "--root", root, "--attempt", job.dir];
    if (run.options.engine) args.push("--engine", run.options.engine);
    const log = openSync(jobLog(root, id, job.id, kind), "a");
    const child = spawn(process.execPath, selfArgs(args), { stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    const live: Live = { child, kind, exit: undefined };
    child.on("exit", (code) => (live.exit = code));
    child.on("error", () => (live.exit = null));
    children.set(job.id, live);
  };

  let budgetHit = false;
  for (;;) {
    // Polecenia z CLI.
    const action = takeControl(root, id);
    if (action === "pause" && run.status === "running") {
      run.status = "paused";
      event({ event: "paused" });
      say("pauza — nowe próby nie startują, w toku kończą się normalnie");
    } else if (action === "resume" && run.status === "paused") {
      run.status = "running";
      event({ event: "resumed" });
      say("wznowiono zlecanie");
    } else if (action === "cancel") {
      cancel("cancel");
    }

    // Procesy-dzieci, które się zakończyły.
    for (const [key, live] of children) {
      if (live.exit === undefined) continue;
      children.delete(key);
      const job = run.jobs.find((j) => j.id === key) as Job;
      if (live.kind === "attempt") {
        if (!attemptFinished(job)) {
          // Proces zginął bez zachowanej próby: sprzątamy jego kontener, numer zwalnia marker.
          const marker = readJson(join(abs(job), "running.json"));
          if (typeof marker?.container === "string" && marker.host === hostname()) sh(engine, ["rm", "-f", marker.container], { timeout: 60_000 });
          const why = tail(jobLog(root, id, job.id, "attempt"), /error:|BŁĄD|AWARIA|błąd runnera/) ?? "bez komunikatu";
          setPhase(job, "failed", `bench attempt zakończony (kod ${live.exit ?? "sygnał"}) bez zachowanej próby: ${why}`);
        }
      } else {
        const resultPath = join(root, "results", job.task, sanitize(job.model), `trial-${job.trial}`, "result.json");
        const fresh = existsSync(resultPath) && statSync(resultPath).mtimeMs >= Date.parse(job.eval_started_at ?? "") - 1000;
        const result = fresh ? readJson(resultPath) : null;
        if (result && typeof result.total === "number") {
          job.result = { passed: result.passed === true, total: result.total, pass_reason: String(result.pass_reason ?? "") };
          setPhase(job, "done", `${job.result.passed ? "PASS" : "FAIL"} ${job.result.total.toFixed(2)} — ${job.result.pass_reason}`);
        } else {
          const skip = tail(jobLog(root, id, job.id, "evaluate"), /^skip:/);
          if (skip && live.exit === 0) setPhase(job, "done", skip.replace(/^skip:\s*/, ""));
          else setPhase(job, "failed", `ocena: ${tail(jobLog(root, id, job.id, "evaluate"), /BŁĄD|error:/) ?? `kod ${live.exit}`} — po naprawie: bench evaluate --attempt ${job.dir}`);
        }
      }
    }

    // Próby w toku: puls, obserwowane bez procesu, zawieszone procesy.
    for (const job of run.jobs) {
      if (job.phase !== "starting" && job.phase !== "running") continue;
      const dir = abs(job);
      const marker = readJson(join(dir, "running.json"));
      if (job.phase === "starting" && marker) setPhase(job, "running");
      job.live = readProgress(dir);
      job.heartbeat_age_s = heartbeatAgeS(dir);
      const own = children.get(job.id);
      if (!own) {
        // Obserwowana po wznowieniu — bez procesu, tylko dysk.
        if (attemptFinished(job)) continue;
        if (!marker || runningMarkerState(marker) === "stale") setPhase(job, "failed", "proces bench attempt sprzed wznowienia zginął bez zachowanej próby");
        continue;
      }
      const started = Date.parse(job.started_at ?? "");
      if (Number.isFinite(started) && Date.now() - started > (job.timeout_s + ATTEMPT_SLACK_S) * 1000) {
        own.child.kill("SIGTERM");
        event({ job: job.id, event: "hung", detail: "przekroczony timeout próby + zapas — proces zakończony" });
      }
    }

    // Budżet na żywo: zakończone + w toku.
    const budget = budgetState(run.jobs, run.options.budget_usd);
    run.spent_usd = budget.spent;
    run.live_usd = budget.live;
    if (budget.over && !budgetHit) {
      budgetHit = true;
      run.stop_reason ??= "budżet";
      say(`budżet: $${(budget.spent + budget.live).toFixed(2)} > $${run.options.budget_usd} — koniec zlecania, próby w toku dostają stop`);
      event({ event: "budget", spent_usd: budget.spent, live_usd: budget.live });
      for (const job of run.jobs) {
        if (job.phase === "queued") setPhase(job, "cancelled", "budżet biegu wyczerpany");
        if (job.phase === "starting" || job.phase === "running") requestStop(abs(job), "budżet biegu", `bench run ${id}`);
      }
    }

    // Zlecanie prób.
    if (run.status === "running" && !budgetHit) {
      const active = () => run.jobs.filter((j) => j.phase === "starting" || j.phase === "running").length;
      const ownActive = () => run.jobs.filter((j) => ACTIVE_PHASES.includes(j.phase)).length;
      for (const job of run.jobs) {
        if (job.phase !== "queued") continue;
        if (active() >= run.options.parallel) break;
        const dir = abs(job);
        if (existsSync(join(dir, "attempt.json"))) {
          setPhase(job, "skipped", "próba zachowana w międzyczasie przez inny proces");
          continue;
        }
        const marker = readJson(join(dir, "running.json"));
        if (marker && runningMarkerState(marker) === "running") {
          setPhase(job, "skipped", "próba w toku w innym procesie bench attempt");
          continue;
        }
        const decision = admit({ needMb: job.memory_mb, freeMb: freeMemoryMb(), ownActive: ownActive(), waitingSince: waitingSince.get(job.id) ?? null });
        if (!decision.admit) {
          if (!waitingSince.has(job.id)) waitingSince.set(job.id, Date.now());
          if (job.reason !== decision.reason) {
            job.reason = decision.reason;
            event({ job: job.id, phase: "queued", reason: decision.reason });
          }
          break;
        }
        waitingSince.delete(job.id);
        if (decision.forced) event({ job: job.id, event: "admitted-low-memory", detail: "start mimo braku pamięci (nic z biegu nie pracowało)" });
        job.started_at = new Date().toISOString();
        setPhase(job, "starting", decision.forced ? "start mimo braku wolnej pamięci — ryzyko OOM" : null);
        launch(job, "attempt");
        // Próbka pamięci po starcie jest nieaktualna — następna decyzja na świeżych danych.
        memory.at = 0;
      }
    }

    // Zlecanie ocen (osobna pula — sędzia API i kontenery guardów).
    if (run.options.evaluate) {
      for (const job of run.jobs) {
        if (job.phase !== "eval-queued") continue;
        if (run.jobs.filter((j) => j.phase === "evaluating").length >= run.options.eval_parallel) break;
        job.eval_started_at = new Date().toISOString();
        setPhase(job, "evaluating");
        launch(job, "evaluate");
      }
    }

    // Koniec: nic w kolejce ani w toku (pauza bez pracy czeka na resume/cancel).
    const counts = phaseCounts(run.jobs);
    const pending = counts.queued + counts.starting + counts.running + counts["eval-queued"] + counts.evaluating;
    const finished = pending === 0 || (run.status === "cancelling" && children.size === 0 && counts.starting + counts.running + counts.evaluating === 0);
    if (finished) {
      for (const job of run.jobs) if (job.phase === "queued" || job.phase === "eval-queued") setPhase(job, "cancelled", run.stop_reason ?? "cancel");
      run.status = run.status === "cancelling" ? "cancelled" : "done";
      run.updated_at = new Date().toISOString();
      writeRun(root, run);
      event({ event: "finished", status: run.status, spent_usd: run.spent_usd });
      say(`koniec biegu (${run.status}): ${runSummaryLine(run)}`);
      return phaseCounts(run.jobs).failed > 0 ? 1 : 0;
    }

    run.updated_at = new Date().toISOString();
    writeRun(root, run);
    await sleep(TICK_MS);
  }
}

// --- status / list / sterowanie ------------------------------------------------

const ago = (iso: string | null): string => {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

/** Puls próby starszy niż tyle sekund przy żywym procesie = podejrzenie zawieszenia. */
const QUIET_HEARTBEAT_S = 120;

function jobDetail(job: Job): string {
  if (job.phase === "running" || job.phase === "starting") {
    const parts = [job.live?.activity ?? (job.phase === "starting" ? "start kontenera" : "brak pulsu jeszcze")];
    if (job.heartbeat_age_s !== null && job.heartbeat_age_s > QUIET_HEARTBEAT_S) parts.push(`BRAK PULSU od ${job.heartbeat_age_s} s — utknęła?`);
    if (job.reason) parts.push(job.reason);
    return parts.join(" · ");
  }
  return job.reason ?? "";
}

export function renderRun(run: RunState, liveness: "alive" | "dead" | "finished"): string {
  const lines: string[] = [];
  const state = liveness === "dead" ? `${run.status} — SUPERVISOR NIE ODPOWIADA (bench run resume ${run.id})` : run.status;
  lines.push(`bench run ${run.id} — ${state}; start ${ago(run.created_at)} temu na ${run.host}`);
  lines.push(
    `  ${runSummaryLine(run)}; projekcja ~$${run.projection.projected_usd.toFixed(2)}` +
      (run.stop_reason ? `; zatrzymany: ${run.stop_reason}` : "") +
      `; równolegle ${run.options.parallel} prób / ${run.options.eval_parallel} ocen`,
  );
  const rows = run.jobs.map((job) => ({
    job: `${job.task} × ${job.model} × ${job.trial}`,
    phase: job.phase,
    time:
      job.phase === "running" || job.phase === "starting"
        ? ago(job.started_at)
        : job.phase === "evaluating"
          ? ago(job.eval_started_at)
          : "",
    events: job.live?.events !== undefined && job.live?.events !== null && (job.phase === "running" || job.phase === "starting") ? String(job.live.events) : "",
    cost:
      job.cost_usd !== null
        ? `$${job.cost_usd.toFixed(2)}`
        : job.live?.cost_usd !== null && job.live?.cost_usd !== undefined
          ? `~$${job.live.cost_usd.toFixed(2)}`
          : "",
    detail: jobDetail(job),
  }));
  const headers = { job: "zadanie × model × próba", phase: "faza", time: "czas", events: "zdarz.", cost: "koszt", detail: "czynność / powód" };
  const keys = Object.keys(headers) as (keyof typeof headers)[];
  const width = Object.fromEntries(keys.map((k) => [k, Math.max(headers[k].length, ...rows.map((r) => r[k].length))])) as Record<keyof typeof headers, number>;
  const line = (r: Record<keyof typeof headers, string>) => keys.map((k) => (k === "detail" ? r[k] : r[k].padEnd(width[k]))).join("  ").trimEnd();
  lines.push("", line(headers));
  for (const row of rows) lines.push(line(row));
  return lines.join("\n");
}

function resolveRunId(root: string, given: string | undefined): string {
  if (given) {
    if (!readRun(root, given)) throw new Error(`bieg ${given} nie istnieje — bench run list`);
    return given;
  }
  const latest = listRuns(root)[0];
  if (!latest) throw new Error("brak biegów — bench run uruchamia nowy");
  return latest;
}

async function manageCommand(sub: "status" | "list" | "pause" | "resume" | "cancel", args: string[]): Promise<number> {
  let rootArg = process.cwd();
  let json = false;
  let watch = false;
  let intervalS = 5;
  let id: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--root") rootArg = resolve(args[++i] ?? "");
    else if (arg === "--json" && sub === "status") json = true;
    else if (arg === "--watch" && sub === "status") watch = true;
    else if (arg === "--interval" && sub === "status") intervalS = Number(args[++i]);
    else if (!arg.startsWith("--") && id === undefined && sub !== "list") id = arg;
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (!(Number.isFinite(intervalS) && intervalS > 0)) {
    console.error(USAGE);
    return 2;
  }
  const root = findInstanceRoot(rootArg);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${rootArg} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    if (sub === "list") {
      const ids = listRuns(root);
      if (ids.length === 0) console.log("brak biegów — bench run uruchamia nowy");
      for (const runId of ids) {
        const run = readRun(root, runId) as RunState;
        const liveness = supervisorLiveness(run);
        console.log(`${runId}  ${liveness === "dead" ? `${run.status} (supervisor martwy)` : run.status}  ${runSummaryLine(run)}`);
      }
      return 0;
    }
    const runId = resolveRunId(root, id);
    if (sub === "status") {
      for (;;) {
        const run = readRun(root, runId) as RunState;
        const liveness = supervisorLiveness(run);
        if (json) console.log(JSON.stringify({ ...run, supervisor: liveness }, null, 2));
        else {
          if (watch && process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
          console.log(renderRun(run, liveness));
          if (!watch) console.log(statusHint(run, liveness));
        }
        if (!watch || liveness !== "alive") return 0;
        await sleep(intervalS * 1000);
      }
    }
    const run = readRun(root, runId) as RunState;
    const liveness = supervisorLiveness(run);
    if (liveness === "finished") {
      console.log(`bench run ${runId}: bieg już zakończony (${run.status}) — nowy: bench run`);
      return 0;
    }
    if (sub === "resume" && liveness === "dead") {
      launchSupervisor(root, runId);
      console.log(`bench run ${runId}: nowy supervisor odtwarza stan z dysku — bench run status ${runId}`);
      return 0;
    }
    if (liveness === "dead") {
      if (sub === "cancel") {
        // Bez supervisora: zatrzymujemy próby w toku bezpośrednio, stan biegu zamykamy.
        for (const job of run.jobs) {
          if (job.phase === "starting" || job.phase === "running") requestStop(join(root, job.dir), "cancel", `bench run cancel ${runId}`);
          if (!TERMINAL_PHASES.includes(job.phase)) {
            job.phase = "cancelled";
            job.reason = "cancel (supervisor martwy)";
          }
        }
        run.status = "cancelled";
        run.stop_reason ??= "cancel";
        writeRun(root, run);
        appendEvent(root, runId, { event: "cancelled-without-supervisor" });
        console.log(`bench run ${runId}: anulowany (supervisor nie żył; próby w toku dostały stop)`);
        return 0;
      }
      console.error(`bench run ${runId}: supervisor nie odpowiada — najpierw bench run resume ${runId}`);
      return 1;
    }
    writeControl(root, runId, sub);
    console.log(`bench run ${runId}: ${sub} przekazane supervisorowi (stan: bench run status ${runId})`);
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function statusHint(run: RunState, liveness: "alive" | "dead" | "finished"): string {
  if (liveness === "dead") return `\nnastępny krok: bench run resume ${run.id} (próby w toku kończą się same; nowy supervisor odtworzy stan z dysku)`;
  if (liveness === "alive") return `\nna żywo: bench run status ${run.id} --watch · log: attempts/.runs/${run.id}/supervisor.log`;
  const failed = run.jobs.filter((j) => j.phase === "failed").length;
  return failed > 0
    ? `\nnastępny krok: ${failed} nieudanych — przyczyny w kolumnie powodu i w attempts/.runs/${run.id}/jobs/; potem bench status`
    : "\nnastępny krok: bench status (komórki × modele), potem bench changes";
}

/** Biegi w toku do linii w `bench status` — tylko żywe albo martwe w trakcie. */
export function activeRunLines(root: string): string[] {
  const lines: string[] = [];
  for (const runId of listRuns(root)) {
    const run = readRun(root, runId);
    if (!run) continue;
    const liveness = supervisorLiveness(run);
    if (liveness === "finished") continue;
    lines.push(
      `  ${runId} (${liveness === "dead" ? "SUPERVISOR NIE ODPOWIADA → bench run resume " + runId : run.status}): ${runSummaryLine(run)}`,
    );
  }
  return lines;
}
