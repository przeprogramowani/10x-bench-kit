/**
 * bench backlog — etap każdego zlecenia z tasks/backlog.md WYPROWADZONY
 * z dysku, nie przepisany ze statusu w pliku. Backlog trzyma decyzje
 * (zlecenie istnieje / porzucone), a postęp to fakty, które i tak już
 * leżą w drzewie: todo.md subagenta, task.yaml, raport z sekcją
 * „Batch gate", zachowane próby i świeże oceny. Komenda tylko czyta.
 *
 * Etapy (kolejno):
 *   ordered    — zlecenie bez katalogu zadania (czeka na bench-build)
 *   building   — tasks/<nazwa>/todo.md istnieje (subagent pracuje)
 *   built      — task.yaml jest, raport bez wypełnionej bramki partii
 *   ready      — raport z bramką partii; brak prób (czeka na bench-measure)
 *   measuring  — są próby, ale nie każda komórka (model z defaults.models)
 *                ma defaults.trials świeżo ocenionych prób
 *   measured   — każda komórka ma cel prób ocenionych w bieżącej erze
 *                (materiał dla bench-summary)
 *   dropped    — zlecenie porzucone (decyzja, Status: dropped)
 *
 * Statusy legacy (in-progress / built / done) są czytane jako deklaracje;
 * rozjazd deklaracji z dyskiem to uwaga (np. osierocone in-progress).
 *
 * Użycie: bench backlog [--json] [--root <dir>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";
import { cellStatus, currentEvalEra } from "../lib/matrix.ts";

interface Options {
  root: string;
  json: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--root") opts.root = resolve(args[++i] ?? "");
    else return null;
  }
  return opts;
}

export type Stage = "ordered" | "building" | "built" | "ready" | "measuring" | "measured" | "dropped";

interface OrderEntry {
  name: string;
  fields: Map<string, string>;
  statusLines: number;
}

export interface OrderState {
  name: string;
  declared: string;
  stage: Stage;
  class: string | null;
  decision: string | null;
  added: string | null;
  /** Świeżo ocenione / cel prób, per model z defaults.models. */
  measurement: { model: string; fresh: number; target: number }[];
  /** Zachowane próby ocenione w innej erze — do re-oceny, nie do nowego biegu. */
  reevaluate: number;
  /** null = brak gita albo etap bez plików; true = pliki zadania/raportu poza commitem. */
  uncommitted: boolean | null;
  notes: string[];
}

/** Wpisy `## <nazwa>` z polami `- **Pole**: wartość` (z kontynuacjami wcięć). */
export function parseBacklog(text: string): OrderEntry[] {
  const entries: OrderEntry[] = [];
  let current: OrderEntry | null = null;
  let lastField: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^## +(.+?)\s*$/);
    if (heading) {
      current = { name: heading[1] as string, fields: new Map(), statusLines: 0 };
      entries.push(current);
      lastField = null;
      continue;
    }
    if (!current) continue;
    const field = line.match(/^- \*\*(.+?)\*\*:\s*(.*)$/);
    if (field) {
      const key = (field[1] as string).toLowerCase();
      if (key === "status") current.statusLines++;
      // Pierwsze wystąpienie wygrywa — duplikat (np. po ręcznym merge'u) to uwaga, nie nadpisanie.
      if (!current.fields.has(key)) current.fields.set(key, (field[2] as string).trim());
      lastField = current.fields.get(key) === (field[2] as string).trim() ? key : null;
      continue;
    }
    if (lastField && /^\s+\S/.test(line)) {
      current.fields.set(lastField, `${current.fields.get(lastField)} ${line.trim()}`.trim());
    } else if (line.trim() === "") {
      lastField = null;
    }
  }
  return entries;
}

