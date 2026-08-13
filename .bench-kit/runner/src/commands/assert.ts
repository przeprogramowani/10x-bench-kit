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
 * Użycie:
 *   bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]
 *   bench assert <ref...> --repo <nazwa> --commit <sha> [--overlay <dir>] [--patch <plik>]
 *   (z --task bez refów: wszystkie asercje nie-LLM-owe z task.yaml)
 */
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { detectEngine, ensureBaseImage } from "../lib/containers.ts";
import { buildStartWorkspace, runAssertions } from "../lib/reference.ts";

interface Options {
  root: string;
  refs: string[];
  task: string | null;
  repo: string | null;
  commit: string | null;
  overlay: string | null;
  noOverlay: boolean;
  patch: string | null;
  engine: string | null;
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
    patch: null,
    engine: null,
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
    else if (arg === "--patch") opts.patch = resolve(value() ?? "");
    else if (arg === "--engine") opts.engine = value() ?? null;
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
        "usage: bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]",
        "       bench assert <ref...> --repo <nazwa> --commit <sha> [--overlay <dir>] [--patch <plik>]",
        "       (wspólne: [--engine docker|podman] [--root <dir>])",
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
    if (opts.task) {
      const task = loadTask(root, opts.task);
      repoName = task.repo;
      commit = task.commit;
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
    if (opts.patch && !existsSync(opts.patch)) throw new Error(`plik patcha nie istnieje: ${opts.patch}`);
    const repoUrl = repoUrls.get(repoName);
    if (!repoUrl) throw new Error(`repo "${repoName}" nie istnieje w base_repos bench.config.yaml`);

    const engine = detectEngine(opts.engine);
    console.log(`assert: obraz bazowy…`);
    const image = ensureBaseImage(engine, root);
    console.log(`assert: stan startowy ${repoName}@${commit.slice(0, 12)}…${overlay ? " + overlay" : ""}${opts.patch ? " + patch" : ""}`);
    const workspace = buildStartWorkspace(repoUrl, commit, overlay);
    try {
      const outcomes = runAssertions(engine, root, image, workspace, refs, opts.patch);
      let allPass = true;
      for (const ref of refs) {
        const outcome = outcomes[ref];
        if (!outcome) throw new Error(`brak wyniku dla asercji ${ref} w checks.json`);
        if (outcome.score < 1) allPass = false;
        console.log(`assert: ${ref} → score ${outcome.score.toFixed(2)} (${outcome.passed}/${outcome.total} komend)`);
        for (const check of outcome.checks) {
          if (check.exit !== 0) {
            console.log(`        ✗ ${check.name} (exit ${check.exit})`);
            const tail = check.log_tail.trim().split("\n").slice(-10).join("\n        | ");
            if (tail) console.log(`        | ${tail}`);
          }
        }
      }
      console.log(`\nbench assert: ${allPass ? "wszystkie asercje przechodzą" : "są asercje poniżej 1.0"}`);
      return allPass ? 0 : 1;
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
