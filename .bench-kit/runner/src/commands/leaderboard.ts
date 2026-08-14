/**
 * bench leaderboard — buduje statyczny dashboard z historii report.json.
 *
 * - wejście: katalog z raportami (jeden report.json per run benchmarku;
 *   nazwa pliku = identyfikator runu, np. numer runu GH Actions),
 * - ery NIGDY nie są mieszane: wyniki grupują się po krotce stamps;
 *   erą bieżącą zadania jest ta z najnowszym runem, starsze ery zostają
 *   widoczne jako historia,
 * - wyjście: --out/index.html (samowystarczalny HTML — zero zależności
 *   sieciowych, dane wbudowane) + data.json (sklejona historia do
 *   własnych analiz),
 * - komenda nie wymaga instancji: pass_threshold i stemple są w raportach.
 *
 * Użycie: bench leaderboard --history <dir> [--out <dir>] [--title <s>]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ReportSchema, type Report, type ReportRow } from "../schemas/report.ts";
import type { Result } from "../schemas/result.ts";

interface Options {
  history: string | null;
  out: string;
  title: string;
}

interface EraRun {
  run_id: string;
  generated_at: string;
  rows: ReportRow[];
}

interface Era {
  stamps: Result["stamps"];
  current: boolean;
  runs: EraRun[]; // rosnąco po generated_at
}

interface SiteData {
  title: string;
  generated_at: string;
  pass_threshold: number;
  runs: { id: string; generated_at: string; total_cost_usd: number; trials: number }[];
  tasks: { task: string; eras: Era[] }[];
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { history: null, out: resolve("leaderboard-site"), title: "Benchmark agentów AI" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--history") opts.history = resolve(value() ?? "");
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--title") opts.title = value() ?? opts.title;
    else return null;
  }
  if (!opts.history) return null;
  return opts;
}

function findReports(dir: string): { run_id: string; report: Report }[] {
  const found: { run_id: string; report: Report }[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".json")) {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(full, "utf8"));
        } catch {
          console.error(`warn:  pomijam nieparsowalny ${full}`);
          continue;
        }
        const parsed = ReportSchema.safeParse(raw);
        if (parsed.success) found.push({ run_id: basename(name, ".json"), report: parsed.data });
        else console.error(`warn:  pomijam ${full} — nie wygląda na report.json`);
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => a.report.generated_at.localeCompare(b.report.generated_at));
}

function buildSiteData(title: string, reports: { run_id: string; report: Report }[]): SiteData {
  // era = krotka stamps; zbieramy runy per era, potem grupujemy ery po zadaniu
  const eras = new Map<string, { stamps: Result["stamps"]; runs: EraRun[] }>();
  for (const { run_id, report } of reports) {
    for (const era of report.eras) {
      // scoring_version (tylko scoring-breaking podbija) zamiast
      // template_version — neutralny release template'u nie rozdziela er;
      // raporty legacy bez scoring_version zachowują stary klucz.
      const key = JSON.stringify([
        era.stamps.scoring_version ?? era.stamps.template_version,
        era.stamps.task_hash,
        era.stamps.judge_model,
        era.stamps.rubric_version,
      ]);
      let entry = eras.get(key);
      if (!entry) {
        entry = { stamps: era.stamps, runs: [] };
        eras.set(key, entry);
      }
      entry.runs.push({ run_id, generated_at: report.generated_at, rows: era.rows });
    }
  }

  const tasks = new Map<string, Era[]>();
  for (const { stamps, runs } of eras.values()) {
    // task_hash jednoznacznie wskazuje zadanie, więc era ma dokładnie jedno
    const task = runs[0]?.rows[0]?.task ?? "(nieznane zadanie)";
    const list = tasks.get(task) ?? [];
    list.push({ stamps, current: false, runs });
    tasks.set(task, list);
  }
  for (const list of tasks.values()) {
    // bieżąca era = ta z najnowszym runem; reszta to historia
    list.sort((a, b) => {
      const lastA = a.runs[a.runs.length - 1]?.generated_at ?? "";
      const lastB = b.runs[b.runs.length - 1]?.generated_at ?? "";
      return lastB.localeCompare(lastA);
    });
    if (list[0]) list[0].current = true;
  }

  const latest = reports[reports.length - 1];
  return {
    title,
    generated_at: new Date().toISOString(),
    pass_threshold: latest?.report.pass_threshold ?? 0.7,
    runs: reports.map(({ run_id, report }) => ({
      id: run_id,
      generated_at: report.generated_at,
      total_cost_usd: report.total_cost_usd,
      trials: report.trials,
    })),
    tasks: [...tasks.entries()]
      .map(([task, eraList]) => ({ task, eras: eraList }))
      .sort((a, b) => a.task.localeCompare(b.task)),
  };
}

/** Dane wbudowane w <script> — escapowanie domknięcia tagu wystarcza. */
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function renderHtml(data: SiteData): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${data.title}</title>
<style>
:root {
  color-scheme: light;
  --surface-1: #fcfcfb; --page: #f9f9f7;
  --ink-1: #0b0b0b; --ink-2: #52514e; --ink-muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
  --good-text: #006300;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
    --good-text: #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-1: #1a1a19; --page: #0d0d0d;
  --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --good-text: #0ca30c;
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--page); color: var(--ink-1);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 32px 20px 64px;
}
main { max-width: 980px; margin: 0 auto; }
h1 { font-size: 24px; font-weight: 650; }
.sub { color: var(--ink-2); margin-top: 4px; font-size: 13px; }
.tiles { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0 8px; }
.tile {
  background: var(--surface-1); border: 1px solid var(--ring); border-radius: 10px;
  padding: 12px 18px; min-width: 130px; flex: 0 1 auto;
}
.tile .v { font-size: 22px; font-weight: 650; }
.tile .l { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
section.task { margin-top: 36px; }
h2 { font-size: 18px; font-weight: 650; }
.era-meta { font-size: 12px; color: var(--ink-muted); margin: 4px 0 12px; }
.era-meta code { font-family: ui-monospace, monospace; font-size: 11px; }
.card {
  background: var(--surface-1); border: 1px solid var(--ring); border-radius: 10px;
  padding: 16px 18px; margin-bottom: 14px; overflow-x: auto;
}
table { border-collapse: collapse; width: 100%; min-width: 640px; }
th {
  text-align: left; font-size: 12px; font-weight: 600; color: var(--ink-2);
  padding: 6px 12px 6px 0; border-bottom: 1px solid var(--axis); white-space: nowrap;
}
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--grid); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.model { font-weight: 600; white-space: nowrap; }
.model .swatch {
  display: inline-block; width: 10px; height: 10px; border-radius: 3px;
  margin-right: 8px; vertical-align: baseline;
}
.model .full { display: block; font-weight: 400; font-size: 11px; color: var(--ink-muted); margin-left: 18px; }
.scorebar { position: relative; width: 140px; height: 4px; background: var(--grid); border-radius: 4px; }
.scorebar .fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--s1); }
.scorebar .thresh { position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--axis); }
.scorecell { display: flex; align-items: center; gap: 10px; }
.scorecell .n { font-variant-numeric: tabular-nums; min-width: 44px; }
.pass { color: var(--good-text); font-weight: 600; }
h3 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 10px; }
.charts { display: flex; flex-wrap: wrap; gap: 14px; }
.charts .card { flex: 1 1 380px; margin-bottom: 0; }
.charts svg { display: block; width: 100%; height: auto; max-width: 460px; }
svg text { font: 11px system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--ink-muted); }
svg text.dl { fill: var(--ink-1); font-weight: 600; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--ink-2); font-size: 13px; }
details .card { margin-top: 10px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12px; color: var(--ink-2); }
.legend span::before {
  content: ""; display: inline-block; width: 10px; height: 10px;
  border-radius: 3px; margin-right: 6px; background: var(--c);
}
#tooltip {
  position: fixed; pointer-events: none; display: none; z-index: 10;
  background: var(--surface-1); border: 1px solid var(--ring); border-radius: 8px;
  padding: 8px 10px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.12);
}
#tooltip b { display: block; }
footer { margin-top: 40px; font-size: 12px; color: var(--ink-muted); }
</style>
</head>
<body>
<main id="app"></main>
<div id="tooltip"></div>
<script>
const DATA = ${embedJson(data)};
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
  let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Jakość względem kosztu próby">';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)" stroke-width="1"/>' +
      '<text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(2) + "</text>";
  }
  s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(threshold) + '" y2="' + y(threshold) +
    '" stroke="var(--axis)" stroke-width="1" stroke-dasharray="4 3"/>' +
    '<text x="' + (W - m.r) + '" y="' + (y(threshold) - 4) + '" text-anchor="end">próg ' + threshold + "</text>";
  for (let e = lo; e <= hi; e++) {
    const c = Math.pow(10, e);
    const anchor = e === hi ? "end" : e === lo ? "start" : "middle";
    s += '<text x="' + x(c) + '" y="' + (H - m.b + 16) + '" text-anchor="' + anchor + '">' + fmt.cost(c) + "</text>" +
      '<line x1="' + x(c) + '" x2="' + x(c) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b + 4) + '" stroke="var(--axis)"/>';
  }
  s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '" stroke="var(--axis)"/>' +
    '<text x="' + (m.l + iw / 2) + '" y="' + (H - 4) + '" text-anchor="middle">koszt próby (log)</text>';
  for (const r of rows) {
    const px = x(r.median_cost_usd), py = y(r.median_total);
    // etykiety trzymane wewnątrz viewBoxu: przy krawędziach zmiana kotwicy/strony
    const anchor = px > W - 90 ? "end" : px < m.l + 90 ? "start" : "middle";
    const ly = py < m.t + 16 ? py + 18 : py - 10;
    s += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="' + colorOf(r.model) +
      '" stroke="var(--surface-1)" stroke-width="2" data-tip="<b>' + esc(short(r.model)) + "</b>mediana " + fmt.score(r.median_total) +
      " · " + fmt.cost(r.median_cost_usd) + " · " + fmt.time(r.median_duration_s) + '"/>' +
      '<text class="dl" x="' + px + '" y="' + ly + '" text-anchor="' + anchor + '">' + esc(short(r.model)) + "</text>";
  }
  return s + "</svg>";
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
  let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Trend median między runami">';
  for (const v of [0, 0.5, 1]) {
    s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)"/>' +
      '<text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(1) + "</text>";
  }
  s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(threshold) + '" y2="' + y(threshold) +
    '" stroke="var(--axis)" stroke-width="1" stroke-dasharray="4 3"/>';
  runs.forEach((run, i) => {
    s += '<text x="' + x(i) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + fmt.date(run.generated_at) + "</text>";
  });
  for (const [model, pts] of byModel) {
    const c = colorOf(model);
    s += '<polyline fill="none" stroke="' + c + '" stroke-width="2" points="' +
      pts.map(p => x(p.i) + "," + y(p.r.median_total)).join(" ") + '"/>';
    for (const p of pts) {
      s += '<circle cx="' + x(p.i) + '" cy="' + y(p.r.median_total) + '" r="4" fill="' + c +
        '" stroke="var(--surface-1)" stroke-width="2" data-tip="<b>' + esc(short(model)) + "</b>run " + esc(p.run.run_id) +
        " · mediana " + fmt.score(p.r.median_total) + " · " + fmt.cost(p.r.median_cost_usd) + '"/>';
    }
    const last = pts[pts.length - 1];
    s += '<text class="dl" x="' + (x(last.i) + 8) + '" y="' + (y(last.r.median_total) + 4) + '">' + esc(short(model)) + "</text>";
  }
  return s + "</svg>";
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
    "</div>";
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
    "Surowe raporty: <a href=\\"data.json\\">data.json</a>.</footer>";
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
</script>
</body>
</html>
`;
}

export async function leaderboardCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts || !opts.history) {
    console.error("usage: bench leaderboard --history <dir> [--out <dir>] [--title <s>]");
    return 2;
  }
  try {
    if (!statSync(opts.history, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`katalog historii nie istnieje: ${opts.history}`);
    }
    const reports = findReports(opts.history);
    if (reports.length === 0) throw new Error(`brak raportów w ${opts.history} — najpierw \`bench report\``);

    const data = buildSiteData(opts.title, reports);
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(join(opts.out, "index.html"), renderHtml(data));
    writeFileSync(join(opts.out, "data.json"), JSON.stringify(data, null, 2) + "\n");

    const eraCount = data.tasks.reduce((acc, t) => acc + t.eras.length, 0);
    console.log(
      `bench leaderboard: ${reports.length} run(ów), ${data.tasks.length} zadań, ${eraCount} er(y) → ${join(opts.out, "index.html")}`,
    );
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
