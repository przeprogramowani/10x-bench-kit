const SLOTS = ["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8"];
const fmt = {
  score: v => v.toFixed(2),
  cost: v => "$" + (v >= 0.1 ? v.toFixed(2) : v.toFixed(4)),
  time: v => v >= 90 ? Math.round(v / 60) + " min " + Math.round(v % 60) + " s" : v.toFixed(1).replace(".", ",") + " s",
  date: iso => new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" }),
};
const short = m => m.split("/").pop();
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// stały przydział koloru per model (identyczność, nie ranking) — globalnie,
// po posortowanych nazwach; powyżej 8 modeli kolor szary + etykieta tekstowa
const models = [...new Set(DATA.tasks.flatMap(t => t.eras.flatMap(e => e.runs.flatMap(r => r.rows.map(x => x.model)))))].sort();
const colorOf = m => { const i = models.indexOf(m); return i < SLOTS.length ? "var(" + SLOTS[i] + ")" : "var(--ink-muted)"; };

// najświeższy wynik per model w obrębie ery — rytuał "dispatch tylko z nowym
// modelem" nie może chować modeli, których nie było w ostatnim runie; wiersz
// spoza najnowszego runu dostaje stempel runu, z którego pochodzi
function latestRowsPerModel(era) {
  const newestRun = era.runs[era.runs.length - 1];
  const byModel = new Map();
  for (const run of era.runs) {
    for (const r of run.rows) byModel.set(r.model, { ...r, run_id: run.run_id, run_at: run.generated_at });
  }
  return [...byModel.values()].map(r => ({ ...r, stale: r.run_id !== newestRun.run_id }));
}

// NIEZAWODNOŚĆ JEST PUNKTEM WYJŚCIA. Ranking idzie po dolnej granicy
// przedziału Wilsona (95%) dla pass rate, a nie po medianie wyniku ani po
// punktowym pass rate. Dwa powody:
//  1. mediana mówi "jak dobry jest udany wynik", nie "jak często jest udany";
//     model, który raz trafia perfekcyjnie, a trzy razy pudłuje, ma świetną
//     najlepszą próbę i nie nadaje się do routowania pracy;
//  2. punktowy pass rate kłamie na małej próbie — 2/2 to nie jest "100%
//     niezawodny", to "dwie próby". Dolna granica sama karze za brak prób,
//     więc "domierz" i "jest gorszy" mają ten sam kierunek w rankingu.
// Koszt wchodzi DOPIERO przy praktycznie równej niezawodności. Cena nigdy nie
// kupuje pozycji nad modelem, który po prostu działa częściej.
function wilson(passed, trials) {
  if (!trials) return { p: 0, lo: 0, hi: 1 };
  const z = 1.959963985, p = passed / trials, n = trials;
  const d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z / d) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// próg, poniżej którego różnica dolnych granic jest szumem, nie rankingiem
const RELIABILITY_TIE = 0.02;
// poniżej tylu prób nie orzekamy o niezawodności — wiersz dostaje jawny znacznik
const MIN_TRIALS = 3;

function rankRows(rows) {
  const out = rows.map(r => ({ ...r, w: wilson(r.passed, r.trials) }));
  out.sort((a, b) => Math.abs(a.w.lo - b.w.lo) > RELIABILITY_TIE
    ? b.w.lo - a.w.lo
    : a.median_cost_usd - b.median_cost_usd);
  // pasmo = grupa sąsiadów o nachodzących się przedziałach: różnicy między
  // nimi ta próba NIE rozstrzyga, więc wybór wewnątrz pasma jest cenowy
  let band = 0;
  out.forEach((r, i) => {
    const prev = out[i - 1];
    if (prev && !(r.w.lo <= prev.w.hi && prev.w.lo <= r.w.hi)) band++;
    r.band = band;
  });
  return out;
}

// Jednostki są głównym źródłem nieporozumień na tym dashboardzie: tabela
// zbiorcza liczy ZADANIA, tabela zadania liczy PRÓBY, a oba mogą pokazać
// "1/1". Dlatego każda taka komórka pisze jednostkę słowem.
const ofUnit = (k, n, unit) => k + " z " + n + " " + unit;

