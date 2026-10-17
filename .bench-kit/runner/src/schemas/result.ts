import { z } from "zod";

/**
 * Schemat result.json — artefakt pojedynczej próby.
 *
 * Wyniki porównują się wyłącznie w obrębie ery: krotka `stamps` musi być
 * identyczna. Erę zamyka release template'u oznaczony scoring-breaking,
 * zmiana modelu sędziego lub rubryk albo zmiana definicji zadania.
 */

/** Składowe oceny w [0, 1]; null = składowa nie brana pod uwagę (waga 0). */
export const Scores = z.object({
  static: z.number().min(0).max(1).nullable(),
  tests: z.number().min(0).max(1).nullable(),
  e2e: z.number().min(0).max(1).nullable(),
  judge: z.number().min(0).max(1).nullable(),
});

/** Stemple wersji wyznaczające erę porównywalności. */
export const EraStamps = z.object({
  /** Wersja template'u (kit i struktura to jeden byt — jeden tag). */
  template_version: z.string().min(1),
  /**
   * Wersja scoringu (.bench-kit/SCORING_VERSION) — podbijana WYŁĄCZNIE
   * przy release'ach oznaczonych scoring-breaking, więc neutralne
   * release'y template'u nie rozdzielają er. Klucz ery używa tego pola;
   * template_version zostaje w stemplach jako informacja. Optional dla
   * zgodności z wynikami sprzed wprowadzenia (tam klucz ery spada na
   * template_version — historyczne ery się nie przetasowują).
   */
  scoring_version: z.string().min(1).optional(),
  /** Hash katalogu zadania (prompt.md + task.yaml + overlay/). */
  task_hash: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hex"),
  judge_model: z.string().min(1),
  /**
   * Ścieżka oceny składowej judge: "api" (sędzia API na diffie), "agent"
   * (sędzia z narzędziami, werdykt z pliku), "human", "none" (zadanie bez
   * sędziego). Część klucza ery. Brak pola = wynik sprzed wprowadzenia.
   */
  judge_mode: z.enum(["api", "agent", "human", "none"]).optional(),
  /**
   * Próg sędziego obowiązujący przy wyliczeniu `passed` — część ery:
   * zmiana defaults.pass_threshold zmienia, co znaczy "zaliczone".
   * Brak pola = wynik sprzed bramki.
   */
  pass_threshold: z.number().min(0).max(1).optional(),
  /** Polityka plików instrukcji w próbie (z attempt.json) — informacyjnie. */
  context_files: z.enum(["unified", "native"]).nullable().optional(),
  /**
   * Wersje rubryk użytych przez zadanie: `<rubryka>@<wersja>` (sortowane,
   * łączone "+"), "none" dla zadań bez składowej judge — kalibracja
   * rubryki otwiera nową erę tylko zadaniom, które jej używają.
   * Wyniki legacy mają tu globalne judge.rubric_version z configu.
   */
  rubric_version: z.string().min(1),
  /**
   * Limit pamięci kontenera próby (MiB) obowiązujący w trakcie wykonania —
   * pułap zasobów wpływa na to, co model zdąży zrobić, więc jego zmiana
   * zmienia miarę (OOM.md, warstwa 2). null = bez jawnego limitu (sufit
   * = pamięć maszyny silnika, niestemplowalna); brak pola = wynik sprzed
   * wprowadzenia.
   */
  memory_limit_mb: z.number().int().positive().nullable().optional(),
});

export const ResultSchema = z.object({
  task: z.string().min(1),
  /** Identyfikator ocenianego modelu (jak podany do opencode). */
  model: z.string().min(1),
  /** Numer próby, licząc od 1. */
  trial: z.number().int().positive(),
  scores: Scores,
  /** Ważona suma scores wg wag z task.yaml — miara jakości, nie zaliczenie. */
  total: z.number().min(0).max(1),
  /**
   * Zaliczenie jako BRAMKA (scoring 3+): każdy guard z wagą > 0 = 1 ORAZ
   * judge ≥ defaults.pass_threshold. Brak pola = wynik sprzed bramki
   * (konsumenci liczą wtedy legacy: total ≥ pass_threshold).
   */
  passed: z.boolean().optional(),
  /** Uzasadnienie werdyktu bramki (czerwone guardy / judge poniżej progu). */
  pass_reason: z.string().optional(),
  cost_usd: z.number().min(0),
  /**
   * Skąd koszt: "harness" / "config" / "openrouter:<slug>" (wycena runnera);
   * null = koszt NIEZNANY (cost_usd = 0 tylko z kontraktu). Brak pola =
   * wynik sprzed wprowadzenia (koszt z harnessu).
   */
  cost_source: z.string().nullable().optional(),
  /**
   * Koszt wywołań sędziego dla tej próby — osobno od cost_usd (kosztu
   * modelu ocenianego), żeby nie zakłamywać kosztu na leaderboardzie.
   * null = provider sędziego nie raportuje kosztu; brak pola = wynik
   * sprzed wprowadzenia (albo próba bez składowej judge).
   */
  judge_cost_usd: z.number().min(0).nullable().optional(),
  duration_s: z.number().min(0),
  tokens: z.object({
    input: z.number().int().min(0),
    output: z.number().int().min(0),
  }),
  stamps: EraStamps,
});

export type Result = z.infer<typeof ResultSchema>;
