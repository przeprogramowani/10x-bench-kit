/**
 * bench validate — bramka spójności instancji przed pierwszym/każdym runem.
 *
 * Sprawdza (0.2.0):
 * - bench.config.yaml i wszystkie tasks/<x>/task.yaml parsują się
 *   schematami z schemas/,
 * - każde zadanie wskazuje repo z base_repos, a referencje evaluation[]
 *   istnieją w evaluation-pool/ (rubryki judge/* zawierają parsowalny
 *   format odpowiedzi),
 * - wagi są spójne z doborem asercji (waga > 0 wymaga asercji tego typu),
 * - model sędziego jest inny niż modele oceniane,
 * - repo bazowe daje się sklonować, pinowany commit istnieje
 *   (pomijane przy --offline),
 * - zadania po dacie ważności → warning (starzenie zadań).
 *
 * Poza zakresem (kontrakt na później):
 * - testy weryfikacyjne na wersji referencyjnej (wymaga `bench run`
 *   wersji wzorcowej),
 * - migracje schematu po `bench-kit update`.
 *
 * Wyjście: lista `ok:` / `warn:` / `error:`; kod 0 gdy brak errorów
 * (warningi dopuszczalne), 1 gdy jakikolwiek error, 2 przy złym użyciu.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BenchConfigSchema, type BenchConfig } from "../schemas/config.ts";
import { TaskSchema, type Task } from "../schemas/task.ts";

const PLACEHOLDER_COMMIT = "0".repeat(40);

interface Issue {
  level: "error" | "warn";
  where: string;
  message: string;
}

interface Options {
  root: string;
  offline: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), offline: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--offline") opts.offline = true;
    else if (arg === "--root") {
      const value = args[++i];
      if (!value) return null;
      opts.root = resolve(value);
    } else return null;
  }
  return opts;
}

/** Szuka korzenia instancji (katalogu z bench.config.yaml) od `start` w górę. */
function findInstanceRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "bench.config.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, "utf8"));
}

/** Asercja judge/* to plik .md z co najmniej jednym parsowalnym blokiem ```json
 *  zawierającym wymagany format odpowiedzi (criteria + total). */
function validateRubric(path: string): string | null {
  const text = readFileSync(path, "utf8");
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  if (blocks.length === 0) return "brak bloku ```json z formatem odpowiedzi sędziego";
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed && typeof parsed === "object" && "criteria" in parsed && "total" in parsed) {
        return null;
      }
    } catch {
      // spróbuj kolejnego bloku
    }
  }
  return "żaden blok ```json nie parsuje się do formatu { criteria, total }";
}

/** `git ls-remote` — czy repo bazowe w ogóle daje się osiągnąć/sklonować. */
function checkCloneable(url: string): string | null {
  const result = spawnSync("git", ["ls-remote", "--heads", url], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status === 0) return null;
  return (result.stderr || `git ls-remote zakończone kodem ${result.status}`).trim().split("\n")[0] ?? "";
}