// Koszt jednego UŻYTECZNEGO wyniku = koszt prób ÷ liczba udanych. Gdy wejście
// policzyło go dokładnie (suma faktycznych kosztów prób — tak robi
// bench-summary), bierzemy tę liczbę; leaderboard ma w raporcie tylko medianę
// kosztu, więc tam jest to przybliżenie. Przy zerowym pass rate liczba nie
// istnieje i musi zostać pokazana jako "brak" — to też informacja.
const costPerPass = r => (r.passed > 0
  ? (r.cost_per_pass ?? r.median_cost_usd * r.trials / r.passed)
  : null);

const TIPS = {
  reliability: "Jak często model kończy zadanie na zaliczeniu. Liczba to udane próby ÷ wszystkie próby. Pasek pokazuje 95% przedział ufności: im mniej prób, tym szerszy. Ranking idzie po LEWYM końcu paska, nie po samej liczbie — dwie próby na dwie udane to jeszcze nie dowód niezawodności.",
  conservative: "Ostrożna ocena niezawodności: lewy koniec 95% przedziału. Mówi „co najmniej tyle”, więc mała liczba prób sama ją obniża. Dzięki temu „domierz więcej prób” i „model jest gorszy” działają w tym samym kierunku.",
  trialsPassed: "Ile POJEDYNCZYCH PRÓB tego modelu na tym zadaniu przeszło próg zaliczenia.",
  tasksPassed: "Ile ZADAŃ (nie prób) model zalicza — zadanie liczy się jako zdane, gdy mediana jego prób sięga progu.",
  costTrial: "Średni koszt jednej próby: tokeny modelu za jedno podejście, niezależnie od tego, czy się udało.",
  costPass: "Koszt jednego UŻYTECZNEGO wyniku: koszt próby ÷ pass rate, czyli z doliczonymi nieudanymi podejściami. Uwaga — zakłada, że odrzucenie złej próby nic nie kosztuje. Jeśli porażki przechodzą lint i testy, koszt ich wyłapania ponosi człowiek, a ta liczba jest zaniżona.",
  score: "Mediana oceny ze wszystkich prób (0–1). Mówi, jak dobra jest typowa praca, NIE jak często się udaje — dlatego nie rankujemy po tej kolumnie.",
  duration: "Średni czas jednej próby: od startu kontenera do końca pracy agenta.",
  coverage: "Na ilu zadaniach benchmarku ten model ma w ogóle wynik. Niskie pokrycie znaczy, że średniej nie ma z czego liczyć.",
  spend: "Suma kosztów prób tego modelu na wszystkich zadaniach bieżących er.",
};
const tipAttr = t => 'data-tip="' + esc(t) + '"';

function reliabilityCell(r) {
  const thin = r.trials < MIN_TRIALS;
  return '<div class="relcell">' +
    '<span class="n' + (!thin && r.w.lo >= 0.5 ? " pass" : "") + '">' + fmt.score(r.w.p) + '</span>' +
    '<div class="relbar" data-tip="' + esc(tipText(short(r.model),
      "udane " + r.passed + " z " + r.trials + " prób",
      "95% przedział: " + fmt.score(r.w.lo) + "–" + fmt.score(r.w.hi),
      "ranking po lewym końcu: " + fmt.score(r.w.lo))) + '">' +
      '<div class="band" style="left:' + (r.w.lo * 100) + '%;right:' + ((1 - r.w.hi) * 100) + '%"></div>' +
      '<div class="pt" style="left:calc(' + (r.w.p * 100) + '% - 1px)"></div></div>' +
    '<span class="thin">' + fmt.score(r.w.lo) + "–" + fmt.score(r.w.hi) + '</span></div>';
}

