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
 * - zadania po dacie ważności → warning (starzenie zadań),
 * - spójność deklaracji `reference` w task.yaml (klucze ⊆ evaluation[],
 *   tylko asercje nie-LLM-owe; ważona asercja bez deklaracji → warning),
 * - `--assert`: weryfikacja referencyjna — asercje z deklaracją `reference`
 *   biegną na stanie startowym zadania (repo@pin + overlay, pusty diff)
 *   w kontenerze oceny; rozjazd z deklaracją = error. Wymaga sieci
 *   i silnika kontenerów (nie łączy się z --offline).
 *
 * Poza zakresem (kontrakt na później):
 * - migracje schematu po `bench-kit update`.
 *
 * Wyjście: lista `ok:` / `warn:` / `error:`; kod 0 gdy brak errorów
 * (warningi dopuszczalne), 1 gdy jakikolwiek error, 2 przy złym użyciu.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { BenchConfigSchema, type BenchConfig } from "../schemas/config.ts";
import { TaskSchema, type Task } from "../schemas/task.ts";
import { findInstanceRoot, listTaskNames, readYamlFile } from "../lib/instance.ts";
import { CheckFileSchema } from "../schemas/check.ts";
import { parseRubric } from "../lib/judge.ts";
import { detectEngine, ensureBaseImage } from "../lib/containers.ts";
import { buildStartWorkspace, runAssertions } from "../lib/reference.ts";

const PLACEHOLDER_COMMIT = "0".repeat(40);

interface Issue {
  level: "error" | "warn";
  where: string;
  message: string;
}

interface Options {
  root: string;
  offline: boolean;
  assert: boolean;
  engine: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), offline: false, assert: false, engine: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--offline") opts.offline = true;
    else if (arg === "--assert") opts.assert = true;
    else if (arg === "--engine") {
      const value = args[++i];
      if (!value) return null;
      opts.engine = value;
    } else if (arg === "--root") {
      const value = args[++i];
      if (!value) return null;
      opts.root = resolve(value);
    } else return null;
  }
  if (opts.assert && opts.offline) return null;
  return opts;
}

/** Asercja judge/* to plik .md z co najmniej jednym parsowalnym blokiem ```json
 *  z formatem odpowiedzi. Rubryka z wagami we frontmatterze: wagi muszą
 *  sumować się do 1, a kryteria bloku formatu muszą pokrywać się z kluczami
 *  wag (total liczy runner). Bez frontmattera: stary kontrakt
 *  ({ criteria, total } — total od modelu). */
