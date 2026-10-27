/**
 * Ścieżki zachowanych prób podawane przez użytkownika (`--attempt <dir>`).
 *
 * Katalog komórki to `attempts/<zadanie>/<sanitize(model)>/trial-<n>/`
 * (prepare.ts → sanitize), a ludzie i dokumentacja naturalnie piszą surowe
 * id modelu: `attempts/<zadanie>/openrouter/deepseek/deepseek-v4.1-flash/trial-1`.
 * resolveAttemptPath przyjmuje obie formy; nieistniejąca ścieżka daje
 * błąd z listą istniejących prób zadania (najbliższe pierwsze).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sanitize } from "./prepare.ts";

/** Odległość edycyjna (Levenshtein) — do podpowiedzi "did you mean". */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}

/** `limit` kandydatów najbliższych `target` (stabilnie: odległość, potem alfabet). */
export function nearest(target: string, candidates: Iterable<string>, limit = 3): string[] {
  return [...new Set(candidates)]
    .map((c) => ({ c, d: editDistance(target, c) }))
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, limit)
    .map((x) => x.c);
}

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
const TRIAL = /^trial-\d+$/;

/** Katalogi trial-N (bez superseded/aborted) pod katalogiem zadania. */
export function listTrialDirs(taskDir: string): string[] {
  const out: string[] = [];
  if (!isDir(taskDir)) return out;
  for (const model of readdirSync(taskDir)) {
    const cell = join(taskDir, model);
    if (!isDir(cell)) continue;
    for (const trial of readdirSync(cell)) if (TRIAL.test(trial) && isDir(join(cell, trial))) out.push(join(cell, trial));
  }
  return out.sort();
}

export type AttemptPath = { ok: true; dir: string; rewritten: boolean } | { ok: false; error: string };

/**
 * Rozwiązuje ścieżkę próby/komórki: istniejąca → bez zmian; inaczej
 * segmenty po `attempts/<zadanie>/` (do `trial-N`, jeśli jest) składa
 * w surowe id modelu i zamienia na katalog sanitize(id). `raw` może być
 * względny wobec cwd albo korzenia instancji.
 */
export function resolveAttemptPath(root: string, raw: string, cwd = process.cwd()): AttemptPath {
  const tries = isAbsolute(raw) ? [raw] : [...new Set([resolve(cwd, raw), resolve(root, raw)])];
  for (const p of tries) if (isDir(p)) return { ok: true, dir: p, rewritten: false };

  const show = (p: string) => {
    const rel = relative(root, p);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : p;
  };
  let taskDir: string | null = null;
  let attemptsDir: string | null = null;
  for (const p of tries) {
    const parts = p.split(sep);
    const at = parts.lastIndexOf("attempts");
    if (at < 0 || at + 1 >= parts.length) continue;
    const base = parts.slice(0, at + 1).join(sep) || sep;
    const task = parts[at + 1] as string;
    let rest = parts.slice(at + 2).filter(Boolean);
    const trial = rest.length > 0 && TRIAL.test(rest[rest.length - 1] as string) ? (rest[rest.length - 1] as string) : null;
    if (trial) rest = rest.slice(0, -1);
    if (rest.length > 0) {
      const candidate = join(base, task, sanitize(rest.join("/")), ...(trial ? [trial] : []));
      if (isDir(candidate)) return { ok: true, dir: candidate, rewritten: true };
    }
    if (isDir(join(base, task))) {
      taskDir = join(base, task);
      break;
    }
    if (isDir(base)) attemptsDir ??= base;
  }

  const wanted = show(tries[tries.length - 1] as string);
  if (taskDir) {
    const trials = listTrialDirs(taskDir).map(show);
    if (trials.length === 0) return { ok: false, error: `katalog próby nie istnieje: ${raw} (${show(taskDir)}/ nie ma żadnych prób trial-N)` };
    const listed = nearest(wanted, trials, 10);
    return {
      ok: false,
      error:
        `katalog próby nie istnieje: ${raw}\n  istniejące próby zadania (najbliższe pierwsze${trials.length > listed.length ? `, ${listed.length} z ${trials.length}` : ""}):` +
        listed.map((t) => `\n    ${t}`).join(""),
    };
  }
  if (attemptsDir) {
    const tasks = readdirSync(attemptsDir).filter((n) => isDir(join(attemptsDir as string, n)));
    return {
      ok: false,
      error: `katalog próby nie istnieje: ${raw}\n  zadania z próbami w ${show(attemptsDir)}/: ${tasks.length ? tasks.join(", ") : "(brak — najpierw bench attempt)"}`,
    };
  }
  return { ok: false, error: `katalog próby nie istnieje: ${raw}${existsSync(join(root, "attempts")) ? "" : " (instancja nie ma jeszcze attempts/ — najpierw bench attempt)"}` };
}
