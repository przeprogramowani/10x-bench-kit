/**
 * bench status — stan macierzy z dysku: zachowane próby (attempts/),
 * próby w toku (running.json), oceny (results/). Tracker benchmarku to
 * pliki w drzewie instancji — ta komenda je tylko czyta, niczego nie
 * zmienia. Pozwala prowadzić bieg nieblokująco: `bench attempt` w tle
 * (albo na drugiej maszynie), a tu widać, co gotowe do oceny.
 *
 * Per komórka (zadanie × model): cel prób (defaults.trials), zachowane,
 * w toku, nieinterpretowalne (infra/kill), ocenione (results/ z bieżącym
 * task_hash; ocena starą definicją zadania = "stara"), koszt prób.
 *
 * Użycie: bench status [--tasks x,y] [--models a,b] [--json] [--root <dir>]
 * (bez argumentów: zadania z tasks/, modele z defaults.models + wszystkie
 *  modele obecne w attempts/)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";
import { hashTaskDir } from "../lib/era.ts";
import { sanitize } from "../lib/prepare.ts";

interface Options {
  root: string;
  tasks: string[] | null;
  models: string[] | null;
  json: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), tasks: null, models: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--tasks") opts.tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--models") opts.models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--root") opts.root = resolve(value() ?? "");
    else return null;
  }
  return opts;
}

interface TrialState {
  trial: number;
  state: "done" | "running" | "stale" | "infra";
  cost_usd: number | null;
  started_at: string | null;
  evaluated: "fresh" | "old" | null;
  total: number | null;
}

interface CellStatus {
  task: string;
  model: string;
  target: number;
  trials: TrialState[];
  aborted: number;
  superseded: number;
}

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
const readJson = (p: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Ta sama reguła przeterminowania co w bench attempt (timeout + 15 min). */
function runningState(marker: Record<string, unknown> | null): "running" | "stale" {
  const started = Date.parse(String(marker?.started_at ?? ""));
  const timeoutS = typeof marker?.timeout_s === "number" ? marker.timeout_s : 0;
  if (!Number.isFinite(started)) return "stale";
  return Date.now() > started + (timeoutS + 900) * 1000 ? "stale" : "running";
}

function cellStatus(root: string, task: string, model: string, target: number, taskHash: string): CellStatus {
  const cellDir = join(root, "attempts", task, sanitize(model));
  const resultsCell = join(root, "results", task, sanitize(model));
  const trials: TrialState[] = [];
  let aborted = 0;
  let superseded = 0;
  if (isDir(cellDir)) {
    for (const name of readdirSync(cellDir).sort()) {
      if (/^trial-\d+\.aborted-/.test(name)) aborted++;
      if (/^trial-\d+\.superseded-/.test(name)) superseded++;
      const match = name.match(/^trial-(\d+)$/);
      if (!match) continue;
      const trial = Number(match[1]);
      const dir = join(cellDir, name);
      const attempt = readJson(join(dir, "attempt.json"));
      if (attempt) {
        const metrics = readJson(join(dir, "metrics.json"));
        const result = readJson(join(resultsCell, name, "result.json"));
        const stamps = (result?.stamps ?? {}) as Record<string, unknown>;
        trials.push({
          trial,
          state: attempt.infra_failure === true ? "infra" : "done",
          cost_usd: typeof metrics?.cost_usd === "number" ? metrics.cost_usd : null,
          started_at: typeof attempt.started_at === "string" ? attempt.started_at : null,
          evaluated: result ? (stamps.task_hash === taskHash ? "fresh" : "old") : null,
          total: typeof result?.total === "number" ? result.total : null,
        });
      } else if (existsSync(join(dir, "running.json"))) {
        const marker = readJson(join(dir, "running.json"));
        trials.push({
          trial,
          state: runningState(marker),
          cost_usd: null,
          started_at: typeof marker?.started_at === "string" ? marker.started_at : null,
          evaluated: null,
          total: null,
        });
      }
    }
  }
  return { task, model, target, trials, aborted, superseded };
}

/** Modele obecne w attempts/ (po polu model w attempt.json / running.json). */
function modelsInAttempts(root: string, tasks: string[]): string[] {
  const found = new Set<string>();
  for (const task of tasks) {
    const taskDir = join(root, "attempts", task);
    if (!isDir(taskDir)) continue;
    for (const modelDir of readdirSync(taskDir)) {
      const cellDir = join(taskDir, modelDir);
      if (!isDir(cellDir)) continue;
      for (const name of readdirSync(cellDir)) {
        if (!/^trial-\d+$/.test(name)) continue;
        const meta = readJson(join(cellDir, name, "attempt.json")) ?? readJson(join(cellDir, name, "running.json"));
        if (typeof meta?.model === "string") {
          found.add(meta.model);
          break;
        }
      }
    }
  }
  return [...found];
}

