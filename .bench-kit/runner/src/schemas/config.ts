import { z } from "zod";

/**
 * Schemat bench.config.yaml — konfiguracja instancji benchmarku
 * (strefa firmy; nietykalna przy update).
 */

/** Repo bazowe — projekt produktowy; benchmark nigdy go nie modyfikuje. */
export const BaseRepo = z.object({
  /** Identyfikator używany w task.yaml (pole `repo`). */
  name: z.string().min(1),
  /** URL do klonowania — https; repo prywatne przez sekret BASE_REPO_TOKEN (contents:read), wpinany w CI przez url.insteadOf. */
  url: z.string().min(1),
});

/** Model sędziego — stały i mocny, inny niż modele oceniane. */
export const JudgeConfig = z.object({
  model: z.string().min(1),
  /**
   * Budżet tokenów odpowiedzi sędziego. U modeli z rozumowaniem reasoning
   * liczy się do budżetu, więc default jest z zapasem — za niski limit
   * ucina JSON werdyktu i zeruje składową judge z winy narzędzia.
   */
  max_tokens: z.number().int().positive().default(8192),
  /**
   * Ścieżka oceny instancji — część bieżącej ery: "agent" (sędzia
   * z narzędziami, werdykty przez bench-evaluate → RATE_ATTEMPT.md) albo
   * "api" (sędzia API na diffie). Wyniki ocenione inną ścieżką `bench
   * status` pokazuje jako nieświeże, z powodem; bench-analysis nie miesza
   * ich z bieżącymi. Smoke/CI może oceniać API — to jawnie inna era.
   */
  mode: z.enum(["agent", "api"]).default("agent"),
  /**
   * Fallback dla rubryk bez `version` we frontmatterze (kontrakt legacy).
   * Docelowo wersję deklaruje każda rubryka u siebie — stempel ery jest
   * per rubryka, więc kalibracja jednej nie unieważnia wyników zadań,
   * które jej nie używają.
   */
  rubric_version: z.string().min(1).optional(),
});

export const BenchConfigSchema = z.object({
  /** Repozytoria bazowe dostępne dla zadań. */
  base_repos: z.array(BaseRepo).min(1),
  /** Konfiguracja LLM-as-judge. */
  judge: JudgeConfig,
  /** Defaults biegu macierzy — nadpisywalne flagami `bench attempt`. */
  defaults: z.object({
    /** Liczba prób na (model × zadanie). */
    trials: z.number().int().positive().default(3),
    /**
     * Modele oceniane, gdy wywołanie nie poda własnej listy. Id niesie
     * harness jako prefiks (`claude-code:…`, `codex:…`; bez prefiksu =
     * OpenCode) — lib/harness.ts.
     */
    models: z.array(z.string().min(1)).min(1),
    /** Timeout próby, gdy task.yaml nie nadpisze. */
    timeout_s: z.number().int().positive().default(1800),
    /** Próg "pass" dla pass@k: próba zalicza, gdy total >= threshold. */
    pass_threshold: z.number().min(0).max(1).default(0.7),
    /**
     * Sufit kosztu prób CAŁEGO biegu macierzy (USD): `bench attempt`
     * robi projekcję kosztu z historii results/ przed startem i przerywa
     * zlecanie prób po przekroczeniu sumy cost_usd z metrics.json.
     * Zgoda człowieka jest potrzebna przy podnoszeniu budżetu, nie przy
     * każdym uruchomieniu. Brak pola = bez limitu.
     */
    max_cost_usd: z.number().positive().optional(),
    /**
     * Równoczesne próby w obrębie jednego `bench attempt` (pool
     * kontenerów). Próba spędza większość czasu na czekaniu na API
     * modelu, więc równoległość tnie wall-clock niemal liniowo.
     * UWAGA: resources.memory_mb to sufit per kontener, nie rezerwacja —
     * parallel × memory_mb może przekraczać pamięć maszyny; równoczesne
     * piki grożą OOM killerem, dobierz do najcięższego zadania.
     * 1 = zachowanie sekwencyjne (default).
     */
    parallel: z.number().int().positive().default(1),
    /**
     * Pliki instrukcji projektu (AGENTS.md / CLAUDE.md) w workspace'ie
     * próby: "unified" = gdy repo ma tylko jeden z pary, drugi jest
     * dokładany przed commitem startowym, żeby każdy harness czytał te
     * same instrukcje (lib/context-files.ts); "native" = repo bez zmian.
     * Zmienia to, co widzi agent → część definicji pomiaru.
     */
    context_files: z.enum(["unified", "native"]).default("unified"),
  }),
  /**
   * Polityka środowiska oceny (decyzja wiringu instancji).
   * deps_cache: trwały wolumen `bench-deps-cache` z cache'ami menedżerów
   * pakietów, montowany do kontenerów asercji — przyspiesza każde
   * `assert` / `validate --assert` / `evaluate` bez zmiany kontraktu
   * asercji. Wyłącz, gdy instancja wymaga w pełni hermetycznych ocen.
   */
  evaluation: z
    .object({
      deps_cache: z.boolean().default(true),
    })
    .default({ deps_cache: true }),
  /**
   * Jawne limity zasobów kontenerów (próby agenta ORAZ oceny) — OOM.md,
   * warstwa 2. Bez limitu kontener bierze tyle, ile ma maszyna silnika,
   * a przy braku OOM killer jądra zabija proces bez śladu w metadanych;
   * z limitem sufit jest częścią definicji pomiaru (stempel ery
   * memory_limit_mb w result.json) i przerwanie jest atrybuowalne.
   * Dobierz do najcięższej operacji stacku (instalacja + build) z zapasem.
   */
  /**
   * Stawki modeli (USD za 1M tokenów) dla wyceny prób, których harness
   * nie raportuje wiarygodnego kosztu (Codex zawsze; Claude Code przez
   * OpenRouter; Claude Code po timeoucie) — lib/pricing.ts. Klucz = id
   * modelu jak w defaults.models (z prefiksem harnessu). Wpis ma
   * pierwszeństwo przed katalogiem OpenRouter; bez wpisu i bez
   * odpowiednika w katalogu `bench attempt` odmawia startu modelu, który
   * wymaga wyceny — koszt nieznany to budżet, który nie działa.
   */
  pricing: z
    .record(
      z.string().min(1),
      z.object({
        input: z.number().min(0),
        output: z.number().min(0),
        cache_read: z.number().min(0).optional(),
        cache_write: z.number().min(0).optional(),
      }),
    )
    .optional(),
  resources: z
    .object({
      /** Limit pamięci kontenera w MiB (--memory, swap = memory). */
      memory_mb: z.number().int().positive().optional(),
      /** Limit liczby procesów kontenera (--pids-limit). */
      pids_limit: z.number().int().positive().optional(),
    })
    .default({}),
});

export type BenchConfig = z.infer<typeof BenchConfigSchema>;
