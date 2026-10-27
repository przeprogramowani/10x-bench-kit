/**
 * Gdzie runner trzyma katalogi tymczasowe (stan startowy assert/validate,
 * kontekst budowy obrazu zadania — setki MB na wywołanie). Domyślne /tmp
 * bywa tmpfs-em: dane zajmują RAM, a limit per użytkownik odcina zapis
 * (EDQUOT) wcześniej, niż pokazuje df. Bez jawnego TMPDIR i przy tmpfs-ie
 * runner używa `<instancja>/.bench-tmp/` — tego samego dysku co attempts/.
 */
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMPFS_MAGIC = 0x01021994;

export function isTmpfs(path: string): boolean {
  try {
    return statfsSync(path).type === TMPFS_MAGIC;
  } catch {
    return false;
  }
}

/** Katalog tymczasowy do ustawienia jako TMPDIR albo null (zostaje, jak jest). */
export function chooseTmpdir(envTmpdir: string | undefined, root: string | null, tmpIsTmpfs: boolean): string | null {
  if (envTmpdir && envTmpdir.trim() !== "") return null; // wybór operatora
  if (!root || !tmpIsTmpfs) return null;
  return join(root, ".bench-tmp");
}

/** Ustawia process.env.TMPDIR (os.tmpdir() czyta je dynamicznie) i zwraca wybrany katalog. */
export function applyDiskTmpdir(root: string | null): string | null {
  const dir = chooseTmpdir(process.env.TMPDIR, root, isTmpfs("/tmp"));
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  // Samoignorujący się katalog — bez zmian w .gitignore instancji.
  writeFileSync(join(dir, ".gitignore"), "*\n");
  process.env.TMPDIR = dir;
  return dir;
}
