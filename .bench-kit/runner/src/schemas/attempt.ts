import { z } from "zod";

/**
 * Schemat attempt.json — metadane ZACHOWANEJ PRÓBY, jedyny punkt styku
 * między wykonaniem (`bench attempt`) a oceną (`bench evaluate` /
 * skill rate-attempt). Pełny kontrakt katalogu próby (pliki, gwarancje,
 * wersjonowanie): .bench-kit/ATTEMPT_FORMAT.md.
 *
 * Katalog próby: attempts/<zadanie>/<model-sanitized>/trial-<n>/
 * - attempt.json, patch.diff, agent.log, metrics.json, execution.json
 *   — commitowane (KB),
 * - workspace/ — stan /workspace po pracy agenta, trzymany POZA gitem
 *   (.gitignore) — surowiec dla sędziego-z-narzędziami.
 *
 * Próba raz opłacona nigdy nie jest wyrzucana: re-run przenosi stary
 * katalog do trial-<n>.superseded-<stempel>/, nie kasuje go.
 */

export const ATTEMPT_FORMAT_VERSION = 1;

export const ExecutionSchema = z.object({
  agent_exit: z.number().int(),
  timed_out: z.boolean(),
  wall_duration_s: z.number().min(0),
});

export const AttemptSchema = z.object({
  /** Wersja formatu zachowanej próby (ATTEMPT_FORMAT.md). */
  format: z.number().int().positive(),
  task: z.string().min(1),
  /** Identyfikator modelu (jak podany do opencode). */
  model: z.string().min(1),
  /** Numer próby, licząc od 1. */
  trial: z.number().int().positive(),
  /** Obraz zadania użyty w próbie (odtwarzalny z task.yaml). */
  image: z.string().min(1),
  /** Commit startowy workspace'u (punkt odniesienia patch.diff). */
  start_sha: z.string().regex(/^[0-9a-f]{40}$/),
  /** Pinowany commit repo bazowego z task.yaml w chwili próby. */
  pinned_commit: z.string().regex(/^[0-9a-f]{40}$/),
  /**
   * SHA-256 katalogu zadania W CHWILI WYKONANIA — ocena porównuje go
   * z bieżącym: rozjazd znaczy, że zadanie zmieniło się po próbie
   * (wynik wyląduje w erze innej niż intencja próby).
   */
  task_hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Wersja kitu, którym wykonano próbę (informacyjnie). */
  kit_version: z.string().min(1),
  started_at: z.string().min(1),
  finished_at: z.string().min(1),
  timeout_s: z.number().int().positive(),
  /** Limit pamięci kontenera próby (MiB); null = bez jawnego limitu. */
  memory_limit_mb: z.number().int().positive().nullable(),
  /** Awaria infrastruktury / kill zasobowy — próba nieoceniana. */
  infra_failure: z.boolean(),
  provider_error: z.boolean(),
  resource_kill: z.boolean(),
  /** Liczba podejść (retry przy awarii providera / kill'u sygnałem). */
  attempts: z.number().int().positive(),
  execution: ExecutionSchema.nullable(),
});

export type Attempt = z.infer<typeof AttemptSchema>;
