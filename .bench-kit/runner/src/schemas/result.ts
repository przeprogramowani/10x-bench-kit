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
   * Wersje rubryk użytych przez zadanie: `<rubryka>@<wersja>` (sortowane,
   * łączone "+"), "none" dla zadań bez składowej judge — kalibracja
   * rubryki otwiera nową erę tylko zadaniom, które jej używają.
   * Wyniki legacy mają tu globalne judge.rubric_version z configu.
   */
  rubric_version: z.string().min(1),
});

export const ResultSchema = z.object({
  task: z.string().min(1),
  /** Identyfikator ocenianego modelu (jak podany do opencode). */
  model: z.string().min(1),
  /** Numer próby, licząc od 1. */
  trial: z.number().int().positive(),
  scores: Scores,
  /** Ważona suma scores wg wag z task.yaml. */
  total: z.number().min(0).max(1),
  cost_usd: z.number().min(0),
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
