/**
 * bench evaluate — oceni artefakty próby i wyprodukuje result.json.
 *
 * Kontrakt (do implementacji):
 * - działa w kontenerze próby już bez agenta; dopiero na tym etapie
 *   montowane są asercje z evaluation-pool/ (izolacja z konstrukcji),
 * - kolejność: static (lint/typecheck/build) → testy weryfikacyjne →
 *   e2e Playwright → LLM-as-judge (stały, mocny model — inny niż oceniane;
 *   dostaje prompt.md + patch.diff + rubrykę, zwraca JSON wg
 *   evaluation-pool/judge/),
 * - wynik próby = ważona suma składowych wg wag z task.yaml,
 * - wyjście: result.json zgodny ze schematem schemas/result.ts, ze
 *   stemplami er (template_version, task_hash, judge_model, rubric_version).
 */
export async function evaluateCommand(_args: string[]): Promise<number> {
  console.error("bench evaluate: not implemented in 0.1.0");
  return 1;
}