// Wniosek liczony TU, z wierszy — zeby leaderboard i bench-summary nie mogly
// pokazac dwoch roznych rekomendacji z tych samych danych.
function verdictHtml(rows, taskName) {
  const ranked = rankRows(rows);
  const cands = ranked.filter(r => r.passed > 0);
  const pick = cands[0];
  if (!pick) {
    return '<div class="verdict none"><div class="vlabel">Wniosek — ' + esc(taskName) + '</div>' +
      '<div class="vpick">Żaden model nie przechodzi</div>' +
      '<div class="vwhy">Ani jedna próba nie sięgnęła progu. To nie ranking do odczytania — to wynik pusty.</div></div>';
  }
  const tied = cands.filter(r => r !== pick && r.w.lo <= pick.w.hi && r.w.hi >= pick.w.lo);
  const caveats = [];
  if (pick.trials < MIN_TRIALS) {
    caveats.push("Sam " + short(pick.model) + " ma tylko " + pick.trials + " prób(y) — poniżej " +
      MIN_TRIALS + " nie ma z czego orzekać o niezawodności. Dolej prób, zanim uznasz to za decyzję.");
  }
  if (pick.w.p < 0.5) {
    caveats.push(short(pick.model) + " zawodzi w " + (pick.trials - pick.passed) + " z " + pick.trials +
      " prób. Koszt dobrego wyniku zakłada, że odrzucenie złej próby jest darmowe — jeśli porażki " +
      "przechodzą lint i testy, ten koszt ponosi człowiek.");
  }
  const thin = cands.filter(r => r !== pick && r.trials < MIN_TRIALS);
  if (thin.length) {
    caveats.push("Porównanie asymetryczne: " + thin.map(r => short(r.model) + " (n=" + r.trials + ")").join(", ") +
      " zmierzony(e) słabiej niż " + short(pick.model) + " (n=" + pick.trials + ").");
  }
  const cpp = costPerPass(pick);
  return '<div class="verdict' + (caveats.length ? " weak" : "") + '">' +
    '<div class="vlabel">Wniosek — ' + esc(taskName) + '</div>' +
    '<div class="vpick">' + esc(short(pick.model)) + '</div>' +
    '<div class="vprice">udane ' + pick.passed + ' z ' + pick.trials + ' prób · ostrożna ocena ' +
      fmt.score(pick.w.lo) + ' · ' + (cpp === null ? "brak" : fmt.cost(cpp)) + ' za jeden dobry wynik</div>' +
    (tied.length ? '<div class="vwhy">Tej próby nie wystarcza, żeby odróżnić go od: ' +
      tied.map(r => esc(short(r.model))).join(", ") + '.</div>' : "") +
    (caveats.length ? '<ul class="vcav">' + caveats.map(c => "<li>" + esc(c) + "</li>").join("") + "</ul>" : "") +
    '</div>';
}

function tableHtml(rows, threshold) {
  const sorted = rankRows(rows);
  const bands = new Set(sorted.map(r => r.band));
  return '<table><thead><tr>' +
    '<th>Model</th>' +
    '<th ' + tipAttr(TIPS.reliability) + '>Jak często się udaje <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.trialsPassed) + '>Udane próby <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.costTrial) + '>Koszt próby <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.costPass) + '>Koszt dobrego wyniku <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.score) + '>Ocena (mediana) <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.duration) + '>Czas próby <span class="q">?</span></th>' +
    '</tr></thead><tbody>' +
    sorted.map((r, i) => {
      const passed = r.median_total >= threshold;
      const opensBand = bands.size > 1 && (i === 0 || r.band !== sorted[i - 1].band);
      const bandMates = sorted.filter(x => x.band === r.band).length;
      // Pasmo NIE znaczy "bierz tanszy" — znaczy, ze tej roznicy ta proba nie
      // rozstrzyga. Uczciwa reakcja to domierzenie, nie siegniecie po cene.
      const head = opensBand && bandMates > 1
        ? '<tr class="bandhead"><td colspan="7">↕ tych modeli ta próba nie rozróżnia — przedziały się nachodzą, więc kolejność między nimi jest niepewna</td></tr>'
        : "";
      const cpp = costPerPass(r);
      return head + '<tr>' +
        '<td class="model"><span class="swatch" style="background:' + colorOf(r.model) + '"></span>' +
          esc(short(r.model)) + '<span class="full">' + esc(r.model) +
          (r.stale ? " · run " + esc(r.run_id) + " (" + fmt.date(r.run_at) + ")" : "") + '</span></td>' +
        '<td>' + reliabilityCell(r) + '</td>' +
        '<td class="num">' + ofUnit(r.passed, r.trials, "prób") +
          (r.trials < MIN_TRIALS ? '<span class="warn" data-tip="' + esc("Mniej niż " + MIN_TRIALS + " próby: za mało, żeby cokolwiek orzekać o niezawodności. Dolej prób przez bench attempt --trials.") + '">za mało prób</span>' : "") + '</td>' +
        '<td class="num">' + fmt.cost(r.median_cost_usd) + '</td>' +
        '<td class="num' + (cpp === null ? " muted" : "") + '"><b>' + (cpp === null ? "brak" : fmt.cost(cpp)) + '</b></td>' +
        '<td class="num' + (passed ? " pass" : "") + '">' + fmt.score(r.median_total) + '</td>' +
        '<td class="num">' + fmt.time(r.median_duration_s) + '</td></tr>';
    }).join("") + "</tbody></table>" +
    '<p class="note">Wiersze są ułożone od najbardziej do najmniej niezawodnego — po lewym końcu przedziału, nie po ocenie. ' +
    'Koszt decyduje tylko między modelami o praktycznie tej samej niezawodności (różnica < ' + RELIABILITY_TIE.toFixed(2) + '). ' +
    'Najedź na nagłówek kolumny, żeby zobaczyć, co dokładnie liczy.</p>';
}

