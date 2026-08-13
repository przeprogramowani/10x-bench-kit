import { z } from "zod";

/**
 * Schemat check.yaml — kontrakt asercji nie-LLM-owych
 * (evaluation-pool/{static,tests,e2e}/<nazwa>/check.yaml).
 *
 * Komendy uruchamiane są w /workspace (stan po nałożeniu patch.diff);
 * katalog asercji jest dostępny w env ASSERTION_DIR (montowany :ro —
 * stamtąd bierze się np. ukryte pliki testów).
 */
export const CheckFileSchema = z.object({
  /** binary: 1 gdy wszystkie komendy przejdą, inaczej 0.
   *  fraction: frakcja przechodzących komend (np. testy weryfikacyjne). */
  score: z.enum(["binary", "fraction"]).default("binary"),
  checks: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Komenda bash; exit 0 = pass. */
        run: z.string().min(1),
      }),
    )
    .min(1),
});

export type CheckFile = z.infer<typeof CheckFileSchema>;
