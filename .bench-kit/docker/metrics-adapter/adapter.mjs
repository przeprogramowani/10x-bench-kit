/**
 * Adapter metryk (OpenCode) — jedyny szew między harnessem a resztą kitu.
 *
 * Czyta storage OpenCode (SQLite: <xdg-data>/opencode/opencode.db) ze
 * świeżego XDG_DATA_HOME próby i zapisuje metrics.json:
 *   { cost_usd, tokens: { input, output }, duration_s }
 *
 * Pusty XDG_DATA_HOME na starcie próby gwarantuje dokładnie jedną sesję —
 * mimo to sumujemy po wszystkich (agent mógł odpalić subagentów jako
 * osobne sesje). Brak danych → metryki częściowe z "incomplete": true,
 * nigdy nie wymyślamy wartości.
 *
 * Użycie: node --experimental-sqlite adapter.mjs <xdg-data-dir> <out-metrics.json> [wall_duration_s]
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [xdgDataDir, outPath, wallDurationArg] = process.argv.slice(2);
if (!xdgDataDir || !outPath) {
  console.error("usage: adapter.mjs <xdg-data-dir> <out-metrics.json> [wall_duration_s]");
  process.exit(2);
}
const wallDuration = wallDurationArg ? Number(wallDurationArg) : null;

function incomplete(reason) {
  const metrics = {
    cost_usd: null,
    tokens: { input: null, output: null },
    duration_s: wallDuration,
    incomplete: true,
    incomplete_reason: reason,
  };
  writeFileSync(outPath, JSON.stringify(metrics, null, 2) + "\n");
  console.error(`metrics-adapter: incomplete (${reason})`);
}

const dbPath = join(xdgDataDir, "opencode", "opencode.db");
if (!existsSync(dbPath)) {
  incomplete(`brak ${dbPath} — agent nie zostawił storage`);
  process.exit(0);
}

let rows;
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  rows = db
    .prepare(
      `SELECT cost, tokens_input, tokens_output, tokens_reasoning,
              tokens_cache_read, tokens_cache_write,
              time_created, time_updated
       FROM session`,
    )
    .all();
  db.close();
} catch (err) {
  incomplete(`nie udało się odczytać storage: ${err}`);
  process.exit(0);
}

if (rows.length === 0) {
  incomplete("storage istnieje, ale nie ma żadnej sesji");
  process.exit(0);
}

const sum = (field) => rows.reduce((acc, r) => acc + Number(r[field] ?? 0), 0);
// duration_s = czas sesji agenta (created → updated), nie czas życia kontenera.
const started = Math.min(...rows.map((r) => Number(r.time_created)));
const finished = Math.max(...rows.map((r) => Number(r.time_updated)));

const metrics = {
  cost_usd: sum("cost"),
  tokens: {
    input: sum("tokens_input"),
    output: sum("tokens_output"),
    reasoning: sum("tokens_reasoning"),
    cache_read: sum("tokens_cache_read"),
    cache_write: sum("tokens_cache_write"),
  },
  duration_s: Math.round((finished - started) / 100) / 10,
  sessions: rows.length,
};
writeFileSync(outPath, JSON.stringify(metrics, null, 2) + "\n");
