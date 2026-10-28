#!/usr/bin/env node
/**
 * bench-analysis: deterministyczna ekonomia i statystyka decyzji.
 *
 * Czyta WYŁĄCZNIE drzewa śledzone przez gita — `results/**\/result.json`
 * (wynik, koszt, czas, stemple) oraz `attempts/**\/patch.diff` (koszt
 * przeglądu). Dzięki temu działa po `git clone`, bez `workspace/`.
 *
 * Nic tu nie ocenia i nic nie pisze do results/ — liczby mają być
 * powtarzalne, a nie wyprowadzane w czacie na nowo przy każdym pytaniu.
 *
 * Per zadanie × model: zaliczenia wg bramki z result.json (`passed`),
 * TYLKO z bieżącej ery zadania (inne ery liczone osobno, nigdy mieszane),
 * pass^k, wykluczone próby (awarie infrastruktury — widoczne, nie
 * przemilczane), koszt nieznany jako nieznany. Ponad zadaniami
 * (analytics.mjs): widok klasa × model z jednostką = zadanie, porównania
 * parowe modeli na wspólnych zadaniach, rozdzielczość (ile zadań na jaką
 * różnicę), horyzont czasowy z pola Human time backlogu.
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
import { spawnSync } from "node:child_process";
import { classView, pairedComparisons, parseBacklogMeta, passHatK, resolvableGap, tasksNeeded, timeHorizon } from "./analytics.mjs";

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

/** Klucz ery jak w runnerze (lib/era.ts → eraKey) — ta sama krotka, ta sama kolejność. */
const eraKeyOf = (s = {}) =>
  JSON.stringify([
    s.scoring_version ?? s.template_version,
    s.task_hash,
    s.judge_model,
    s.rubric_version,
    s.judge_mode ?? null,
    s.pass_threshold ?? null,
  ]);

