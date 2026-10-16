/**
 * Harness próby — CLI agenta, który wykonuje zadanie w kontenerze.
 *
 * Identyfikator modelu w configu i w `--models` niesie harness jako
 * prefiks: `<harness>:<model>`. Brak prefiksu = OpenCode (zachowanie
 * sprzed wprowadzenia harnessów — istniejące wyniki i katalogi prób nie
 * zmieniają nazw). Harness jest częścią tożsamości zawodnika: ten sam
 * model w innym CLI to inny wiersz wyników, bo mierzymy parę
 * (model × narzędzie), nie sam model.
 *
 *   openrouter/anthropic/claude-sonnet-5          → OpenCode (jak dotąd)
 *   claude-code:claude-sonnet-5                   → Claude Code, ANTHROPIC_API_KEY
 *   claude-code:openrouter/anthropic/claude-sonnet-5 → Claude Code przez OpenRouter
 *   codex:gpt-5.1-codex                           → Codex CLI, OPENAI_API_KEY
 *   codex:openrouter/openai/gpt-5.1-codex         → Codex CLI przez OpenRouter
 *
 * Segment `openrouter/` po prefiksie harnessu znaczy routing przez
 * OpenRouter (jeden klucz OPENROUTER_API_KEY dla całej macierzy — ta sama
 * konwencja, której OpenCode używa natywnie); bez niego harness rozmawia
 * z własnym dostawcą.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HARNESSES = ["opencode", "claude-code", "codex"] as const;
export type HarnessName = (typeof HARNESSES)[number];

export interface HarnessModel {
  /** Identyfikator jak w configu / attempt.json (z prefiksem harnessu). */
  id: string;
  harness: HarnessName;
  /** native = własny dostawca harnessu; openrouter = przez OpenRouter. */
  route: "native" | "openrouter";
  /** Nazwa modelu przekazywana do CLI (dla OpenCode: pełny provider/model). */
  cliModel: string;
}

const PREFIX = /^(opencode|claude-code|codex):(.+)$/;

export function parseModelId(id: string): HarnessModel {
  const match = id.match(PREFIX);
  const harness = (match?.[1] ?? "opencode") as HarnessName;
  const rest = match ? (match[2] as string) : id;
  if (harness === "opencode") {
    return { id, harness, route: rest.startsWith("openrouter/") ? "openrouter" : "native", cliModel: rest };
  }
  if (rest.startsWith("openrouter/")) {
    const cliModel = rest.slice("openrouter/".length);
    if (!cliModel) throw new Error(`model "${id}": po "openrouter/" brakuje nazwy modelu`);
    return { id, harness, route: "openrouter", cliModel };
  }
  return { id, harness, route: "native", cliModel: rest };
}

/**
 * Klucze API, z których KTÓRYKOLWIEK wystarcza do próby tego modelu
 * (null = nieznany dostawca OpenCode — nie da się orzec). Codex czyta
 * CODEX_API_KEY; trial.sh mapuje na niego OPENAI_API_KEY.
 */
export function requiredKeysFor(id: string): string[] | null {
  const { harness, route, cliModel } = parseModelId(id);
  if (route === "openrouter") return ["OPENROUTER_API_KEY"];
  if (harness === "claude-code") return ["ANTHROPIC_API_KEY"];
  if (harness === "codex") return ["OPENAI_API_KEY", "CODEX_API_KEY"];
  const provider = cliModel.split("/")[0];
  if (provider === "anthropic") return ["ANTHROPIC_API_KEY"];
  if (provider === "openai") return ["OPENAI_API_KEY"];
  return null;
}

/**
 * Prefiks przypominający harness, którego nie znamy (`claude:…`,
 * `cc:…`) — bez tej kontroli id poszłoby do OpenCode jako nazwa modelu
 * i wróciło jako niezrozumiały błąd próby. Dwukropek PO ukośniku
 * (`openrouter/qwen/qwen3-coder:free`) to część nazwy modelu, nie prefiks.
 */
export function unknownHarnessPrefix(id: string): string | null {
  const match = id.match(/^([^/:]+):/);
  if (!match) return null;
  return (HARNESSES as readonly string[]).includes(match[1] as string) ? null : (match[1] as string);
}

/** Pin wersji CLI harnessu (`.bench-kit/docker/<harness>.version`). */
export function harnessVersion(root: string, harness: HarnessName): string {
  return readFileSync(join(root, ".bench-kit", "docker", `${harness}.version`), "utf8").trim();
}
