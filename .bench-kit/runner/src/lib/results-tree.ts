/**
 * Kanoniczne drzewo wyników na gałęzi bench-data — jedno źródło prawdy
 * dla `bench snapshot` (zapis), `bench matrix` (skip-logic) i leaderboardu
 * (odczyt przez `bench report --run <drzewo>`).
 *
 * Układ (klucz treścią, nie run_id — re-run komórki nadpisuje w miejscu):
 *
 *   results/<zadanie>/<era12>/<model-sanitized>/trial-<n>/result.json
 *   results/<zadanie>/<era12>/era.json   — stemple ery (mapa hash → krotka)
 *
 * gdzie era12 = pierwsze 12 znaków SHA-256 klucza ery (lib/era.ts).
 * Era w ścieżce = nowa era zaczyna czysty katalog, historia starych er
 * zostaje nietknięta obok.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ResultSchema, type Result } from "../schemas/result.ts";

/** Ta sama sanityzacja co slugi artefaktów CI. */
export const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-");

/** Nazwa katalogu ery: krótki, stabilny hash klucza ery. */
export function eraDirName(eraKey: string): string {
  return createHash("sha256").update(eraKey).digest("hex").slice(0, 12);
}

/** Ścieżka result.json próby względem korzenia drzewa wyników. */
export function resultRelPath(result: Pick<Result, "task" | "model" | "trial">, eraDir: string): string {
  return join(result.task, eraDir, sanitize(result.model), `trial-${result.trial}`, "result.json");
}

/**
 * Liczba prób (model × zadanie) zmierzonych w danej erze. Liczy po TREŚCI
 * result.json (pole model), nie po nazwie katalogu — sanityzacja nazw
 * modeli nie jest wstecznie odwracalna, więc dopasowanie po katalogu
 * mogłoby sklejać różne modele.
 */
export function countTrials(resultsDir: string, task: string, eraDir: string, model: string): number {
  const eraPath = join(resultsDir, task, eraDir);
  if (!statSync(eraPath, { throwIfNoEntry: false })?.isDirectory()) return 0;
  const trials = new Set<number>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "result.json") {
        try {
          const parsed = ResultSchema.safeParse(JSON.parse(readFileSync(full, "utf8")));
          if (parsed.success && parsed.data.model === model && parsed.data.task === task) trials.add(parsed.data.trial);
        } catch {
          console.error(`warn:  drzewo wyników: pomijam nieparsowalny ${full}`);
        }
      }
    }
  };
  walk(eraPath);
  return trials.size;
}
