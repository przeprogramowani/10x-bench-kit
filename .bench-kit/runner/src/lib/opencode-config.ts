/**
 * Konfiguracja OpenCode dla próby — deklaracja modeli z bench.config.yaml.
 *
 * OpenCode zna tylko modele ze swojego wbudowanego katalogu. Id spoza
 * niego (nowy model, którego pinowana wersja CLI jeszcze nie widziała)
 * kończy próbę po sekundzie błędem ProviderModelNotFoundError, a model
 * zadeklarowany bez cen daje `cost_usd: 0` przy realnych tokenach —
 * budżet biegu przestaje wtedy cokolwiek widzieć. Runner zna i id, i ceny
 * (pricing w configu albo katalog OpenRouter), więc sam podaje je
 * harnessowi przez OPENCODE_CONFIG_CONTENT.
 *
 * OPENCODE_CONFIG_CONTENT ustawiony przez operatora ZOSTAJE u władzy:
 * deklaracja runnera jest podkładem, a każdy klucz operatora ją
 * nadpisuje (scalanie w głąb). Runner dopisuje więc tylko to, czego
 * operator nie ustawił. Treści operatora, której nie da się sparsować
 * jako JSON, runner nie rusza wcale — idzie do kontenera bez zmian,
 * z ostrzeżeniem, że modeli nie zadeklarowano.
 */
import type { HarnessModel } from "./harness.ts";
import type { Price } from "./pricing.ts";

/** Limity modelu z katalogu OpenRouter (tokeny); brak = OpenCode bierze własne domyślne. */
export interface ModelLimits {
  context?: number;
  output?: number;
}

export interface OpencodeModelDecl {
  spec: HarnessModel;
  price: Price | null;
  limits?: ModelLimits | null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Scalanie w głąb: `over` wygrywa na każdym kluczu; tablice i wartości proste podmieniane w całości. */
export function mergeDeep(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = isObject(current) && isObject(value) ? mergeDeep(current, value) : value;
  }
  return out;
}

/**
 * Deklaracja modeli OpenCode: `provider.<dostawca>.models.<model>` z ceną
 * (USD za 1M tokenów — te same jednostki co pricing w bench.config.yaml)
 * i limitami, gdy są znane. Id OpenCode to `<dostawca>/<model>`, np.
 * `openrouter/anthropic/claude-sonnet-5` → dostawca `openrouter`, model
 * `anthropic/claude-sonnet-5`. Modele innych harnessów są pomijane.
 */
export function opencodeModelsConfig(decls: OpencodeModelDecl[]): Json {
  const providers: Record<string, { models: Record<string, Json> }> = {};
  for (const { spec, price, limits } of decls) {
    if (spec.harness !== "opencode") continue;
    const slash = spec.cliModel.indexOf("/");
    if (slash <= 0 || slash === spec.cliModel.length - 1) continue; // bez dostawcy nie ma gdzie zadeklarować
    const provider = spec.cliModel.slice(0, slash);
    const model = spec.cliModel.slice(slash + 1);
    const decl: Json = { name: model };
    if (price) {
      decl.cost = {
        input: price.input,
        output: price.output,
        ...(price.cache_read !== undefined ? { cache_read: price.cache_read } : {}),
        ...(price.cache_write !== undefined ? { cache_write: price.cache_write } : {}),
      };
    }
    if (limits?.context && limits.context > 0) {
      decl.limit = { context: limits.context, output: limits.output && limits.output > 0 ? limits.output : Math.min(limits.context, 32_000) };
    }
    (providers[provider] ??= { models: {} }).models[model] = decl;
  }
  return Object.keys(providers).length > 0 ? { provider: providers } : {};
}

export interface OpencodeConfigResult {
  /** Wartość OPENCODE_CONFIG_CONTENT dla kontenera próby; null = nie ustawiaj (zostaje env operatora albo nic). */
  content: string | null;
  /** Ostrzeżenie do logu runnera albo null. */
  warning: string | null;
}

/** Treść OPENCODE_CONFIG_CONTENT próby: deklaracja runnera scalona z konfiguracją operatora (operator wygrywa). */
export function opencodeConfigContent(decls: OpencodeModelDecl[], operatorContent: string | undefined): OpencodeConfigResult {
  const declared = opencodeModelsConfig(decls);
  const ours = Object.keys(declared).length > 0;
  if (operatorContent === undefined || operatorContent.trim() === "") {
    return { content: ours ? JSON.stringify(declared) : null, warning: null };
  }
  let operator: unknown;
  try {
    operator = JSON.parse(operatorContent);
  } catch {
    operator = null;
  }
  if (!isObject(operator)) {
    return {
      content: null,
      warning: ours
        ? "OPENCODE_CONFIG_CONTENT z env nie jest obiektem JSON — przekazuję go bez zmian i NIE dopisuję modeli z bench.config.yaml (model spoza katalogu OpenCode skończy próbę błędem, model bez ceny da koszt $0)"
        : null,
    };
  }
  return { content: ours ? JSON.stringify(mergeDeep(declared, operator)) : null, warning: null };
}
