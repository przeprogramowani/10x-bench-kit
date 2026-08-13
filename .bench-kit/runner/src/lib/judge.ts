/**
 * LLM-as-judge — wywołanie modelu sędziego (host-side, poza kontenerem).
 *
 * Sędzia dostaje prompt.md + patch.diff + rubrykę i ma zwrócić JSON
 * w formacie zdefiniowanym w rubryce ({ criteria, total }). Odpowiedź
 * bez poprawnego JSON-a = 0 dla składowej judge (twarda zasada — sędzia
 * ma zwracać strukturę, nie prozę).
 *
 * Providery: `anthropic/<model>` (ANTHROPIC_API_KEY),
 * `openrouter/<model>` (OPENROUTER_API_KEY). Format id jak w OpenCode.
 */

export interface JudgeVerdict {
  /** Wynik składowej judge w [0, 1]; 0 również przy niepoprawnym JSON-ie. */
  score: number;
  /** Surowa odpowiedź modelu (audyt — ląduje w judge.json obok result.json). */
  raw: string;
  /** Sparsowany werdykt, jeśli JSON był poprawny. */
  parsed: unknown | null;
  invalid_reason?: string;
}

export function buildJudgePrompt(taskPrompt: string, patchDiff: string, rubric: string): string {
  return [
    "Jesteś sędzią benchmarku agentów AI. Oceń poniższy diff wykonany przez",
    "agenta względem treści zadania, ściśle według rubryki. Odpowiedz",
    "WYŁĄCZNIE JSON-em w formacie wymaganym przez rubrykę — bez markdownu,",
    "bez komentarza, bez niczego poza JSON-em.",
    "",
    "## Rubryka",
    rubric,
    "",
    "## Zadanie (prompt.md — jedyne wejście, które widział agent)",
    taskPrompt,
    "",
    "## Diff (patch.diff — workspace vs punkt startowy)",
    "```diff",
    patchDiff || "(pusty diff — agent nie zmienił niczego)",
    "```",
  ].join("\n");
}

async function callAnthropic(model: string, prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("sędzia anthropic/* wymaga ANTHROPIC_API_KEY w env");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = (await response.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

async function callOpenRouter(model: string, prompt: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("sędzia openrouter/* wymaga OPENROUTER_API_KEY w env");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`OpenRouter API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? "";
}

/** Wyciąga JSON z odpowiedzi (goły lub w płocie ```json) i liczy score. */
function parseVerdict(raw: string): JudgeVerdict {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { score: 0, raw, parsed: null, invalid_reason: "brak JSON-a w odpowiedzi" };
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    const total = (parsed as Record<string, unknown>)?.["total"];
    if (typeof total !== "number" || Number.isNaN(total)) {
      return { score: 0, raw, parsed, invalid_reason: "JSON bez liczbowego pola total" };
    }
    return { score: Math.min(1, Math.max(0, total)), raw, parsed };
  } catch (err) {
    return { score: 0, raw, parsed: null, invalid_reason: `JSON nie parsuje się: ${err}` };
  }
}

export async function judgeTrial(judgeModel: string, taskPrompt: string, patchDiff: string, rubric: string): Promise<JudgeVerdict> {
  const slash = judgeModel.indexOf("/");
  if (slash === -1) throw new Error(`model sędziego "${judgeModel}" musi mieć format <provider>/<model>`);
  const provider = judgeModel.slice(0, slash);
  const model = judgeModel.slice(slash + 1);
  const prompt = buildJudgePrompt(taskPrompt, patchDiff, rubric);
  let raw: string;
  if (provider === "anthropic") raw = await callAnthropic(model, prompt);
  else if (provider === "openrouter") raw = await callOpenRouter(model, prompt);
  else throw new Error(`nieobsługiwany provider sędziego: ${provider} (obsługiwane: anthropic, openrouter)`);
  return parseVerdict(raw);
}
