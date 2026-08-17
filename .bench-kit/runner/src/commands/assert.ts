/**
 * bench assert — pojedyncze asercje nie-LLM-owe z puli na wskazanej
 * referencji, bez pełnego cyklu próby. Enabler zasady "testuj na
 * referencji, zanim zaproponujesz" (bench-task / bench-refresh) oraz
 * weryfikacji referencyjnej w `bench validate --assert`.
 *
 * Referencja = stan startowy zbudowany na hoście (repo@pin + overlay
 * + commit startowy) i zamontowany do kontenera oceny — ten sam
 * /bench/evaluate.mjs co w `bench evaluate`, więc wynik jest tożsamy
 * z pełnym cyklem. Opcjonalny --patch nakłada diff (np. wzorcowe
 * rozwiązanie) przed oceną.
 *
 * Kod wyjścia: 0 gdy wszystkie asercje mają score 1, 1 gdy którakolwiek
 * niżej — skill sprawdza oba kierunki ("referencja przechodzi" = exit 0,
 * "znany zły stan nie przechodzi" = exit 1).
 *
 * Praca wsadowa (N2): --patch można podać wielokrotnie — wszystkie diffy
 * ocenia JEDNO wejście do kontenera (evaluate.mjs aplikuje i resetuje
 * między patchami); pusty plik diffa = stan startowy. Exit 0 tylko gdy
 * każdy patch przechodzi wszystkie asercje.
 *
 * --json (N3): strukturalny wynik na stdout (postęp idzie na stderr) —
 * bez parsowania tabelek w pętli "zmierz → porównaj → zdecyduj".
 *
 * Użycie:
 *   bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]...
 *   bench assert <ref...> --repo <nazwa> --commit <sha> [--overlay <dir>] [--patch <plik>]...
 *   (wspólne: [--json] [--no-deps-cache]; z --task bez refów: wszystkie
 *    asercje nie-LLM-owe z task.yaml)
 */
import { existsSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { detectEngine, ensureBaseImage } from "../lib/containers.ts";
import { buildStartWorkspace, runAssertions, runAssertionsBatch, type AssertionOutcome } from "../lib/reference.ts";

interface Options {
  root: string;
  refs: string[];
  task: string | null;
  repo: string | null;
  commit: string | null;
  overlay: string | null;
  noOverlay: boolean;
  patches: string[];
  engine: string | null;
  json: boolean;
  noDepsCache: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = {
    root: process.cwd(),
    refs: [],
    task: null,
    repo: null,
    commit: null,
    overlay: null,
    noOverlay: false,
    patches: [],
    engine: null,
    json: false,
    noDepsCache: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) return null;
    const value = () => args[++i];
    if (arg === "--task") opts.task = value() ?? null;
    else if (arg === "--repo") opts.repo = value() ?? null;
    else if (arg === "--commit") opts.commit = value() ?? null;
    else if (arg === "--overlay") opts.overlay = resolve(value() ?? "");
    else if (arg === "--no-overlay") opts.noOverlay = true;
    else if (arg === "--patch") opts.patches.push(resolve(value() ?? ""));
    else if (arg === "--engine") opts.engine = value() ?? null;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--no-deps-cache") opts.noDepsCache = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else if (arg.startsWith("--")) return null;
    else opts.refs.push(arg);
  }
  if (opts.task && (opts.repo || opts.commit)) return null;
  if (!opts.task && (!opts.repo || !opts.commit)) return null;
  if (!opts.task && opts.refs.length === 0) return null;
  return opts;
}

