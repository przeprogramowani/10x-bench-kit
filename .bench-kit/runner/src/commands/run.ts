/**
 * bench run — wykonuje próby macierzy model × zadanie × próba.
 *
 * Przebieg:
 * 1. Przygotowanie (jedyny etap zależny od sieci): budowa obrazu bazowego
 *    (.bench-kit/docker, pinowany OpenCode), a per zadanie — płytki fetch
 *    pinowanego commita repo bazowego + overlay + commit startowy,
 *    zapieczone w obraz `bench-task-<nazwa>`.
 * 2. Próby: każda w jednorazowym kontenerze (docker/podman) ze świeżym,
 *    pustym XDG_DATA_HOME. W kontenerze /bench/trial.sh: `opencode run`
 *    z prompt.md pod twardym timeoutem z task.yaml → agent.log,
 *    patch.diff (workspace vs commit startowy), metrics.json (adapter),
 *    execution.json (status/timeout).
 * 3. Artefakty per próba w <out>/<zadanie>/<model>/trial-<n>/; runner
 *    dokłada trial.json (metadane próby). Ocena to `bench evaluate`.
 *
 * Sekrety modeli przechodzą do kontenera wyłącznie przez env
 * (*_API_KEY oraz OPENCODE_*), nigdy nie są zapiekane w obraz.
 * Próby biegną sekwencyjnie — równoległość daje macierz w GH Actions.
 *
 * Użycie: bench run [--models a,b] [--tasks x,y] [--trials n]
 *                   [--out <dir>] [--engine docker|podman] [--root <dir>]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig, loadTask } from "../lib/instance.ts";
import type { Task } from "../schemas/task.ts";

interface Options {
  root: string;
  models: string[] | null;
  tasks: string[] | null;
  trials: number | null;
  out: string | null;
  engine: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), models: null, tasks: null, trials: null, out: null, engine: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--models") opts.models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--tasks") opts.tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") opts.trials = Number(value());
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (opts.trials !== null && (!Number.isInteger(opts.trials) || opts.trials < 1)) return null;
  return opts;
}

function sh(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function must(cmd: string, args: string[], what: string, opts: Parameters<typeof sh>[2] = {}): string {
  const result = sh(cmd, args, opts);
  if (result.status !== 0) {
    throw new Error(`${what}: ${cmd} ${args.join(" ")}\n${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

/** docker jeśli daemon odpowiada, inaczej podman — albo wymuszony --engine. */
function detectEngine(forced: string | null): string {
  const candidates = forced ? [forced] : ["docker", "podman"];
  for (const engine of candidates) {
    if (sh(engine, ["info"], { timeout: 15_000 }).status === 0) return engine;
  }
  throw new Error(
    forced
      ? `${forced} nie odpowiada — czy daemon/machine działa?`
      : "ani docker, ani podman nie odpowiada — uruchom daemon/machine albo wskaż --engine",
  );
}

/** Env przekazywany do kontenera próby: sekrety modeli + konfiguracja OpenCode. */
function trialEnvNames(): string[] {
  return Object.keys(process.env).filter((name) => /_API_KEY$/.test(name) || /^OPENCODE_/.test(name));
}

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");

interface PreparedTask {
  name: string;
  task: Task;
  image: string;
  startSha: string;
}

