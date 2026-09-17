#!/usr/bin/env node
/**
 * bench-summary: deterministyczna ekonomia biegu.
 *
 * Czyta WYŁĄCZNIE drzewa śledzone przez gita — `results/**\/result.json`
 * (wynik, koszt, czas, stemple) oraz `attempts/**\/patch.diff` (koszt
 * przeglądu). Dzięki temu działa po `git clone`, bez `workspace/`.
 *
 * Nic tu nie ocenia i nic nie pisze do results/ — liczby mają być
 * powtarzalne, a nie wyprowadzane w czacie na nowo przy każdym pytaniu.
 *
 *   node summarize.mjs --root <instancja> [--task <slug>] [--out <plik.json>] [--html <plik.html>]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const root = arg("--root", process.cwd());
const onlyTask = arg("--task");
const outPath = arg("--out");
const htmlPath = arg("--html");

const dirs = (p) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : [];

/** pass_threshold bez zależności yaml — jedno pole, prosty odczyt. */
function passThreshold() {
  const cfg = join(root, "bench.config.yaml");
  if (!existsSync(cfg)) return 0.7;
  const m = readFileSync(cfg, "utf8").match(/^\s*pass_threshold:\s*([0-9.]+)/m);
  return m ? Number(m[1]) : 0.7;
}

/** Przedział Wilsona 95% — po to, by „nierozróżnialne" było twierdzeniem, nie wrażeniem. */
function wilson(k, n) {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Koszt przeglądu: ile diffu ląduje na biurku człowieka. Nigdy nie wchodzi do scoringu. */
function reviewBurden(attemptDir) {
  const p = join(attemptDir, "patch.diff");
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, "utf8").split("\n");
  let files = 0, added = 0, removed = 0;
  for (const l of lines) {
    if (l.startsWith("+++ ")) files++;
    else if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { files, added, removed };
}

const threshold = passThreshold();
const resultsRoot = join(root, "results");
const attemptsRoot = join(root, "attempts");
const tasks = [];
const eras = new Set();

for (const task of dirs(resultsRoot)) {
  if (onlyTask && task !== onlyTask) continue;
  const models = [];

  for (const modelDir of dirs(join(resultsRoot, task))) {
    const trials = [];
    let modelId = modelDir;
    for (const trialDir of dirs(join(resultsRoot, task, modelDir))) {
      const f = join(resultsRoot, task, modelDir, trialDir, "result.json");
      if (!existsSync(f)) continue;
      const r = JSON.parse(readFileSync(f, "utf8"));
      if (r.model) modelId = r.model;
      if (r.stamps) {
        eras.add(
          [r.stamps.task_hash?.slice(0, 12), r.stamps.judge_model, r.stamps.rubric_version].join(" / "),
        );
      }
      trials.push({
        trial: r.trial,
        total: r.total,
        passed: r.total >= threshold,
        cost_usd: r.cost_usd ?? 0,
        duration_s: r.duration_s ?? null,
        scores: r.scores ?? {},
        review: reviewBurden(join(attemptsRoot, task, modelDir, trialDir)),
      });
    }
    if (!trials.length) continue;

    const n = trials.length;
    const passes = trials.filter((t) => t.passed).length;
    const rate = passes / n;
    const spend = trials.reduce((s, t) => s + t.cost_usd, 0);
    const meanCost = spend / n;
    const reviews = trials.map((t) => t.review).filter(Boolean);

    models.push({
      model_id: modelId,
      model_dir: modelDir,
      trials: n,
      passes,
      pass_rate: rate,
      interval: wilson(passes, n),
      spend_usd: spend,
      mean_cost_usd: meanCost,
      // TA liczba jest decyzją: ile kosztuje JEDEN akceptowalny wynik, z ponowieniami.
      expected_cost_per_pass: passes > 0 ? meanCost / rate : null,
      median_total: median(trials.map((t) => t.total)),
      mean_duration_s: median(trials.map((t) => t.duration_s).filter((d) => d != null)),
      review_burden: reviews.length
        ? {
            files: Math.round(reviews.reduce((s, r) => s + r.files, 0) / reviews.length),
            added: Math.round(reviews.reduce((s, r) => s + r.added, 0) / reviews.length),
            removed: Math.round(reviews.reduce((s, r) => s + r.removed, 0) / reviews.length),
          }
        : null,
      trials_detail: trials,
    });
  }
  if (!models.length) continue;

  // Rekomendacja: wśród modeli, które w ogóle przechodzą, najtańszy oczekiwany koszt.
  const passing = models.filter((m) => m.passes > 0);
  passing.sort((a, b) => a.expected_cost_per_pass - b.expected_cost_per_pass);
  const pick = passing[0] ?? null;

  // Remis: przedziały pass-rate nachodzą na siebie → nie wolno ich ustawiać w kolejności.
  const tied = pick
    ? passing.filter(
        (m) => m !== pick && m.interval.lo <= pick.interval.hi && m.interval.hi >= pick.interval.lo,
      )
    : [];

  tasks.push({
    task,
    pass_threshold: threshold,
    models: models.sort((a, b) => (b.median_total ?? 0) - (a.median_total ?? 0)),
    recommendation: pick
      ? {
          model_id: pick.model_id,
          expected_cost_per_pass: pick.expected_cost_per_pass,
          basis: `${pick.passes}/${pick.trials}`,
          tied_with: tied.map((m) => m.model_id),
          // Remis rozstrzyga cena — nie ułamek mediany, którego nie da się odróżnić.
          tie_note: tied.length
            ? "Przedziały pass-rate nachodzą się — wybór po cenie, nie po medianie."
            : null,
        }
      : null,
    spend_usd: models.reduce((s, m) => s + m.spend_usd, 0),
  });
}

const out = {
  generated_at: new Date().toISOString(),
  root,
  pass_threshold: threshold,
  eras: [...eras],
  tasks,
  total_spend_usd: tasks.reduce((s, t) => s + t.spend_usd, 0),
};

const json = JSON.stringify(out, null, 2);
if (outPath) {
  writeFileSync(outPath, json + "\n");
  console.error(`bench-summary: ${tasks.length} zadań, ${[...eras].length} er(y) → ${outPath}`);
} else if (!htmlPath) {
  process.stdout.write(json + "\n");
}

// Jedna samowystarczalna strona — bez bundlera, bez sieci, jak leaderboard kitu.
if (htmlPath) {
  const tpl = readFileSync(new URL("./template.html", import.meta.url), "utf8");
  const title = onlyTask ? `bench-summary — ${onlyTask}` : "bench-summary — który model do tej pracy";
  writeFileSync(
    htmlPath,
    tpl.replaceAll("__TITLE__", title).replace("__DATA__", json),
  );
  console.error(`bench-summary: → ${htmlPath}`);
}