function validateRubric(path: string): string | null {
  const text = readFileSync(path, "utf8");
  const rubric = parseRubric(text);
  if (rubric.problem) return rubric.problem;
  const blocks = [...rubric.body.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  if (blocks.length === 0) return "brak bloku ```json z formatem odpowiedzi sędziego";
  if (rubric.weights) {
    const sum = Object.values(rubric.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.001) return `wagi frontmattera sumują się do ${sum.toFixed(4)}, oczekiwano 1`;
    const wanted = Object.keys(rubric.weights).sort();
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block) as Record<string, unknown>;
        const criteria = parsed && typeof parsed === "object" ? parsed["criteria"] : null;
        if (criteria && typeof criteria === "object" && !Array.isArray(criteria)) {
          const got = Object.keys(criteria).sort();
          if (got.length === wanted.length && got.every((k, i) => k === wanted[i])) return null;
        }
      } catch {
        // spróbuj kolejnego bloku
      }
    }
    return `żaden blok \`\`\`json nie ma criteria zgodnych z wagami frontmattera (${wanted.join(", ")})`;
  }
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
    console.error("usage: bench validate [--offline] [--assert] [--engine docker|podman] [--root <dir>]  (--assert nie łączy się z --offline)");
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
  const taskNames = listTaskNames(root);
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
  const checkedRubricVersions = new Set<string>();
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
        const rubricWhere = `evaluation-pool/judge/${assertionName}.md`;
        const problem = validateRubric(assertionPath);
        if (problem) {
          report({ level: "error", where: rubricWhere, message: problem });
        }
        if (!checkedRubricVersions.has(assertionName)) {
          checkedRubricVersions.add(assertionName);
          const version = parseRubric(readFileSync(assertionPath, "utf8")).version;
          if (!version && !config?.judge.rubric_version) {
            report({
              level: "error",
              where: rubricWhere,
              message: "rubryka bez `version` we frontmatterze, a config nie ma judge.rubric_version — wynik nie dostanie stempla wersji rubryki",
            });
          } else if (!version) {
            report({
              level: "warn",
              where: rubricWhere,
              message: `rubryka bez \`version\` we frontmatterze — stemplem będzie globalne judge.rubric_version ("${config?.judge.rubric_version}"); zadeklaruj wersję w rubryce, żeby jej kalibracja nie unieważniała innych zadań`,
            });
          }
        }
      } else {
        const checkPath = join(assertionPath, "check.yaml");
        if (!existsSync(checkPath)) {
          report({ level: "error", where: `evaluation-pool/${ref}`, message: "brak check.yaml (kontrakt asercji nie-LLM-owych)" });
        } else {
          try {
            const parsed = CheckFileSchema.safeParse(readYamlFile(checkPath));
            if (!parsed.success) {
              report({ level: "error", where: `evaluation-pool/${ref}/check.yaml`, message: z.prettifyError(parsed.error) });
            }
          } catch (err) {
            report({ level: "error", where: `evaluation-pool/${ref}/check.yaml`, message: `niepoprawny YAML: ${String(err)}` });
          }
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

    // --- deklaracje reference: klucze ⊆ evaluation[], tylko nie-LLM-owe ---
    for (const ref of Object.keys(task.reference ?? {})) {
      if (ref.startsWith("judge/")) {
        report({ level: "error", where, message: `reference deklaruje "${ref}" — dotyczy tylko asercji nie-LLM-owych (sędzia nie biegnie na referencji)` });
      } else if (!task.evaluation.includes(ref)) {
        report({ level: "error", where, message: `reference deklaruje "${ref}", którego nie ma w evaluation[]` });
      }
    }
    for (const ref of task.evaluation) {
      const type = ref.split("/")[0] as keyof Task["weights"];
      if (type !== "judge" && task.weights[type] > 0 && !task.reference?.[ref]) {
        report({
          level: "warn",
          where,
          message: `asercja "${ref}" bez deklaracji reference (pass|fail na stanie startowym) — weryfikacja referencyjna (--assert) ją pominie`,
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

  // --- weryfikacja referencyjna: asercje na stanie startowym vs deklaracje ---
  if (opts.assert && config) {
    const declared = [...tasks].filter(([, t]) => Object.keys(t.reference ?? {}).length > 0);
    if (declared.length === 0) {
      console.log("info:  --assert — żadne zadanie nie deklaruje reference, nic do weryfikacji");
    } else {
      try {
        const engine = detectEngine(opts.engine);
        const image = ensureBaseImage(engine, root);
        for (const [name, task] of declared) {
          const url = repoUrls.get(task.repo);
          if (!url || task.commit === PLACEHOLDER_COMMIT) continue; // zaraportowane wyżej
          const refs = Object.keys(task.reference ?? {}).filter((ref) => !ref.startsWith("judge/"));
          if (refs.length === 0) continue;
          console.log(`info:  --assert — tasks/${name}: stan startowy ${task.repo}@${task.commit.slice(0, 12)}…`);
          const overlay = join(root, "tasks", name, "overlay");
          const workspace = buildStartWorkspace(url, task.commit, existsSync(overlay) ? overlay : null);
          try {
            const outcomes = runAssertions(engine, root, image, workspace, refs, null);
            for (const ref of refs) {
              const expectation = (task.reference ?? {})[ref];
              const outcome = outcomes[ref];
              const passes = (outcome?.score ?? 0) >= 1;
              if ((expectation === "pass") === passes) {
                ok(`tasks/${name}: ${ref} na stanie startowym zgodnie z deklaracją (${expectation})`);
              } else {
                const failed = outcome?.checks.filter((c) => c.exit !== 0).map((c) => `${c.name}: exit ${c.exit}`).join("; ");
                report({
                  level: "error",
                  where: `tasks/${name}`,
                  message: `asercja "${ref}" na stanie startowym ${passes ? "przechodzi" : "nie przechodzi"}, a deklaracja mówi "${expectation}"${failed ? ` (${failed})` : ""} — popraw asercję, overlay albo deklarację`,
                });
              }
            }
          } finally {
            rmSync(workspace, { recursive: true, force: true });
          }
        }
      } catch (err) {
        report({ level: "error", where: "--assert", message: `weryfikacja referencyjna nie doszła do skutku: ${err instanceof Error ? err.message : String(err)}` });
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