// przybliżona szerokość etykiety w jednostkach viewBoxu (font 11px/600)
const labelW = text => text.length * 6.6;

// rozmieszczanie etykiet punktów bez kolizji: dla każdego punktu próbujemy
// kolejnych pozycji nad/pod (coraz dalej), aż bounding box nie zahacza o już
// położone etykiety ani o krawędź viewBoxu; etykieta odsunięta od punktu
// dostaje cienki łącznik, żeby przypisanie pozostało czytelne
function placePointLabels(items, W, H, m) {
  const placed = [];
  const out = [];
  for (const it of [...items].sort((a, b) => a.px - b.px)) {
    const w = labelW(it.text), h = 13;
    const anchor = it.px > W - m.r - w / 2 ? "end" : it.px < m.l + w / 2 ? "start" : "middle";
    const bx = anchor === "end" ? it.px - w : anchor === "start" ? it.px : it.px - w / 2;
    let pick = null;
    for (const dy of [-10, 15, -23, 28, -36, 41, -49, 54, -62, 67, -75, 80, -88, 93]) {
      const ly = it.py + dy;
      if (ly - h + 3 < 2 || ly > H - m.b - 2) continue;
      const box = { x: bx - 2, y: ly - h + 3, w: w + 4, h };
      if (!placed.some(p => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h)) {
        pick = { ly, box, dy };
        break;
      }
    }
    if (!pick) {
      const ly = Math.min(Math.max(it.py - 10, h), H - m.b - 2);
      pick = { ly, box: { x: bx - 2, y: ly - h + 3, w: w + 4, h }, dy: ly - it.py };
    }
    placed.push(pick.box);
    out.push({ ...it, anchor, ly: pick.ly, leader: Math.abs(pick.dy) > 23 });
  }
  return out;
}

// rozsuwanie pionowe nakładających się etykiet (końcówki linii trendu):
// sort po y, przepych w dół z minimalnym odstępem, potem korekta od dołu,
// żeby całość zmieściła się w [lo, hi]
function spreadY(ys, minGap, lo, hi) {
  const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < idx.length; k++) idx[k].y = Math.max(idx[k].y, idx[k - 1].y + minGap);
  if (idx.length && idx[idx.length - 1].y > hi) idx[idx.length - 1].y = hi;
  for (let k = idx.length - 2; k >= 0; k--) idx[k].y = Math.min(idx[k].y, idx[k + 1].y - minGap);
  for (const p of idx) p.y = Math.max(p.y, lo);
  for (let k = 1; k < idx.length; k++) idx[k].y = Math.max(idx[k].y, idx[k - 1].y + minGap);
  const res = new Array(ys.length);
  for (const p of idx) res[p.i] = p.y;
  return res;
}

// deklaratywny zapis SVG: el(tag, atrybuty, ...dzieci) → string; dzieci mogą
// być dowolnie zagnieżdżonymi tablicami (spłaszczane), falsy pomijane —
// wykres składa się jak drzewo, bez ręcznego doklejania stringów
const el = (tag, attrs = {}, ...children) => {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => " " + k + '="' + v + '"').join("");
  const kids = children.flat(Infinity).filter(Boolean).join("");
  return kids ? "<" + tag + a + ">" + kids + "</" + tag + ">" : "<" + tag + a + "/>";
};

const chart = (W, H, label, ...children) =>
  el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": label }, children);

const hGridLine = (v, text, W, m, y) => [
  el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--grid)", "stroke-width": 1 }),
  el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, text),
];

const thresholdLine = (threshold, W, m, y) =>
  el("line", { x1: m.l, x2: W - m.r, y1: y(threshold), y2: y(threshold),
    stroke: "var(--axis)", "stroke-width": 1, "stroke-dasharray": "4 3" });

