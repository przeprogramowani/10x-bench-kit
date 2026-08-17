/**
 * bench evaluate — ocenia artefakty prób i produkuje result.json.
 *
 * Przebieg per próba (katalog trial-* z artefaktami `bench run`):
 * 1. Asercje nie-LLM-owe (static → tests → e2e): świeży kontener z obrazu
 *    zadania (agent dawno nie żyje), patch.diff nakładany na /workspace,
 *    asercje montowane :ro pod /bench/assertions/<ref> — dopiero teraz,
 *    izolacja z konstrukcji. Runner parsuje check.yaml na hoście
 *    (eval-plan.json), w kontenerze biegnie /bench/evaluate.mjs →
 *    checks.json. Składowa = średnia score'ów jej asercji.
 * 2. LLM-as-judge (host-side): sędzia z bench.config.yaml dostaje
 *    prompt.md + patch.diff + rubrykę, zwraca JSON; brak poprawnego
 *    JSON-a = 0. Surowa odpowiedź → judge.json (audyt).
 * 3. result.json: scores (null przy wadze 0), total = ważona suma,
 *    koszt/czas/tokeny z metrics.json, stemple er (template_version,
 *    task_hash = SHA-256 katalogu zadania, judge_model, rubric_version).
 *
 * Próby z awarią infrastruktury (infra_failure) są pomijane z warningiem.
 *
 * Użycie: bench evaluate --run <dir> [--engine docker|podman] [--root <dir>]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, relative } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { judgeTrial, parseRubric } from "../lib/judge.ts";
import { buildEvalPlan } from "../lib/reference.ts";
import { depsCacheArgs, detectEngine, resourceLimitArgs, signalFromExit } from "../lib/containers.ts";
import { ResultSchema, type Result } from "../schemas/result.ts";
import type { Task } from "../schemas/task.ts";

interface Options {
  root: string;
  run: string | null;
  engine: string | null;
  noDepsCache: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), run: null, engine: null, noDepsCache: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--run") opts.run = resolve(value() ?? "");
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--no-deps-cache") opts.noDepsCache = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.run) return null;
  return opts;
}

/** SHA-256 katalogu zadania: posortowane ścieżki względne + treści plików. */
function hashTaskDir(taskDir: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): string[] =>
    readdirSync(dir)
      .sort()
      .flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
  for (const file of walk(taskDir)) {
    hash.update(relative(taskDir, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

interface TrialRef {
  dir: string;
  meta: {
    task: string;
    model: string;
    trial: number;
    image: string;
    infra_failure: boolean;
    resource_kill?: boolean;
    memory_limit_mb?: number | null;
  };
}

function findTrials(runDir: string): TrialRef[] {
  const trials: TrialRef[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      const trialJson = join(full, "trial.json");
      if (existsSync(trialJson)) trials.push({ dir: full, meta: JSON.parse(readFileSync(trialJson, "utf8")) });
      else walk(full);
    }
  };
  walk(runDir);
  return trials.sort((a, b) => a.dir.localeCompare(b.dir));
}

const NON_JUDGE = ["static", "tests", "e2e"] as const;
type Component = (typeof NON_JUDGE)[number] | "judge";

/**
 * Stempel wersji rubryk zadania: per rubryka (`<nazwa>@<wersja>`, sortowane,
 * łączone "+"), więc kalibracja jednej rubryki otwiera nową erę tylko
 * zadaniom, które jej używają. Wersja z frontmattera rubryki; fallback:
 * judge.rubric_version z configu (kontrakt legacy). Zadanie bez składowej
 * judge dostaje "none" — rubryki nie wpływają na jego wynik.
 */
function rubricVersionStamp(root: string, judgeRefs: string[], fallback: string | undefined): string {
  if (judgeRefs.length === 0) return "none";
  return judgeRefs
    .map((ref) => {
      const name = ref.split("/")[1] as string;
      const rubric = parseRubric(readFileSync(join(root, "evaluation-pool", "judge", `${name}.md`), "utf8"));
      const version = rubric.version ?? fallback;
      if (!version) {
        throw new Error(
          `rubryka "${ref}" bez \`version\` we frontmatterze, a config nie ma judge.rubric_version — uruchom \`bench validate\``,
        );
      }
      return `${name}@${version}`;
    })
    .sort()
    .join("+");
}

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
    // OOM w ocenie wyzerowałby miarę pracy i wyglądał jak porażka modelu
    // (OOM.md, rozdz. 6) — kod sygnałowy nazywamy zamiast zgadywać.
    const signal = result.status !== null ? signalFromExit(result.status) : null;
    const signalNote = signal
      ? ` (${signal.name}${signal.likely_oom ? ` — prawdopodobnie OOM; limit: ${memoryMb !== null ? `${memoryMb} MiB` : "brak, sufit = pamięć maszyny silnika"}` : ""})`
      : "";
    throw new Error(`kontener oceny zakończony kodem ${result.status}${signalNote}:\n${(result.stderr || result.stdout || "").slice(-1000)}`);
  }
  const checks = JSON.parse(readFileSync(join(trialDir, "checks.json"), "utf8")) as Record<string, { score: number }>;
  return new Map(refs.map((ref) => [ref, checks[ref]?.score ?? 0]));
}

