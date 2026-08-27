/**
 * bench attempt — LOKALNE wykonanie prób macierzy model × zadanie × próba,
 * produkujące ZACHOWANE PRÓBY (kontrakt: .bench-kit/ATTEMPT_FORMAT.md).
 * Wykonanie nie wie nic o rubrykach — ocena to osobny proces
 * (`bench evaluate` / skill rate-attempt), uruchamialny wielokrotnie.
 *
 * Przebieg:
 * 1. Plan: docelowa liczba prób per komórka (model × zadanie); istniejące
 *    zachowane próby (attempt.json) się liczą — domyślnie DOGANIAMY braki
 *    (top-up), niczego nie nadpisując. Projekcja kosztu z historii
 *    results/ + sufit budżetu na CAŁY bieg macierzy (defaults.max_cost_usd
 *    albo --max-cost).
 * 2. Przygotowanie (jedyny etap z siecią): obraz bazowy + obraz zadania
 *    (repo@pin + overlay + commit startowy, lib/prepare.ts).
 * 3. Próby: każda w jednorazowym kontenerze ze świeżym XDG_DATA_HOME;
 *    /bench/trial.sh → agent.log, patch.diff, metrics.json (koszt/tokeny
 *    z lokalnego opencode.db — jedyne wiarygodne źródło), execution.json,
 *    workspace/ (stan po pracy agenta — ZAWSZE zachowywany, poza gitem).
 * 4. Runner dokłada attempt.json (format 1) — metadane próby.
 *
 * Próba raz opłacona nigdy nie jest wyrzucana: `--force` (re-run mimo
 * istniejących prób) przenosi stary katalog do
 * trial-<n>.superseded-<stempel>/ zamiast go kasować.
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
 *                 [--max-cost <usd>] [--out <dir>]
 *                 [--engine docker|podman] [--root <dir>]
 *
 * `--smoke` = sprawdzenie rur: 1 próba, tylko pierwszy model z listy.
 * `--trial-index n` = dokładnie próba nr n (chirurgiczny re-run z --force).
 * Domyślny cel: attempts/ w korzeniu instancji (kanoniczne drzewo prób).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig, loadTask } from "../lib/instance.ts";
import { detectEngine, engineMemoryBytes, ensureBaseImage, resourceLimitArgs, shAsync, signalFromExit } from "../lib/containers.ts";
import { hashTaskDir } from "../lib/era.ts";
import { prepareTaskImage, sanitize, type PreparedTask } from "../lib/prepare.ts";
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

function detectProviderError(trialDir: string, execution: { agent_exit: number; timed_out: boolean } | null): boolean {
  if (!execution || execution.timed_out || execution.agent_exit === 0) return false;
  const logPath = join(trialDir, "agent.log");
  if (!existsSync(logPath)) return false;
  const log = readFileSync(logPath, "utf8");
  return PROVIDER_ERROR_PATTERN.test(log.slice(-8000));
}

/** Env przekazywany do kontenera próby: sekrety modeli + konfiguracja OpenCode. */
function trialEnvNames(): string[] {
  return Object.keys(process.env).filter((name) => /_API_KEY$/.test(name) || /^OPENCODE_/.test(name));
}

/** Numery zachowanych prób komórki (katalogi trial-<n> z attempt.json). */
function existingTrials(cellDir: string): Set<number> {
  const found = new Set<number>();
  if (!statSync(cellDir, { throwIfNoEntry: false })?.isDirectory()) return found;
  for (const name of readdirSync(cellDir)) {
    const match = name.match(/^trial-(\d+)$/);
    if (match && existsSync(join(cellDir, name, "attempt.json"))) found.add(Number(match[1]));
  }
  return found;
}

/**
 * Projekcja kosztu próby komórki z historii results/ w repo: mediana
 * cost_usd wyników tej pary (zadanie × model), fallback: mediana po
 * wszystkich modelach zadania. null = brak historii (pierwszy pomiar).
 */
function projectedTrialCost(resultsDir: string, task: string, model: string): number | null {
  const costs: { model: string; cost: number }[] = [];
  const taskDir = join(resultsDir, task);
  if (!statSync(taskDir, { throwIfNoEntry: false })?.isDirectory()) return null;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "result.json") {
        try {
          const parsed = JSON.parse(readFileSync(full, "utf8")) as { model?: string; cost_usd?: number };
          if (typeof parsed.cost_usd === "number" && typeof parsed.model === "string") {
            costs.push({ model: parsed.model, cost: parsed.cost_usd });
          }
        } catch {
          // nieparsowalny wynik nie psuje projekcji
        }
      }
    }
  };
  walk(taskDir);
  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  };
  return median(costs.filter((c) => c.model === model).map((c) => c.cost)) ?? median(costs.map((c) => c.cost));
}

