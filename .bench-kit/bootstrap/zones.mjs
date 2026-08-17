/**
 * Strefy plików kitu — jedyne źródło prawdy o tym, co jest czym.
 *
 * - template-only: rozwija i prezentuje sam template, nigdy nie ląduje
 *   w instancji (`.github/` to self-test template'u, `benchkit.png` to
 *   grafika README).
 * - shared root: pliki korzenia synchronizowane przy update jako
 *   propozycja do review (git diff).
 * - skille: źródło w template'cie, cel zależny od profilu narzędzia
 *   (podaje go CLI w żądaniu).
 * - workflows: `.bench-kit/workflows/` → `.github/workflows/` instancji
 *   (GitHub odpala workflowy tylko stamtąd).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
} from "node:fs";
import { join, sep } from "node:path";

export const TEMPLATE_ONLY_PATHS = [".github", "benchkit.png", "docs"];

export const SHARED_ROOT_FILES = ["AGENTS.md"];

/** True, gdy `relPosix` jest wpisem template-only (lub leży w nim). */
export function isTemplateOnly(relPosix) {
  return TEMPLATE_ONLY_PATHS.some(
    (path) => relPosix === path || relPosix.startsWith(`${path}/`),
  );
}

/** Gdzie template trzyma skille (migracja na .agents/skills wykrywana automatycznie). */
export function templateSkillSource(templateDir) {
  return existsSync(join(templateDir, ".agents", "skills"))
    ? ".agents/skills"
    : ".claude/skills";
}

/**
 * Kopiuje klon do celu bez historii gita. W trybie repair istniejące
 * pliki nie są nadpisywane — treść firmy jest nietykalna. `skip` wyklucza
 * poddrzewa obsługiwane osobno (skille idą wg profilu narzędzia).
 * Zwraca liczbę skopiowanych plików.
 */
export function materialize(srcDir, destDir, opts) {
  let copied = 0;
  const walk = (rel) => {
    for (const entry of readdirSync(join(srcDir, rel), { withFileTypes: true })) {
      if (rel === "" && entry.name === ".git") continue;
      const relPath = join(rel, entry.name);
      if (opts.skip?.(relPath)) continue;
      const from = join(srcDir, relPath);
      const to = join(destDir, relPath);
      if (entry.isDirectory()) {
        mkdirSync(to, { recursive: true });
        walk(relPath);
        // Katalog, którego całą zawartość pominięto (np. `.claude/`, gdy
        // skille idą gdzie indziej), nie może zostać pusty w instancji.
        if (readdirSync(to).length === 0) rmdirSync(to);
        continue;
      }
      if (opts.skipExisting && existsSync(to)) continue;
      cpSync(from, to);
      copied++;
    }
  };
  walk("");
  return copied;
}

/**
 * Rekurencyjnie synchronizuje `srcDir` do `destDir`, licząc wyniki
 * per plik. Pliki są tylko dodawane albo nadpisywane — nigdy kasowane —
 * więc pliki firmy żyjące obok template'owych przeżywają. Przy
 * `overwrite: false` istniejące pliki zostają i liczą się jako unchanged.
 */
export function syncDir(srcDir, destDir, opts) {
  const counts = { added: 0, updated: 0, unchanged: 0 };
  if (!existsSync(srcDir)) return counts;
  const walk = (rel) => {
    for (const entry of readdirSync(join(srcDir, rel), { withFileTypes: true })) {
      const relPath = join(rel, entry.name);
      const from = join(srcDir, relPath);
      const to = join(destDir, relPath);
      if (entry.isDirectory()) {
        mkdirSync(to, { recursive: true });
        walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!existsSync(to)) {
        mkdirSync(join(destDir, rel), { recursive: true });
        cpSync(from, to);
        counts.added++;
      } else if (readFileSync(from).equals(readFileSync(to))) {
        counts.unchanged++;
      } else if (opts.overwrite) {
        cpSync(from, to);
        counts.updated++;
      } else {
        counts.unchanged++;
      }
    }
  };
  mkdirSync(destDir, { recursive: true });
  walk("");
  return counts;
}

/** Synchronizuje pojedynczy plik z semantyką add/overwrite jak syncDir. */
export function syncFile(from, to) {
  const counts = { added: 0, updated: 0, unchanged: 0 };
  if (!existsSync(from)) return counts;
  if (!existsSync(to)) {
    cpSync(from, to);
    counts.added++;
  } else if (readFileSync(from).equals(readFileSync(to))) {
    counts.unchanged++;
  } else {
    cpSync(from, to);
    counts.updated++;
  }
  return counts;
}

export function addSync(into, counts) {
  into.added += counts.added;
  into.updated += counts.updated;
  into.unchanged += counts.unchanged;
}

/**
 * Instaluje workflowy instancji z `.bench-kit/workflows/` do
 * `.github/workflows/`. W trybie repair istniejące pliki zostają —
 * firma mogła dostosować triggery albo sekrety.
 */
export function installWorkflows(targetDir, opts) {
  return syncDir(
    join(targetDir, ".bench-kit", "workflows"),
    join(targetDir, ".github", "workflows"),
    { overwrite: !opts.skipExisting },
  );
}

export const relPosix = (rel) => rel.split(sep).join("/");