export async function evaluateCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench evaluate --run <dir> [--no-deps-cache] [--engine docker|podman] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  const runDir = opts.run;
  if (!runDir) return 2;

  try {
    const config = loadConfig(root);
    const templateVersion = readFileSync(join(root, ".bench-kit", "VERSION"), "utf8").trim();
    const scoringVersion = readFileSync(join(root, ".bench-kit", "SCORING_VERSION"), "utf8").trim();
    const trials = findTrials(runDir);
    if (trials.length === 0) throw new Error(`brak prób (trial.json) w ${runDir}`);
    console.log(`bench evaluate: ${trials.length} prób(y) w ${runDir}`);

    const taskCache = new Map<string, { task: Task; hash: string }>();
    let engine: string | null = null;
    let failures = 0;

    for (const { dir, meta } of trials) {
      const label = `${meta.task} × ${meta.model} × próba ${meta.trial}`;
      if (meta.infra_failure) {
        const why = meta.resource_kill
          ? "próba zabita sygnałem (nieinterpretowalna — patrz signal.json)"
          : "awaria infrastruktury w bench run, nie ma czego oceniać";
        console.error(`skip:  ${label} — ${why}`);
        continue;
      }
      try {
        let cached = taskCache.get(meta.task);
        if (!cached) {
          cached = { task: loadTask(root, meta.task), hash: hashTaskDir(join(root, "tasks", meta.task)) };
          taskCache.set(meta.task, cached);
        }
        const { task, hash } = cached;

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
          refScores = runChecksContainer(
            engine,
            root,
            dir,
            meta.image,
            nonJudgeRefs,
            !opts.noDepsCache && config.evaluation.deps_cache,
            task.memory_mb ?? config.resources.memory_mb ?? null,
            config.resources.pids_limit ?? null,
          );
        }
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
        const componentScore = (c: Component): number | null => {
          const refs = refsByComponent.get(c) ?? [];
          if (task.weights[c] === 0 || refs.length === 0) return null;
          return mean(refs.map((ref) => refScores.get(ref) ?? 0));
        };

        // 2. LLM-as-judge
        let judgeScore: number | null = null;
        let judgeCostUsd: number | null = null;
        const judgeRefs = refsByComponent.get("judge") ?? [];
        if (task.weights.judge > 0 && judgeRefs.length > 0) {
          const taskPrompt = readFileSync(join(root, "tasks", meta.task, "prompt.md"), "utf8");
          const patchDiff = readFileSync(join(dir, "patch.diff"), "utf8");
          const verdicts = [];
          for (const ref of judgeRefs) {
            const rubric = readFileSync(join(root, "evaluation-pool", "judge", `${ref.split("/")[1]}.md`), "utf8");
            const verdict = await judgeTrial(config.judge.model, taskPrompt, patchDiff, rubric, {
              maxTokens: config.judge.max_tokens,
            });
            verdicts.push({ ref, ...verdict });
          }
          writeFileSync(join(dir, "judge.json"), JSON.stringify(verdicts, null, 2) + "\n");
          judgeScore = mean(verdicts.map((v) => v.score));
          // Koszt sędziego osobno od kosztu próby — nie dokleja się do kosztu
          // modelu, ale bez niego "koszt na leaderboardzie" myli przy tanich
          // modelach. null = provider nie raportuje kosztu.
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
        const metricsPath = join(dir, "metrics.json");
        const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, "utf8")) : {};
        const result: Result = ResultSchema.parse({
          task: meta.task,
          model: meta.model,
          trial: meta.trial,
          scores,
          total: Math.min(1, Math.max(0, total)),
          cost_usd: metrics.cost_usd ?? 0,
          judge_cost_usd: judgeCostUsd,
          duration_s: metrics.duration_s ?? 0,
          tokens: { input: metrics.tokens?.input ?? 0, output: metrics.tokens?.output ?? 0 },
          stamps: {
            template_version: templateVersion,
            scoring_version: scoringVersion,
            task_hash: hash,
            judge_model: config.judge.model,
            rubric_version: rubricVersionStamp(root, judgeRefs, config.judge.rubric_version),
            // Sufit zasobów obowiązujący W TRAKCIE próby (z trial.json) —
            // "model się poprawił" i "daliśmy więcej RAM-u" nie mogą
            // wyglądać w wynikach identycznie (OOM.md, warstwa 2).
            memory_limit_mb: meta.memory_limit_mb ?? null,
          },
        });
        writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
        const summary = (Object.entries(scores) as [string, number | null][])
          .filter(([, v]) => v !== null)
          .map(([k, v]) => `${k} ${(v as number).toFixed(2)}`)
          .join(", ");
        console.log(`eval:  ${label} → total ${result.total.toFixed(3)} (${summary})`);
      } catch (err) {
        failures++;
        console.error(`eval:  ${label} — BŁĄD: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`\nbench evaluate: gotowe${failures ? ` (${failures} prób z błędem oceny)` : ""}`);
    return failures > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