// tooltip: pierwszy element pogrubioną nazwą, reszta rozdzielona kropką
const tipText = (name, ...parts) => "<b>" + esc(name) + "</b>" + parts.join(" · ");

// niezawodność vs koszt: log-x (koszty rozpięte o rzędy wielkości), punkt per
// model, identyczność niesiona kolorem ORAZ bezpośrednią etykietą (reguła
// relief). Oś Y to pass rate z wąsem przedziału Wilsona, NIE mediana wyniku:
// wykres ma odpowiadać na "jak często to działa i ile to kosztuje".
function scatterSvg(rows) {
  const W = 420, H = 240, m = { t: 18, r: 28, b: 34, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const costs = rows.map(r => Math.max(r.median_cost_usd, 1e-5));
  let lo = Math.floor(Math.log10(Math.min(...costs))), hi = Math.ceil(Math.log10(Math.max(...costs)));
  if (hi <= lo) hi = lo + 1;
  const x = c => m.l + (Math.log10(Math.max(c, 1e-5)) - lo) / (hi - lo) * iw;
  const y = v => m.t + (1 - v) * ih;
  const decades = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  const withW = rows.map(r => ({ ...r, w: wilson(r.passed, r.trials) }));
  const points = placePointLabels(withW.map(r => ({
    r, px: x(r.median_cost_usd), py: y(r.w.p), text: short(r.model),
  })), W, H, m);
  return chart(W, H, "Niezawodność względem kosztu próby",
    [0, 0.25, 0.5, 0.75, 1].map(v => hGridLine(v, v.toFixed(2), W, m, y)),
    decades.map(e => [
      el("text", { x: x(Math.pow(10, e)), y: H - m.b + 16,
        "text-anchor": e === hi ? "end" : e === lo ? "start" : "middle" }, fmt.cost(Math.pow(10, e))),
      el("line", { x1: x(Math.pow(10, e)), x2: x(Math.pow(10, e)), y1: H - m.b, y2: H - m.b + 4, stroke: "var(--axis)" }),
    ]),
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: "var(--axis)" }),
    el("text", { x: m.l + iw / 2, y: H - 4, "text-anchor": "middle" }, "koszt próby (log)"),
    points.map(({ r, px, py, text, anchor, ly, leader }) => [
      leader && el("line", { x1: px, x2: px, y1: py + (ly > py ? 6 : -6), y2: ly > py ? ly - 10 : ly + 3,
        stroke: "var(--axis)", "stroke-width": 1 }),
      // wąs przedziału: punkt bez niepewności czytałby się jak pomiar, którym nie jest
      el("line", { x1: px, x2: px, y1: y(r.w.hi), y2: y(r.w.lo),
        stroke: colorOf(r.model), "stroke-width": 2, opacity: 0.45 }),
      el("circle", { cx: px, cy: py, r: 5, fill: colorOf(r.model), stroke: "var(--surface-1)", "stroke-width": 2,
        "data-tip": tipText(short(r.model), "pass rate " + fmt.score(r.w.p) + " (" + r.passed + "/" + r.trials + ")",
          "95%: " + fmt.score(r.w.lo) + "–" + fmt.score(r.w.hi),
          fmt.cost(r.median_cost_usd), "mediana " + fmt.score(r.median_total)) }),
      el("text", { class: "dl", x: px, y: ly, "text-anchor": anchor }, esc(text)),
    ]),
  );
}

