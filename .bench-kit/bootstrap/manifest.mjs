/**
 * Manifest instancji (`.bench-kit/instance.json`) i wersje template'u.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Wersja template'u instancji, albo null gdy `dir` nie jest instancją. */
export function readInstanceVersion(dir) {
  const versionFile = join(dir, ".bench-kit", "VERSION");
  if (!existsSync(versionFile)) return null;
  return readFileSync(versionFile, "utf8").trim();
}

/** Czyta manifest instancji, tolerując jego brak (starsze inity). */
export function readManifest(dir) {
  const file = join(dir, ".bench-kit", "instance.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeManifest(dir, manifest) {
  writeFileSync(
    join(dir, ".bench-kit", "instance.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/** Wersja z klonu template'u, albo null gdy klon jest niekompletny. */
export function readTemplateVersion(templateDir) {
  const versionFile = join(templateDir, ".bench-kit", "VERSION");
  if (!existsSync(versionFile)) return null;
  return readFileSync(versionFile, "utf8").trim();
}
