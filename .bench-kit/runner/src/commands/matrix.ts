/**
 * bench matrix — helper CI: wylicza listę KOMÓREK (model × zadanie) do
 * zmierzenia. Orkiestrator (workflow bench-run) dispatchuje jeden
 * niezależny run workflow bench-cell per komórka.
 *
 * Wypisuje na stdout JSON:
 *   { "include": [{ "model", "task", "trials", "slug" }, …] }
 * gdzie slug to bezpieczna nazwa (model+zadanie bez znaków specjalnych).
 * Próby komórki biegną równolegle wewnątrz jednego joba bench-cell
 * (`bench run --parallel`) — granulacja per komórka zachowuje ekonomię
 * job-minut, a pojedynczą próbę da się powtórzyć ręcznym dispatchem
 * bench-cell z inputem `trial`.
 *
 * Skip-logic (--results): benchmark jest stateless w obrębie ery —
 * komórka, która w BIEŻĄCEJ (prospektywnej) erze ma już w kanonicznym
 * drzewie wyników (gałąź bench-data, układ z lib/results-tree.ts)
 * >= żądanej liczby prób, wypada z listy. Mniej prób niż żądane
 * (top-up) = pełny re-run komórki — bench-cell nadpisuje trial-1..N
 * w miejscu. --force ignoruje drzewo (wymuszone odświeżenie). Pusta
 * lista PO odfiltrowaniu jest poprawna ({"include":[]}), pusta PRZED
 * to błąd konfiguracji.
 *
 * Uwaga: drzewo widzi tylko wyniki ZMERGOWANE do bench-data — komórki
 * z otwartymi PR-ami wyników wyglądają na niezmierzone; merguj PR-y
 * przed kolejnym dispatchem bench-run.
 *
 * Użycie: bench matrix [--models a,b] [--tasks x,y] [--trials n]
 *                      [--results <dir>] [--force] [--root <dir>]
 * (defaults jak w `bench run`: config.defaults.models / wszystkie zadania /
 * config.defaults.trials)
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";
import { prospectiveEraKey } from "../lib/era.ts";
import { countTrials, eraDirName, sanitize } from "../lib/results-tree.ts";

const USAGE = "usage: bench matrix [--models a,b] [--tasks x,y] [--trials n] [--results <dir>] [--force] [--root <dir>]";

export async function matrixCommand(args: string[]): Promise<number> {
  let models: string[] | null = null;
  let tasks: string[] | null = null;
  let trials: number | null = null;
  let results: string | null = null;
  let force = false;
  let rootArg = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--models") models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--tasks") tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") trials = Number(value());
    else if (arg === "--results") results = resolve(value() ?? "");
    else if (arg === "--force") force = true;
    else if (arg === "--root") rootArg = resolve(value() ?? "");
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (trials !== null && (!Number.isInteger(trials) || trials < 1)) {
    console.error("error: --trials wymaga liczby całkowitej >= 1");
    return 2;
  }

  const root = findInstanceRoot(rootArg);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${rootArg} w górę`);
    return 1;
  }
  try {
    const config = loadConfig(root);
    const allTasks = listTaskNames(root);
    const chosenTasks = tasks ?? allTasks;
    for (const name of chosenTasks) {
      if (!allTasks.includes(name)) throw new Error(`nieznane zadanie: ${name}`);
    }
    const chosenModels = models ?? config.defaults.models;
    const chosenTrials = trials ?? config.defaults.trials;

    let cells = chosenModels.flatMap((model) => chosenTasks.map((task) => ({ model, task })));
    if (cells.length === 0) throw new Error("pusta macierz — brak modeli lub zadań");

    if (results && !force) {
      if (statSync(results, { throwIfNoEntry: false })?.isDirectory()) {
        // prospektywna era per zadanie — te same źródła co stemple evaluate
        const eraByTask = new Map(chosenTasks.map((task) => [task, eraDirName(prospectiveEraKey(root, config, task))]));
        cells = cells.filter(({ model, task }) => {
          const had = countTrials(results as string, task, eraByTask.get(task) as string, model);
          if (had < chosenTrials) return true;
          console.error(`skip:  ${task} × ${model} — ${had} prób(y) w bieżącej erze (>= ${chosenTrials}); --force wymusza re-run`);
          return false;
        });
      } else {
        console.error(`warn:  katalog drzewa wyników nie istnieje (${results}) — bez skip-logic`);
      }
    }

    const include = cells.map(({ model, task }) => ({
      model,
      task,
      trials: chosenTrials,
      slug: `${sanitize(model)}--${sanitize(task)}`,
    }));
    if (include.length === 0) console.error("bench matrix: wszystkie komórki zmierzone w bieżącej erze — nic do zrobienia");
    console.log(JSON.stringify({ include }));
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