// trend median po runach w obrębie ery — tylko gdy jest co porównywać (>= 2 runy)
function trendSvg(runs, threshold) {
  const W = 420, H = 240, m = { t: 14, r: 126, b: 34, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = i => m.l + (runs.length === 1 ? iw / 2 : i / (runs.length - 1) * iw);
  const y = v => m.t + (1 - v) * ih;
  const byModel = new Map();
  runs.forEach((run, i) => run.rows.forEach(r => {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push({ i, run, r });
  }));
  const series = [...byModel].map(([model, pts]) => {
    const last = pts[pts.length - 1];
    return { model, color: colorOf(model), pts, lx: x(last.i), ly: y(last.r.median_total) };
  });
  // etykiety końcówek rozsuwane pionowo per kolumna zakończenia serii —
  // przy zbliżonych medianach lądowałyby jedna na drugiej
  const byEnd = new Map();
  series.forEach(sr => {
    const key = Math.round(sr.lx);
    byEnd.set(key, [...(byEnd.get(key) ?? []), sr]);
  });
  for (const group of byEnd.values()) {
    const ys = spreadY(group.map(sr => sr.ly + 4), 13, m.t + 8, H - m.b - 2);
    group.forEach((sr, k) => { sr.ty = ys[k]; });
  }
  const endLabel = sr => {
    const name = short(sr.model);
    const maxW = W - (sr.lx + 8) - 2;
    const label = labelW(name) <= maxW ? name : name.slice(0, Math.max(3, Math.floor(maxW / 6.6) - 1)) + "…";
    return [
      Math.abs(sr.ty - (sr.ly + 4)) > 7 && el("line", { x1: sr.lx + 5, x2: sr.lx + 7, y1: sr.ly, y2: sr.ty - 4,
        stroke: "var(--axis)", "stroke-width": 1 }),
      el("text", { class: "dl", x: sr.lx + 8, y: sr.ty, "data-tip": "<b>" + esc(name) + "</b>" }, esc(label)),
    ];
  };
  return chart(W, H, "Trend median między runami",
    [0, 0.5, 1].map(v => hGridLine(v, v.toFixed(1), W, m, y)),
    thresholdLine(threshold, W, m, y),
    runs.map((run, i) => el("text", { x: x(i), y: H - m.b + 16, "text-anchor": "middle" }, fmt.date(run.generated_at))),
    series.map(sr => [
      el("polyline", { fill: "none", stroke: sr.color, "stroke-width": 2,
        points: sr.pts.map(p => x(p.i) + "," + y(p.r.median_total)).join(" ") }),
      sr.pts.map(p => el("circle", { cx: x(p.i), cy: y(p.r.median_total), r: 4, fill: sr.color,
        stroke: "var(--surface-1)", "stroke-width": 2,
        "data-tip": tipText(short(sr.model), "run " + esc(p.run.run_id),
          "mediana " + fmt.score(p.r.median_total), fmt.cost(p.r.median_cost_usd)) })),
    ]),
    series.map(endLabel),
  );
}

// ranking przekrojowy: bieżąca era każdego zadania, najświeższy wynik per
// model (latestRowsPerModel), średnie nieważone po zadaniach — model bez
// wyniku w części zadań ma jawną kolumnę pokrycia zamiast cichej kary
function overallRows() {
  const perModel = new Map();
  for (const t of DATA.tasks) {
    const era = t.eras.find(e => e.current);
    if (!era) continue;
    for (const r of latestRowsPerModel(era)) {
      const acc = perModel.get(r.model) ?? { model: r.model, tasks: 0, sumTotal: 0, sumP1: 0, sumCost: 0, sumLo: 0, trials: 0, passed: 0 };
      acc.tasks++;
      acc.sumTotal += r.median_total;
      acc.sumP1 += r.pass_at_1;
      acc.sumCost += r.median_cost_usd;
      acc.sumLo += wilson(r.passed, r.trials).lo;
      acc.trials += r.trials;
      if (r.median_total >= DATA.pass_threshold) acc.passed++;
      perModel.set(r.model, acc);
    }
  }
  return [...perModel.values()]
    .map(a => ({ ...a, mean: a.sumTotal / a.tasks, meanP1: a.sumP1 / a.tasks, meanLo: a.sumLo / a.tasks }))
    // ta sama zasada co w tabeli zadania: niezawodność pierwsza, koszt przy remisie
    .sort((a, b) => Math.abs(a.meanLo - b.meanLo) > RELIABILITY_TIE
      ? b.meanLo - a.meanLo
      : a.sumCost - b.sumCost || b.tasks - a.tasks);
}

function overallHtml() {
  const rows = overallRows();
  if (!rows.length) return "";
  const total = DATA.tasks.length;
  return '<section class="task"><h2>Zbiorczo — średnia ze wszystkich zadań</h2>' +
    '<p class="era-meta"><b>Ta tabela liczy ZADANIA, nie próby.</b> Niżej, pod nazwą każdego zadania, ' +
    'znajdziesz tabelę pojedynczych prób — tam te same liczby znaczą coś innego. ' +
    'Kolejność po ostrożnej ocenie niezawodności; koszt dopiero przy remisie. ' +
    'Średnie nieważone po bieżących erach zadań, więc to orientacja, nie pomiar.</p>' +
    '<div class="card"><table><thead><tr>' +
    '<th>Model</th>' +
    '<th class="num" ' + tipAttr(TIPS.conservative) + '>Niezawodność — ostrożna ocena <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.tasksPassed) + '>Zdane zadania <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.spend) + '>Koszt prób razem <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.score) + '>Ocena (średnia median) <span class="q">?</span></th>' +
    '<th class="num" ' + tipAttr(TIPS.coverage) + '>Pokrycie benchmarku <span class="q">?</span></th>' +
    '</tr></thead><tbody>' +
    rows.map(r => '<tr>' +
      '<td class="model"><span class="swatch" style="background:' + colorOf(r.model) + '"></span>' +
        esc(short(r.model)) + '<span class="full">' + esc(r.model) + '</span></td>' +
      '<td class="num' + (r.meanLo >= 0.5 ? " pass" : "") + '"><b>' + fmt.score(r.meanLo) + '</b></td>' +
      '<td class="num">' + ofUnit(r.passed, r.tasks, "zadań") + '</td>' +
      '<td class="num">' + fmt.cost(r.sumCost) + '</td>' +
      '<td class="num">' + fmt.score(r.mean) + '</td>' +
      '<td class="num' + (r.tasks < total ? " muted" : "") + '">' + ofUnit(r.tasks, total, "zadań") + '</td></tr>').join("") +
    "</tbody></table></div></section>";
}

