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
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const OUT = "/bench/out";
const WORKSPACE = "/workspace";

const plan = JSON.parse(readFileSync(`${OUT}/eval-plan.json`, "utf8"));

function applyPatch(patchPath) {
  if (!existsSync(patchPath) || statSync(patchPath).size === 0) return null;
  const apply = spawnSync("git", ["apply", "--binary", "--whitespace=nowarn", patchPath], {
    cwd: WORKSPACE,
    encoding: "utf8",
  });
  return apply.status === 0 ? null : apply.stderr || `git apply exit ${apply.status}`;
}

function runPlan() {
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
  return results;
}

// Reset workspace do stanu startowego między patchami wsadu. Katalogi
// zależności zostają (płacisz instalację raz na wsad, nie raz na patch);
// pozostałe artefakty nieśledzone są sprzątane, żeby patch B nie dziedziczył
// buildów patcha A.
const KEEP_DIRS = ["node_modules", ".venv", "venv", "vendor", "target", ".pnpm-store"];
function resetWorkspace() {
  spawnSync("git", ["reset", "--hard", "-q"], { cwd: WORKSPACE, encoding: "utf8" });
  spawnSync("git", ["clean", "-fdq", ...KEEP_DIRS.flatMap((d) => ["-e", d])], { cwd: WORKSPACE, encoding: "utf8" });
}

const patchesDir = `${OUT}/patches`;
if (existsSync(patchesDir)) {
  // Tryb wsadowy (N wyników w jednym wejściu do środowiska): każdy patch
  // aplikowany na stan startowy, komplet asercji, reset — patch po patchu.
  const batch = {};
  for (const file of readdirSync(patchesDir).sort()) {
    console.error(`evaluate: === patch ${file} ===`);
    resetWorkspace();
    const patchError = applyPatch(`${patchesDir}/${file}`);
    if (patchError !== null) {
      console.error(`evaluate: git apply ${file} nie powiodło się:\n${patchError}`);
      batch[file] = { outcomes: null, patch_error: patchError.slice(-2000) };
      continue;
    }
    batch[file] = { outcomes: runPlan(), patch_error: null };
  }
  resetWorkspace();
  writeFileSync(`${OUT}/checks-batch.json`, JSON.stringify(batch, null, 2) + "\n");
} else {
  const patchError = applyPatch(`${OUT}/patch.diff`);
  if (patchError !== null) {
    console.error(`evaluate: git apply patch.diff nie powiodło się:\n${patchError}`);
    process.exit(1);
  }
  writeFileSync(`${OUT}/checks.json`, JSON.stringify(runPlan(), null, 2) + "\n");
}