/** judge.mode z configu (ścieżka oceny instancji) bez zależności yaml; domyślnie agent. */
function configuredJudgeMode() {
  const cfg = join(root, "bench.config.yaml");
  if (!existsSync(cfg)) return "agent";
  const block = readFileSync(cfg, "utf8").match(/^judge:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m)?.[1] ?? "";
  return block.match(/^\s+mode:\s*["']?(agent|api)\b/m)?.[1] ?? "agent";
}
const judgeMode = configuredJudgeMode();
/** judge.model z configu (zapas heurystyki ery). */
function configuredJudgeModel() {
  const cfg = join(root, "bench.config.yaml");
  if (!existsSync(cfg)) return null;
  const block = readFileSync(cfg, "utf8").match(/^judge:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m)?.[1] ?? "";
  return block.match(/^\s+model:\s*["']?([^"'\s#]+)/m)?.[1] ?? null;
}
const judgeModel = configuredJudgeModel();

/**
 * Bieżąca era zadania: najwyższa wersja scoringu; potem era ścieżki oceny
 * z configu (judge.mode; zadania bez sędziego mają "none"); potem
 * najliczniejsza. Reszta to other_era_trials — widoczna, nie mieszana.
 */
function currentEra(results) {
  const byKey = new Map();
  for (const r of results) {
    const key = eraKeyOf(r.stamps);
    const mode = r.stamps?.judge_mode;
    // Zgodność z bieżącym configiem: ścieżka oceny, próg, sędzia.
    const preferred =
      (mode === judgeMode || mode === "none" ? 1 : 0) +
      (r.stamps?.pass_threshold === undefined || r.stamps.pass_threshold === threshold ? 1 : 0) +
      (judgeModel === null || r.stamps?.judge_model === judgeModel ? 1 : 0);
    const entry = byKey.get(key) ?? { key, scoring: Number(r.stamps?.scoring_version ?? 0), preferred, count: 0 };
    entry.count++;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.scoring - a.scoring || b.preferred - a.preferred || b.count - a.count)[0]?.key ?? null;
}
/** Próby wyłączone z oceny (awaria infrastruktury / kill zasobowy) — z attempts/. */
function excludedAttempts(cellDir) {
  let excluded = 0;
  for (const trialDir of dirs(cellDir)) {
    if (!/^trial-\d+$/.test(trialDir)) continue;
    const f = join(cellDir, trialDir, "attempt.json");
    if (!existsSync(f)) continue;
    try {
      if (JSON.parse(readFileSync(f, "utf8")).infra_failure === true) excluded++;
    } catch {
      // nieczytelny attempt.json nie zmienia rachunku
    }
  }
  return excluded;
}
/**
 * Świeżość z RUNNERA (`bench status --json`) — jedno źródło prawdy o tym,
 * co jest bieżącą erą: SCORING_VERSION, hash katalogu zadania, sędzia,
 * wersje rubryk, judge.mode i próg z bieżącej instancji (lib/matrix.ts).
 * Heurystyka po stemplach (currentEra) zostaje tylko jako zapas, gdy
 * runner nie jest zainstalowany — i wtedy mówi o tym caveat.
 */
const sanitize = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
function runnerFreshness() {
  const entry = join(root, ".bench-kit", "runner", "src", "index.ts");
  if (!existsSync(entry)) return null;
  const run = spawnSync(process.execPath, ["--experimental-strip-types", entry, "status", "--json", "--root", root], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (run.status !== 0) return null;
  try {
    const status = JSON.parse(run.stdout);
    const fresh = new Set();
    const stale = new Map();
    for (const cell of status.cells ?? []) {
      for (const t of cell.trials ?? []) {
        const key = `${cell.task}\0${sanitize(cell.model)}\0trial-${t.trial}`;
        if (t.evaluated === "fresh") fresh.add(key);
        else if (t.evaluated === "old") stale.set(key, t.stale_reasons ?? []);
      }
    }
    return { fresh, stale };
  } catch {
    return null;
  }
}
const freshness = runnerFreshness();
const taskRates = new Map();
const resultsRoot = join(root, "results");
const attemptsRoot = join(root, "attempts");
const tasks = [];
const eras = new Set();

for (const task of dirs(resultsRoot)) {
  if (onlyTask && task !== onlyTask) continue;
  const models = [];

  // Najpierw wszystkie wyniki zadania — bieżąca era wybierana nad całością,
  // żeby żaden model nie liczył się w innej erze niż reszta.
  const all = [];
  for (const modelDir of dirs(join(resultsRoot, task))) {
    for (const trialDir of dirs(join(resultsRoot, task, modelDir))) {
      const f = join(resultsRoot, task, modelDir, trialDir, "result.json");
      if (existsSync(f)) all.push({ modelDir, trialDir, r: JSON.parse(readFileSync(f, "utf8")) });
    }
  }
  const isCurrent = freshness
    ? (x) => freshness.fresh.has(`${task}\0${x.modelDir}\0${x.trialDir}`)
    : ((era) => (x) => eraKeyOf(x.r.stamps) === era)(currentEra(all.map((x) => x.r)));
  const rawStamps = all.find(isCurrent)?.r.stamps ?? null;
  if (rawStamps) eras.add([rawStamps.task_hash?.slice(0, 12), rawStamps.judge_model, rawStamps.rubric_version, rawStamps.judge_mode ?? "?"].join(" / "));

  for (const modelDir of [...new Set(all.map((x) => x.modelDir))]) {
    const trials = [];
    let modelId = modelDir;
    let otherEra = 0;
    const staleReasons = new Set();
    for (const x of all.filter((x) => x.modelDir === modelDir)) {
      const { trialDir, r } = x;
      if (r.model) modelId = r.model;
      if (!isCurrent(x)) {
        otherEra++;
        for (const reason of freshness?.stale.get(`${task}\0${modelDir}\0${trialDir}`) ?? []) staleReasons.add(reason);
        continue;
      }
      trials.push({
        trial: r.trial,
        total: r.total,
        // Bramka z runnera (guardy zielone + judge ≥ próg); wyniki sprzed
        // bramki — legacy próg sumy.
        passed: r.passed ?? r.total >= threshold,
        cost_usd: r.cost_usd ?? 0,
        cost_known: r.cost_source !== null,
        duration_s: r.duration_s ?? null,
        scores: r.scores ?? {},
        review: reviewBurden(join(attemptsRoot, task, modelDir, trialDir)),
      });
    }
    const excluded = excludedAttempts(join(attemptsRoot, task, modelDir));
    if (!trials.length) {
      // Model bez bieżących wyników nie znika: jest NIEZMIERZONY, z powodem.
      models.push({
        model_id: modelId,
        model_dir: modelDir,
        status: "unmeasured",
        trials: 0,
        passes: 0,
        other_era_trials: otherEra,
        stale_reasons: [...staleReasons],
        excluded,
      });
      continue;
    }

    const n = trials.length;
    const passes = trials.filter((t) => t.passed).length;
    const rate = passes / n;
    const costUnknown = trials.filter((t) => !t.cost_known).length;
    const spend = trials.reduce((s, t) => s + t.cost_usd, 0);
    const meanCost = spend / n;
    const reviews = trials.map((t) => t.review).filter(Boolean);
    // Stałe k = 3 w całej kolumnie (porównywalność między modelami);
    // przy n < 3 pass^3 nie istnieje.
    const k = 3;

    if (!taskRates.has(task)) taskRates.set(task, new Map());
    taskRates.get(task).set(modelId, { passes, trials: n, outcomes: trials.map((t) => t.passed) });

    models.push({
      model_id: modelId,
      model_dir: modelDir,
      trials: n,
      passes,
      pass_rate: rate,
      interval: wilson(passes, n),
      // pass^k: szansa, że k prób Z RZĘDU zaliczy — "czy da się to puścić
      // bez nadzoru", ostrzejsze niż pass rate.
      pass_hat_k: { k, value: passHatK(n, passes, k) },
      // Wykluczone (infra/kill) nie wchodzą do n — ale są widoczne: model,
      // który częściej wywraca środowisko, nie może na tym zyskać.
      excluded,
      exclusion_rate: excluded / (n + excluded),
      other_era_trials: otherEra,
      stale_reasons: [...staleReasons],
      spend_usd: spend,
      cost_unknown_trials: costUnknown,
      mean_cost_usd: meanCost,
      // TA liczba jest decyzją: ile kosztuje JEDEN akceptowalny wynik, z ponowieniami.
      // Nieznany koszt którejkolwiek próby = nieznany wynik, nie zaniżony.
      expected_cost_per_pass: passes > 0 && costUnknown === 0 ? meanCost / rate : null,
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
  // Modele, które mają tylko próby wykluczone (awarie) — bez żadnego wyniku.
  for (const modelDir of dirs(join(attemptsRoot, task))) {
    if (models.some((m) => m.model_dir === modelDir)) continue;
    const excluded = excludedAttempts(join(attemptsRoot, task, modelDir));
    if (excluded > 0) {
      models.push({ model_id: modelDir, model_dir: modelDir, status: "unmeasured", trials: 0, passes: 0, other_era_trials: 0, stale_reasons: [], excluded });
    }
  }
  if (!models.length) continue;
  const measured = models.filter((m) => m.trials > 0);

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
  const candidates = measured.filter((m) => m.passes > 0);
  // Nieznany koszt nie wygrywa remisu ceną (null → nieskończoność, nie 0).
  const price = (m) => m.expected_cost_per_pass ?? Infinity;
  const ranked = [...candidates].sort((a, b) =>
    Math.abs(a.interval.lo - b.interval.lo) > RELIABILITY_TIE ? b.interval.lo - a.interval.lo : price(a) - price(b),
  );
  const pick = ranked[0] ?? null;

  // Remis: przedziały pass-rate nachodzą na siebie → tej różnicy próba NIE
  // rozstrzyga. Nie wolno jej podawać jako ustalonej kolejności ani zamieniać
  // na "więc bierz tańszy" — uczciwą reakcją jest domierzenie.
  // Po wszystkich zmierzonych, także bez zaliczeń: 0/3 z przedziałem
  // 0–0.56 nachodzi na 3/3 (0.44–1) tak samo jak 1/3 — pominięcie go
  // sugerowałoby, że próba już go odróżniła. Najtańszym w remisie nie
  // zostanie (brak kosztu na zaliczenie).
  const tied = pick
    ? measured.filter(
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
    if (pick.cost_unknown_trials > 0) {
      caveats.push(`${pick.model_id}: koszt nieznany w ${pick.cost_unknown_trials} próbach — brak ceny modelu; koszt na wynik nie jest policzalny`);
    }
    const thin = candidates.filter((m) => m.trials < 3 && m !== pick);
    if (thin.length) {
      caveats.push(
        `porównanie asymetryczne: ${thin.map((m) => `${m.model_id} (n=${m.trials})`).join(", ")} zmierzone słabiej niż ${pick.model_id} (n=${pick.trials})`,
      );
    }
  }

  if (!freshness) {
    caveats.push("bieżąca era wybrana heurystycznie po stemplach — runner niedostępny (npm ci --prefix .bench-kit/runner), świeżość niepotwierdzona");
  }
  for (const m of models.filter((x) => x.trials === 0)) {
    const why = [
      m.other_era_trials ? `${m.other_era_trials} wynik(ów) z innej ery${m.stale_reasons.length ? ` (${m.stale_reasons.join("; ")})` : ""}` : "",
      m.excluded ? `${m.excluded} prób wykluczonych (awarie/kill)` : "",
    ]
      .filter(Boolean)
      .join(", ");
    caveats.push(`${m.model_id}: NIEZMIERZONY w bieżącej erze — ${why || "brak wyników"}`);
  }
  for (const m of measured) {
    if (m.exclusion_rate > 0.2 && m.excluded >= 2) {
      caveats.push(`${m.model_id}: ${m.excluded} prób wykluczonych (awarie/kill — ${Math.round(m.exclusion_rate * 100)}%) — pass rate liczony bez nich może być zawyżony`);
    }
    if (m.other_era_trials > 0) {
      caveats.push(
        `${m.model_id}: ${m.other_era_trials} wynik(ów) z innej ery pominięte${m.stale_reasons.length ? ` (${m.stale_reasons.join("; ")})` : ""} — re-ocena zachowanych prób włączy je do bieżącej`,
      );
    }
  }

  // Prezentacja jest jedna: wspólny szablon leaderboardu
  // (.bench-kit/runner/assets/leaderboard/). Tutaj tylko przekładamy wyniki na
  // jego kształt wiersza, żeby obie drogi pokazywały te same liczby i ten sam
  // wniosek — dwa osobne szablony rozjeżdżały się na tych samych danych.
  const siteRows = measured.map((m) => ({
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
    pass_hat_k: m.pass_hat_k.value,
  }));

  tasks.push({
    task,
    site_rows: siteRows,
    site_stamps: rawStamps,
    pass_threshold: threshold,
    // kolejność prezentacji = kolejność rankingu (niezawodność, potem cena),
    // nie mediana: mediana mówi jak dobra była udana próba, nie jak często
    // Zmierzone w kolejności rankingu, niezmierzone na końcu (z powodem w caveats).
    models: [
      ...[...measured].sort((a, b) =>
        Math.abs(a.interval.lo - b.interval.lo) > RELIABILITY_TIE ? b.interval.lo - a.interval.lo : price(a) - price(b),
      ),
      ...models.filter((m) => m.trials === 0),
    ],
    recommendation: pick
      ? {
          model_id: pick.model_id,
          expected_cost_per_pass: pick.expected_cost_per_pass,
          basis: `${pick.passes}/${pick.trials}`,
          reliability_lo: pick.interval.lo,
          caveats,
          tied_with: tied.map((m) => m.model_id),
          // Remis = nierozstrzygnięte (SKILL.md reguła 3): model_id to tylko
          // lider po dolnej granicy, nie werdykt, a cena nie rozstrzyga
          // różnicy, której próba nie widzi — uczciwy krok to domierzenie.
          resolved: tied.length === 0,
          cheapest_in_tie: tied.length
            ? ([pick, ...tied]
                .filter((m) => m.expected_cost_per_pass !== null)
                .sort((a, b) => a.expected_cost_per_pass - b.expected_cost_per_pass)[0]?.model_id ?? null)
            : null,
          tie_note: tied.length
            ? `Nierozstrzygnięte: przedziały pass-rate ${[pick, ...tied].map((m) => m.model_id).join(", ")} nachodzą się — ` +
              "próba nie odróżnia ich niezawodności. Nie wybieraj po cenie ani po medianie; rozstrzygają więcej zadań tej klasy lub więcej prób."
            : null,
        }
      : null,
    spend_usd: measured.reduce((s, m) => s + m.spend_usd, 0),
  });
}

// --- ponad zadaniami: klasy, porównania parowe, rozdzielczość, horyzont ---
const backlogPath = join(root, "tasks", "backlog.md");
const backlogMeta = existsSync(backlogPath) ? parseBacklogMeta(readFileSync(backlogPath, "utf8")) : new Map();
const classOf = new Map([...taskRates.keys()].map((t) => [t, backlogMeta.get(t)?.class ?? null]).filter(([, c]) => c));
const classes = classView(taskRates, classOf);
// Kotwice (zadania z publicznych repo, MINING.md) sprawdzają ustawienie
// względem publikowanych liczb — nie wchodzą do statystyki decyzji.
const anchorTasks = new Set([...taskRates.keys()].filter((t) => classOf.get(t) === "anchor"));
const decisionRates = new Map([...taskRates].filter(([t]) => !anchorTasks.has(t)));
const anchorRates = new Map([...taskRates].filter(([t]) => anchorTasks.has(t)));
const paired = {
  all: pairedComparisons(decisionRates),
  by_class: Object.fromEntries(
    classes
      .filter((c) => c.tasks >= 2)
      .filter((c) => c.class !== "anchor")
      .map((c) => [c.class, pairedComparisons(decisionRates, new Set([...decisionRates.keys()].filter((t) => (classOf.get(t) ?? "(bez klasy)") === c.class)))]),
  ),
};
const horizonModels = [...new Set([...decisionRates.values()].flatMap((m) => [...m.keys()]))];
const horizons = Object.fromEntries(
  horizonModels.map((model) => {
    const obs = [];
    const tasksUsed = new Set();
    for (const [task, m] of decisionRates) {
      const minutes = backlogMeta.get(task)?.human_minutes;
      const cell = m.get(model);
      if (!minutes || !cell) continue;
      tasksUsed.add(task);
      for (const passed of cell.outcomes) obs.push({ task, minutes, passed });
    }
    const estimated = [...tasksUsed].filter((t) => backlogMeta.get(t)?.human_estimated).length;
    // Horyzont jest tak dobry jak minuty pod nim — udział szacunków jedzie z liczbą.
    return [model, { ...timeHorizon(obs), estimated_share: tasksUsed.size ? estimated / tasksUsed.size : null }];
  }),
);

const out = {
  generated_at: new Date().toISOString(),
  root,
  pass_threshold: threshold,
  eras: [...eras],
  tasks,
  classes,
  paired,
  horizons,
  anchors: {
    tasks: [...anchorTasks],
    paired: pairedComparisons(anchorRates),
    note: "kotwice z publicznych repo — kontrola ustawienia, nie decyzja routingu",
  },
  // Rozdzielczość: jaką różnicę między modelami ten zbiór zadań w ogóle
  // potrafi rozstrzygnąć — i ile zadań trzeba na mniejszą.
  power: {
    tasks_measured: decisionRates.size,
    resolvable_gap_pp: resolvableGap(decisionRates.size),
    tasks_needed: { "20pp": tasksNeeded(0.2), "30pp": tasksNeeded(0.3), "50pp": tasksNeeded(0.5) },
    assumption: "porównanie parowe na wspólnych zadaniach, α=0.05, moc 0.8, rozbieżność modeli ψ=δ+0.1",
  },
  total_spend_usd: tasks.reduce((s, t) => s + t.spend_usd, 0),
};

const json = JSON.stringify(out, null, 2);
if (outPath) {
  writeFileSync(outPath, json + "\n");
  console.error(`bench-analysis: ${tasks.length} zadań, ${[...eras].length} er(y) → ${outPath}`);
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
  const title = headTitle ?? (onlyTask ? `bench-analysis — ${onlyTask}` : "bench-analysis — który model do tej pracy");
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
  console.error(`bench-analysis: → ${htmlPath}`);
}