function eraMeta(stamps, runs) {
  // Era scoringowa może obejmować wiele wersji template'u (neutralne
  // release'y) — pokazujemy stempel, który faktycznie wyznacza erę.
  const version = stamps.scoring_version !== undefined
    ? "scoring v" + esc(stamps.scoring_version)
    : "template " + esc(stamps.template_version);
  // Nowy format stempla to "<rubryka>@<wersja>[+…]" (per rubryka),
  // legacy to goła wersja globalna — etykieta dopasowana do formatu.
  const rubric = stamps.rubric_version.includes("@")
    ? "rubryki " + esc(stamps.rubric_version)
    : stamps.rubric_version === "none"
      ? "bez rubryk"
      : "rubryka v" + esc(stamps.rubric_version);
  return version + " · " + rubric +
    " · sędzia " + esc(short(stamps.judge_model)) + " · zadanie <code>" + stamps.task_hash.slice(0, 8) + "</code>" +
    " · " + runs.length + " run(y): " + runs.map(r => esc(r.run_id)).join(", ");
}

function eraHtml(era, threshold, taskName) {
  const rows = latestRowsPerModel(era);
  let html = '<p class="era-meta">' + eraMeta(era.stamps, era.runs) + "</p>" +
    (taskName ? verdictHtml(rows, taskName) : "") +
    '<div class="card">' + tableHtml(rows, threshold) + "</div>" +
    '<div class="charts"><div class="card"><h3>Niezawodność vs koszt (najświeższy wynik per model)</h3>' + scatterSvg(rows) + "</div>";
  if (era.runs.length >= 2) {
    html += '<div class="card"><h3>Trend median między runami</h3>' + trendSvg(era.runs, threshold) +
      '<div class="legend">' + [...new Set(era.runs.flatMap(r => r.rows.map(x => x.model)))].sort()
        .map(mo => '<span style="--c:' + colorOf(mo) + '">' + esc(short(mo)) + "</span>").join("") + "</div></div>";
  }
  return html + "</div>";
}

