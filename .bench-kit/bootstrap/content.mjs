/**
 * Semantyka treści instancji: placeholdery, rejestracja repo bazowego,
 * pinowanie zadań-demo, .gitignore.
 *
 * Chirurgia na yamlu wymaga pakietu `yaml` — bootstrap nie ma własnych
 * zależności, więc pożycza go z `.bench-kit/runner/node_modules`
 * instancji. Stąd twarda kolejność w index.mjs: `npm ci` w runnerze
 * PRZED wywołaniami z tego modułu.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Placeholderowe repo bazowe z template'u, które init może podmienić. */
export const PLACEHOLDER_BASE_REPO = "demo-app";

/** Commit z samych zer, którym template pinuje zadanie-demo. */
export const PLACEHOLDER_COMMIT = /^0{40}$/;

/** Lokalne klony rep bazowych: `.repos/<nazwa>` (gitignorowane, konwencja z AGENTS.md). */
export const BASE_REPOS_DIR = ".repos";

/**
 * Ładuje `parseDocument` z runnera instancji. Zwraca null, gdy pakiet
 * jest niedostępny (np. `npm ci` padło) — wołający degraduje do warninga.
 */
export function loadYaml(targetDir) {
  try {
    const requireFromRunner = createRequire(
      join(targetDir, ".bench-kit", "runner", "package.json"),
    );
    return requireFromRunner("yaml");
  } catch {
    return null;
  }
}

/**
 * Podmienia placeholderowe repo bazowe w bench.config.yaml na wykryte,
 * edytując plik w miejscu (komentarze pliku przeżywają). Zwraca false,
 * gdy config nie ma placeholdera — treści firmy nigdy nie nadpisujemy
 * na zgadywanego.
 */
export function registerBaseRepo(yaml, configPath, repo) {
  if (!existsSync(configPath)) return false;
  const doc = yaml.parseDocument(readFileSync(configPath, "utf8"));
  const firstName = doc.getIn(["base_repos", 0, "name"]);
  if (firstName !== PLACEHOLDER_BASE_REPO) return false;
  doc.setIn(["base_repos", 0, "name"], repo.name);
  doc.setIn(["base_repos", 0, "url"], repo.url);
  // Wpis jest już prawdziwy — per-polowe komentarze placeholdera znikają
  // (komentarze na poziomie pliku zostają).
  const entry = doc.getIn(["base_repos", 0], true);
  if (entry && typeof entry === "object" && "items" in entry) {
    for (const pair of entry.items) {
      if (pair.key) pair.key.commentBefore = null;
    }
  }
  writeFileSync(configPath, doc.toString());
  return true;
}

/**
 * Pinuje placeholderowe zadania do wykrytego repo: każdy
 * tasks/<x>/task.yaml wskazujący placeholder dostaje nazwę wykrytego
 * repo, a commit z zer — jego HEAD. Zadania firmy nietykalne (brak
 * placeholdera → brak edycji). Zwraca liczbę zapinowanych zadań.
 */
export function pinPlaceholderTasks(yaml, tasksDir, repo) {
  if (!existsSync(tasksDir) || !/^[0-9a-f]{40}$/.test(repo.headCommit)) return 0;
  let pinned = 0;
  for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskYaml = join(tasksDir, entry.name, "task.yaml");
    if (!existsSync(taskYaml)) continue;
    const doc = yaml.parseDocument(readFileSync(taskYaml, "utf8"));
    if (doc.getIn(["repo"]) !== PLACEHOLDER_BASE_REPO) continue;
    const commit = doc.getIn(["commit"]);
    doc.setIn(["repo"], repo.name);
    if (typeof commit === "string" && PLACEHOLDER_COMMIT.test(commit)) {
      doc.setIn(["commit"], repo.headCommit);
    }
    writeFileSync(taskYaml, doc.toString());
    pinned++;
  }
  return pinned;
}

/**
 * Przepisuje URL SSH na odpowiednik https, albo null gdy URL już jest
 * https (lub nierozpoznany). `git@host:org/repo.git` oraz
 * `ssh://git@host/org/repo.git` mapują się na `https://host/org/repo.git`.
 */
export function toHttpsUrl(url) {
  const scp = url.match(/^git@([^:/]+):(.+)$/);
  if (scp !== null) return `https://${scp[1]}/${scp[2]}`;
  const ssh = url.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/);
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`;
  return null;
}

/**
 * Gwarantuje, że `.gitignore` zawiera `entry`, zanim wyląduje lokalny
 * klon — template ma tę regułę, ale nic nie może skończyć się
 * zacommitowaniem całego repo produktowego do instancji.
 */
export function ensureIgnored(dir, entry) {
  const file = join(dir, ".gitignore");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").some((line) => line.trim() === entry)) return;
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  writeFileSync(file, `${prefix}${entry}\n`);
}
