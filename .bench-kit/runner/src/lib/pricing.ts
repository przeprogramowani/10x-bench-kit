/**
 * Wycena próby z tokenów — dla harnessów, których własny koszt nie jest
 * wiarygodny albo go nie ma. Koszt to wejście budżetu biegu
 * (defaults.max_cost_usd) i ekonomii bench-decide, więc nigdy nie jest
 * zgadywany: każda wycena zapisuje w metrics.json źródło i stawki.
 *
 * Polityka per harness (costPolicy):
 *   opencode                → koszt z harnessu (opencode.db), bez zmian
 *   claude-code, native     → koszt z harnessu (cennik Claude Code dla
 *                             modeli pierwszej strony); wycena tylko gdy
 *                             go brak (timeout — tokeny z transkryptu)
 *   claude-code, openrouter → wycena zawsze: Claude Code wycenia slugi
 *                             OpenRouter własną tabelą przez zgadywanie
 *                             nazwy (sprawdzone: anthropic/claude-sonnet-4.5
 *                             liczony jako claude-sonnet-4-0)
 *   codex                   → wycena zawsze: Codex nie raportuje USD
 *
 * Źródła ceny (resolvePrice), w kolejności:
 *   1. bench.config.yaml → pricing["<id modelu>"] (USD / 1M tokenów),
 *   2. publiczny katalog OpenRouter (/api/v1/models, bez klucza) — dla
 *      routingu przez OpenRouter slug modelu; dla native: odpowiednik
 *      w katalogu (`anthropic/…`, `openai/…`) jako cena katalogowa.
 * Stawki katalogu są cenami listowymi; progi długiego kontekstu
 * (overrides) nie są stosowane — wycena z sum tokenów to estymata.
 */
import type { BenchConfig } from "../schemas/config.ts";
import { parseModelId, type HarnessModel } from "./harness.ts";

