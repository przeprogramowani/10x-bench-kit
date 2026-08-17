/**
 * bench calibrate — pomiar rozdzielczości rubryki na zbiorze kalibracyjnym.
 *
 * Zbiór kalibracyjny = katalog z diffami o znanej jakości (*.diff / *.patch;
 * konwencja: evaluation-pool/judge/<zadanie>-calibration/). Każdy diff jest
 * oceniany `--repeats` razy tym samym sędzią (judgeTrial — werdykt tożsamy
 * z pełnym cyklem), a komenda liczy arytmetykę, którą dotąd robiło się
 * pętlą w bashu: min/med/max per diff, mediany per kryterium, rozrzut.
 *
 * Osąd zostaje w skillu bench-rubric (projekt zbioru, ocena rankingu
 * i separacji, decyzja o iteracji kryteriów) — runner przejmuje liczenie.
 *
 * Wyniki dopisywane do results.json zbioru jako runda `--label`
 * (format jak w PR-ach kalibracyjnych: rounds.<label>[] = {diff, rep,
 * score, criteria}); istniejące rundy zostają — kolejne iteracje rubryki
 * mierzą się na tym samym zbiorze i tej samej historii.
 *
 * Równoległość (N2): werdykty w ramach rundy są niezależne — `--parallel`
 * ogranicza liczbę jednoczesnych wywołań sędziego (default 3; 1 = sekwencyjnie
 * jak dawniej, np. przy providerach z ostrym rate limitem).
 *
 * --json (N3): strukturalne podsumowanie rundy na stdout (tabela dla
 * człowieka idzie wtedy na stderr) — pętla "zmierz → porównaj → zdecyduj"
 * bez parsowania tabelek.
 *
 * Użycie: bench calibrate --task <nazwa> --set <dir> [--rubric judge/<nazwa>]
 *                         [--repeats 3] [--parallel 3] [--model <provider/model>]
 *                         [--label <runda>] [--json] [--out <plik>] [--root <dir>]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { findInstanceRoot, loadConfig, loadTask } from "../lib/instance.ts";
import { judgeTrial, parseRubric } from "../lib/judge.ts";

interface Options {
  root: string;
  task: string | null;
  set: string | null;
  rubric: string | null;
  repeats: number;
  parallel: number;
  model: string | null;
  label: string | null;
  json: boolean;
  out: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), task: null, set: null, rubric: null, repeats: 3, parallel: 3, model: null, label: null, json: false, out: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--task") opts.task = value() ?? null;
    else if (arg === "--set") opts.set = resolve(value() ?? "");
    else if (arg === "--rubric") opts.rubric = value() ?? null;
    else if (arg === "--repeats") opts.repeats = Number(value());
    else if (arg === "--parallel") opts.parallel = Number(value());
    else if (arg === "--model") opts.model = value() ?? null;
    else if (arg === "--label") opts.label = value() ?? null;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.task || !opts.set) return null;
  if (!Number.isInteger(opts.repeats) || opts.repeats < 1) return null;
  if (!Number.isInteger(opts.parallel) || opts.parallel < 1) return null;
  if (opts.rubric && !/^judge\/[A-Za-z0-9._-]+$/.test(opts.rubric)) return null;
  return opts;
}

interface Measurement {
  diff: string;
  rep: number;
  score: number;
  criteria: Record<string, number> | null;
  invalid_reason?: string;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

function criteriaScores(parsed: unknown): Record<string, number> | null {
  const criteria = (parsed as Record<string, unknown> | null)?.["criteria"];
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) return null;
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(criteria as Record<string, unknown>)) {
    const score = (value as Record<string, unknown> | null)?.["score"];
    if (typeof score === "number") out[name] = score;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function calibrateCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts || !opts.task || !opts.set) {
    console.error(
      "usage: bench calibrate --task <nazwa> --set <dir> [--rubric judge/<nazwa>] [--repeats 3] [--parallel 3] [--model <provider/model>] [--label <runda>] [--json] [--out <plik>] [--root <dir>]",
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
    const task = loadTask(root, opts.task);
    const judgeModel = opts.model ?? config.judge.model;

    const judgeRefs = task.evaluation.filter((ref) => ref.startsWith("judge/"));
    const rubricRef = opts.rubric ?? (judgeRefs.length === 1 ? judgeRefs[0] : null);
    if (!rubricRef) {
      throw new Error(
        judgeRefs.length === 0
          ? `tasks/${opts.task}: brak asercji judge/* w evaluation[] — wskaż rubrykę przez --rubric`
          : `tasks/${opts.task}: ${judgeRefs.length} rubryki w evaluation[] — kalibracja mierzy jedną, wskaż --rubric`,
      );
    }
    const rubricName = rubricRef.split("/")[1] as string;
    const rubricPath = join(root, "evaluation-pool", "judge", `${rubricName}.md`);
    if (!existsSync(rubricPath)) throw new Error(`rubryka "${rubricRef}" nie istnieje w evaluation-pool/judge/`);
    const rubricText = readFileSync(rubricPath, "utf8");
    const rubricVersion = parseRubric(rubricText).version ?? config.judge.rubric_version ?? "?";

    if (!existsSync(opts.set)) throw new Error(`zbiór kalibracyjny nie istnieje: ${opts.set}`);
    const diffFiles = readdirSync(opts.set)
      .filter((name) => /\.(diff|patch)$/.test(name))
      .sort();
    if (diffFiles.length === 0) throw new Error(`brak plików *.diff / *.patch w ${opts.set}`);

    const taskPrompt = readFileSync(join(root, "tasks", opts.task, "prompt.md"), "utf8");
    const label = opts.label ?? `${rubricName}-v${rubricVersion}-${new Date().toISOString().slice(0, 10)}`;
    console.error(
      `calibrate: ${diffFiles.length} diffów × ${opts.repeats} powtórzeń (parallel ${opts.parallel}), rubryka ${rubricRef} (v${rubricVersion}), sędzia ${judgeModel}, runda "${label}"`,
    );

    // Werdykty są niezależne — pula o ograniczonej równoległości (Z3/N2);
    // kolejność w measurements zostaje deterministyczna (indeks jobu).
    const setDir = opts.set;
    const jobs = diffFiles.flatMap((file) => {
      const diffName = basename(file).replace(/\.(diff|patch)$/, "");
      const patchDiff = readFileSync(join(setDir, file), "utf8");
      return Array.from({ length: opts.repeats }, (_, i) => ({ diffName, patchDiff, rep: i + 1 }));
    });
    const measurements: Measurement[] = new Array(jobs.length);
    let judgeCostUsd = 0;
    let costKnown = false;
    let nextJob = 0;
    const worker = async () => {
      for (;;) {
        const index = nextJob++;
        const job = jobs[index];
        if (!job) return;
        const verdict = await judgeTrial(judgeModel, taskPrompt, job.patchDiff, rubricText, { maxTokens: config.judge.max_tokens });
        for (const usage of [verdict.usage, verdict.first_attempt?.usage]) {
          if (typeof usage?.cost_usd === "number") {
            judgeCostUsd += usage.cost_usd;
            costKnown = true;
          }
        }
        measurements[index] = {
          diff: job.diffName,
          rep: job.rep,
          score: verdict.score,
          criteria: criteriaScores(verdict.parsed),
          ...(verdict.invalid_reason ? { invalid_reason: verdict.invalid_reason } : {}),
        };
        console.error(
          `calibrate: ${job.diffName} #${job.rep} → ${verdict.score.toFixed(3)}${verdict.invalid_reason ? ` (${verdict.invalid_reason})` : ""}`,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.parallel, jobs.length) }, worker));

    // --- tabela: min/med/max per diff + mediany per kryterium ---
    const criteriaNames = [...new Set(measurements.flatMap((m) => Object.keys(m.criteria ?? {})))].sort();
    const rows = diffFiles.map((file) => {
      const diffName = basename(file).replace(/\.(diff|patch)$/, "");
      const scores = measurements.filter((m) => m.diff === diffName).map((m) => m.score);
      const perCriterion = criteriaNames.map((name) => {
        const values = measurements
          .filter((m) => m.diff === diffName && typeof m.criteria?.[name] === "number")
          .map((m) => m.criteria?.[name] as number);
        return values.length > 0 ? median(values).toFixed(2) : "—";
      });
      return {
        diff: diffName,
        min: Math.min(...scores),
        med: median(scores),
        max: Math.max(...scores),
        perCriterion,
      };
    });
    rows.sort((a, b) => b.med - a.med);

    // W trybie --json stdout należy do wyniku strukturalnego; tabela → stderr.
    const print = opts.json ? console.error : console.log;
    const width = Math.max(...rows.map((r) => r.diff.length), 4);
    print(`\n${"diff".padEnd(width)}  min    med    max    rozrzut  ${criteriaNames.join("  ")}`);
    for (const row of rows) {
      print(
        `${row.diff.padEnd(width)}  ${row.min.toFixed(3)}  ${row.med.toFixed(3)}  ${row.max.toFixed(3)}  ${(row.max - row.min).toFixed(3)}    ${row.perCriterion.map((v, i) => v.padEnd((criteriaNames[i] as string).length)).join("  ")}`,
      );
    }
    const invalid = measurements.filter((m) => m.invalid_reason).length;
    if (invalid > 0) print(`\nwarn: ${invalid}/${measurements.length} werdyktów niepoprawnych (invalid_reason w results)`);
    print(
      `\ncalibrate: ${measurements.length} werdyktów, koszt sędziego ${costKnown ? `$${judgeCostUsd.toFixed(4)}` : "nieznany (provider nie raportuje)"}`,
    );

    // --- results.json: dopisz rundę, historia poprzednich iteracji zostaje ---
    const outPath = opts.out ?? join(opts.set, "results.json");
    let results: Record<string, unknown> = { judge_model: judgeModel, rounds: {} };
    if (existsSync(outPath)) {
      results = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      if (results["judge_model"] && results["judge_model"] !== judgeModel) {
        console.error(`warn: results.json mierzone sędzią ${results["judge_model"]}, ta runda: ${judgeModel} — porównuj ostrożnie`);
      }
      if (!results["rounds"] || typeof results["rounds"] !== "object") results["rounds"] = {};
    }
    results["date"] = new Date().toISOString().slice(0, 10);
    (results["rounds"] as Record<string, unknown>)[label] = measurements;
    writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
    print(`→ runda "${label}" dopisana do ${outPath}`);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            label,
            rubric: rubricRef,
            rubric_version: rubricVersion,
            judge_model: judgeModel,
            repeats: opts.repeats,
            rows: rows.map((row) => ({
              diff: row.diff,
              min: row.min,
              med: row.med,
              max: row.max,
              spread: row.max - row.min,
              criteria_medians: Object.fromEntries(criteriaNames.map((name, i) => [name, row.perCriterion[i] === "—" ? null : Number(row.perCriterion[i])])),
            })),
            invalid_verdicts: invalid,
            judge_cost_usd: costKnown ? judgeCostUsd : null,
            results_path: outPath,
          },
          null,
          2,
        ),
      );
    }
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
