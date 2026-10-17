/**
 * Adapter metryk (Claude Code) — czyta zdarzenia `--output-format
 * stream-json` próby (agent.log) i zapisuje metrics.json w kontrakcie
 * README.md.
 *
 * Źródła, w kolejności:
 * 1. Linia `{"type":"result"}` — koszt i tokeny CAŁEJ sesji z
 *    subagentami (`total_cost_usd`, `modelUsage`). Koszt to wycena
 *    Claude Code wg jego tabeli cen (`costBasis`): wiarygodna dla
 *    modeli pierwszej strony, ZGADYWANA dla nazw spoza tabeli (np. slugi
 *    OpenRouter) — dlatego zapisujemy ją jako `harness_cost_usd`, a o tym,
 *    czy zostaje kosztem próby, decyduje runner (lib/pricing.ts).
 * 2. Brak linii result (timeout, crash) → tokeny z transkryptów sesji
 *    w CLAUDE_CONFIG_DIR/projects/**.jsonl (finalne `usage` per
 *    wiadomość, deduplikacja po message.id), koszt null — wyceni go runner.
 *
 * Użycie: node claude-code.mjs <agent.log> <claude-config-dir> <out-metrics.json> [wall_duration_s]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [logPath, configDir, outPath, wallArg] = process.argv.slice(2);
if (!logPath || !configDir || !outPath) {
  console.error("usage: claude-code.mjs <agent.log> <claude-config-dir> <out-metrics.json> [wall_duration_s]");
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
const result = events.findLast((e) => e.type === "result");

if (result && result.modelUsage && typeof result.total_cost_usd === "number") {
  const models = Object.entries(result.modelUsage);
  const sum = (field) => models.reduce((acc, [, u]) => acc + Number(u[field] ?? 0), 0);
  write({
    cost_usd: result.total_cost_usd,
    cost_source: "harness",
    harness_cost_usd: result.total_cost_usd,
    cost_basis: [...new Set(models.map(([, u]) => u.costBasis ?? "unknown"))].join("+"),
    tokens: {
      input: sum("inputTokens"),
      output: sum("outputTokens"),
      cache_read: sum("cacheReadInputTokens"),
      cache_write: sum("cacheCreationInputTokens"),
    },
    duration_s: typeof result.duration_ms === "number" ? Math.round(result.duration_ms / 100) / 10 : wall,
    // Czas w API modelu (bez narzędzi i czekania lokalnego) — odróżnia
    // timeout "model myślał długo" od "provider dławił / rate limit".
    api_duration_s: typeof result.duration_api_ms === "number" ? Math.round(result.duration_api_ms / 100) / 10 : null,
    models: Object.fromEntries(models.map(([name, u]) => [name, { cost_usd: u.costUSD ?? null, cost_basis: u.costBasis ?? null }])),
    turns: result.num_turns ?? null,
    result_subtype: result.subtype ?? null,
  });
  process.exit(0);
}

// Brak linii result: tokeny z transkryptów sesji (główna + subagenci).
const transcripts = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".jsonl")) transcripts.push(full);
  }
};
walk(join(configDir, "projects"));

// Jedna odpowiedź API = kilka wpisów (blok na wpis) z tym samym
// message.id i tym samym usage — liczymy ją raz.
const byMessage = new Map();
for (const file of transcripts) {
  for (const entry of jsonLines(file)) {
    const message = entry.type === "assistant" ? entry.message : null;
    if (message?.usage && message.id) byMessage.set(message.id, message.usage);
  }
}
const usages = [...byMessage.values()];
const total = (field) => usages.reduce((acc, u) => acc + Number(u[field] ?? 0), 0);
const reason = result ? `linia result bez kosztu (subtype ${result.subtype ?? "?"})` : "brak linii result (timeout / przerwanie / crash)";

if (usages.length === 0) {
  write({ cost_usd: null, cost_source: null, tokens: { input: null, output: null }, duration_s: wall, incomplete: true, incomplete_reason: `${reason}; brak transkryptu z usage` });
  console.error(`metrics-adapter: incomplete (${reason})`);
  process.exit(0);
}
write({
  cost_usd: null,
  cost_source: null,
  tokens: {
    input: total("input_tokens"),
    output: total("output_tokens"),
    cache_read: total("cache_read_input_tokens"),
    cache_write: total("cache_creation_input_tokens"),
  },
  duration_s: wall,
  api_calls: usages.length,
  tokens_source: "transcript",
  incomplete_reason: `${reason}; tokeny z transkryptu, koszt do wyceny przez runner`,
});
