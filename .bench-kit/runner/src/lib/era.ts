/**
 * Tożsamość ery porównywalności — jedno źródło prawdy dla evaluate
 * (stemplowanie wyników) i report/leaderboard (grupowanie).
 *
 * Klucz ery to krotka (scoring_version, task_hash, judge_model,
 * rubric_version). Era OCENY jest odklejona od ery wykonania —
 * zmiana rubryki wersjonuje wyniki (re-ocena zachowanych prób),
 * nie unieważnia samych prób.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseRubric } from "./judge.ts";
import type { Result } from "../schemas/result.ts";

/** SHA-256 katalogu zadania: posortowane ścieżki względne + treści plików. */
export function hashTaskDir(taskDir: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): string[] =>
    readdirSync(dir)
      .sort()
      .flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
  for (const file of walk(taskDir)) {
    hash.update(relative(taskDir, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Stempel wersji rubryk zadania: per rubryka (`<nazwa>@<wersja>`, sortowane,
 * łączone "+"), więc kalibracja jednej rubryki otwiera nową erę tylko
 * zadaniom, które jej używają. Wersja z frontmattera rubryki; fallback:
 * judge.rubric_version z configu (kontrakt legacy). Zadanie bez składowej
 * judge dostaje "none" — rubryki nie wpływają na jego wynik.
 */
export function rubricVersionStamp(root: string, judgeRefs: string[], fallback: string | undefined): string {
  if (judgeRefs.length === 0) return "none";
  return judgeRefs
    .map((ref) => {
      const name = ref.split("/")[1] as string;
      const rubric = parseRubric(readFileSync(join(root, "evaluation-pool", "judge", `${name}.md`), "utf8"));
      const version = rubric.version ?? fallback;
      if (!version) {
        throw new Error(
          `rubryka "${ref}" bez \`version\` we frontmatterze, a config nie ma judge.rubric_version — uruchom \`bench validate\``,
        );
      }
      return `${name}@${version}`;
    })
    .sort()
    .join("+");
}

/**
 * Klucz ery z krotki stamps. Używa scoring_version (podbijanej tylko przy
 * release'ach scoring-breaking), nie template_version — neutralny release
 * nie rozdziela er; wyniki legacy (bez scoring_version) spadają na
 * template_version, więc historyczne ery się nie przetasowują.
 */
export function eraKey(
  stamps: Pick<Result["stamps"], "template_version" | "scoring_version" | "task_hash" | "judge_model" | "rubric_version">,
): string {
  return JSON.stringify([
    stamps.scoring_version ?? stamps.template_version,
    stamps.task_hash,
    stamps.judge_model,
    stamps.rubric_version,
  ]);
}

