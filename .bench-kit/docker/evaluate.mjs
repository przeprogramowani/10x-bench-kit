/**
 * Ocena nie-LLM-owa próby — uruchamiana w świeżym kontenerze z obrazu
 * zadania, już bez agenta. Dopiero na tym etapie w kontenerze pojawiają
 * się asercje z evaluation-pool (mount :ro pod /bench/assertions/<ref>).
 *
 * Wejście (mount /bench/out z katalogu próby):
 * - /bench/out/patch.diff — nakładany na /workspace (stan po pracy agenta),
 * - /bench/out/eval-plan.json — plan przygotowany przez runner:
 *   [{ ref, score_mode: "binary"|"fraction", checks: [{name, run}] }]
 *   (runner parsuje check.yaml na hoście; tu tylko JSON — zero zależności).
 *
 * Wyjście: /bench/out/checks.json:
 *   { "<ref>": { score, passed, total, checks: [{name, exit, log_tail}] } }
 *
 * Komendy biegną w /workspace; katalog asercji dostają w env ASSERTION_DIR.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const OUT = "/bench/out";
const WORKSPACE = "/workspace";

const patchPath = `${OUT}/patch.diff`;
if (existsSync(patchPath) && statSync(patchPath).size > 0) {
  const apply = spawnSync("git", ["apply", "--binary", "--whitespace=nowarn", patchPath], {
    cwd: WORKSPACE,
    encoding: "utf8",
  });
  if (apply.status !== 0) {
    console.error(`evaluate: git apply patch.diff nie powiodło się:\n${apply.stderr}`);
    process.exit(1);
  }
}

const plan = JSON.parse(readFileSync(`${OUT}/eval-plan.json`, "utf8"));
const results = {};

for (const assertion of plan) {
  const checks = [];
  let passed = 0;
  for (const check of assertion.checks) {
    const result = spawnSync("bash", ["-c", check.run], {
      cwd: WORKSPACE,
      encoding: "utf8",
      timeout: 600_000,
      env: { ...process.env, ASSERTION_DIR: `/bench/assertions/${assertion.ref}` },
    });
    const exit = result.status ?? -1;
    if (exit === 0) passed++;
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    checks.push({ name: check.name, exit, log_tail: log.slice(-2000) });
    console.error(`evaluate: ${assertion.ref} / ${check.name} → exit ${exit}`);
  }
  const total = assertion.checks.length;
  const score = assertion.score_mode === "fraction" ? (total ? passed / total : 0) : passed === total ? 1 : 0;
  results[assertion.ref] = { score, passed, total, checks };
}

writeFileSync(`${OUT}/checks.json`, JSON.stringify(results, null, 2) + "\n");
