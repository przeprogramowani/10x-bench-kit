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
 * - frontend dashboardu (HTML/CSS/JS) żyje w assets/leaderboard/ jako
 *   zwykłe pliki — ta komenda skleja je w samowystarczalny index.html,
 * - komenda nie wymaga instancji: pass_threshold i stemple są w raportach;
 *   opcjonalny --root <instancja> ogranicza dashboard do zadań, które
 *   nadal istnieją w tasks/ (historia zadań usuniętych z instancji
 *   zostaje na gałęzi bench-data, ale nie zaśmieca UI).
 *
 * Użycie: bench leaderboard --history <dir> [--out <dir>] [--title <s>]
 *                           [--root <dir>]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames } from "../lib/instance.ts";
import { ReportSchema, type Report, type ReportRow } from "../schemas/report.ts";
import { eraKey } from "../lib/era.ts";
import type { Result } from "../schemas/result.ts";

interface Options {
  history: string | null;
  out: string;
  title: string;
  root: string | null;
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
  const opts: Options = { history: null, out: resolve("leaderboard-site"), title: "Benchmark agentów AI", root: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--history") opts.history = resolve(value() ?? "");
    else if (arg === "--out") opts.out = resolve(value() ?? "");
    else if (arg === "--title") opts.title = value() ?? opts.title;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
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

function buildSiteData(
  title: string,
  reports: { run_id: string; report: Report }[],
  existingTasks: Set<string> | null,
): SiteData {
  // era = krotka stamps; zbieramy runy per era, potem grupujemy ery po zadaniu
  const eras = new Map<string, { stamps: Result["stamps"]; runs: EraRun[] }>();
  for (const { run_id, report } of reports) {
    for (const era of report.eras) {
      const key = eraKey(era.stamps);
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
    // zadania usunięte z instancji zostają w historii (bench-data), ale
    // nie na dashboardzie — filtr tylko przy podanym --root
    if (existingTasks && !existingTasks.has(task)) {
      console.error(`info:  pomijam zadanie spoza instancji: ${task}`);
      continue;
    }
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

const ASSETS = new URL("../../assets/leaderboard/", import.meta.url);
const asset = (name: string) => readFileSync(new URL(name, ASSETS), "utf8");

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * Frontend dashboardu żyje w assets/leaderboard/ jako zwykłe pliki
 * (template.html + style.css + app.js) — tu tylko sklejamy je w jeden
 * samowystarczalny index.html. Placeholdery zamiast bundlera; split/join
 * zamiast String.replace (semantyka $ w zamiennikach).
 */
function renderHtml(data: SiteData): string {
  return asset("template.html")
    .split("__TITLE__").join(escHtml(data.title))
    .split("/*__STYLE__*/").join(asset("style.css").trimEnd())
    .split("__DATA__").join(embedJson(data))
    .split("/*__APP__*/").join(asset("app.js").trimEnd());
}

export async function leaderboardCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts || !opts.history) {
    console.error("usage: bench leaderboard --history <dir> [--out <dir>] [--title <s>] [--root <dir>]");
    return 2;
  }
  try {
    if (!statSync(opts.history, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`katalog historii nie istnieje: ${opts.history}`);
    }
    let existingTasks: Set<string> | null = null;
    if (opts.root) {
      const root = findInstanceRoot(opts.root);
      if (!root) throw new Error(`nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
      existingTasks = new Set(listTaskNames(root));
    }
    const reports = findReports(opts.history);
    if (reports.length === 0) throw new Error(`brak raportów w ${opts.history} — najpierw \`bench report\``);

    const data = buildSiteData(opts.title, reports, existingTasks);
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
