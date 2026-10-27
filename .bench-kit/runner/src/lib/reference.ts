/**
 * Stan startowy zadania i asercje poza pełnym runem — fundament
 * `bench assert` oraz weryfikacji referencyjnej w `bench validate --assert`.
 *
 * Stan startowy = repo bazowe na pinowanym commicie + (opcjonalnie) overlay
 * zadania + commit startowy — dokładnie to, co `bench attempt` zapieka w obraz.
 * Tu workspace powstaje na hoście i jest montowany do kontenera oceny
 * (ten sam /bench/evaluate.mjs co w `bench evaluate`), więc wynik asercji
 * jest tożsamy z tym z pełnego cyklu próby.
 */
import { unifyContextFiles, type ContextFilesPolicy } from "./context-files.ts";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { containerFailureMessage, depsCacheArgs, must, removeTree, resourceLimitArgs, sh } from "./containers.ts";
import { gitAuthArgs } from "./git-auth.ts";
import { readYamlFile } from "./instance.ts";
import { CheckFileSchema } from "../schemas/check.ts";

/** Wynik pojedynczej asercji — kształt wpisu checks.json z evaluate.mjs. */
export interface AssertionOutcome {
  score: number;
  passed: number;
  total: number;
  /** duration_s: czas komendy w sekundach — pole addytywne evaluate.mjs; starsze checks.json go nie mają. */
  checks: Array<{ name: string; exit: number; log_tail: string; duration_s?: number }>;
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
 * startowy. Zwraca ścieżkę workspace'u (sprzątanie po stronie wołającego
 * — removeTree; przy błędzie budowy katalog jest usuwany tutaj).
 */
export function buildStartWorkspace(
  repoUrl: string,
  commit: string,
  overlayDir: string | null,
  contextPolicy: ContextFilesPolicy = "unified",
): string {
  const workspace = mkdtempSync(join(tmpdir(), "bench-reference-"));
  try {
    populateStartWorkspace(workspace, repoUrl, commit, overlayDir, contextPolicy);
  } catch (err) {
    removeTree(workspace);
    throw err;
  }
  return workspace;
}

function populateStartWorkspace(
  workspace: string,
  repoUrl: string,
  commit: string,
  overlayDir: string | null,
  contextPolicy: ContextFilesPolicy,
): void {
  must("git", ["init", "-q", workspace], "git init workspace referencyjnego");
  must("git", [...gitAuthArgs(), "-C", workspace, "fetch", "--depth", "1", repoUrl, commit], `fetch pinowanego commita ${commit.slice(0, 12)}…`, {
    timeout: 300_000,
  });
  must("git", ["-C", workspace, "checkout", "-q", commit], "checkout pinowanego commita");

  if (overlayDir && existsSync(overlayDir)) {
    cpSync(overlayDir, workspace, { recursive: true, filter: (src) => !src.endsWith(".gitkeep") });
  }

  // Ten sam stan co obraz próby (prepare.ts) — guardy widzą to, co agent.
  unifyContextFiles(workspace, contextPolicy);

  must("git", ["-C", workspace, "add", "-A"], "git add stanu startowego");
  must(
    "git",
    ["-C", workspace, "-c", "user.name=bench", "-c", "user.email=bench@local", "commit", "-q", "--allow-empty", "-m", "bench: stan startowy referencji"],
    "commit stanu startowego",
  );
}

/**
 * task.prepare na stanie startowym — to samo, co `bench attempt` zapieka
 * w obraz zadania (prepare.ts): komenda w /workspace z siecią, potem commit
 * artefaktów. Bez tego guardy dowodzone przez assert/validate widziałyby
 * inny stan niż agent i ocena (np. brak node_modules z prepare).
 */
export function applyPrepare(engine: string, image: string, workspace: string, prepare: string, opts: AssertRunOptions = {}): void {
  must(
    engine,
    [
      "run",
      "--rm",
      "-v",
      `${workspace}:/workspace`,
      ...resourceLimitArgs(opts.memoryMb ?? null, opts.pidsLimit ?? null),
      image,
      "bash",
      "-c",
      `cd /workspace && ( ${prepare} ) && git add -A && git -c user.name=bench -c user.email=bench@local commit -q --allow-empty -m "bench: prepare środowiska zadania"`,
    ],
    "task.prepare na stanie startowym",
    { timeout: 1_800_000 },
  );
}

export interface AssertRunOptions {
  /** Trwały cache zależności (wolumen bench-deps-cache) — patrz containers.ts. */
  depsCache?: boolean;
  /** Jawny limit pamięci kontenera oceny w MiB (OOM.md, warstwa 2). */
  memoryMb?: number | null;
  /** Limit liczby procesów kontenera oceny. */
  pidsLimit?: number | null;
}

