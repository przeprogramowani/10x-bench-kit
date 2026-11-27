/**
 * Gdzie runner trzyma katalogi tymczasowe (stan startowy assert/validate,
 * kontekst budowy obrazu zadania — setki MB na wywołanie). Domyślne /tmp
 * bywa tmpfs-em: dane zajmują RAM, a limit per użytkownik odcina zapis
 * (EDQUOT) wcześniej, niż pokazuje df. Bez jawnego TMPDIR i przy tmpfs-ie
 * runner używa `<instancja>/.bench-tmp/` — tego samego dysku co attempts/.
 *
 * macOS: systemowy TMPDIR to /var/folders/… — katalog, którego silniki
 * z maszyną wirtualną (colima, podman machine) domyślnie nie montują.
 * Kontener oceny dostawał wtedy pusty /bench/out i każda ocena padała na
 * `ENOENT … /bench/out/eval-plan.json`. Systemowy TMPDIR macOS nie jest
 * wyborem operatora, więc runner też przenosi się do `.bench-tmp/`
 * instancji: jej katalog silnik widzieć musi, bo montuje z niego attempts/.
 * TMPDIR wskazany przez operatora gdziekolwiek indziej zostaje, jak jest
 * (czy silnik go widzi, sprawdza `bench doctor`).
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

/** macOS: TMPDIR nieustawiony albo systemowy (/var/folders/…, także jako /private/var/folders/…). */
export function isMacSystemTmp(envTmpdir: string | undefined, platform: string = process.platform): boolean {
  if (platform !== "darwin") return false;
  if (!envTmpdir || envTmpdir.trim() === "") return true;
  return /^(\/private)?\/var\/folders\//.test(envTmpdir.trim());
}

/** Katalog tymczasowy do ustawienia jako TMPDIR albo null (zostaje, jak jest). */
export function chooseTmpdir(envTmpdir: string | undefined, root: string | null, tmpIsTmpfs: boolean, macSystemTmp = false): string | null {
  if (macSystemTmp) return root ? join(root, ".bench-tmp") : null; // systemowy TMPDIR macOS to nie wybór operatora
  if (envTmpdir && envTmpdir.trim() !== "") return null; // wybór operatora
  if (!root || !tmpIsTmpfs) return null;
  return join(root, ".bench-tmp");
}

/** Ustawia process.env.TMPDIR (os.tmpdir() czyta je dynamicznie) i zwraca wybrany katalog. */
export function applyDiskTmpdir(root: string | null): string | null {
  const dir = chooseTmpdir(process.env.TMPDIR, root, isTmpfs("/tmp"), isMacSystemTmp(process.env.TMPDIR));
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  // Samoignorujący się katalog — bez zmian w .gitignore instancji.
  writeFileSync(join(dir, ".gitignore"), "*\n");
  process.env.TMPDIR = dir;
  return dir;
}
