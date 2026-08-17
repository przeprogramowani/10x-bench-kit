import { z } from "zod";

/**
 * Schemat task.yaml — definicja zadania w tasks/<nazwa>/.
 *
 * Katalog zadania: prompt.md (jedyne wejście agenta), task.yaml,
 * opcjonalny overlay/ nakładany na repo bazowe (np. seed buga).
 */

/** Referencja do asercji z evaluation-pool/, np. "tests/checkout-happy-path". */
export const EvaluationRef = z
  .string()
  .regex(
    /^(static|tests|e2e|judge)\/[A-Za-z0-9._-]+$/,
    "asercja musi wskazywać do evaluation-pool: <static|tests|e2e|judge>/<nazwa>",
  );

/** Wagi składowych oceny; wynik próby = ważona suma. Muszą sumować się do 1. */
export const ScoreWeights = z
  .object({
    static: z.number().min(0).max(1).default(0),
    tests: z.number().min(0).max(1).default(0),
    e2e: z.number().min(0).max(1).default(0),
    judge: z.number().min(0).max(1).default(0),
  })
  .refine(
    (w) => Math.abs(w.static + w.tests + w.e2e + w.judge - 1) < 1e-9,
    "wagi muszą sumować się do 1",
  );

export const TaskSchema = z.object({
  /** Identyfikator repo bazowego z bench.config.yaml (base_repos[].name). */
  repo: z.string().min(1),
  /** Pinowany commit repo bazowego (pełny SHA — punkt startowy workspace'u). */
  commit: z.string().regex(/^[0-9a-f]{40}$/, "pełny SHA-1 commita (40 znaków hex)"),
  /** Twardy timeout wykonania agenta w sekundach. */
  timeout_s: z.number().int().positive(),
  /** Dobór asercji z evaluation-pool; montowane dopiero na etapie oceny. */
  evaluation: z.array(EvaluationRef).min(1),
  /** Wagi składowych oceny. */
  weights: ScoreWeights,
  /** Data ważności zadania (starzenie: po niej validate ostrzega o refresh). */
  expires: z.iso.date().optional(),
  /**
   * Opcjonalna komenda przygotowania środowiska (bash), zapiekana w obraz
   * zadania na etapie `prepare` w `bench run` — biegnie RAZ na zadanie,
   * w /workspace, z siecią (etap przygotowania). Płacisz instalację
   * zależności raz na obraz zamiast raz na wywołanie oceny; kontener
   * próby agenta i kontener oceny startują z gotowym środowiskiem.
   * Uwaga autorska: agent też dostaje ten stan — to jawna decyzja
   * projektowa zadania (i zmiana task_hash jak każda zmiana task.yaml).
   */
  prepare: z.string().min(1).optional(),
  /**
   * Nadpisanie limitu pamięci kontenera (MiB) dla tego zadania — dla
   * stacków cięższych niż default instancji (resources.memory_mb
   * w bench.config.yaml). Obowiązuje w próbie i w ocenie; wartość jest
   * stemplem ery (memory_limit_mb w result.json).
   */
  memory_mb: z.number().int().positive().optional(),
  /**
   * Oczekiwane zachowanie asercji nie-LLM-owych na stanie startowym zadania
   * (repo@pin + overlay, pusty diff): "pass" = guard, musi przechodzić już
   * na starcie (np. lint — lekcja z pierwszego runu); "fail" = miara pracy,
   * ma nie przechodzić na starcie (inaczej zadanie przechodzi się pustym
   * diffem). Podstawa weryfikacji `bench validate --assert`.
   */
  reference: z.record(EvaluationRef, z.enum(["pass", "fail"])).optional(),
});

export type Task = z.infer<typeof TaskSchema>;
