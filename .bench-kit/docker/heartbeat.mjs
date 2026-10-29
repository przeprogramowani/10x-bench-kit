/**
 * Puls próby w toku — uruchamiany przez trial.sh co HEARTBEAT_S sekund,
 * równolegle z agentem. Zapisuje /bench/out/heartbeat.json (atomowo:
 * tmp + rename), który runner na hoście czyta bez wchodzenia do kontenera:
 *
 *   { at, elapsed_s, log_bytes, events, activity, tokens, cost_usd, cost_source }
 *
 * - activity = ostatnia czynność agenta z jego WŁASNEGO strumienia zdarzeń
 *   (Claude Code stream-json, Codex exec --json; OpenCode: ostatnia linia
 *   tekstowego logu). Niczego nie dokładamy do promptu ocenianego modelu —
 *   puls tylko czyta to, co harness i tak emituje.
 * - tokens / cost_usd = ten sam adapter metryk, który trial.sh woła po
 *   próbie (metrics-adapter/), uruchomiony na stanie W TRAKCIE sesji.
 *   Koszt bez wiarygodnego źródła w harnessie zostaje null — wycenia go
 *   runner (bench attempt → progress.json).
 *
 * Puls nigdy nie przerywa próby: każdy błąd kończy się cichym brakiem pola.
 *
 * Użycie: node heartbeat.mjs <harness> <out-dir> <start_epoch_s>
 */
import { existsSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Ile końcówki logu czytamy do ostatniej czynności (log bywa dziesiątkami MB). */
const TAIL_BYTES = 256 * 1024;
const ACTIVITY_MAX = 160;

const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const clip = (s) => {
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length > ACTIVITY_MAX ? `${one.slice(0, ACTIVITY_MAX - 1)}…` : one;
};

function readTail(path, bytes = TAIL_BYTES) {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // Pierwsza linia ucięta w środku — odrzucamy ją.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

const jsonLines = (text) =>
  text.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

/** Krótki opis wywołania narzędzia: nazwa + najbardziej mówiący argument. */
function describeTool(name, input) {
  const arg = input?.command ?? input?.file_path ?? input?.path ?? input?.pattern ?? input?.url ?? input?.description ?? null;
  return clip(arg ? `${name}: ${arg}` : name);
}

/**
 * Ostatnia czynność agenta z końcówki logu. Czysta funkcja (testy:
 * .github/tests/units.test.mjs).
 */
export function lastActivity(harness, tail) {
  if (harness === "claude-code") {
    for (const event of jsonLines(tail).reverse()) {
      if (event.type === "result") return clip(`koniec sesji (${event.subtype ?? "result"})`);
      if (event.type !== "assistant") continue;
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      const tool = blocks.findLast((b) => b?.type === "tool_use");
      if (tool) return describeTool(tool.name ?? "tool", tool.input);
      const text = blocks.findLast((b) => b?.type === "text" && b.text);
      if (text) return clip(text.text);
    }
    return null;
  }
  if (harness === "codex") {
    for (const event of jsonLines(tail).reverse()) {
      const item = event.item;
      if (event.type === "turn.failed") return clip(`turn.failed: ${event.error?.message ?? ""}`);
      if (!item || (event.type !== "item.started" && event.type !== "item.completed")) continue;
      if (item.type === "command_execution") return clip(`shell: ${item.command ?? ""}`);
      if (item.type === "file_change") return clip(`edit: ${(item.changes ?? []).map((c) => c.path).join(", ")}`);
      if (item.type === "agent_message" || item.type === "reasoning") return clip(item.text ?? item.type);
      return clip(item.type);
    }
    return null;
  }
  const lines = tail.replace(ANSI, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? clip(lines[lines.length - 1]) : null;
}

/** Liczba zdarzeń agenta (tury/elementy) — miara "czy coś się dzieje", nie metryka próby. */
export function countEvents(harness, log) {
  if (harness === "claude-code") return (log.match(/^\{"type":"assistant"/gm) ?? []).length;
  if (harness === "codex") return (log.match(/^\{"type":"item\.completed"/gm) ?? []).length;
  return null;
}

/** Tokeny/koszt w trakcie sesji — adapter metryk na bieżącym stanie harnessu. */
function liveMetrics(harness, out) {
  const scratch = mkdtempSync(join(tmpdir(), "bench-heartbeat-"));
  const target = join(scratch, "metrics.json");
  try {
    const adapter = "/bench/metrics-adapter";
    const args = {
      opencode: ["--experimental-sqlite", `${adapter}/opencode.mjs`, process.env.XDG_DATA_HOME ?? "/bench/xdg-data", target],
      "claude-code": [`${adapter}/claude-code.mjs`, join(out, "agent.log"), "/bench/claude-home", target],
      codex: [`${adapter}/codex.mjs`, join(out, "agent.log"), "/bench/codex-home", target],
    }[harness];
    if (!args) return null;
    spawnSync(process.execPath, args, { timeout: 15_000, stdio: "ignore" });
    return existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : null;
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const [harness, out, startArg] = process.argv.slice(2);
  if (!harness || !out) {
    console.error("usage: heartbeat.mjs <harness> <out-dir> <start_epoch_s>");
    process.exit(2);
  }
  const logPath = join(out, "agent.log");
  const beat = {
    at: new Date().toISOString(),
    elapsed_s: startArg ? Math.max(0, Math.round(Date.now() / 1000 - Number(startArg))) : null,
    log_bytes: 0,
    events: null,
    activity: null,
    tokens: null,
    cost_usd: null,
    cost_source: null,
  };
  try {
    if (existsSync(logPath)) {
      beat.log_bytes = statSync(logPath).size;
      beat.activity = lastActivity(harness, readTail(logPath));
      // Liczenie zdarzeń czyta cały log — tylko póki jest rozsądnej wielkości.
      if (beat.log_bytes <= 64 * 1024 * 1024) beat.events = countEvents(harness, readFileSync(logPath, "utf8"));
    }
  } catch {
    // brak pola zamiast przerwanej próby
  }
  const metrics = liveMetrics(harness, out);
  // Zero tokenów w trakcie = harness jeszcze ich nie zapisał (OpenCode
  // liczy je na końcu kroku), nie darmowa sesja — zostawiamy nieznane.
  const counted = metrics?.tokens && Object.values(metrics.tokens).some((n) => typeof n === "number" && n > 0);
  if (metrics && !metrics.incomplete && counted) {
    beat.tokens = metrics.tokens ?? null;
    beat.cost_usd = typeof metrics.cost_usd === "number" ? metrics.cost_usd : null;
    beat.cost_source = metrics.cost_source ?? null;
  }
  const target = join(out, "heartbeat.json");
  writeFileSync(`${target}.tmp`, JSON.stringify(beat, null, 2) + "\n");
  renameSync(`${target}.tmp`, target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
