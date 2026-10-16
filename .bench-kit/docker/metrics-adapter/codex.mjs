/**
 * Adapter metryk (Codex CLI) — czyta zdarzenia `codex exec --json`
 * (agent.log) i zapisuje metrics.json w kontrakcie README.md.
 *
 * Codex nie raportuje kosztu w USD — cost_usd zostaje null i wycenia go
 * runner z tokenów (lib/pricing.ts, źródło ceny zapisane w metrics.json).
 *
 * Tokeny:
 * 1. Ostatnie `turn.completed.usage` — licznik SKUMULOWANY wątku.
 * 2. Brak turn.completed (timeout / przerwanie) → ostatnie zdarzenie
 *    `token_count` z rolloutu sesji w CODEX_HOME/sessions/**.jsonl
 *    (`total_token_usage`, też skumulowany).
 *
 * Semantyka OpenAI: input_tokens ZAWIERA cached_input_tokens, a
 * output_tokens zawiera reasoning — normalizujemy do kontraktu
 * (input = bez cache, reasoning informacyjnie jako podzbiór output).
 *
 * Użycie: node codex.mjs <agent.log> <codex-home> <out-metrics.json> [wall_duration_s]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [logPath, codexHome, outPath, wallArg] = process.argv.slice(2);
if (!logPath || !codexHome || !outPath) {
  console.error("usage: codex.mjs <agent.log> <codex-home> <out-metrics.json> [wall_duration_s]");
  process.exit(2);
}
const wall = wallArg ? Number(wallArg) : null;
const write = (metrics) => writeFileSync(outPath, JSON.stringify(metrics, null, 2) + "\n");

const jsonLines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line) => {
          if (!line.startsWith("{")) return [];
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];

const events = jsonLines(logPath);
let usage = events.findLast((e) => e.type === "turn.completed")?.usage ?? null;
let source = "exec-json";

if (!usage) {
  const rollouts = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".jsonl")) rollouts.push(full);
    }
  };
  walk(join(codexHome, "sessions"));
  // Pusty CODEX_HOME na starcie próby = jedna sesja; przy kilku (subagenci)
  // sumujemy ostatni skumulowany licznik każdej.
  const totals = rollouts
    .map((file) => jsonLines(file).findLast((e) => e.payload?.type === "token_count" && e.payload.info?.total_token_usage))
    .filter(Boolean)
    .map((e) => e.payload.info.total_token_usage);
  if (totals.length > 0) {
    const keys = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens"];
    usage = Object.fromEntries(keys.map((k) => [k, totals.reduce((acc, t) => acc + Number(t[k] ?? 0), 0)]));
    source = "rollout";
  }
}

const failed = events.findLast((e) => e.type === "turn.failed");
if (!usage) {
  const reason = failed ? `turn.failed: ${String(failed.error?.message ?? "").slice(0, 200)}` : "brak turn.completed i rolloutu z token_count";
  write({ cost_usd: null, cost_source: null, tokens: { input: null, output: null }, duration_s: wall, incomplete: true, incomplete_reason: reason });
  console.error(`metrics-adapter: incomplete (${reason})`);
  process.exit(0);
}

const cached = Number(usage.cached_input_tokens ?? 0);
write({
  cost_usd: null,
  cost_source: null,
  tokens: {
    input: Math.max(0, Number(usage.input_tokens ?? 0) - cached),
    output: Number(usage.output_tokens ?? 0),
    reasoning: Number(usage.reasoning_output_tokens ?? 0),
    cache_read: cached,
    cache_write: Number(usage.cache_write_input_tokens ?? 0),
  },
  duration_s: wall,
  tokens_source: source,
  ...(failed ? { turn_failed: String(failed.error?.message ?? "").slice(0, 500) } : {}),
});
