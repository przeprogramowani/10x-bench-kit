/**
 * bench matrix — helper CI: wylicza macierz jobów model × zadanie × próba.
 *
 * Wypisuje na stdout JSON dla `strategy.matrix` GH Actions:
 *   { "include": [{ "model", "task", "trial", "slug" }, …] }
 * gdzie slug to bezpieczna nazwa artefaktu (model+zadanie+próba bez znaków
 * specjalnych). Jeden job = jedna próba (`bench run --trial-index`) —
 * próby biegną równolegle, wall-clock runu ≈ najdłuższa pojedyncza próba
 * zamiast trials × próba. Obrazy zadań idą przez rejestr (GHCR), więc
 * rozmnożenie jobów nie mnoży budowań.
 *
 * Użycie: bench matrix [--models a,b] [--tasks x,y] [--trials n] [--root <dir>]
 * (defaults jak w `bench run`: config.defaults.models / wszystkie zadania /
 * config.defaults.trials)
 */
import { resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";

export async function matrixCommand(args: string[]): Promise<number> {
  let models: string[] | null = null;
  let tasks: string[] | null = null;
  let trials: number | null = null;
  let rootArg = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--models") models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--tasks") tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") trials = Number(value());
    else if (arg === "--root") rootArg = resolve(value() ?? "");
    else {
      console.error("usage: bench matrix [--models a,b] [--tasks x,y] [--trials n] [--root <dir>]");
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
    const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
    const include = chosenModels.flatMap((model) =>
      chosenTasks.flatMap((task) =>
        Array.from({ length: chosenTrials }, (_, i) => ({
          model,
          task,
          trial: i + 1,
          slug: `${sanitize(model)}--${sanitize(task)}--t${i + 1}`,
        })),
      ),
    );
    if (include.length === 0) throw new Error("pusta macierz — brak modeli lub zadań");
    console.log(JSON.stringify({ include }));
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