export async function attemptCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error(
      [
        "usage: bench attempt [<zadanie> <model>] [--tasks x,y] [--models a,b]",
        "                     [--trials n | --trial-index n] [--force] [--parallel n]",
        "                     [--smoke] [--max-cost <usd>] [--out <dir>]",
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
      console.log(`smoke: 1 próba × ${models[0]} (tani model wskaż przez --models)`);
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
    }
    const plan: PlannedCell[] = [];
    for (const task of taskNames) {
      for (const model of models) {
        const cellDir = join(outDir, task, sanitize(model));
        const existing = existingTrials(cellDir);
        let numbers: number[];
        if (opts.trialIndex !== null) {
          if (existing.has(opts.trialIndex) && !opts.force) {
            throw new Error(
              `${task} × ${model}: próba trial-${opts.trialIndex} już istnieje — ` +
                "zachowane próby nie są nadpisywane; --force odkłada starą do trial-N.superseded-* i wykonuje nową",
            );
          }
          numbers = [opts.trialIndex];
        } else if (opts.force) {
          numbers = Array.from({ length: trials }, (_, i) => i + 1);
        } else {
          numbers = Array.from({ length: trials }, (_, i) => i + 1).filter((n) => !existing.has(n));
        }
        plan.push({ task, model, numbers, skipped: opts.force ? 0 : [...existing].filter((n) => n <= trials).length });
      }
    }
    const totalPlanned = plan.reduce((acc, c) => acc + c.numbers.length, 0);
    const totalSkipped = plan.reduce((acc, c) => acc + c.skipped, 0);
    if (totalSkipped > 0) {
      console.log(`plan:   ${totalSkipped} zachowanych prób już na dysku — doganiam tylko braki (--force wymusza re-run)`);
    }
    if (totalPlanned === 0) {
      console.log("bench attempt: wszystkie zaplanowane próby już zachowane — nic do zrobienia");
      return 0;
    }

    // --- projekcja kosztu + sufit budżetu na cały bieg macierzy ---
    const budget = opts.maxCost ?? config.defaults.max_cost_usd ?? null;
    let projectedTotal = 0;
    let projectionUnknown = 0;
    for (const cell of plan) {
      if (cell.numbers.length === 0) continue;
      const perTrial = projectedTrialCost(resultsDir, cell.task, cell.model);
      if (perTrial === null) projectionUnknown += cell.numbers.length;
      else projectedTotal += perTrial * cell.numbers.length;
    }
    const projectionNote =
      projectionUnknown > 0
        ? ` + ${projectionUnknown} prób bez historii kosztu (pierwszy pomiar — projekcja niepełna)`
        : "";
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

    const engine = detectEngine(opts.engine);
    console.log(`bench attempt: macierz ${models.length} model(i) × ${taskNames.length} zadań → ${outDir} (engine: ${engine})`);

    // --- przygotowanie: obraz bazowy + obrazy zadań (jedyny etap z siecią) ---
    const baseImage = ensureBaseImage(engine, root);
    console.log(`prepare: obraz bazowy ${baseImage}`);

    const repoUrls = new Map(config.base_repos.map((r) => [r.name, r.url]));
    const prepared = new Map<string, PreparedTask>();
    const taskHashes = new Map<string, string>();
    for (const name of new Set(plan.filter((c) => c.numbers.length > 0).map((c) => c.task))) {
      const task = loadTask(root, name);
      const url = repoUrls.get(task.repo);
      if (!url) throw new Error(`tasks/${name}: repo "${task.repo}" nie istnieje w base_repos — uruchom \`bench validate\``);
      prepared.set(name, prepareTaskImage(engine, root, baseImage, name, task, url));
      taskHashes.set(name, hashTaskDir(join(root, "tasks", name)));
    }

    // --- próby: pool --parallel, bez sieci do repo ---
    const envArgs = trialEnvNames().flatMap((name) => ["-e", name]);
    let spentUsd = 0;
    let overBudget = false;
    let failures = 0;
    let resourceKills = 0;

    interface TrialSpec {
      name: string;
      task: Task;
      image: string;
      startSha: string;
      model: string;
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
        specs.push({ name: cell.task, task, image, startSha, model: cell.model, trial, memoryMb, limitArgs });
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

    const runTrial = async ({ name, task, image, startSha, model, trial, memoryMb, limitArgs }: TrialSpec) => {
      const trialDir = join(outDir, name, sanitize(model), `trial-${trial}`);
      // Zachowane próby są nienaruszalne: re-run (--force / --trial-index)
      // odkłada starą próbę obok zamiast ją kasować.
      if (existsSync(join(trialDir, "attempt.json"))) {
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
        renameSync(trialDir, `${trialDir}.superseded-${stamp}`);
        console.log(`trial:  ${name} × ${model} × próba ${trial} — poprzednia próba odłożona do trial-${trial}.superseded-${stamp}/`);
      }
      mkdirSync(trialDir, { recursive: true });
      const label = `${name} × ${model} × próba ${trial}`;
      const startedAt = new Date().toISOString();

      // Retry 1× przy przejściowej awarii providera — pusta próba
      // z HTTP 500 wliczona do median to pomiar pogody, nie modelu.
      // Ta sama mechanika dla kodów sygnałowych 128+N: SIGKILL bez
      // timeoutu to prawie zawsze wyczerpanie zasobów.
      let execution: { agent_exit: number; timed_out: boolean; wall_duration_s: number } | null = null;
      let infraFailure = false;
      let providerError = false;
      let resourceKill = false;
      let attempts = 0;
      for (;;) {
        attempts++;
        console.log(`trial:  ${label} …`);
        const result = await shAsync(
          engine,
          ["run", "--rm", "-v", `${trialDir}:/bench/out`, ...limitArgs, ...envArgs, image, "/bench/trial.sh", model, String(task.timeout_s)],
          { timeout: (task.timeout_s + 300) * 1000 },
        );

        const executionPath = join(trialDir, "execution.json");
        execution = existsSync(executionPath) ? JSON.parse(readFileSync(executionPath, "utf8")) : null;
        infraFailure = result.status !== 0 || !execution;
        providerError = !infraFailure && detectProviderError(trialDir, execution);
        const signal = !infraFailure && !providerError && execution && !execution.timed_out ? signalFromExit(execution.agent_exit) : null;
        if ((providerError || signal) && attempts === 1) {
          const kind = providerError ? "provider-error" : "signal-kill";
          const archive = join(trialDir, `${kind}-attempt-${attempts}`);
          mkdirSync(archive);
          for (const entry of readdirSync(trialDir)) {
            if (!/^(provider-error|signal-kill)-attempt-/.test(entry)) renameSync(join(trialDir, entry), join(archive, entry));
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

      writeFileSync(
        join(trialDir, "attempt.json"),
        JSON.stringify(
          {
            format: ATTEMPT_FORMAT_VERSION,
            task: name,
            model,
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
            infra_failure: infraFailure || resourceKill,
            provider_error: providerError,
            resource_kill: resourceKill,
            attempts,
            execution,
          },
          null,
          2,
        ) + "\n",
      );

      // Budżet biegu: nie zlecaj kolejnych prób, gdy suma przekroczy limit
      // (pool sprawdza flagę przed startem każdej próby; próby już
      // biegnące kończą się normalnie).
      if (budget !== null) {
        const metricsPath = join(trialDir, "metrics.json");
        const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, "utf8")) : {};
        spentUsd += typeof metrics.cost_usd === "number" ? metrics.cost_usd : 0;
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
    let nextSpec = 0;
    await Promise.all(
      Array.from({ length: parallel }, async () => {
        while (nextSpec < specs.length && !overBudget) {
          const spec = specs[nextSpec++] as TrialSpec;
          await runTrial(spec);
        }
      }),
    );

    // Przekroczenie budżetu PO ostatniej próbie niczego nie ucina — pieniądze
    // już wydane, próby zachowane; głośny warning zamiast wywrotki. Kod 1
    // dopiero, gdy budżet realnie pominął zaplanowane próby.
    const skippedByBudget = specs.length - nextSpec;
    const budgetNote = budget !== null ? `, koszt prób $${spentUsd.toFixed(4)}/$${budget}` : "";
    const killNote = resourceKills
      ? ` (${resourceKills} prób ZABITYCH sygnałem — nieinterpretowalne, wyłączone z oceny; diagnostyka w signal.json, próby do powtórzenia po naprawie zasobów)`
      : "";
    const status = overBudget
      ? skippedByBudget > 0
        ? `PRZERWANE (budżet) — ${skippedByBudget} prób(y) niezlecone`
        : "gotowe (budżet przekroczony po ostatniej próbie — nic nie pominięto)"
      : "gotowe";
    console.log(
      `\nbench attempt: ${status} → ${outDir}${failures ? ` (${failures} prób z awarią infrastruktury)` : ""}${killNote}${budgetNote}` +
        `\nnastępny krok: bench evaluate (ocena zachowanych prób → results/)`,
    );
    return failures > 0 || resourceKills > 0 || skippedByBudget > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
