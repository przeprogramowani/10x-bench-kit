/**
 * Stan startowy zadania i asercje poza pełnym runem — fundament
 * `bench assert` oraz weryfikacji referencyjnej w `bench validate --assert`.
 *
 * Stan startowy = repo bazowe na pinowanym commicie + (opcjonalnie) overlay
 * zadania + commit startowy — dokładnie to, co `bench run` zapieka w obraz.
 * Tu workspace powstaje na hoście i jest montowany do kontenera oceny
 * (ten sam /bench/evaluate.mjs co w `bench evaluate`), więc wynik asercji
 * jest tożsamy z tym z pełnego cyklu próby.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { must, sh } from "./containers.ts";
import { readYamlFile } from "./instance.ts";
import { CheckFileSchema } from "../schemas/check.ts";

/** Wynik pojedynczej asercji — kształt wpisu checks.json z evaluate.mjs. */
export interface AssertionOutcome {
  score: number;
  passed: number;
  total: number;
  checks: Array<{ name: string; exit: number; log_tail: string }>;
}

/** Plan oceny dla evaluate.mjs: sparsowane check.yaml wskazanych refów. */
export function buildEvalPlan(root: string, refs: string[]) {
  return refs.map((ref) => {
    const parsed = CheckFileSchema.safeParse(readYamlFile(join(root, "evaluation-pool", ref, "check.yaml")));
    if (!parsed.success) {
      throw new Error(`evaluation-pool/${ref}/check.yaml nie parsuje się schematem:\n${z.prettifyError(parsed.error)}`);
    }
    return { ref, score_mode: parsed.data.score, checks: parsed.data.checks };
  });
}

/**
 * Buduje stan startowy w katalogu tymczasowym: repo@pin + overlay + commit
 * startowy. Zwraca ścieżkę workspace'u (sprzątanie po stronie wołającego).
 */
export function buildStartWorkspace(repoUrl: string, commit: string, overlayDir: string | null): string {
  const workspace = mkdtempSync(join(tmpdir(), "bench-reference-"));
  must("git", ["init", "-q", workspace], "git init workspace referencyjnego");
  must("git", ["-C", workspace, "fetch", "--depth", "1", repoUrl, commit], `fetch pinowanego commita ${commit.slice(0, 12)}…`, {
    timeout: 300_000,
  });
  must("git", ["-C", workspace, "checkout", "-q", commit], "checkout pinowanego commita");

  if (overlayDir && existsSync(overlayDir)) {
    cpSync(overlayDir, workspace, { recursive: true, filter: (src) => !src.endsWith(".gitkeep") });
  }

  must("git", ["-C", workspace, "add", "-A"], "git add stanu startowego");
  must(
    "git",
    ["-C", workspace, "-c", "user.name=bench", "-c", "user.email=bench@local", "commit", "-q", "--allow-empty", "-m", "bench: stan startowy referencji"],
    "commit stanu startowego",
  );
  return workspace;
}

/**
 * Uruchamia asercje nie-LLM-owe na workspace montowanym do kontenera
 * z obrazu bazowego; opcjonalny patch jest nakładany przez evaluate.mjs
 * (pusty/nieobecny patch = ocena stanu startowego). Zwraca wynik per ref.
 */
export function runAssertions(
  engine: string,
  root: string,
  image: string,
  workspace: string,
  refs: string[],
  patchFile: string | null,
): Record<string, AssertionOutcome> {
  const outDir = mkdtempSync(join(tmpdir(), "bench-assert-out-"));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "eval-plan.json"), JSON.stringify(buildEvalPlan(root, refs), null, 2) + "\n");
  if (patchFile) copyFileSync(patchFile, join(outDir, "patch.diff"));

  const mounts = refs.flatMap((ref) => ["-v", `${join(root, "evaluation-pool", ref)}:/bench/assertions/${ref}:ro`]);
  const result = sh(
    engine,
    ["run", "--rm", "-v", `${workspace}:/workspace`, "-v", `${outDir}:/bench/out`, ...mounts, image, "node", "/bench/evaluate.mjs"],
    { timeout: 3_600_000 },
  );
  if (result.status !== 0 || !existsSync(join(outDir, "checks.json"))) {
    throw new Error(`kontener oceny zakończony kodem ${result.status}:\n${(result.stderr || result.stdout || "").slice(-1000)}`);
  }
  return JSON.parse(readFileSync(join(outDir, "checks.json"), "utf8"));
}
