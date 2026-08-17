/**
 * bench report — agreguje result.json prób runu do danych leaderboardu.
 *
 * - MEDIANA per (model × zadanie) dla total / kosztu / czasu — nie średnia,
 *   żeby pojedynczy odjazd kosztowy nie zaburzał wyniku,
 * - pass@k jako miara niezawodności: próba "zalicza", gdy
 *   total >= defaults.pass_threshold z bench.config.yaml; estymator
 *   pass@k = 1 - C(n-c, k)/C(n, k) dla n prób, c zaliczonych,
 * - koszt runu = suma kosztów wszystkich prób (koszt sędziego jeszcze
 *   nieuwzględniany — pole cost_scope mówi wprost, co jest w sumie),
 * - wyniki grupowane w ery (identyczna krotka stamps) — nigdy nie
 *   mieszane; dashboard dostaje ery osobno,
 * - wyjście: report.json w katalogu runu (albo --out) — statyczne dane
 *   dla dashboardu GH Pages; surowe result.json zostają jako artefakty.
 *
 * Użycie: bench report --run <dir> [--out <plik>] [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, loadConfig } from "../lib/instance.ts";
import { eraKey } from "../lib/era.ts";
import { ResultSchema, type Result } from "../schemas/result.ts";

interface Options {
  root: string;
  run: string | null;
  out: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), run: null, out: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--run") opts.run = resolve(value() ?? "");
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  if (!opts.run) return null;
  return opts;
}

function findResults(runDir: string): Result[] {
  const results: Result[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "result.json") {
        const parsed = ResultSchema.safeParse(JSON.parse(readFileSync(full, "utf8")));
        if (parsed.success) results.push(parsed.data);
        else console.error(`warn:  pomijam niepoprawny ${full}`);
      }
    }
  };
  walk(runDir);
  return results;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** pass@k = 1 - C(n-c, k)/C(n, k); n prób, c zaliczonych. */
function passAtK(n: number, c: number, k: number): number {
  if (n - c < k) return 1;
  let ratio = 1;
  for (let i = 0; i < k; i++) ratio *= (n - c - i) / (n - i);
  return 1 - ratio;
}

export async function reportCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts || !opts.run) {
    console.error("usage: bench report --run <dir> [--out <plik>] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  try {
    const config = loadConfig(root);
    const threshold = config.defaults.pass_threshold;
    const results = findResults(opts.run);
    if (results.length === 0) throw new Error(`brak result.json w ${opts.run} — najpierw \`bench evaluate\``);

    // grupowanie: era (krotka stamps, klucz z lib/era.ts) →
    // (model × zadanie) → próby.
    const eras = new Map<string, { stamps: Result["stamps"]; cells: Map<string, Result[]> }>();
    for (const result of results) {
      const key = eraKey(result.stamps);
      let era = eras.get(key);
      if (!era) {
        era = { stamps: result.stamps, cells: new Map() };
        eras.set(key, era);
      }
      const cellKey = `${result.model}\0${result.task}`;
      era.cells.set(cellKey, [...(era.cells.get(cellKey) ?? []), result]);
    }

    const report = {
      generated_at: new Date().toISOString(),
      run_dir: opts.run,
      pass_threshold: threshold,
      /** Suma kosztów prób; koszt sędziego osobno (total_judge_cost_usd). */
      cost_scope: "trials",
      total_cost_usd: results.reduce((acc, r) => acc + r.cost_usd, 0),
      // Koszt sędziego jako osobna pozycja — nie dokleja się do kosztu
      // modelu, ale przy tanich modelach bywa porównywalny z kosztem próby.
      total_judge_cost_usd: results.some((r) => typeof r.judge_cost_usd === "number")
        ? results.reduce((acc, r) => acc + (r.judge_cost_usd ?? 0), 0)
        : null,
      trials: results.length,
      eras: [...eras.values()].map(({ stamps, cells }) => ({
        stamps,
        rows: [...cells.entries()]
          .map(([key, cellResults]) => {
            const [model, task] = key.split("\0") as [string, string];
            const n = cellResults.length;
            const passed = cellResults.filter((r) => r.total >= threshold).length;
            return {
              model,
              task,
              trials: n,
              median_total: median(cellResults.map((r) => r.total)),
              median_cost_usd: median(cellResults.map((r) => r.cost_usd)),
              median_judge_cost_usd: cellResults.every((r) => typeof r.judge_cost_usd === "number")
                ? median(cellResults.map((r) => r.judge_cost_usd as number))
                : null,
              median_duration_s: median(cellResults.map((r) => r.duration_s)),
              passed,
              pass_at_1: passAtK(n, passed, 1),
              pass_at_k: passAtK(n, passed, Math.min(n, config.defaults.trials)),
            };
          })
          .sort((a, b) => a.task.localeCompare(b.task) || b.median_total - a.median_total),
      })),
    };

    const outPath = opts.out ?? join(opts.run, "report.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

    const judgeCostNote =
      report.total_judge_cost_usd !== null ? ` + sędzia $${report.total_judge_cost_usd.toFixed(4)}` : "";
    console.log(`bench report: ${results.length} prób, ${eras.size} era(y), koszt prób $${report.total_cost_usd.toFixed(4)}${judgeCostNote}`);
    for (const era of report.eras) {
      for (const row of era.rows) {
        console.log(
          `  ${row.task} × ${row.model}: mediana ${row.median_total.toFixed(3)}, ` +
            `pass@1 ${row.pass_at_1.toFixed(2)}, $${row.median_cost_usd.toFixed(4)}, ${row.median_duration_s}s ` +
            `(${row.passed}/${row.trials} zaliczonych)`,
        );
      }
    }
    console.log(`→ ${outPath}`);
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
