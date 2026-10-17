// Mock LLM API do offline'owych testów harnessów (bez kluczy, bez kosztu):
// Anthropic Messages (Claude Code) i OpenAI Responses (Codex), plus
// katalog cen w formacie OpenRouter (GET /api/v1/models). Pierwsza tura
// z narzędziami → jedno wywołanie narzędzia powłoki, które zapisuje plik;
// po wyniku narzędzia → tekst końcowy. Każde żądanie trafia do logu.
//
//   node mock-llm.mjs <port> [log] [delayMs] [plik-z-komendą-dla-Bash]
//
// Użycie i scenariusze: README.md obok.
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 8787);
const logFile = process.argv[3] ?? "/dev/stdout";
const log = (s) => appendFileSync(logFile, s + "\n");
// Opcjonalnie: każde żądanie modelu po pierwszym czeka delayMs (test timeoutu).
const delayMs = Number(process.argv[4] ?? 0);
// Opcjonalnie: plik z komendą, którą "agent" wykona narzędziem Bash.
const commandFile = process.argv[5] ?? "";
const agentCommand = commandFile ? readFileSync(commandFile, "utf8") : "echo 'hello from claude' > HELLO.md";
let modelCalls = 0;

const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

function anthropic(body, res) {
  const msgs = body.messages ?? [];
  const last = msgs[msgs.length - 1];
  const hasToolResult = Array.isArray(last?.content) && last.content.some((c) => c.type === "tool_result");
  const tools = (body.tools ?? []).map((t) => t.name);
  const useTool = !hasToolResult && tools.includes("Bash");
  const usage = { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 };
  const start = { type: "message_start", message: { id: `msg_${modelCalls}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage } };
  const blocks = useTool
    ? [
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_mock1", name: "Bash", input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: agentCommand, description: "do the task" }) } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ]
    : [
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ];
  const stop = useTool ? "tool_use" : "end_turn";
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage }));
    return;
  }
  sse(res, [
    ["message_start", start],
    ...blocks,
    ["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
}

function openaiResponses(body, res) {
  const input = body.input ?? [];
  const hasToolOutput = input.some((i) => i.type === "function_call_output" || i.type === "custom_tool_call_output");
  const toolNames = (body.tools ?? []).map((t) => t.name ?? t.type);
  log(`  codex tools: ${toolNames.join(",")}`);
  const shellTool = ["exec_command", "shell", "shell_command"].find((n) => toolNames.includes(n));
  const usage = { input_tokens: 2000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 2080 };
  const id = "resp_mock";
  let item;
  if (!hasToolOutput && shellTool) {
    const args =
      shellTool === "exec_command"
        ? { cmd: "echo 'hello from codex' > HELLO.md" }
        : shellTool === "shell_command"
          ? { command: "echo 'hello from codex' > HELLO.md" }
          : { command: ["bash", "-lc", "echo 'hello from codex' > HELLO.md"] };
    item = { type: "function_call", id: "fc_mock", call_id: "call_mock1", name: shellTool, arguments: JSON.stringify(args), status: "completed" };
  } else {
    item = { type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] };
  }
  const response = { id, object: "response", status: "completed", model: body.model, output: [item], usage };
  sse(res, [
    ["response.created", { type: "response.created", response: { ...response, status: "in_progress", output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response }],
  ]);
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}
    const firstUser = JSON.stringify(body.messages?.[0]?.content ?? body.input ?? "");
    if (firstUser.includes("HELLO.md")) log(`  prompt seen: ${firstUser.includes("Add a file HELLO.md") ? "yes" : "partial"}`);
    log(`${req.method} ${req.url} model=${body.model ?? "-"} auth=${req.headers.authorization ? "bearer" : req.headers["x-api-key"] ? "x-api-key" : "none"}`);
    if (req.method === "GET" && /\/api\/v1\/models(\?|$)/.test(req.url) && !req.url.includes("client_version")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [
        { id: "anthropic/claude-sonnet-4.5", pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" } },
        { id: "openai/gpt-5.1-codex", pricing: { prompt: "0.00000125", completion: "0.00001", input_cache_read: "0.000000125" } },
      ] }));
      return;
    }
    const isModel = req.method === "POST" && /\/(messages|responses)(\?|$)/.test(req.url);
    const wait = isModel && modelCalls++ > 0 ? delayMs : 0;
    setTimeout(() => {
      if (req.method === "POST" && /\/messages(\?|$)/.test(req.url)) return anthropic(body, res);
      if (req.method === "POST" && /\/responses(\?|$)/.test(req.url)) return openaiResponses(body, res);
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock: not found" } }));
    }, wait);
  });
}).listen(port, "0.0.0.0", () => log(`mock listening on ${port}`));
