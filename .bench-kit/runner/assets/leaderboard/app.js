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

function tableHtml(rows, threshold) {
  const sorted = [...rows].sort((a, b) => b.median_total - a.median_total);
  return '<table><thead><tr><th>Model</th><th>Wynik (mediana)</th>' +
    '<th class="num">pass@1</th><th class="num">pass@k</th><th class="num">Zaliczone</th>' +
    '<th class="num">Koszt / próba</th><th class="num">Czas / próba</th></tr></thead><tbody>' +
    sorted.map(r => {
      const passed = r.median_total >= threshold;
      return '<tr>' +
        '<td class="model"><span class="swatch" style="background:' + colorOf(r.model) + '"></span>' +
          esc(short(r.model)) + '<span class="full">' + esc(r.model) +
          (r.stale ? " · run " + esc(r.run_id) + " (" + fmt.date(r.run_at) + ")" : "") + '</span></td>' +
        '<td><div class="scorecell"><span class="n' + (passed ? ' pass' : '') + '">' + fmt.score(r.median_total) + '</span>' +
          '<div class="scorebar"><div class="fill" style="width:' + (r.median_total * 100) + '%"></div>' +
          '<div class="thresh" style="left:' + (threshold * 100) + '%"></div></div></div></td>' +
        '<td class="num">' + fmt.score(r.pass_at_1) + '</td>' +
        '<td class="num">' + fmt.score(r.pass_at_k) + '</td>' +
        '<td class="num">' + r.passed + "/" + r.trials + '</td>' +
        '<td class="num">' + fmt.cost(r.median_cost_usd) + '</td>' +
        '<td class="num">' + fmt.time(r.median_duration_s) + '</td></tr>';
    }).join("") + "</tbody></table>";
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

// jakość vs koszt: log-x (koszty rozpięte o rzędy wielkości), punkt per model,
// identyczność niesiona kolorem ORAZ bezpośrednią etykietą (reguła relief)
function scatterSvg(rows, threshold) {
  const W = 420, H = 240, m = { t: 18, r: 28, b: 34, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const costs = rows.map(r => Math.max(r.median_cost_usd, 1e-5));
  let lo = Math.floor(Math.log10(Math.min(...costs))), hi = Math.ceil(Math.log10(Math.max(...costs)));
  if (hi <= lo) hi = lo + 1;
  const x = c => m.l + (Math.log10(Math.max(c, 1e-5)) - lo) / (hi - lo) * iw;
  const y = v => m.t + (1 - v) * ih;
  const decades = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  const points = placePointLabels(rows.map(r => ({
    r, px: x(r.median_cost_usd), py: y(r.median_total), text: short(r.model),
  })), W, H, m);
  return chart(W, H, "Jakość względem kosztu próby",
    [0, 0.25, 0.5, 0.75, 1].map(v => hGridLine(v, v.toFixed(2), W, m, y)),
    thresholdLine(threshold, W, m, y),
    el("text", { x: W - m.r, y: y(threshold) - 4, "text-anchor": "end" }, "próg " + threshold),
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
      el("circle", { cx: px, cy: py, r: 5, fill: colorOf(r.model), stroke: "var(--surface-1)", "stroke-width": 2,
        "data-tip": tipText(short(r.model), "mediana " + fmt.score(r.median_total),
          fmt.cost(r.median_cost_usd), fmt.time(r.median_duration_s)) }),
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
      const acc = perModel.get(r.model) ?? { model: r.model, tasks: 0, sumTotal: 0, sumP1: 0, sumCost: 0, passed: 0 };
      acc.tasks++;
      acc.sumTotal += r.median_total;
      acc.sumP1 += r.pass_at_1;
      acc.sumCost += r.median_cost_usd;
      if (r.median_total >= DATA.pass_threshold) acc.passed++;
      perModel.set(r.model, acc);
    }
  }
  return [...perModel.values()]
    .map(a => ({ ...a, mean: a.sumTotal / a.tasks, meanP1: a.sumP1 / a.tasks }))
    .sort((a, b) => b.mean - a.mean || b.tasks - a.tasks);
}

function overallHtml() {
  const rows = overallRows();
  if (!rows.length) return "";
  const total = DATA.tasks.length;
  const threshold = DATA.pass_threshold;
  return '<section class="task"><h2>Ranking modeli — wszystkie zadania</h2>' +
    '<p class="era-meta">Średnie nieważone z median po bieżących erach zadań; przekrój przez ery, więc traktuj jako orientację, nie pomiar.</p>' +
    '<div class="card"><table><thead><tr><th>Model</th><th>Średni wynik</th>' +
    '<th class="num">śr. pass@1</th><th class="num">Zaliczone zadania</th><th class="num">Pokrycie</th>' +
    '<th class="num">Koszt przebiegu</th></tr></thead><tbody>' +
    rows.map(r => '<tr>' +
      '<td class="model"><span class="swatch" style="background:' + colorOf(r.model) + '"></span>' +
        esc(short(r.model)) + '<span class="full">' + esc(r.model) + '</span></td>' +
      '<td><div class="scorecell"><span class="n' + (r.mean >= threshold ? ' pass' : '') + '">' + fmt.score(r.mean) + '</span>' +
        '<div class="scorebar"><div class="fill" style="width:' + (r.mean * 100) + '%"></div>' +
        '<div class="thresh" style="left:' + (threshold * 100) + '%"></div></div></div></td>' +
      '<td class="num">' + fmt.score(r.meanP1) + '</td>' +
      '<td class="num">' + r.passed + "/" + r.tasks + '</td>' +
      '<td class="num">' + r.tasks + "/" + total + '</td>' +
      '<td class="num">' + fmt.cost(r.sumCost) + '</td></tr>').join("") +
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

function eraHtml(era, threshold) {
  const rows = latestRowsPerModel(era);
  let html = '<p class="era-meta">' + eraMeta(era.stamps, era.runs) + "</p>" +
    '<div class="card">' + tableHtml(rows, threshold) + "</div>" +
    '<div class="charts"><div class="card"><h3>Jakość vs koszt (najświeższy wynik per model)</h3>' + scatterSvg(rows, threshold) + "</div>";
  if (era.runs.length >= 2) {
    html += '<div class="card"><h3>Trend median między runami</h3>' + trendSvg(era.runs, threshold) +
      '<div class="legend">' + [...new Set(era.runs.flatMap(r => r.rows.map(x => x.model)))].sort()
        .map(mo => '<span style="--c:' + colorOf(mo) + '">' + esc(short(mo)) + "</span>").join("") + "</div></div>";
  }
  return html + "</div>";
}

function render() {
  const app = document.getElementById("app");
  const lastRun = DATA.runs[DATA.runs.length - 1];
  let html = "<h1>" + esc(DATA.title) + "</h1>" +
    '<p class="sub">Leaderboard benchmarku — mediany z prób, pass@k jako niezawodność. ' +
    "Wygenerowano " + new Date(DATA.generated_at).toLocaleString("pl-PL") + ".</p>" +
    '<div class="tiles">' +
    '<div class="tile"><div class="v">' + DATA.runs.length + '</div><div class="l">runów benchmarku</div></div>' +
    '<div class="tile"><div class="v">' + DATA.tasks.length + '</div><div class="l">zadań</div></div>' +
    '<div class="tile"><div class="v">' + models.length + '</div><div class="l">modeli</div></div>' +
    (lastRun ? '<div class="tile"><div class="v">' + fmt.cost(lastRun.total_cost_usd) + '</div><div class="l">koszt prób ostatniego runu</div></div>' : "") +
    "</div>" + overallHtml();
  for (const task of DATA.tasks) {
    const current = task.eras.find(e => e.current);
    const history = task.eras.filter(e => !e.current);
    html += '<section class="task"><h2>' + esc(task.task) + "</h2>" + eraHtml(current, DATA.pass_threshold);
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
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = (e.clientY + 14) + "px";
  });
  app.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}
render();