const elapsed = (iso: string | null): string => {
  const started = Date.parse(iso ?? "");
  if (!Number.isFinite(started)) return "?";
  const minutes = Math.round((Date.now() - started) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export async function statusCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench status [--tasks x,y] [--models a,b] [--json] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    const config = loadConfig(root);
    const allTasks = listTaskNames(root);
    const tasks = opts.tasks ?? allTasks;
    for (const name of tasks) {
      if (!allTasks.includes(name)) throw new Error(`nieznane zadanie: ${name}`);
    }
    const models = opts.models ?? [...new Set([...config.defaults.models, ...modelsInAttempts(root, tasks)])];
    const target = config.defaults.trials;

    const cells: CellStatus[] = [];
    for (const task of tasks) {
      const taskHash = hashTaskDir(join(root, "tasks", task));
      for (const model of models) cells.push(cellStatus(root, task, model, target, taskHash));
    }

    if (opts.json) {
      console.log(JSON.stringify({ target_trials: target, cells }, null, 2));
      return 0;
    }

    const rows = cells.map((cell) => {
      const done = cell.trials.filter((t) => t.state === "done");
      const running = cell.trials.filter((t) => t.state === "running").length;
      const stale = cell.trials.filter((t) => t.state === "stale").length;
      const infra = cell.trials.filter((t) => t.state === "infra").length;
      const fresh = done.filter((t) => t.evaluated === "fresh").length;
      const old = done.filter((t) => t.evaluated === "old").length;
      const cost = done.reduce((acc, t) => acc + (t.cost_usd ?? 0), 0);
      const missing = Math.max(0, cell.target - done.length - running);
      const evaluated = `${fresh}/${done.length}${old ? ` (+${old} starą definicją)` : ""}`;
      const notes = [
        running ? `${running} w toku` : "",
        stale ? `${stale} PRZETERMINOWANE` : "",
        infra ? `${infra} infra` : "",
        cell.aborted ? `${cell.aborted} aborted` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        task: cell.task,
        model: cell.model,
        preserved: `${done.length}/${cell.target}`,
        evaluated,
        missing: String(missing),
        cost: `$${cost.toFixed(2)}`,
        notes,
      };
    });
    const headers = { task: "zadanie", model: "model", preserved: "zachowane", evaluated: "ocenione", missing: "brakuje", cost: "koszt prób", notes: "uwagi" };
    const keys = Object.keys(headers) as (keyof typeof headers)[];
    const width = Object.fromEntries(keys.map((k) => [k, Math.max(headers[k].length, ...rows.map((r) => r[k].length))])) as Record<keyof typeof headers, number>;
    const line = (r: Record<keyof typeof headers, string>) => keys.map((k) => r[k].padEnd(width[k])).join("  ").trimEnd();
    console.log(`bench status: ${tasks.length} zadań × ${models.length} modeli, cel ${target} prób(y) na komórkę (defaults.trials)\n`);
    console.log(line(headers));
    for (const row of rows) console.log(line(row));

    const running = cells.flatMap((c) => c.trials.filter((t) => t.state === "running").map((t) => ({ ...t, task: c.task, model: c.model })));
    const stale = cells.flatMap((c) => c.trials.filter((t) => t.state === "stale").map((t) => ({ ...t, task: c.task, model: c.model })));
    if (running.length > 0) {
      console.log("\nw toku:");
      for (const t of running) console.log(`  ${t.task} × ${t.model} × próba ${t.trial} — od ${elapsed(t.started_at)}`);
    }
    if (stale.length > 0) {
      console.log("\nprzeterminowane markery (proces bench attempt zginął?) — następny bench attempt odłoży je do trial-N.aborted-*:");
      for (const t of stale) console.log(`  ${t.task} × ${t.model} × próba ${t.trial} — start ${t.started_at ?? "?"}`);
    }
    const toEvaluate = cells.reduce((acc, c) => acc + c.trials.filter((t) => t.state === "done" && t.evaluated !== "fresh").length, 0);
    const missing = rows.reduce((acc, r) => acc + Number(r.missing), 0);
    console.log(
      `\nnastępny krok: ${toEvaluate > 0 ? `${toEvaluate} zachowanych prób bez świeżej oceny → bench evaluate / rate-attempt` : "wszystkie zachowane próby ocenione"}` +
        `${missing > 0 ? `; ${missing} prób(y) brakuje do celu → bench attempt (dogania braki)` : ""}`,
    );
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