/** Płytki fetch konkretnego SHA do tymczasowego repo — dowód, że pin istnieje. */
function checkCommitExists(url: string, commit: string): string | null {
  const tmp = mkdtempSync(join(tmpdir(), "bench-validate-"));
  try {
    const init = spawnSync("git", ["init", "-q", tmp], { encoding: "utf8" });
    if (init.status !== 0) return "git init w katalogu tymczasowym nie powiodło się";
    const fetch = spawnSync("git", ["-C", tmp, "fetch", "--depth", "1", url, commit], {
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (fetch.status === 0) return null;
    return (fetch.stderr || `git fetch zakończone kodem ${fetch.status}`).trim().split("\n").pop() ?? "";
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function validateCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench validate [--offline] [--root <dir>]");
    return 2;
  }

  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  const issues: Issue[] = [];
  const ok = (msg: string) => console.log(`ok:    ${msg}`);
  const report = (issue: Issue) => issues.push(issue);

  // --- bench.config.yaml ---
  let config: BenchConfig | null = null;
  try {
    const parsed = BenchConfigSchema.safeParse(readYamlFile(join(root, "bench.config.yaml")));
    if (parsed.success) {
      config = parsed.data;
      ok("bench.config.yaml parsuje się schematem");
    } else {
      report({ level: "error", where: "bench.config.yaml", message: z.prettifyError(parsed.error) });
    }
  } catch (err) {
    report({ level: "error", where: "bench.config.yaml", message: `niepoprawny YAML: ${String(err)}` });
  }

  if (config && config.defaults.models.includes(config.judge.model)) {
    report({
      level: "error",
      where: "bench.config.yaml",
      message: `model sędziego (${config.judge.model}) jest na liście modeli ocenianych — sędzia musi być innym modelem`,
    });
  }

  const repoUrls = new Map<string, string>(config?.base_repos.map((r) => [r.name, r.url]) ?? []);

  // --- tasks/<x>/ ---
  const tasksDir = join(root, "tasks");
  const taskNames = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((name) => statSync(join(tasksDir, name)).isDirectory())
    : [];
  if (taskNames.length === 0) {
    report({ level: "warn", where: "tasks/", message: "brak zadań — instancja nie ma czego uruchamiać" });
  }

  const tasks = new Map<string, Task>();
  for (const name of taskNames) {
    const where = `tasks/${name}`;
    if (!existsSync(join(tasksDir, name, "prompt.md"))) {
      report({ level: "error", where, message: "brak prompt.md (jedynego wejścia agenta)" });
    }
    const taskYamlPath = join(tasksDir, name, "task.yaml");
    if (!existsSync(taskYamlPath)) {
      report({ level: "error", where, message: "brak task.yaml" });
      continue;
    }
    try {
      const parsed = TaskSchema.safeParse(readYamlFile(taskYamlPath));
      if (parsed.success) {
        tasks.set(name, parsed.data);
        ok(`${where}/task.yaml parsuje się schematem`);
      } else {
        report({ level: "error", where: `${where}/task.yaml`, message: z.prettifyError(parsed.error) });
      }
    } catch (err) {
      report({ level: "error", where: `${where}/task.yaml`, message: `niepoprawny YAML: ${String(err)}` });
    }
  }

  // --- spójność zadań: repo, asercje, wagi, starzenie ---
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, task] of tasks) {
    const where = `tasks/${name}`;

    if (config && !repoUrls.has(task.repo)) {
      report({
        level: "error",
        where,
        message: `repo "${task.repo}" nie istnieje w base_repos bench.config.yaml`,
      });
    }

    const refTypes = new Set<string>();
    for (const ref of task.evaluation) {
      const [type, assertionName] = ref.split("/") as [string, string];
      refTypes.add(type);
      const assertionPath =
        type === "judge"
          ? join(root, "evaluation-pool", "judge", `${assertionName}.md`)
          : join(root, "evaluation-pool", type, assertionName);
      if (!existsSync(assertionPath)) {
        report({
          level: "error",
          where,
          message: `asercja "${ref}" nie istnieje w evaluation-pool/ (oczekiwano: ${assertionPath.slice(root.length + 1)})`,
        });
        continue;
      }
      if (type === "judge") {
        const problem = validateRubric(assertionPath);
        if (problem) {
          report({ level: "error", where: `evaluation-pool/judge/${assertionName}.md`, message: problem });
        }
      }
    }

    for (const type of ["static", "tests", "e2e", "judge"] as const) {
      if (task.weights[type] > 0 && !refTypes.has(type)) {
        report({
          level: "error",
          where,
          message: `waga ${type} = ${task.weights[type]}, ale evaluation[] nie zawiera żadnej asercji ${type}/*`,
        });
      }
      if (task.weights[type] === 0 && refTypes.has(type)) {
        report({
          level: "warn",
          where,
          message: `evaluation[] zawiera asercje ${type}/*, ale ich waga = 0 — wynik będzie ignorowany`,
        });
      }
    }

    if (task.expires && task.expires < today) {
      report({
        level: "warn",
        where,
        message: `zadanie przeterminowane (expires: ${task.expires}) — odśwież pin i asercje (nowa era zadania)`,
      });
    }
  }

  // --- sieć: klonowalność repo bazowych i istnienie pinów ---
  if (opts.offline) {
    console.log("info:  --offline — pomijam klonowalność repo bazowych i istnienie pinów");
  } else if (config) {
    const usedRepos = new Set([...tasks.values()].map((t) => t.repo));
    for (const repoName of usedRepos) {
      const url = repoUrls.get(repoName);
      if (!url) continue;
      const problem = checkCloneable(url);
      if (problem) {
        report({ level: "error", where: `base_repos/${repoName}`, message: `repo nieosiągalne (${url}): ${problem}` });
        continue;
      }
      ok(`base_repos/${repoName} osiągalne (${url})`);

      for (const [taskName, task] of tasks) {
        if (task.repo !== repoName) continue;
        if (task.commit === PLACEHOLDER_COMMIT) {
          report({
            level: "error",
            where: `tasks/${taskName}`,
            message: "commit to placeholder (same zera) — przypnij realny SHA repo bazowego",
          });
          continue;
        }
        const commitProblem = checkCommitExists(url, task.commit);
        if (commitProblem) {
          report({
            level: "error",
            where: `tasks/${taskName}`,
            message: `pinowany commit ${task.commit.slice(0, 12)}… nie daje się pobrać z ${repoName}: ${commitProblem}`,
          });
        } else {
          ok(`tasks/${taskName}: pin ${task.commit.slice(0, 12)}… istnieje w ${repoName}`);
        }
      }
    }
  }

  // --- podsumowanie ---
  for (const issue of issues.filter((i) => i.level === "warn")) {
    console.log(`warn:  [${issue.where}] ${issue.message}`);
  }
  for (const issue of issues.filter((i) => i.level === "error")) {
    console.error(`error: [${issue.where}] ${issue.message}`);
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.length - errors;
  console.log(`\nbench validate: ${errors} error(ów), ${warns} warning(ów)`);
  return errors > 0 ? 1 : 0;
}
