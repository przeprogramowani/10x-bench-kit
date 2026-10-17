/**
 * bench status — stan macierzy z dysku: zachowane próby (attempts/),
 * próby w toku (running.json), oceny (results/). Tracker benchmarku to
 * pliki w drzewie instancji — ta komenda je tylko czyta, niczego nie
 * zmienia. Pozwala prowadzić bieg nieblokująco: `bench attempt` w tle
 * (albo na drugiej maszynie), a tu widać, co gotowe do oceny.
 *
 * Per komórka (zadanie × model): cel prób (defaults.trials), zachowane,
 * w toku, nieinterpretowalne (infra/kill), ocenione (results/ w bieżącej
 * erze oceny: task_hash + sędzia + wersje rubryk + scoring; ocena z innej
 * ery = "stara", z powodem — do re-oceny), koszt prób.
 *
 * Użycie: bench status [--tasks x,y] [--models a,b] [--json] [--root <dir>]
 * (bez argumentów: zadania z tasks/, modele z defaults.models + wszystkie
 *  modele obecne w attempts/)
 */
import { resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";
import { cellStatus, currentEvalEra, modelsInAttempts, type CellStatus } from "../lib/matrix.ts";

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
      const era = currentEvalEra(root, config, task);
      for (const model of models) cells.push(cellStatus(root, task, model, target, era));
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
      const evaluated = `${fresh}/${done.length}${old ? ` (+${old} z innej ery)` : ""}`;
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
    // Ocena z innej ery to nie "oceniona": zmiana rubryki / sędziego /
    // zadania wymaga RE-OCENY zachowanych prób — tu widać, których i dlaczego.
    const oldByReason = new Map<string, string[]>();
    for (const cell of cells) {
      for (const t of cell.trials) {
        if (t.evaluated !== "old") continue;
        const key = t.stale_reasons.join("; ");
        oldByReason.set(key, [...(oldByReason.get(key) ?? []), `${cell.task} × ${cell.model} × próba ${t.trial}`]);
      }
    }
    if (oldByReason.size > 0) {
      console.log("\nocenione w innej erze (do re-oceny zachowanych prób — bez nowego biegu):");
      for (const [reason, trials] of oldByReason) {
        console.log(`  ${reason}: ${trials.length} prób(y)${trials.length <= 3 ? ` — ${trials.join(", ")}` : ""}`);
      }
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
