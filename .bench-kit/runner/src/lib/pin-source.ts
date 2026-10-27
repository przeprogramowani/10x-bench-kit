/**
 * Skąd brać pinowany commit zadania. Init (i bench-status) klonuje repo
 * bazowe z pełną historią do `.repos/<name>/` — na potrzeby kopania PR-ów.
 * Ten sam klon wystarcza do budowy stanu startowego: shallow fetch z dysku
 * (~3 s, bez sieci i bez paczki pobieranej przy każdym wywołaniu) zamiast
 * z remote przy każdym obrazie zadania, `bench assert` i `validate`.
 * Klon bez pina (nieodświeżony, płytki) → remote, jak dotąd.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { must } from "./containers.ts";
import { gitAuthArgs } from "./git-auth.ts";

/** Ścieżka lokalnego klonu `.repos/<repo>/`, jeśli zawiera commit; inaczej null. */
export function localPinClone(root: string, repo: string, commit: string): string | null {
  const dir = resolve(join(root, ".repos", repo));
  if (!existsSync(join(dir, ".git")) && !existsSync(join(dir, "HEAD"))) return null;
  const has = spawnSync("git", ["-C", dir, "cat-file", "-e", `${commit}^{commit}`], { encoding: "utf8", timeout: 30_000 });
  return has.status === 0 ? dir : null;
}

/** Shallow fetch pina do zainicjowanego repo `workspace` — z lokalnego klonu, gdy go ma. */
export function fetchPin(workspace: string, repoUrl: string, commit: string, localClone: string | null, what: string): void {
  if (localClone) {
    // Commit spoza reklamowanych refów: upload-pack po stronie klonu musi go wydać.
    const local = spawnSync(
      "git",
      ["-C", workspace, "fetch", "-q", "--depth", "1", "--upload-pack=git -c uploadpack.allowAnySHA1InWant=true upload-pack", `file://${localClone}`, commit],
      { encoding: "utf8", timeout: 300_000 },
    );
    if (local.status === 0) return;
    // nieudany odczyt klonu (np. uszkodzony) — remote jako zapas
  }
  must("git", [...gitAuthArgs(), "-C", workspace, "fetch", "--depth", "1", repoUrl, commit], what, { timeout: 300_000 });
}
