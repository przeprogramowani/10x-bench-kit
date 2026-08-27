/**
 * bench snapshot — przepisuje result.json z katalogu runu do kanonicznego
 * drzewa wyników (lib/results-tree.ts): układ kluczowany treścią
 * (zadanie / era / model / próba), nie run_id.
 *
 * To jedyne miejsce, które zna układ drzewa przy ZAPISIE — workflow
 * bench-cell woła snapshot na klonie gałęzi bench-data i commituje wynik
 * jako PR. Ścieżka wynika w całości z treści result.json (task, model,
 * trial, stamps), więc re-run tej samej komórki/próby nadpisuje plik
 * w miejscu, a próba z nowej ery ląduje w świeżym katalogu obok starej.
 *
 * Obok wyników ląduje <zadanie>/<era12>/era.json ze stemplami ery —
 * mapa hash → krotka dla ludzi przeglądających PR-y z wynikami.
 *
 * Użycie: bench snapshot --run <dir> --out <dir-drzewa-wyników>
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { eraKey } from "../lib/era.ts";
import { eraDirName, resultRelPath } from "../lib/results-tree.ts";
import { ResultSchema, type Result } from "../schemas/result.ts";

const USAGE = "usage: bench snapshot --run <dir> --out <dir>";

function findResults(runDir: string): Result[] {
  const results: Result[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "result.json") {
        const parsed = ResultSchema.safeParse(JSON.parse(readFileSync(full, "utf8")));
        if (parsed.success) results.push(parsed.data);
        else console.error(`warn:  pomijam niepoprawny ${full}`);
      }
    }
  };
  walk(runDir);
  return results;
}

export async function snapshotCommand(args: string[]): Promise<number> {
  let run: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[++i];
    if (arg === "--run") run = resolve(value() ?? "");
    else if (arg === "--out") out = resolve(value() ?? "");
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (!run || !out) {
    console.error(USAGE);
    return 2;
  }

  try {
    if (!statSync(run, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`katalog runu nie istnieje: ${run}`);
    }
    const results = findResults(run);
    if (results.length === 0) throw new Error(`brak result.json w ${run} — najpierw \`bench evaluate\``);

    for (const result of results) {
      const eraDir = eraDirName(eraKey(result.stamps));
      const dest = join(out, resultRelPath(result, eraDir));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(result, null, 2) + "\n");
      // era.json: stemple czytelne dla człowieka przy hashu w ścieżce
      writeFileSync(join(out, result.task, eraDir, "era.json"), JSON.stringify(result.stamps, null, 2) + "\n");
      console.log(`snapshot: ${resultRelPath(result, eraDir)} (total ${result.total})`);
    }
    console.log(`bench snapshot: ${results.length} wynik(ów) → ${out}`);
    return 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
