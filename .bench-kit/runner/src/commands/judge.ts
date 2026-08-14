/**
 * bench judge — pojedyncze wywołanie sędziego LLM na zadanym diffie,
 * bez pełnego cyklu próby. Enabler kalibracji rubryk (bench-rubric):
 * ten sam buildJudgePrompt/parseVerdict co w `bench evaluate`, więc
 * werdykt jest tożsamy z pełnym cyklem.
 *
 * Wejście: prompt.md zadania + diff z pliku + rubryki judge/* zadania
 * (albo jedna wskazana --rubric). Model sędziego z bench.config.yaml,
 * do nadpisania --model (np. porównanie sędziów przy kalibracji).
 *
 * Wyjście: werdykt(y) JSON na stdout — {ref, score, parsed,
 * invalid_reason?}; przy niepoprawnym JSON-ie odpowiedzi score = 0
 * i surowa odpowiedź w polu raw (audyt jak w judge.json).
 *
 * Kod wyjścia: 0 gdy wywołania sędziego się powiodły (score to werdykt,
 * nie sukces komendy), 2 przy błędzie użycia/API.
 *
 * Użycie: bench judge --task <nazwa> --patch <plik>
 *                     [--rubric judge/<nazwa>] [--model <provider/model>] [--root <dir>]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { judgeTrial } from "../lib/judge.ts";

interface Options {
  root: string;
  task: string | null;
  patch: string | null;
  rubric: string | null;
  model: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), task: null, patch: null, rubric: null, model: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--task") opts.task = value() ?? null;
    else if (arg === "--patch") opts.patch = resolve(value() ?? "");
    else if (arg === "--rubric") opts.rubric = value() ?? null;
    else if (arg === "--model") opts.model = value() ?? null;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.task || !opts.patch) return null;
  if (opts.rubric && !/^judge\/[A-Za-z0-9._-]+$/.test(opts.rubric)) return null;
  return opts;
}

export async function judgeCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench judge --task <nazwa> --patch <plik> [--rubric judge/<nazwa>] [--model <provider/model>] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  try {
    const config = loadConfig(root);
    const task = loadTask(root, opts.task as string);
    const judgeModel = opts.model ?? config.judge.model;

    const rubricRefs = opts.rubric ? [opts.rubric] : task.evaluation.filter((ref) => ref.startsWith("judge/"));
    if (rubricRefs.length === 0) {
      throw new Error(`tasks/${opts.task}: brak asercji judge/* w evaluation[] — wskaż rubrykę przez --rubric`);
    }

    const patchPath = opts.patch as string;
    if (!existsSync(patchPath)) throw new Error(`plik patcha nie istnieje: ${patchPath}`);
    const patchDiff = readFileSync(patchPath, "utf8");
    const taskPrompt = readFileSync(join(root, "tasks", opts.task as string, "prompt.md"), "utf8");

    const verdicts = [];
    for (const ref of rubricRefs) {
      const rubricPath = join(root, "evaluation-pool", "judge", `${ref.split("/")[1]}.md`);
      if (!existsSync(rubricPath)) throw new Error(`rubryka "${ref}" nie istnieje w evaluation-pool/judge/`);
      const rubric = readFileSync(rubricPath, "utf8");
      console.error(`judge: ${ref} × ${judgeModel} …`);
      const verdict = await judgeTrial(judgeModel, taskPrompt, patchDiff, rubric, { maxTokens: config.judge.max_tokens });
      verdicts.push({ ref, judge_model: judgeModel, ...verdict });
      console.error(`judge: ${ref} → score ${verdict.score.toFixed(2)}${verdict.invalid_reason ? ` (${verdict.invalid_reason})` : ""}`);
    }
    console.log(JSON.stringify(verdicts, null, 2));
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