/** Stawki w USD za 1M tokenów. */
export interface Price {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ResolvedPrice extends Price {
  /** "config" albo "openrouter:<slug>". */
  source: string;
}

export type CostPolicy = "harness" | "harness-or-priced" | "priced";

export function costPolicy(spec: HarnessModel): CostPolicy {
  if (spec.harness === "opencode") return "harness";
  if (spec.harness === "claude-code" && spec.route === "native") return "harness-or-priced";
  return "priced";
}

/**
 * Slug katalogu OpenRouter odpowiadający modelowi. Dla native Claude:
 * `claude-sonnet-4-5[-20250929]` → `anthropic/claude-sonnet-4.5`
 * (wersja z myślnikiem → z kropką, sufiks daty odcięty); aliasy
 * (`sonnet`, `opus`) nie mają odpowiednika — wtedy null.
 */
export function catalogSlugFor(spec: HarnessModel): string | null {
  // OpenCode niesie pełne provider/model (`openrouter/x/y`, `anthropic/…`) —
  // wyceny potrzebuje tylko szacunek projekcji (koszt próby daje harness).
  if (spec.harness === "opencode") {
    if (spec.route === "openrouter") return spec.cliModel.slice("openrouter/".length);
    return spec.cliModel.includes("/") ? spec.cliModel : null;
  }
  if (spec.route === "openrouter") return spec.cliModel;
  if (spec.harness === "codex") return `openai/${spec.cliModel}`;
  if (spec.harness === "claude-code") {
    if (!spec.cliModel.startsWith("claude-")) return null;
    // Ta sama normalizacja co underlyingModel: wersja z myślnikami → kropki
    // także w środku nazwy (claude-3-5-sonnet → claude-3.5-sonnet).
    const base = spec.cliModel.replace(/-\d{8}$/, "").replace(/(\d)-(\d)/g, "$1.$2");
    return `anthropic/${base}`;
  }
  return null;
}

export type Catalog = Map<string, Price>;

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

type CatalogModel = { id: string; pricing?: Record<string, string> };

/** Surowa lista modeli publicznego katalogu OpenRouter (/api/v1/models, bez klucza). */
async function fetchOpenRouterModels(): Promise<CatalogModel[]> {
  const url = process.env.BENCH_PRICING_CATALOG_URL || CATALOG_URL;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`katalog cen ${url}: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: CatalogModel[] };
  return body.data ?? [];
}

/** Id wszystkich modeli katalogu OpenRouter (także bez cennika) — do walidacji id. */
export async function fetchOpenRouterModelIds(): Promise<Set<string>> {
  return new Set((await fetchOpenRouterModels()).map((m) => m.id));
}

/**
 * Id w katalogu OpenRouter dla modelu routowanego przez OpenRouter
 * (`openrouter/x/y`, `claude-code:openrouter/x/y`, `codex:openrouter/x/y`
 * → `x/y`); null dla pozostałych (native — nie nasz katalog).
 */
export function openRouterCatalogId(id: string): string | null {
  let spec: HarnessModel;
  try {
    spec = parseModelId(id);
  } catch {
    return null; // zły format id zgłasza validate osobno
  }
  if (spec.route !== "openrouter") return null;
  return spec.harness === "opencode" ? spec.cliModel.slice("openrouter/".length) : spec.cliModel;
}

/** Katalog cen OpenRouter (stawki per token → per 1M tokenów). */
export async function fetchOpenRouterCatalog(): Promise<Catalog> {
  const body = { data: await fetchOpenRouterModels() };
  const perMtok = (value: string | undefined) => {
    const n = Number(value);
    return value !== undefined && Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
  };
  const catalog: Catalog = new Map();
  for (const model of body.data ?? []) {
    const input = perMtok(model.pricing?.prompt);
    const output = perMtok(model.pricing?.completion);
    if (input === undefined || output === undefined) continue;
    catalog.set(model.id, {
      input,
      output,
      cache_read: perMtok(model.pricing?.input_cache_read),
      cache_write: perMtok(model.pricing?.input_cache_write),
    });
  }
  return catalog;
}

export function resolvePrice(spec: HarnessModel, config: BenchConfig, catalog: Catalog | null): ResolvedPrice | null {
  const configured = config.pricing?.[spec.id];
  if (configured) return { ...configured, source: "config" };
  const slug = catalogSlugFor(spec);
  const listed = slug && catalog ? catalog.get(slug) : undefined;
  return listed ? { ...listed, source: `openrouter:${slug}` } : null;
}

export interface Tokens {
  input: number | null;
  output: number | null;
  cache_read?: number;
  cache_write?: number;
}

/** Koszt z tokenów kontraktu metrics.json (input = bez cache). */
export function priceTokens(tokens: Tokens, price: Price): number {
  const input = (tokens.input ?? 0) * price.input;
  const output = (tokens.output ?? 0) * price.output;
  const cacheRead = (tokens.cache_read ?? 0) * (price.cache_read ?? price.input);
  const cacheWrite = (tokens.cache_write ?? 0) * (price.cache_write ?? price.input);
  return (input + output + cacheRead + cacheWrite) / 1_000_000;
}

/**
 * Domyka koszt w metrics.json próby wg polityki harnessu. Zwraca opis
 * tego, co zrobiono (do logu runnera), albo null, gdy nic do zrobienia.
 */
export function finalizeCost(metrics: Record<string, unknown>, spec: HarnessModel, price: ResolvedPrice | null): string | null {
  const policy = costPolicy(spec);
  if (policy === "harness") return null;
  if (policy === "harness-or-priced" && metrics.cost_source === "harness" && typeof metrics.cost_usd === "number") return null;
  const tokens = (metrics.tokens ?? {}) as Tokens;
  if (tokens.input === null || tokens.input === undefined || tokens.output === null || tokens.output === undefined) {
    return null; // adapter nie odtworzył tokenów — incomplete już opisane
  }
  if (!price) {
    metrics.cost_usd = null;
    metrics.cost_source = null;
    metrics.incomplete = true;
    metrics.incomplete_reason = [metrics.incomplete_reason, "brak ceny modelu (pricing w bench.config.yaml / katalog OpenRouter)"]
      .filter(Boolean)
      .join("; ");
    return "koszt nieznany — brak ceny modelu";
  }
  const cost = priceTokens(tokens, price);
  metrics.cost_usd = cost;
  metrics.cost_source = price.source;
  metrics.pricing_usd_per_mtok = {
    input: price.input,
    output: price.output,
    cache_read: price.cache_read ?? null,
    cache_write: price.cache_write ?? null,
  };
  return `koszt $${cost.toFixed(4)} wyceniony z tokenów (${price.source})`;
}
