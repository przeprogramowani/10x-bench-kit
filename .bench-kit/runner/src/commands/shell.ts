/**
 * bench shell — jednorazowy kontener sędziego na ZACHOWANEJ PRÓBIE.
 *
 * Sędzia-z-narzędziami (skill rate-attempt) bada workspace po pracy
 * agenta: build, testy, uruchomienie aplikacji. Ten kod jest cudzy
 * (wyprodukowany przez oceniany model) — nie wykonuje się go na hoście
 * operatora, tylko w kontenerze z obrazu zadania, tak jak guardy
 * w `bench evaluate`. Zachowany workspace/ jest montowany TYLKO DO
 * ODCZYTU i kopiowany do /workspace kontenera; oryginał pozostaje
 * nienaruszony (kontrakt ATTEMPT_FORMAT.md), kontener znika po wyjściu.
 *
 * Ocena może używać sieci (instalacja zależności) i ciepłego cache'u
 * zależności — jak kontener guardów. Limity zasobów jak w ocenie.
 *
 * Użycie:
 *   bench shell --attempt <dir>                 # interaktywna powłoka
 *   bench shell --attempt <dir> -- <komenda…>   # jedna komenda (bash -lc), kod wyjścia komendy
 *   (wspólne: [--no-deps-cache] [--engine docker|podman] [--root <dir>])
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { depsCacheArgs, detectEngine, ensureBaseImage, resourceLimitArgs } from "../lib/containers.ts";
import { imageExists, prepareTaskImage } from "../lib/prepare.ts";
import { AttemptSchema } from "../schemas/attempt.ts";

interface Options {
  root: string;
  attempt: string | null;
  command: string[];
  engine: string | null;
  noDepsCache: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), attempt: null, command: [], engine: null, noDepsCache: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--") {
      opts.command = args.slice(i + 1);
      break;
    } else if (arg === "--attempt") opts.attempt = resolve(value() ?? "");
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--no-deps-cache") opts.noDepsCache = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.attempt) return null;
  return opts;
}

export async function shellCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench shell --attempt <dir> [--no-deps-cache] [--engine docker|podman] [--root <dir>] [-- <komenda…>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    const attemptDir = opts.attempt as string;
    const attemptJson = join(attemptDir, "attempt.json");
    if (!existsSync(attemptJson)) {
      throw new Error(`${attemptDir}: brak attempt.json — to nie jest zachowana próba (w toku? patrz bench status)`);
    }
    const meta = AttemptSchema.parse(JSON.parse(readFileSync(attemptJson, "utf8")));
    const workspace = join(attemptDir, "workspace");
    if (!existsSync(workspace)) {
      throw new Error(`${attemptDir}: brak workspace/ — próba wykonana na innej maszynie? Ocena z narzędziami biegnie tam, gdzie leży workspace`);
    }

    const config = loadConfig(root);
    const task = loadTask(root, meta.task);
    const engine = detectEngine(opts.engine);
    if (!imageExists(engine, meta.image)) {
      const url = new Map(config.base_repos.map((r) => [r.name, r.url])).get(task.repo);
      if (!url) throw new Error(`repo "${task.repo}" nie istnieje w base_repos — uruchom \`bench validate\``);
      prepareTaskImage(engine, root, ensureBaseImage(engine, root), meta.task, task, url);
    }

    const interactive = opts.command.length === 0;
    const tty = interactive && process.stdin.isTTY && process.stdout.isTTY;
    // Kopia wewnątrz kontenera: oryginał tylko do odczytu, nic nie ląduje
    // na hoście, kontener z kopią znika po wyjściu (--rm).
    const copyIn = "rm -rf /workspace && cp -a /bench/attempt-workspace /workspace && cd /workspace";
    const script = interactive ? `${copyIn} && exec bash` : `${copyIn} && ${opts.command.join(" ")}`;
    const label = `${meta.task} × ${meta.model} × próba ${meta.trial}`;
    console.error(
      `bench shell: ${label} → kontener z obrazu ${meta.image} (kopia workspace/ w /workspace, oryginał :ro)${interactive ? " — wyjście: exit" : ""}`,
    );
    const result = spawnSync(
      engine,
      [
        "run",
        "--rm",
        ...(tty ? ["-it"] : interactive ? ["-i"] : []),
        "-v",
        `${workspace}:/bench/attempt-workspace:ro`,
        ...resourceLimitArgs(task.memory_mb ?? config.resources.memory_mb ?? null, config.resources.pids_limit ?? null),
        ...depsCacheArgs(!opts.noDepsCache && config.evaluation.deps_cache),
        "-e",
        `BENCH_ATTEMPT=${label}`,
        meta.image,
        "bash",
        "-lc",
        script,
      ],
      { stdio: "inherit" },
    );
    return result.status ?? 1;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