// Panel "jak to czytac" jest domyslnie zwiniety, ale obecny: bez niego liczby
// na tej stronie daja sie przeczytac na trzy sposoby, z czego dwa sa bledne.
function howToRead() {
  return '<details class="howto"><summary>Jak czytać ten dashboard</summary><div class="howto-body">' +
    '<p><b>Dwa poziomy, dwie jednostki.</b> Sekcja <i>Zbiorczo</i> liczy <b>zadania</b> ' +
    '(„zdane 1 z 1 zadań"). Sekcje niżej, nazwane jak zadanie, liczą <b>próby</b> ' +
    '(„udane 2 z 2 prób"). Jedno zadanie może mieć wiele prób, więc „1 z 1" na górze ' +
    'i „2 z 2" na dole opisują to samo — raz jako zadanie, raz jako próby.</p>' +
    '<p><b>Dlaczego niezawodność, a nie ocena.</b> Ocena mówi, jak dobra jest typowa praca. ' +
    'Niezawodność mówi, jak często jakakolwiek praca wychodzi. Model, który raz zrobi rzecz ' +
    'perfekcyjnie, a trzy razy spudłuje, ma świetną ocenę najlepszej próby i nie nadaje się ' +
    'do routowania pracy — bo za każdy użyteczny wynik płacisz czterema podejściami.</p>' +
    '<p><b>Pasek i przedział.</b> Liczba to udane próby ÷ wszystkie próby. Pasek to 95% ' +
    'przedział ufności — im mniej prób, tym szerszy. Ranking idzie po <b>lewym końcu</b> paska, ' +
    'czyli po „co najmniej tyle". Dzięki temu dwie próby na dwie udane nie udają pewności: ' +
    'lewy koniec jest wtedy dopiero w okolicy 0.34, a nie 1.00.</p>' +
    '<p><b>Kiedy cena decyduje.</b> Tylko między modelami, których przedziały mówią o zbliżonej ' +
    'niezawodności. Wiersz „↕ tych modeli ta próba nie rozróżnia" znaczy, że różnicy nie da się ' +
    'jeszcze rozstrzygnąć — właściwą reakcją jest dolanie prób, nie wybór tańszego.</p>' +
    '<p><b>Czego ta strona nie wie.</b> „Koszt dobrego wyniku" zakłada, że odrzucenie nieudanej ' +
    'próby jest darmowe. Jeśli porażki modelu przechodzą lint, typy i testy, ich wyłapanie ' +
    'kosztuje czas człowieka, a tej pozycji nie ma w żadnej kolumnie.</p>' +
    '<p><b>Ery.</b> Wyniki są porównywalne tylko w obrębie ery (ten sam hash zadania, sędzia, ' +
    'rubryka, wersja scoringu). Stare ery są zwinięte i nie mieszają się z bieżącą.</p>' +
    '</div></details>';
}

function render() {
  const app = document.getElementById("app");
  const lastRun = DATA.runs[DATA.runs.length - 1];
  let html = "<h1>" + esc(DATA.title) + "</h1>" +
    '<p class="sub">Który model nadaje się do tej pracy. Pierwsze kryterium to <b>niezawodność</b> — jak często model kończy zadanie na zaliczeniu. ' +
    'Cena porównuje się dopiero między modelami o podobnej niezawodności. ' +
    "Wygenerowano " + new Date(DATA.generated_at).toLocaleString("pl-PL") + ".</p>" +
    howToRead() +
    '<div class="tiles">' +
    '<div class="tile"><div class="v">' + DATA.runs.length + '</div><div class="l">runów benchmarku</div></div>' +
    '<div class="tile"><div class="v">' + DATA.tasks.length + '</div><div class="l">zadań</div></div>' +
    '<div class="tile"><div class="v">' + models.length + '</div><div class="l">modeli</div></div>' +
    (lastRun ? '<div class="tile"><div class="v">' + fmt.cost(lastRun.total_cost_usd) + '</div><div class="l">koszt prób ostatniego runu</div></div>' : "") +
    "</div>" + overallHtml();
  for (const task of DATA.tasks) {
    const current = task.eras.find(e => e.current);
    const history = task.eras.filter(e => !e.current);
    html += '<section class="task"><h2>' + esc(task.task) +
      ' <span class="h2sub">— pojedyncze próby</span></h2>' + eraHtml(current, DATA.pass_threshold);
    if (history.length) {
      html += "<details><summary>Poprzednie ery (" + history.length + ") — wyniki nieporównywalne z bieżącą</summary>" +
        history.map(e => eraHtml(e, DATA.pass_threshold)).join("") + "</details>";
    }
    html += "</section>";
  }
  html += "<footer>Ery wyznaczają stemple (template, hash zadania, sędzia, rubryka) — dashboard nie miesza wyników między erami. " +
    "Surowe raporty: <a href=\"data.json\">data.json</a>.</footer>";
  app.innerHTML = html;

  const tip = document.getElementById("tooltip");
  app.addEventListener("mousemove", e => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.style.display = "none"; return; }
    tip.innerHTML = t.dataset.tip;
    tip.style.display = "block";
    // clamp w obie strony: samo dociskanie do prawej krawedzi przy szerokim
    // tooltipie wypychalo go za lewa. Blisko dolu pokazujemy nad kursorem.
    const left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8));
    const below = e.clientY + 14;
    const top = below + tip.offsetHeight > innerHeight - 8
      ? Math.max(8, e.clientY - tip.offsetHeight - 12)
      : below;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  });
  app.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}
render();