export async function assertCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error(
      [
        "usage: bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]...",
        "       bench assert <ref...> --repo <nazwa> --commit <sha> [--overlay <dir>] [--patch <plik>]...",
        "       (wspólne: [--json] [--no-deps-cache] [--engine docker|podman] [--root <dir>])",
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
    const repoUrls = new Map(config.base_repos.map((r) => [r.name, r.url]));

    let repoName: string, commit: string, overlay: string | null, refs: string[];
    let taskMemoryMb: number | null = null;
    if (opts.task) {
      const task = loadTask(root, opts.task);
      repoName = task.repo;
      commit = task.commit;
      taskMemoryMb = task.memory_mb ?? null;
      const taskOverlay = join(root, "tasks", opts.task, "overlay");
      overlay = opts.noOverlay ? null : existsSync(taskOverlay) ? taskOverlay : null;
      refs = opts.refs.length > 0 ? opts.refs : task.evaluation.filter((ref) => !ref.startsWith("judge/"));
      if (refs.length === 0) throw new Error(`tasks/${opts.task}: brak asercji nie-LLM-owych w evaluation[] — bench assert nie ma czego uruchomić`);
    } else {
      repoName = opts.repo as string;
      commit = opts.commit as string;
      overlay = opts.overlay;
      refs = opts.refs;
    }

    for (const ref of refs) {
      if (ref.startsWith("judge/")) throw new Error(`asercja "${ref}" jest typu judge — użyj \`bench judge\``);
      if (!existsSync(join(root, "evaluation-pool", ref, "check.yaml"))) {
        throw new Error(`asercja "${ref}" nie istnieje w evaluation-pool/ (brak check.yaml)`);
      }
    }
    for (const patch of opts.patches) {
      if (!existsSync(patch)) throw new Error(`plik patcha nie istnieje: ${patch}`);
    }
    const repoUrl = repoUrls.get(repoName);
    if (!repoUrl) throw new Error(`repo "${repoName}" nie istnieje w base_repos bench.config.yaml`);

    // W trybie --json stdout należy do wyniku strukturalnego; postęp → stderr.
    const progress = opts.json ? console.error : console.log;
    const runOpts = {
      depsCache: !opts.noDepsCache && config.evaluation.deps_cache,
      memoryMb: taskMemoryMb ?? config.resources.memory_mb ?? null,
      pidsLimit: config.resources.pids_limit ?? null,
    };

    const engine = detectEngine(opts.engine);
    progress(`assert: obraz bazowy…`);
    const image = ensureBaseImage(engine, root);
    const patchNote = opts.patches.length === 1 ? " + patch" : opts.patches.length > 1 ? ` + ${opts.patches.length} patchy (wsad)` : "";
    progress(`assert: stan startowy ${repoName}@${commit.slice(0, 12)}…${overlay ? " + overlay" : ""}${patchNote}`);
    const workspace = buildStartWorkspace(repoUrl, commit, overlay);
    try {
      const printOutcomes = (outcomes: Record<string, AssertionOutcome>, indent: string): boolean => {
        let allPass = true;
        for (const ref of refs) {
          const outcome = outcomes[ref];
          if (!outcome) throw new Error(`brak wyniku dla asercji ${ref} w checks.json`);
          if (outcome.score < 1) allPass = false;
          progress(`${indent}assert: ${ref} → score ${outcome.score.toFixed(2)} (${outcome.passed}/${outcome.total} komend)`);
          for (const check of outcome.checks) {
            if (check.exit !== 0) {
              progress(`${indent}        ✗ ${check.name} (exit ${check.exit})`);
              const tail = check.log_tail.trim().split("\n").slice(-10).join(`\n${indent}        | `);
              if (tail) progress(`${indent}        | ${tail}`);
            }
          }
        }
        return allPass;
      };

      if (opts.patches.length > 1) {
        // Wsad: jedno wejście do kontenera, N wyników (N2).
        const names: string[] = [];
        for (const patch of opts.patches) {
          const base = basename(patch);
          names.push(names.includes(base) ? patch : base);
        }
        const patches = opts.patches.map((path, i) => ({ name: names[i] as string, path }));
        const batch = runAssertionsBatch(engine, root, image, workspace, refs, patches, runOpts);
        let allPass = true;
        for (const { name } of patches) {
          const entry = batch[name];
          if (!entry) throw new Error(`brak wyniku dla patcha "${name}" w checks-batch.json`);
          if (entry.patch_error !== null || !entry.outcomes) {
            allPass = false;
            progress(`\npatch ${name}: NIE APLIKUJE SIĘ na stan startowy`);
            progress(`  | ${(entry.patch_error ?? "").trim().split("\n").slice(-5).join("\n  | ")}`);
            continue;
          }
          progress(`\npatch ${name}:`);
          if (!printOutcomes(entry.outcomes, "  ")) allPass = false;
        }
        progress(`\nbench assert: ${allPass ? "wszystkie patche przechodzą wszystkie asercje" : "są patche z asercjami poniżej 1.0 (lub nieaplikowalne)"}`);
        if (opts.json) console.log(JSON.stringify({ mode: "batch", refs, patches: batch }, null, 2));
        return allPass ? 0 : 1;
      }

      const outcomes = runAssertions(engine, root, image, workspace, refs, opts.patches[0] ?? null, runOpts);
      const allPass = printOutcomes(outcomes, "");
      progress(`\nbench assert: ${allPass ? "wszystkie asercje przechodzą" : "są asercje poniżej 1.0"}`);
      if (opts.json) console.log(JSON.stringify({ mode: "single", refs, outcomes }, null, 2));
      return allPass ? 0 : 1;
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
