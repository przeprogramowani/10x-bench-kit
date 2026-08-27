/**
 * Przygotowanie obrazu zadania — wspólne dla `bench attempt` (wykonanie)
 * i `bench evaluate` (ocena zachowanej próby, gdy obraz nie istnieje
 * lokalnie — ocena jest niezależnym procesem i musi umieć odtworzyć
 * środowisko z samego task.yaml).
 *
 * Obraz `bench-task-<nazwa>` = obraz bazowy + repo@pin + overlay
 * + commit startowy (+ opcjonalny etap `prepare` z task.yaml).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { must, sh } from "./containers.ts";
import { gitAuthArgs } from "./git-auth.ts";
import type { Task } from "../schemas/task.ts";

export const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-");

export interface PreparedTask {
  name: string;
  task: Task;
  image: string;
  startSha: string;
}

/** Zapieka repo@pin + overlay + commit startowy w obraz `bench-task-<nazwa>`. */
export function prepareTaskImage(engine: string, root: string, baseImage: string, name: string, task: Task, repoUrl: string): PreparedTask {
  const image = `bench-task-${sanitize(name)}:latest`;
  const context = mkdtempSync(join(tmpdir(), `bench-prepare-${sanitize(name)}-`));
  try {
    const workspace = join(context, "workspace");
    mkdirSync(workspace);
    must("git", ["init", "-q", workspace], "git init workspace");
    must("git", [...gitAuthArgs(), "-C", workspace, "fetch", "--depth", "1", repoUrl, task.commit], `fetch pinowanego commita ${name}`, {
      timeout: 300_000,
    });
    must("git", ["-C", workspace, "checkout", "-q", task.commit], "checkout pinowanego commita");

    const overlay = join(root, "tasks", name, "overlay");
    if (existsSync(overlay)) {
      cpSync(overlay, workspace, {
        recursive: true,
        filter: (src) => !src.endsWith(".gitkeep"),
      });
    }

    // Commit startowy = punkt odniesienia dla patch.diff (repo@pin + overlay).
    must("git", ["-C", workspace, "add", "-A"], "git add punktu startowego");
    must(
      "git",
      ["-C", workspace, "-c", "user.name=bench", "-c", "user.email=bench@local", "commit", "-q", "--allow-empty", "-m", "bench: punkt startowy próby"],
      "commit punktu startowego",
    );
    const startSha = must("git", ["-C", workspace, "rev-parse", "HEAD"], "rev-parse punktu startowego").trim();

    cpSync(join(root, "tasks", name, "prompt.md"), join(context, "prompt.md"));
    writeFileSync(join(context, "start-sha"), startSha + "\n");
    // task.prepare: środowisko zapiekane raz na obraz zadania (etap z siecią)
    // zamiast płacone przy każdym wejściu do kontenera oceny/próby.
    // Artefakty prepare są commitowane, a start-sha w obrazie aktualizowany —
    // inaczej `git add -A` w trial.sh wciągnąłby np. node_modules do patch.diff.
    const prepareLines = task.prepare
      ? [
          `RUN cd /workspace && ( ${task.prepare} ) \\`,
          ` && git add -A \\`,
          ` && git -c user.name=bench -c user.email=bench@local commit -q --allow-empty -m "bench: prepare środowiska zadania" \\`,
          ` && git rev-parse HEAD > /bench/start-sha`,
        ]
      : [];
    writeFileSync(
      join(context, "Dockerfile"),
      [`FROM ${baseImage}`, "COPY workspace/ /workspace/", "COPY prompt.md start-sha /bench/", ...prepareLines, ""].join("\n"),
    );

    console.log(`prepare: ${name} → ${image} (pin ${task.commit.slice(0, 12)}…)${task.prepare ? " + prepare środowiska" : ""}`);
    must(engine, ["build", "-q", "-t", image, context], `budowa obrazu zadania ${name}`, { timeout: 1_800_000 });
    const effectiveStartSha = task.prepare
      ? must(engine, ["run", "--rm", image, "cat", "/bench/start-sha"], `odczyt start-sha obrazu ${name}`, { timeout: 120_000 }).trim()
      : startSha;
    return { name, task, image, startSha: effectiveStartSha };
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}

/** True, gdy obraz o tym tagu istnieje lokalnie w silniku. */
export function imageExists(engine: string, image: string): boolean {
  return sh(engine, ["image", "inspect", image], { timeout: 30_000 }).status === 0;
}
