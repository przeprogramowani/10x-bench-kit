/**
 * Pliki instrukcji projektu w workspace'ie próby — wyrównanie między
 * harnessami.
 *
 * Każde CLI czyta inny plik: Claude Code — CLAUDE.md (AGENTS.md tylko,
 * gdy CLAUDE.md nie ma), Codex i OpenCode — AGENTS.md. Repo, które ma
 * tylko jeden z nich, daje temu samemu zadaniu RÓŻNY kontekst zależnie
 * od harnessu — porównanie narzędzi mierzyłoby wtedy układ repo.
 *
 * `unified` (domyślnie, defaults.context_files): gdy w korzeniu jest
 * dokładnie jeden z pary, dokładamy drugi — CLAUDE.md jako import
 * `@AGENTS.md` (mechanizm Claude Code), AGENTS.md jako symlink do
 * CLAUDE.md. Dzieje się to PRZED commitem startowym, więc nie trafia do
 * patch.diff, a wszystkie harnessy (i guardy) widzą ten sam stan.
 * `native`: workspace bez zmian (repo takie, jak jest).
 */
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ContextFilesPolicy = "unified" | "native";

/** Wyrównuje parę AGENTS.md / CLAUDE.md w korzeniu; zwraca opis zmian (pusty = nic). */
export function unifyContextFiles(workspace: string, policy: ContextFilesPolicy): string[] {
  if (policy !== "unified") return [];
  const agents = join(workspace, "AGENTS.md");
  const claude = join(workspace, "CLAUDE.md");
  if (existsSync(agents) && !existsSync(claude)) {
    writeFileSync(claude, "@AGENTS.md\n");
    return ["CLAUDE.md → import @AGENTS.md"];
  }
  if (existsSync(claude) && !existsSync(agents)) {
    symlinkSync("CLAUDE.md", agents);
    return ["AGENTS.md → symlink do CLAUDE.md"];
  }
  return [];
}
