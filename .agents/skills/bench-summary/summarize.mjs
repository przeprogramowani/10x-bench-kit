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
 *
 * Nagłówek strony jest treścią redakcyjną, nie wynikiem — ustawia się go
 * flagami --title / --lede / --eyebrow. Bez nich strona bierze neutralne
 * domyślne teksty z szablonu; mechanikę oceniania opisuje sekcja
 * "jak to czytać", więc nagłówek nie musi jej powtarzać.
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
const headTitle = arg("--title");
const headLede = arg("--lede");
const headEyebrow = arg("--eyebrow");

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
  let rawStamps = null;

  for (const modelDir of dirs(join(resultsRoot, task))) {
    const trials = [];
    let modelId = modelDir;
    for (const trialDir of dirs(join(resultsRoot, task, modelDir))) {
      const f = join(resultsRoot, task, modelDir, trialDir, "result.json");
      if (!existsSync(f)) continue;
      const r = JSON.parse(readFileSync(f, "utf8"));
      if (r.model) modelId = r.model;
      if (r.stamps && !rawStamps) rawStamps = r.stamps;
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

  // REKOMENDACJA — niezawodność najpierw, cena jako rozstrzygnięcie remisu.
  //
  // Historycznie ta funkcja brała po prostu najtańszy expected_cost_per_pass
  // spośród modeli z choć jednym zaliczeniem. To produkowało rekomendacje w
  // rodzaju "model z 1/4 prób, bo 3× tańszy na wynik": arytmetycznie poprawne,
  // praktycznie mylące, bo cost ÷ pass_rate zakłada, że ponowienie kosztuje
  // tylko tokeny. Nie kosztuje — ktoś musi każdą porażkę otworzyć i odrzucić,
  // a gdy guardy są na niej zielone, robi to człowiek.
  //
  // Dlatego ranking idzie po DOLNEJ granicy przedziału Wilsona: mała próba jest
  // niepewnością i liczy się na niekorzyść, więc "domierz" i "jest gorszy"
  // pchają w tę samą stronę. Cena wchodzi dopiero między modelami o praktycznie
  // równej niezawodności.
  const RELIABILITY_TIE = 0.02;
  const candidates = models.filter((m) => m.passes > 0);
  const ranked = [...candidates].sort((a, b) =>
    Math.abs(a.interval.lo - b.interval.lo) > RELIABILITY_TIE
      ? b.interval.lo - a.interval.lo
      : a.expected_cost_per_pass - b.expected_cost_per_pass,
  );
  const pick = ranked[0] ?? null;

  // Remis: przedziały pass-rate nachodzą na siebie → tej różnicy próba NIE
  // rozstrzyga. Nie wolno jej podawać jako ustalonej kolejności ani zamieniać
  // na "więc bierz tańszy" — uczciwą reakcją jest domierzenie.
  const tied = pick
    ? ranked.filter(
        (m) => m !== pick && m.interval.lo <= pick.interval.hi && m.interval.hi >= pick.interval.lo,
      )
    : [];

  // Ostrzeżenia, które muszą jechać razem z liczbą, bo inaczej nagłówek kłamie.
  const caveats = [];
  if (pick) {
    if (pick.trials < 3) {
      caveats.push(
        `${pick.model_id}: ${pick.trials} prób(y) — poniżej 3 nie ma podstawy do orzekania o niezawodności`,
      );
    }
    if (pick.pass_rate < 0.5) {
      caveats.push(
        `${pick.model_id} zawodzi w ${pick.trials - pick.passes} z ${pick.trials} prób — koszt na akceptowalny wynik zakłada, że ponowienie jest darmowe poza tokenami`,
      );
    }
    const thin = candidates.filter((m) => m.trials < 3 && m !== pick);
    if (thin.length) {
      caveats.push(
        `porównanie asymetryczne: ${thin.map((m) => `${m.model_id} (n=${m.trials})`).join(", ")} zmierzone słabiej niż ${pick.model_id} (n=${pick.trials})`,
      );
    }
  }

  // Prezentacja jest jedna: wspólny szablon leaderboardu
  // (.bench-kit/runner/assets/leaderboard/). Tutaj tylko przekładamy wyniki na
  // jego kształt wiersza, żeby obie drogi pokazywały te same liczby i ten sam
  // wniosek — dwa osobne szablony rozjeżdżały się na tych samych danych.
  const siteRows = models.map((m) => ({
    model: m.model_id,
    task,
    trials: m.trials,
    median_total: m.median_total ?? 0,
    // mediana, żeby kolumna "Koszt próby" znaczyła na obu stronach to samo
    median_cost_usd: median(m.trials_detail.map((t) => t.cost_usd)),
    // dokładny koszt użytecznego wyniku z faktycznych kosztów, nie z mediany
    cost_per_pass: m.expected_cost_per_pass,
    median_judge_cost_usd: null,
    median_duration_s: m.mean_duration_s ?? 0,
    passed: m.passes,
    pass_at_1: m.pass_rate,
    pass_at_k: m.passes > 0 ? 1 : 0,
  }));

  tasks.push({
    task,
    site_rows: siteRows,
    site_stamps: rawStamps,
    pass_threshold: threshold,
    // kolejność prezentacji = kolejność rankingu (niezawodność, potem cena),
    // nie mediana: mediana mówi jak dobra była udana próba, nie jak często
    models: [...models].sort((a, b) =>
      Math.abs(a.interval.lo - b.interval.lo) > RELIABILITY_TIE
        ? b.interval.lo - a.interval.lo
        : (a.expected_cost_per_pass ?? Infinity) - (b.expected_cost_per_pass ?? Infinity),
    ),
    recommendation: pick
      ? {
          model_id: pick.model_id,
          expected_cost_per_pass: pick.expected_cost_per_pass,
          basis: `${pick.passes}/${pick.trials}`,
          reliability_lo: pick.interval.lo,
          caveats,
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
  // JEDEN szablon prezentacji dla całego kitu: ten sam, z którego korzysta
  // `bench leaderboard`. Skill nie trzyma już własnego HTML-a — dwie strony
  // o tych samych danych zawsze w końcu zaczynały mówić dwie różne rzeczy.
  const assets = join(root, ".bench-kit", "runner", "assets", "leaderboard");
  const asset = (n) => readFileSync(join(assets, n), "utf8");
  if (!existsSync(join(assets, "template.html"))) {
    console.error(`error: brak wspólnego szablonu w ${assets} — uruchom z --root wskazującym instancję benchmarku`);
    process.exit(1);
  }
  const title = headTitle ?? (onlyTask ? `bench-summary — ${onlyTask}` : "bench-summary — który model do tej pracy");
  const escHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Kształt SiteData leaderboardu: jeden run, jedna era per zadanie.
  const site = {
    title,
    // Redakcja nagłówka: puste stringi celowo kasują element (np. --lede ""),
    // a brak flagi zostawia domyślkę szablonu — stąd undefined, nie "".
    heading: {
      title,
      ...(headLede === undefined ? {} : { lede: headLede }),
      ...(headEyebrow === undefined ? {} : { eyebrow: headEyebrow }),
    },
    generated_at: out.generated_at,
    pass_threshold: threshold,
    runs: [{ id: "summary", generated_at: out.generated_at, total_cost_usd: out.total_spend_usd, trials: 0 }],
    tasks: out.tasks.map((t) => ({
      task: t.task,
      eras: [{
        stamps: t.site_stamps ?? {
          template_version: "?", scoring_version: undefined, task_hash: "",
          judge_model: "?", rubric_version: "none",
        },
        current: true,
        runs: [{ run_id: "summary", generated_at: out.generated_at, rows: t.site_rows }],
      }],
    })),
  };

  writeFileSync(
    htmlPath,
    asset("template.html")
      .split("__TITLE__").join(escHtml(title))
      .split("/*__STYLE__*/").join(asset("style.css").trimEnd())
      .split("__DATA__").join(JSON.stringify(site).replace(/</g, "\\u003c"))
      .split("/*__APP__*/").join(asset("app.js").trimEnd()),
  );
  console.error(`bench-summary: → ${htmlPath}`);
}
