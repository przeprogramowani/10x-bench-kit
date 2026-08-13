/**
 * Ładowanie instancji benchmarku — wspólne dla komend runnera.
 *
 * `validate` robi własne, drobiazgowe raportowanie (safeParse per plik);
 * tutaj są wersje "twarde" dla komend, które zakładają instancję już
 * zwalidowaną (`run`, `evaluate`, `report`) — błąd = wyjątek z czytelnym
 * komunikatem i odesłaniem do `bench validate`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BenchConfigSchema, type BenchConfig } from "../schemas/config.ts";
import { TaskSchema, type Task } from "../schemas/task.ts";

/** Szuka korzenia instancji (katalogu z bench.config.yaml) od `start` w górę. */
export function findInstanceRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "bench.config.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, "utf8"));
}

export function loadConfig(root: string): BenchConfig {
  const parsed = BenchConfigSchema.safeParse(readYamlFile(join(root, "bench.config.yaml")));
  if (!parsed.success) {
    throw new Error(`bench.config.yaml nie parsuje się schematem — uruchom \`bench validate\`:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function listTaskNames(root: string): string[] {
  const tasksDir = join(root, "tasks");
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).filter((name) => statSync(join(tasksDir, name)).isDirectory());
}

export function loadTask(root: string, name: string): Task {
  const parsed = TaskSchema.safeParse(readYamlFile(join(root, "tasks", name, "task.yaml")));
  if (!parsed.success) {
    throw new Error(`tasks/${name}/task.yaml nie parsuje się schematem — uruchom \`bench validate\`:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
