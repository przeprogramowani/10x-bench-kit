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

export interface JudgeCallMeta {
  /** Powód zakończenia generacji wg providera (np. "length" = ucięło na limicie). */
  finish_reason: string | null;
  /** Tokeny wywołania sędziego; cost_usd tylko, gdy provider go raportuje. */
  usage: { input_tokens: number; output_tokens: number; cost_usd: number | null } | null;
}

export interface JudgeVerdict extends JudgeCallMeta {
  /** Wynik składowej judge w [0, 1]; 0 również przy niepoprawnym JSON-ie. */
  score: number;
  /** Skąd total: policzony przez runner z wag czy podany przez model. */
  total_source: "runner" | "model";
  /** Surowa odpowiedź modelu (audyt — ląduje w judge.json obok result.json). */
  raw: string;
  /** Sparsowany werdykt, jeśli JSON był poprawny. */
  parsed: unknown | null;
  invalid_reason?: string;
  /**
   * Pierwsze podejście, gdy werdykt pochodzi z retry po niepoprawnym
   * JSON-ie — audyt nie cierpi, obie odpowiedzi zostają w judge.json.
   */
  first_attempt?: { raw: string; invalid_reason?: string } & JudgeCallMeta;
}

export interface JudgeOptions {
  /**
   * Budżet tokenów odpowiedzi sędziego. U modeli z rozumowaniem reasoning
   * liczy się do tego budżetu, więc default jest wyraźnie wyżej niż treść
   * werdyktu — ucięty JSON to 0 z winy narzędzia, nie modelu.
   */
  maxTokens?: number;
}

export const JUDGE_MAX_TOKENS_DEFAULT = 8192;

export interface ParsedRubric {
  /** Wagi kryteriów z frontmattera; null = rubryka bez frontmattera. */
  weights: Record<string, number> | null;
  /**
   * Wersja rubryki z frontmattera (`version`); null = brak deklaracji
   * (kontrakt legacy — wersję dostarcza judge.rubric_version z configu).
   * Stempel ery jest per rubryka, więc kalibracja jednej rubryki nie
   * unieważnia wyników zadań, które jej nie używają.
   */
  version: string | null;
  /** Treść rubryki bez frontmattera — to widzi sędzia. */
  body: string;
  /** Ustawione, gdy frontmatter istnieje, ale nie daje poprawnych wag. */
  problem?: string;
}

/** Frontmatter YAML (---) na początku pliku rubryki: `weights` jako mapa
 *  kryterium → dodatnia liczba, opcjonalne `version` (string/liczba). */
export function parseRubric(text: string): ParsedRubric {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { weights: null, version: null, body: text };
  const body = text.slice(match[0].length);
  let front: unknown;
  try {
    front = parseYaml(match[1] ?? "");
  } catch (err) {
    return { weights: null, version: null, body, problem: `frontmatter nie parsuje się jako YAML: ${err}` };
  }
  const frontObj = front as Record<string, unknown> | null;
  const rawVersion = frontObj?.["version"];
  const version =
    typeof rawVersion === "string" && rawVersion.length > 0
      ? rawVersion
      : typeof rawVersion === "number"
        ? String(rawVersion)
        : null;
  const weights = frontObj?.["weights"];
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return { weights: null, version, body, problem: "frontmatter bez mapy `weights` (kryterium → waga)" };
  }
  const entries = Object.entries(weights as Record<string, unknown>);
  if (entries.length === 0) return { weights: null, version, body, problem: "`weights` we frontmatterze jest puste" };
  for (const [name, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { weights: null, version, body, problem: `waga "${name}" musi być dodatnią liczbą (jest: ${JSON.stringify(value)})` };
    }
  }
  return { weights: weights as Record<string, number>, version, body };
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

interface RawCall extends JudgeCallMeta {
  text: string;
}

async function callAnthropic(model: string, prompt: string, maxTokens: number): Promise<RawCall> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("sędzia anthropic/* wymaga ANTHROPIC_API_KEY w env");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    finish_reason: data.stop_reason ?? null,
    usage: data.usage
      ? { input_tokens: data.usage.input_tokens ?? 0, output_tokens: data.usage.output_tokens ?? 0, cost_usd: null }
      : null,
  };
}

async function callOpenRouter(model: string, prompt: string, maxTokens: number): Promise<RawCall> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("sędzia openrouter/* wymaga OPENROUTER_API_KEY w env");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      // Reasoning nie wraca w treści (i tak parsujemy tylko JSON),
      // a usage.cost daje koszt sędziego do raportu.
      reasoning: { exclude: true },
      usage: { include: true },
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  return {
    text: data.choices[0]?.message.content ?? "",
    finish_reason: data.choices[0]?.finish_reason ?? null,
    usage: data.usage
      ? {
          input_tokens: data.usage.prompt_tokens ?? 0,
          output_tokens: data.usage.completion_tokens ?? 0,
          cost_usd: typeof data.usage.cost === "number" ? data.usage.cost : null,
        }
      : null,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Total z wag frontmattera i `criteria[*].score` — bez arytmetyki modelu. */
function computeWeightedTotal(parsed: unknown, weights: Record<string, number>, raw: string): ParsedVerdict {
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

type ParsedVerdict = Omit<JudgeVerdict, keyof JudgeCallMeta>;

/** Wyciąga JSON z odpowiedzi (goły lub w płocie ```json) i liczy score. */
export function parseVerdict(raw: string, weights: Record<string, number> | null): ParsedVerdict {
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

export async function judgeTrial(
  judgeModel: string,
  taskPrompt: string,
  patchDiff: string,
  rubric: string,
  options: JudgeOptions = {},
): Promise<JudgeVerdict> {
  const slash = judgeModel.indexOf("/");
  if (slash === -1) throw new Error(`model sędziego "${judgeModel}" musi mieć format <provider>/<model>`);
  const provider = judgeModel.slice(0, slash);
  const model = judgeModel.slice(slash + 1);
  const maxTokens = options.maxTokens ?? JUDGE_MAX_TOKENS_DEFAULT;
  const { weights, body, problem } = parseRubric(rubric);
  if (problem) throw new Error(`rubryka: ${problem}`);
  const prompt = buildJudgePrompt(taskPrompt, patchDiff, body);

  const call = async (): Promise<RawCall> => {
    if (provider === "anthropic") return callAnthropic(model, prompt, maxTokens);
    if (provider === "openrouter") return callOpenRouter(model, prompt, maxTokens);
    throw new Error(`nieobsługiwany provider sędziego: ${provider} (obsługiwane: anthropic, openrouter)`);
  };

  const first = await call();
  const firstVerdict = parseVerdict(first.text, weights);
  if (!firstVerdict.invalid_reason) {
    return { ...firstVerdict, finish_reason: first.finish_reason, usage: first.usage };
  }

  // Retry 1× przy niepoprawnym JSON-ie: zerowanie werdyktu za jednorazowy
  // poślizg formatu (albo ucięcie na limicie) karałoby model za narzędzie.
  const second = await call();
  const secondVerdict = parseVerdict(second.text, weights);
  return {
    ...secondVerdict,
    finish_reason: second.finish_reason,
    usage: second.usage,
    first_attempt: {
      raw: first.text,
      ...(firstVerdict.invalid_reason ? { invalid_reason: firstVerdict.invalid_reason } : {}),
      finish_reason: first.finish_reason,
      usage: first.usage,
    },
  };
}
