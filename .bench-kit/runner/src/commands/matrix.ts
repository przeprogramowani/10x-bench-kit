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
 * Skip-logic (--history): benchmark jest stateless w obrębie ery —
 * komórka (model × zadanie), która w BIEŻĄCEJ (prospektywnej) erze ma już
 * w historii raportów >= żądanej liczby prób, wypada z macierzy. Historia
 * to katalog report.json (gałąź bench-data). Więcej prób niż w historii
 * (top-up) = pełny re-run komórki od zera — próby między runami nie są
 * scalane. --force ignoruje historię (wymuszone odświeżenie). Pusta
 * macierz PO odfiltrowaniu jest poprawna ({"include":[]} — workflow
 * pomija joby prób), pusta PRZED to błąd konfiguracji.
 *
 * Użycie: bench matrix [--models a,b] [--tasks x,y] [--trials n]
 *                      [--history <dir>] [--force] [--root <dir>]
 * (defaults jak w `bench run`: config.defaults.models / wszystkie zadania /
 * config.defaults.trials)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstanceRoot, listTaskNames, loadConfig } from "../lib/instance.ts";
import { eraKey, prospectiveEraKey } from "../lib/era.ts";
import { ReportSchema } from "../schemas/report.ts";

const USAGE = "usage: bench matrix [--models a,b] [--tasks x,y] [--trials n] [--history <dir>] [--force] [--root <dir>]";

/**
 * Historia z raportów: klucz ery → (model × zadanie) → max prób w jakimkolwiek
 * runie tej ery. Max, nie "ostatni run" — pytanie skip-logic brzmi "czy ta
 * komórka była już zmierzona z >= N próbami w tej erze", a każdy raport ery
 * jest równoprawnym pomiarem.
 */
function collectTrialsDone(historyDir: string): Map<string, Map<string, number>> {
  const done = new Map<string, Map<string, number>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(full, "utf8"));
      } catch {
        console.error(`warn:  historia: pomijam nieparsowalny ${full}`);
        continue;
      }
      const parsed = ReportSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`warn:  historia: pomijam ${full} — nie wygląda na report.json`);
        continue;
      }
      for (const era of parsed.data.eras) {
        const key = eraKey(era.stamps);
        const cells = done.get(key) ?? new Map<string, number>();
        done.set(key, cells);
        for (const row of era.rows) {
          const cell = `${row.model}\0${row.task}`;
          cells.set(cell, Math.max(cells.get(cell) ?? 0, row.trials));
        }
      }
    }
  };
  walk(historyDir);
  return done;
}

export async function matrixCommand(args: string[]): Promise<number> {
  let models: string[] | null = null;
  let tasks: string[] | null = null;
  let trials: number | null = null;
  let history: string | null = null;
  let force = false;
  let rootArg = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--models") models = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--tasks") tasks = value()?.split(",").filter(Boolean) ?? null;
    else if (arg === "--trials") trials = Number(value());
    else if (arg === "--history") history = resolve(value() ?? "");
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

    if (history && !force) {
      if (statSync(history, { throwIfNoEntry: false })?.isDirectory()) {
        const done = collectTrialsDone(history);
        // prospektywna era per zadanie — te same źródła co stemple evaluate
        const eraByTask = new Map(chosenTasks.map((task) => [task, prospectiveEraKey(root, config, task)]));
        cells = cells.filter(({ model, task }) => {
          const had = done.get(eraByTask.get(task) as string)?.get(`${model}\0${task}`) ?? 0;
          if (had < chosenTrials) return true;
          console.error(`skip:  ${task} × ${model} — ${had} prób(y) w bieżącej erze (>= ${chosenTrials}); --force wymusza re-run`);
          return false;
        });
      } else {
        console.error(`warn:  katalog historii nie istnieje (${history}) — bez skip-logic`);
      }
    }

    const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
    const include = cells.flatMap(({ model, task }) =>
      Array.from({ length: chosenTrials }, (_, i) => ({
        model,
        task,
        trial: i + 1,
        slug: `${sanitize(model)}--${sanitize(task)}--t${i + 1}`,
      })),
    );
    if (include.length === 0) console.error("bench matrix: wszystkie komórki zmierzone w bieżącej erze — nic do zrobienia");
    console.log(JSON.stringify({ include }));
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