function runEvaluateContainer(engine: string, root: string, image: string, workspace: string, refs: string[], outDir: string, opts: AssertRunOptions) {
  const mounts = refs.flatMap((ref) => ["-v", `${join(root, "evaluation-pool", ref)}:/bench/assertions/${ref}:ro`]);
  const result = sh(
    engine,
    [
      "run",
      "--rm",
      "-v",
      `${workspace}:/workspace`,
      "-v",
      `${outDir}:/bench/out`,
      ...resourceLimitArgs(opts.memoryMb ?? null, opts.pidsLimit ?? null),
      ...depsCacheArgs(opts.depsCache !== false),
      ...mounts,
      image,
      "node",
      "/bench/evaluate.mjs",
    ],
    { timeout: 3_600_000 },
  );
  return result;
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
  opts: AssertRunOptions = {},
): Record<string, AssertionOutcome> {
  const outDir = mkdtempSync(join(tmpdir(), "bench-assert-out-"));
  try {
    writeFileSync(join(outDir, "eval-plan.json"), JSON.stringify(buildEvalPlan(root, refs), null, 2) + "\n");
    if (patchFile) copyFileSync(patchFile, join(outDir, "patch.diff"));

    const result = runEvaluateContainer(engine, root, image, workspace, refs, outDir, opts);
    if (result.status !== 0 || !existsSync(join(outDir, "checks.json"))) {
      throw new Error(containerFailureMessage(result));
    }
    return JSON.parse(readFileSync(join(outDir, "checks.json"), "utf8"));
  } finally {
    // checks.json pisze kontener — może nie należeć do użytkownika hosta.
    removeTree(outDir, { engine, image });
  }
}

/** Wynik wsadu: per patch — wynik per ref albo błąd aplikacji patcha. */
export interface BatchEntry {
  outcomes: Record<string, AssertionOutcome> | null;
  patch_error: string | null;
}

/**
 * Wariant wsadowy (N2 z OPTIMIZATION.md): N patchy w JEDNYM wejściu do
 * kontenera oceny — evaluate.mjs aplikuje każdy patch na stan startowy,
 * uruchamia komplet asercji i resetuje workspace między patchami
 * (z zachowaniem katalogów zależności, żeby instalacja płaciła się raz).
 * Zwraca wyniki per patch w kolejności podanej listy.
 */
export function runAssertionsBatch(
  engine: string,
  root: string,
  image: string,
  workspace: string,
  refs: string[],
  patches: Array<{ name: string; path: string }>,
  opts: AssertRunOptions = {},
): Record<string, BatchEntry> {
  const outDir = mkdtempSync(join(tmpdir(), "bench-assert-out-"));
  try {
    return runBatchIn(outDir, engine, root, image, workspace, refs, patches, opts);
  } finally {
    // checks-batch.json pisze kontener — może nie należeć do użytkownika hosta.
    removeTree(outDir, { engine, image });
  }
}

function runBatchIn(
  outDir: string,
  engine: string,
  root: string,
  image: string,
  workspace: string,
  refs: string[],
  patches: Array<{ name: string; path: string }>,
  opts: AssertRunOptions,
): Record<string, BatchEntry> {
  mkdirSync(join(outDir, "patches"), { recursive: true });
  writeFileSync(join(outDir, "eval-plan.json"), JSON.stringify(buildEvalPlan(root, refs), null, 2) + "\n");
  const order: string[] = [];
  for (const [index, patch] of patches.entries()) {
    // Prefiks porządkowy: evaluate.mjs iteruje posortowane pliki, a wynik
    // ma wracać w kolejności podanej przez wołającego.
    const file = `${String(index).padStart(3, "0")}-${patch.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    copyFileSync(patch.path, join(outDir, "patches", file));
    order.push(file);
  }

  const result = runEvaluateContainer(engine, root, image, workspace, refs, outDir, opts);
  const batchPath = join(outDir, "checks-batch.json");
  if (result.status !== 0 || !existsSync(batchPath)) {
    throw new Error(containerFailureMessage(result));
  }
  const raw = JSON.parse(readFileSync(batchPath, "utf8")) as Record<string, BatchEntry>;
  const results: Record<string, BatchEntry> = {};
  for (const [index, patch] of patches.entries()) {
    const entry = raw[order[index] as string];
    if (!entry) throw new Error(`brak wyniku dla patcha "${patch.name}" w checks-batch.json`);
    results[patch.name] = entry;
  }
  return results;
}
