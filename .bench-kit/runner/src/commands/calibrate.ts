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
 * Użycie: bench calibrate --task <nazwa> --set <dir> [--rubric judge/<nazwa>]
 *                         [--repeats 3] [--model <provider/model>]
 *                         [--label <runda>] [--out <plik>] [--root <dir>]
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
  model: string | null;
  label: string | null;
  out: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), task: null, set: null, rubric: null, repeats: 3, model: null, label: null, out: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--task") opts.task = value() ?? null;
    else if (arg === "--set") opts.set = resolve(value() ?? "");
    else if (arg === "--rubric") opts.rubric = value() ?? null;
    else if (arg === "--repeats") opts.repeats = Number(value());
    else if (arg === "--model") opts.model = value() ?? null;
    else if (arg === "--label") opts.label = value() ?? null;
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.task || !opts.set) return null;
  if (!Number.isInteger(opts.repeats) || opts.repeats < 1) return null;
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
      "usage: bench calibrate --task <nazwa> --set <dir> [--rubric judge/<nazwa>] [--repeats 3] [--model <provider/model>] [--label <runda>] [--out <plik>] [--root <dir>]",
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
      `calibrate: ${diffFiles.length} diffów × ${opts.repeats} powtórzeń, rubryka ${rubricRef} (v${rubricVersion}), sędzia ${judgeModel}, runda "${label}"`,
    );

    const measurements: Measurement[] = [];
    let judgeCostUsd = 0;
    let costKnown = false;
    for (const file of diffFiles) {
      const diffName = basename(file).replace(/\.(diff|patch)$/, "");
      const patchDiff = readFileSync(join(opts.set, file), "utf8");
      for (let rep = 1; rep <= opts.repeats; rep++) {
        const verdict = await judgeTrial(judgeModel, taskPrompt, patchDiff, rubricText, { maxTokens: config.judge.max_tokens });
        for (const usage of [verdict.usage, verdict.first_attempt?.usage]) {
          if (typeof usage?.cost_usd === "number") {
            judgeCostUsd += usage.cost_usd;
            costKnown = true;
          }
        }
        measurements.push({
          diff: diffName,
          rep,
          score: verdict.score,
          criteria: criteriaScores(verdict.parsed),
          ...(verdict.invalid_reason ? { invalid_reason: verdict.invalid_reason } : {}),
        });
        console.error(
          `calibrate: ${diffName} #${rep} → ${verdict.score.toFixed(3)}${verdict.invalid_reason ? ` (${verdict.invalid_reason})` : ""}`,
        );
      }
    }

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

    const width = Math.max(...rows.map((r) => r.diff.length), 4);
    console.log(`\n${"diff".padEnd(width)}  min    med    max    rozrzut  ${criteriaNames.join("  ")}`);
    for (const row of rows) {
      console.log(
        `${row.diff.padEnd(width)}  ${row.min.toFixed(3)}  ${row.med.toFixed(3)}  ${row.max.toFixed(3)}  ${(row.max - row.min).toFixed(3)}    ${row.perCriterion.map((v, i) => v.padEnd((criteriaNames[i] as string).length)).join("  ")}`,
      );
    }
    const invalid = measurements.filter((m) => m.invalid_reason).length;
    if (invalid > 0) console.log(`\nwarn: ${invalid}/${measurements.length} werdyktów niepoprawnych (invalid_reason w results)`);
    console.log(
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
    console.log(`→ runda "${label}" dopisana do ${outPath}`);
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
