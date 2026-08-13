import { z } from "zod";

/**
 * Schemat bench.config.yaml — konfiguracja instancji benchmarku
 * (strefa firmy; nietykalna przy update).
 */

/** Repo bazowe — projekt produktowy; benchmark nigdy go nie modyfikuje. */
export const BaseRepo = z.object({
  /** Identyfikator używany w task.yaml (pole `repo`). */
  name: z.string().min(1),
  /** URL do klonowania (dostęp read-only przez deploy key / token). */
  url: z.string().min(1),
});

/** Model sędziego — stały i mocny, inny niż modele oceniane. */
export const JudgeConfig = z.object({
  model: z.string().min(1),
  /** Wersja rubryk; zmiana = nowa era porównywalności. */
  rubric_version: z.string().min(1),
});

export const BenchConfigSchema = z.object({
  /** Repozytoria bazowe dostępne dla zadań. */
  base_repos: z.array(BaseRepo).min(1),
  /** Konfiguracja LLM-as-judge. */
  judge: JudgeConfig,
  /** Defaults runu — nadpisywalne parametrami workflow_dispatch. */
  defaults: z.object({
    /** Liczba prób na (model × zadanie). */
    trials: z.number().int().positive().default(3),
    /** Modele oceniane, gdy dispatch nie poda własnej listy. */
    models: z.array(z.string().min(1)).min(1),
    /** Timeout próby, gdy task.yaml nie nadpisze. */
    timeout_s: z.number().int().positive().default(1800),
  }),
});

export type BenchConfig = z.infer<typeof BenchConfigSchema>;