/** Zapieka repo@pin + overlay + commit startowy w obraz `bench-task-<nazwa>`. */
function prepareTaskImage(engine: string, root: string, baseImage: string, name: string, task: Task, repoUrl: string): PreparedTask {
  const context = mkdtempSync(join(tmpdir(), `bench-prepare-${sanitize(name)}-`));
  try {
    const workspace = join(context, "workspace");
    mkdirSync(workspace);
    must("git", ["init", "-q", workspace], "git init workspace");
    must("git", ["-C", workspace, "fetch", "--depth", "1", repoUrl, task.commit], `fetch pinowanego commita ${name}`, {
      timeout: 300_000,
    });
    must("git", ["-C", workspace, "checkout", "-q", task.commit], "checkout pinowanego commita");

    const overlay = join(root, "tasks", name, "overlay");
    if (existsSync(overlay)) {
      cpSync(overlay, workspace, {
        recursive: true,
        filter: (src) => !src.endsWith(".gitkeep"),
      });
    }

    // Commit startowy = punkt odniesienia dla patch.diff (repo@pin + overlay).
    must("git", ["-C", workspace, "add", "-A"], "git add punktu startowego");
    must(
      "git",
      ["-C", workspace, "-c", "user.name=bench", "-c", "user.email=bench@local", "commit", "-q", "--allow-empty", "-m", "bench: punkt startowy próby"],
      "commit punktu startowego",
    );
    const startSha = must("git", ["-C", workspace, "rev-parse", "HEAD"], "rev-parse punktu startowego").trim();

    cpSync(join(root, "tasks", name, "prompt.md"), join(context, "prompt.md"));
    writeFileSync(join(context, "start-sha"), startSha + "\n");
    writeFileSync(
      join(context, "Dockerfile"),
      [`FROM ${baseImage}`, "COPY workspace/ /workspace/", "COPY prompt.md start-sha /bench/", ""].join("\n"),
    );

    const image = `bench-task-${sanitize(name)}:latest`;
    console.log(`prepare: ${name} → ${image} (pin ${task.commit.slice(0, 12)}…)`);
    must(engine, ["build", "-q", "-t", image, context], `budowa obrazu zadania ${name}`, { timeout: 600_000 });
    return { name, task, image, startSha };
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}

export async function runCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench run [--models a,b] [--tasks x,y] [--trials n] [--out <dir>] [--engine docker|podman] [--root <dir>]");
    return 2;
  }

  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  try {
    const config = loadConfig(root);
    const models = opts.models ?? config.defaults.models;
    const trials = opts.trials ?? config.defaults.trials;
    const allTasks = listTaskNames(root);
    const taskNames = opts.tasks ?? allTasks;
    for (const name of taskNames) {
      if (!allTasks.includes(name)) throw new Error(`nieznane zadanie: ${name}`);
    }
    if (taskNames.length === 0) throw new Error("brak zadań do uruchomienia");

    const engine = detectEngine(opts.engine);
    const runId = `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}`;
    const outDir = opts.out ?? join(root, "out", runId);
    mkdirSync(outDir, { recursive: true });
    console.log(`bench run: ${runId} (engine: ${engine})`);
    console.log(`macierz: ${models.length} model(i) × ${taskNames.length} zadań × ${trials} prób → ${outDir}`);

    // --- przygotowanie: obraz bazowy + obrazy zadań (jedyny etap z siecią) ---
    const opencodeVersion = readFileSync(join(root, ".bench-kit", "docker", "opencode.version"), "utf8").trim();
    const baseImage = `bench-base:${opencodeVersion}`;
    console.log(`prepare: obraz bazowy ${baseImage}`);
    must(
      engine,
      ["build", "-q", "--build-arg", `OPENCODE_VERSION=${opencodeVersion}`, "-t", baseImage, join(root, ".bench-kit", "docker")],
      "budowa obrazu bazowego",
      { timeout: 900_000 },
    );

    const repoUrls = new Map(config.base_repos.map((r) => [r.name, r.url]));
    const prepared: PreparedTask[] = [];
    for (const name of taskNames) {
      const task = loadTask(root, name);
      const url = repoUrls.get(task.repo);
      if (!url) throw new Error(`tasks/${name}: repo "${task.repo}" nie istnieje w base_repos — uruchom \`bench validate\``);
      prepared.push(prepareTaskImage(engine, root, baseImage, name, task, url));
    }

    // --- próby: model × zadanie × próba, sekwencyjnie, bez sieci do repo ---
    const envArgs = trialEnvNames().flatMap((name) => ["-e", name]);
    let failures = 0;
    for (const { name, task, image, startSha } of prepared) {
      for (const model of models) {
        for (let trial = 1; trial <= trials; trial++) {
          const trialDir = join(outDir, name, sanitize(model), `trial-${trial}`);
          mkdirSync(trialDir, { recursive: true });
          const label = `${name} × ${model} × próba ${trial}/${trials}`;
          console.log(`trial:  ${label} …`);
          const startedAt = new Date().toISOString();

          const result = sh(
            engine,
            ["run", "--rm", "-v", `${trialDir}:/bench/out`, ...envArgs, image, "/bench/trial.sh", model, String(task.timeout_s)],
            { timeout: (task.timeout_s + 300) * 1000 },
          );

          const executionPath = join(trialDir, "execution.json");
          const execution = existsSync(executionPath) ? JSON.parse(readFileSync(executionPath, "utf8")) : null;
          const infraFailure = result.status !== 0 || !execution;
          if (infraFailure) {
            failures++;
            writeFileSync(join(trialDir, "container.log"), (result.stdout ?? "") + (result.stderr ?? ""));
            console.error(`trial:  ${label} — AWARIA infrastruktury (kod ${result.status}); szczegóły: ${trialDir}/container.log`);
          } else if (execution.timed_out) {
            console.log(`trial:  ${label} — TIMEOUT po ${task.timeout_s}s (artefakty częściowe zapisane)`);
          } else {
            console.log(`trial:  ${label} — zakończona (agent exit ${execution.agent_exit}, ${execution.wall_duration_s}s)`);
          }

          writeFileSync(
            join(trialDir, "trial.json"),
            JSON.stringify(
              {
                run_id: runId,
                task: name,
                model,
                trial,
                image,
                start_sha: startSha,
                pinned_commit: task.commit,
                started_at: startedAt,
                finished_at: new Date().toISOString(),
                infra_failure: infraFailure,
                execution,
              },
              null,
              2,
            ) + "\n",
          );
        }
      }
    }

    console.log(`\nbench run: gotowe → ${outDir}${failures ? ` (${failures} prób z awarią infrastruktury)` : ""}`);
    return failures > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
