/**
 * LLM-as-judge — wywołanie modelu sędziego (host-side, poza kontenerem).
 *
 * Sędzia dostaje prompt.md + patch.diff + rubrykę i ma zwrócić JSON
 * w formacie zdefiniowanym w rubryce. Odpowiedź bez poprawnego JSON-a = 0
 * dla składowej judge (twarda zasada — sędzia ma zwracać strukturę,
 * nie prozę).
 *
 * Rubryka może deklarować wagi kryteriów we frontmatterze YAML
 * (`weights: { <kryterium>: <waga> }`) — wtedy total liczy runner
 * z `criteria[*].score`, a arytmetyka modelu jest poza pętlą oceny.
 * Rubryka bez frontmattera = stary kontrakt: model zwraca `total` sam.
 *
 * Providery: `anthropic/<model>` (ANTHROPIC_API_KEY),
 * `openrouter/<model>` (OPENROUTER_API_KEY). Format id jak w OpenCode.
 */
import { parse as parseYaml } from "yaml";

export interface JudgeVerdict {
  /** Wynik składowej judge w [0, 1]; 0 również przy niepoprawnym JSON-ie. */
  score: number;
  /** Skąd total: policzony przez runner z wag czy podany przez model. */
  total_source: "runner" | "model";
  /** Surowa odpowiedź modelu (audyt — ląduje w judge.json obok result.json). */
  raw: string;
  /** Sparsowany werdykt, jeśli JSON był poprawny. */
  parsed: unknown | null;
  invalid_reason?: string;
}

export interface ParsedRubric {
  /** Wagi kryteriów z frontmattera; null = rubryka bez frontmattera. */
  weights: Record<string, number> | null;
  /** Treść rubryki bez frontmattera — to widzi sędzia. */
  body: string;
  /** Ustawione, gdy frontmatter istnieje, ale nie daje poprawnych wag. */
  problem?: string;
}

/** Frontmatter YAML (---) na początku pliku rubryki; wymaga `weights`
 *  jako mapy kryterium → dodatnia liczba. */
export function parseRubric(text: string): ParsedRubric {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { weights: null, body: text };
  const body = text.slice(match[0].length);
  let front: unknown;
  try {
    front = parseYaml(match[1] ?? "");
  } catch (err) {
    return { weights: null, body, problem: `frontmatter nie parsuje się jako YAML: ${err}` };
  }
  const weights = (front as Record<string, unknown> | null)?.["weights"];
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return { weights: null, body, problem: "frontmatter bez mapy `weights` (kryterium → waga)" };
  }
  const entries = Object.entries(weights as Record<string, unknown>);
  if (entries.length === 0) return { weights: null, body, problem: "`weights` we frontmatterze jest puste" };
  for (const [name, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { weights: null, body, problem: `waga "${name}" musi być dodatnią liczbą (jest: ${JSON.stringify(value)})` };
    }
  }
  return { weights: weights as Record<string, number>, body };
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Total z wag frontmattera i `criteria[*].score` — bez arytmetyki modelu. */
function computeWeightedTotal(parsed: unknown, weights: Record<string, number>, raw: string): JudgeVerdict {
  const criteria = (parsed as Record<string, unknown>)?.["criteria"];
  if (!criteria || typeof criteria !== "object") {
    return { score: 0, total_source: "runner", raw, parsed, invalid_reason: "JSON bez obiektu criteria" };
  }
  let weighted = 0;
  let weightSum = 0;
  const missing: string[] = [];
  for (const [name, weight] of Object.entries(weights)) {
    const score = ((criteria as Record<string, unknown>)[name] as Record<string, unknown> | undefined)?.["score"];
    if (typeof score !== "number" || Number.isNaN(score)) {
      missing.push(name);
      continue;
    }
    weighted += weight * clamp01(score);
    weightSum += weight;
  }
  if (missing.length > 0) {
    return { score: 0, total_source: "runner", raw, parsed, invalid_reason: `criteria bez liczbowego score: ${missing.join(", ")}` };
  }
  return { score: clamp01(weighted / weightSum), total_source: "runner", raw, parsed };
}

/** Wyciąga JSON z odpowiedzi (goły lub w płocie ```json) i liczy score. */
export function parseVerdict(raw: string, weights: Record<string, number> | null): JudgeVerdict {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const totalSource = weights ? "runner" : "model";
  if (start === -1 || end <= start) {
    return { score: 0, total_source: totalSource, raw, parsed: null, invalid_reason: "brak JSON-a w odpowiedzi" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    return { score: 0, total_source: totalSource, raw, parsed: null, invalid_reason: `JSON nie parsuje się: ${err}` };
  }
  if (weights) return computeWeightedTotal(parsed, weights, raw);
  const total = (parsed as Record<string, unknown>)?.["total"];
  if (typeof total !== "number" || Number.isNaN(total)) {
    return { score: 0, total_source: "model", raw, parsed, invalid_reason: "JSON bez liczbowego pola total" };
  }
  return { score: clamp01(total), total_source: "model", raw, parsed };
}

export async function judgeTrial(judgeModel: string, taskPrompt: string, patchDiff: string, rubric: string): Promise<JudgeVerdict> {
  const slash = judgeModel.indexOf("/");
  if (slash === -1) throw new Error(`model sędziego "${judgeModel}" musi mieć format <provider>/<model>`);
  const provider = judgeModel.slice(0, slash);
  const model = judgeModel.slice(slash + 1);
  const { weights, body, problem } = parseRubric(rubric);
  if (problem) throw new Error(`rubryka: ${problem}`);
  const prompt = buildJudgePrompt(taskPrompt, patchDiff, body);
  let raw: string;
  if (provider === "anthropic") raw = await callAnthropic(model, prompt);
  else if (provider === "openrouter") raw = await callOpenRouter(model, prompt);
  else throw new Error(`nieobsługiwany provider sędziego: ${provider} (obsługiwane: anthropic, openrouter)`);
  return parseVerdict(raw, weights);
}