/** Krótka etykieta klasy pracy: tekst do pierwszego „—" / „(" / „;". */
function shortClass(raw: string | undefined): string | null {
  if (!raw || raw.startsWith("<")) return null;
  const head = raw.split(/\s+[—–-]\s+|\(|;/)[0]?.trim().toLowerCase();
  return head ? head.slice(0, 32) : null;
}

/** Sekcja `## Batch gate` raportu wypełniona (nie placeholder z szablonu). */
export function gateFilled(report: string): boolean {
  const match = report.match(/^## +Batch gate[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const body = match?.[1]?.trim() ?? "";
  return body.length > 0 && !body.startsWith("<");
}

function gitUncommitted(root: string, paths: string[]): boolean | null {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all", "--", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

const hoursSince = (path: string): number => (Date.now() - statSync(path).mtimeMs) / 3_600_000;

export function backlogStates(root: string): { orders: OrderState[]; unordered: string[]; problems: string[] } {
  const backlogPath = join(root, "tasks", "backlog.md");
  const problems: string[] = [];
  if (!existsSync(backlogPath)) return { orders: [], unordered: listTaskNames(root), problems };
  const config = loadConfig(root);
  const entries = parseBacklog(readFileSync(backlogPath, "utf8"));
  const taskNames = listTaskNames(root);

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) problems.push(`zlecenie "${entry.name}" występuje w backlogu więcej niż raz`);
    seen.add(entry.name);
  }

  const orders = entries.map((entry): OrderState => {
    const name = entry.name;
    const declared = (entry.fields.get("status") ?? "?").split(/\s/)[0]?.toLowerCase() ?? "?";
    const notes: string[] = [];
    if (entry.statusLines === 0) notes.push("brak linii Status — wpis uszkodzony (ręczny merge?)");
    if (entry.statusLines > 1) notes.push(`${entry.statusLines} linie Status — scal ręcznie (artefakt merge'a?)`);
    const decision = entry.fields.get("decision") ?? null;
    if (declared !== "dropped" && (!decision || decision.startsWith("<"))) {
      notes.push("brak Decision — bench-build tego nie zbuduje (reguła 7 bench-new-task)");
    }

    const taskDir = join(root, "tasks", name);
    const todo = join(taskDir, "todo.md");
    const reportPath = join(root, "reports", `${name}-build.md`);
    const hasTask = existsSync(join(taskDir, "task.yaml"));
    const hasReport = existsSync(reportPath);
    const gated = hasReport && gateFilled(readFileSync(reportPath, "utf8"));

    let stage: Stage;
    const measurement: OrderState["measurement"] = [];
    let reevaluate = 0;
    if (declared === "dropped") {
      stage = "dropped";
      if (existsSync(taskDir)) notes.push(`porzucone, ale tasks/${name}/ istnieje`);
    } else if (existsSync(todo)) {
      stage = "building";
      const age = hoursSince(todo);
      if (age > 6) notes.push(`todo.md nieruszany od ${Math.round(age)} h — subagent żyje?`);
    } else if (!hasTask) {
      stage = "ordered";
      if (declared === "in-progress") notes.push("osierocone in-progress: brak todo.md i task.yaml — sesja budowy zginęła?");
      if (declared === "built" || declared === "done") notes.push(`deklarowane ${declared}, a tasks/${name}/task.yaml nie istnieje`);
    } else if (!gated) {
      stage = "built";
      if (!hasReport) notes.push(`brak reports/${name}-build.md — zadanie bez dowodów`);
      else notes.push("raport bez sekcji Batch gate — czeka na bramkę partii");
      if (declared === "done") notes.push("deklarowane done bez dowodu bramki w raporcie");
    } else {
      const era = currentEvalEra(root, config, name);
      let anyAttempt = false;
      for (const model of config.defaults.models) {
        const cell = cellStatus(root, name, model, config.defaults.trials, era);
        if (cell.trials.length > 0) anyAttempt = true;
        const fresh = cell.trials.filter((t) => t.state === "done" && t.evaluated === "fresh").length;
        measurement.push({ model, fresh, target: cell.target });
        const old = cell.trials.filter((t) => t.evaluated === "old").length;
        reevaluate += old;
        if (old > 0) notes.push(`${model}: ${old} ocen(y) z innej ery — re-ocena`);
      }
      if (!anyAttempt) stage = "ready";
      else stage = measurement.every((m) => m.fresh >= m.target) ? "measured" : "measuring";
    }

    const uncommitted =
      stage === "ordered" || stage === "dropped" ? null : gitUncommitted(root, [`tasks/${name}`, `reports/${name}-build.md`]);

    return {
      name,
      declared,
      stage,
      class: shortClass(entry.fields.get("class")),
      decision: decision && !decision.startsWith("<") ? decision : null,
      added: entry.fields.get("added") ?? null,
      measurement,
      reevaluate,
      uncommitted,
      notes,
    };
  });

  const unordered = taskNames.filter((t) => !seen.has(t));
  return { orders, unordered, problems };
}

export async function backlogCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench backlog [--json] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    const { orders, unordered, problems } = backlogStates(root);
    if (opts.json) {
      console.log(JSON.stringify({ orders, unordered, problems }, null, 2));
      return problems.length > 0 ? 1 : 0;
    }
    if (!existsSync(join(root, "tasks", "backlog.md"))) {
      console.log("bench backlog: brak tasks/backlog.md — zlecenia tworzy skill bench-new-task");
      return 0;
    }

    const rows = orders.map((o) => ({
      name: o.name,
      klass: o.class ?? "—",
      stage: o.stage,
      measure: o.measurement.length ? o.measurement.map((m) => `${m.fresh}/${m.target}`).join(" ") : "",
      git: o.uncommitted === null ? "" : o.uncommitted ? "niezacommitowane" : "w gicie",
      notes: o.notes.join("; "),
    }));
    const headers = { name: "zlecenie", klass: "klasa", stage: "etap", measure: "ocenione/cel", git: "git", notes: "uwagi" };
    const keys = Object.keys(headers) as (keyof typeof headers)[];
    const width = Object.fromEntries(keys.map((k) => [k, Math.max(headers[k].length, ...rows.map((r) => r[k].length))])) as Record<
      keyof typeof headers,
      number
    >;
    const line = (r: Record<keyof typeof headers, string>) => keys.map((k) => r[k].padEnd(width[k])).join("  ").trimEnd();
    const models = loadConfig(root).defaults.models;
    console.log(`bench backlog: zlecenia ${orders.length}; etap wyprowadzony z dysku (kolumna ocenione/cel: ${models.join(", ")})\n`);
    console.log(line(headers));
    for (const row of rows) console.log(line(row));

    // Pokrycie klas pracy — klasa bez pomiaru to pytanie, na które instancja jeszcze nie odpowiada.
    const byClass = new Map<string, Stage[]>();
    for (const o of orders) {
      if (o.stage === "dropped") continue;
      const key = o.class ?? "(bez klasy)";
      byClass.set(key, [...(byClass.get(key) ?? []), o.stage]);
    }
    if (byClass.size > 0) {
      console.log("\nklasy pracy:");
      for (const [klass, stages] of byClass) {
        const measured = stages.filter((s) => s === "measured").length;
        console.log(`  ${klass}: zlecenia ${stages.length}, zmierzone ${measured}${measured === 0 ? " — klasa jeszcze bez odpowiedzi" : ""}`);
      }
    }
    if (unordered.length > 0) console.log(`\nzadania bez zlecenia w backlogu: ${unordered.join(", ")}`);
    for (const problem of problems) console.log(`\nproblem: ${problem}`);

    const count = (s: Stage) => orders.filter((o) => o.stage === s).length;
    const uncommitted = orders.filter((o) => o.uncommitted).length;
    const buildable = orders.filter((o) => o.stage === "ordered" && o.decision).length;
    const undecided = count("ordered") - buildable;
    const reevaluate = orders.reduce((acc, o) => acc + o.reevaluate, 0);
    const steps = [
      buildable ? `${buildable} do zbudowania → bench-build` : "",
      undecided ? `${undecided} bez Decision → uzupełnij (bench-new-task)` : "",
      count("built") ? `${count("built")} czeka na bramkę partii (bench-build krok 5)` : "",
      count("ready") + count("measuring") ? `${count("ready") + count("measuring")} do pomiaru → bench-measure` : "",
      reevaluate ? `${reevaluate} zachowanych prób ocenionych w innej erze → re-ocena (rate-attempt)` : "",
      count("measured") ? `${count("measured")} zmierzone → bench-summary` : "",
      uncommitted ? `${uncommitted} z plikami poza commitem → bench changes (plan commitów)` : "",
    ].filter(Boolean);
    console.log(`\nnastępny krok: ${steps.length ? steps.join("; ") : "nic nie czeka"}`);
    return problems.length > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
