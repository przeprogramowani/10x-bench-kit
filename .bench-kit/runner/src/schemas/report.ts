import { z } from "zod";
import { EraStamps } from "./result.ts";

/**
 * Schemat report.json — wyjście `bench report`, wejście `bench leaderboard`.
 *
 * Jeden plik = jeden run benchmarku. Leaderboard skleja wiele raportów
 * w historię, nigdy nie mieszając er (identyczna krotka stamps).
 */

export const ReportRowSchema = z.object({
  model: z.string().min(1),
  task: z.string().min(1),
  trials: z.number().int().positive(),
  median_total: z.number().min(0).max(1),
  median_cost_usd: z.number().min(0),
  median_duration_s: z.number().min(0),
  passed: z.number().int().min(0),
  pass_at_1: z.number().min(0).max(1),
  pass_at_k: z.number().min(0).max(1),
});

export const ReportSchema = z.object({
  generated_at: z.string().min(1),
  run_dir: z.string(),
  pass_threshold: z.number().min(0).max(1),
  cost_scope: z.string(),
  total_cost_usd: z.number().min(0),
  trials: z.number().int().positive(),
  eras: z.array(
    z.object({
      stamps: EraStamps,
      rows: z.array(ReportRowSchema),
    }),
  ),
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportRow = z.infer<typeof ReportRowSchema>;
