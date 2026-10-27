/**
 * Stempel świeżości guardów (checks.stamp.json obok checks.json próby).
 *
 * Procedura rate-attempt liczy guardy dwa razy: `--skip-judge` (fakty dla
 * sędziego-agenta), potem fold werdyktu `--verdict`. Fold może użyć
 * checks.json z pierwszego przebiegu zamiast uruchamiać kontener oceny
 * od nowa — ale tylko, gdy da się DOWIEŚĆ, że wynik byłby ten sam:
 * ta sama definicja zadania (task_hash), te same asercje z puli (hash
 * katalogu każdego refa: check.yaml + ukryte pliki), ten sam obraz oceny
 * (id obrazu — obejmuje też /bench/evaluate.mjs), ten sam patch próby,
 * te same limity zasobów, a checks.json nietknięty od zapisu stempla.
 * Cokolwiek się nie zgadza (albo stempla brak) = guardy biegną od nowa.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashTaskDir } from "./era.ts";

export const GUARD_STAMP_FILE = "checks.stamp.json";

export interface GuardFingerprint {
  task_hash: string;
  /** ref → SHA-256 katalogu evaluation-pool/<ref>. */
  assertions: Record<string, string>;
  /** Id obrazu oceny (engine image inspect), nie tag. */
  image_id: string;
  patch_sha256: string;
  memory_mb: number | null;
  pids_limit: number | null;
}

export interface GuardStamp extends GuardFingerprint {
  /** SHA-256 checks.json w chwili zapisu stempla. */
  checks_sha256: string;
  created_at: string;
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

export const fileSha256 = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null);

/** Odcisk wejść guardów próby w bieżącym stanie instancji. */
export function guardFingerprint(
  root: string,
  trialDir: string,
  input: { taskHash: string; refs: string[]; imageId: string; memoryMb: number | null; pidsLimit: number | null },
): GuardFingerprint {
  return {
    task_hash: input.taskHash,
    assertions: Object.fromEntries([...input.refs].sort().map((ref) => [ref, hashTaskDir(join(root, "evaluation-pool", ref))])),
    image_id: input.imageId,
    patch_sha256: fileSha256(join(trialDir, "patch.diff")) ?? sha256(""),
    memory_mb: input.memoryMb,
    pids_limit: input.pidsLimit,
  };
}

/**
 * Decyzja: czy checks.json z poprzedniego przebiegu jest świeży dla
 * bieżących wejść. Czysta funkcja — stempel i sha checks.json podaje
 * wołający. `fresh: false` zawsze z powodem (do logu).
 */
export function guardStampFreshness(
  stamp: unknown,
  current: GuardFingerprint,
  checksSha: string | null,
): { fresh: true } | { fresh: false; reason: string } {
  if (!stamp || typeof stamp !== "object") return { fresh: false, reason: `brak ${GUARD_STAMP_FILE} (guardy sprzed stempla albo nigdy nie liczone)` };
  const s = stamp as Partial<GuardStamp>;
  if (checksSha === null) return { fresh: false, reason: "brak checks.json" };
  if (s.checks_sha256 !== checksSha) return { fresh: false, reason: "checks.json zmieniony po zapisie stempla" };
  if (s.task_hash !== current.task_hash) return { fresh: false, reason: "zmienione zadanie (task_hash)" };
  if (s.patch_sha256 !== current.patch_sha256) return { fresh: false, reason: "inny patch.diff próby" };
  if (s.image_id !== current.image_id) return { fresh: false, reason: "inny obraz oceny (przebudowany obraz zadania/bazowy)" };
  const before = s.assertions ?? {};
  const refs = new Set([...Object.keys(before), ...Object.keys(current.assertions)]);
  const changed = [...refs].filter((ref) => before[ref] !== current.assertions[ref]).sort();
  if (changed.length > 0) return { fresh: false, reason: `zmienione / inne asercje puli: ${changed.join(", ")}` };
  if ((s.memory_mb ?? null) !== current.memory_mb || (s.pids_limit ?? null) !== current.pids_limit) {
    return { fresh: false, reason: "inne limity zasobów kontenera oceny" };
  }
  return { fresh: true };
}
