/**
 * Testy bootstrapu (.bench-kit/bootstrap/) — efekty dyskowe kontraktu.
 *
 * Przeniesione z 10x-cli/tests/bench-kit-command.test.ts: to kit zna
 * układ swoich plików, więc to tutaj czerwienieje dryf tej wiedzy.
 * Testy leżą w .github/ (strefa template-only) — nigdy nie trafiają
 * do instancji.
 *
 * Uruchomienie: node --test .github/tests/
 *
 * Fixture'y nie mają runner/package.json (npm ci pomijane — szybkość);
 * pakiet yaml dociera do instancji przez shim w node_modules fixture'a,
 * wskazujący na realny yaml z runnera tego repo (CI robi npm ci przed
 * testami).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "../../.bench-kit/bootstrap/index.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_YAML = join(REPO_ROOT, ".bench-kit", "runner", "node_modules", "yaml");
const BOOTSTRAP = join(REPO_ROOT, ".bench-kit", "bootstrap", "index.mjs");

// Commity w fixture'ach nie mogą zależeć od globalnej konfiguracji gita.
process.env.GIT_AUTHOR_NAME = "bootstrap-test";
process.env.GIT_AUTHOR_EMAIL = "bootstrap-test@example.invalid";
process.env.GIT_COMMITTER_NAME = "bootstrap-test";
process.env.GIT_COMMITTER_EMAIL = "bootstrap-test@example.invalid";

const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Minimalny template-fixture (z fałszywym .git — dowód, że jest pomijany). */
function buildTemplateFixture(version = "0.1.0") {
  const dir = tempDir("bootstrap-template-");
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, ".bench-kit", "bootstrap"), { recursive: true });
  writeFileSync(join(dir, ".bench-kit", "VERSION"), `${version}\n`);
  writeFileSync(join(dir, ".bench-kit", "bootstrap", "index.mjs"), "// bootstrap\n");
  mkdirSync(join(dir, ".bench-kit", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".bench-kit", "workflows", "bench-run.yaml"),
    `name: bench-run (${version})\n`,
  );
  // Shim yaml: instancja dostaje działający pakiet yaml bez npm ci.
  const yamlShim = join(dir, ".bench-kit", "runner", "node_modules", "yaml");
  mkdirSync(yamlShim, { recursive: true });
  writeFileSync(
    join(yamlShim, "package.json"),
    JSON.stringify({ name: "yaml", version: "0.0.0-shim", main: "index.cjs" }),
  );
  writeFileSync(join(yamlShim, "index.cjs"), `module.exports = require(${JSON.stringify(REAL_YAML)});\n`);
  // Wpisy template-only: self-test CI template'u, grafika README, dokumenty.
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yaml"), `name: ci (${version})\n`);
  writeFileSync(join(dir, "benchkit.png"), "PNG");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "plan.md"), "# plan template'u\n");
  mkdirSync(join(dir, ".claude", "skills", "bench-task"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "skills", "bench-task", "SKILL.md"),
    `# bench-task (${version})\n`,
  );
  mkdirSync(join(dir, "tasks", "demo"), { recursive: true });
  writeFileSync(join(dir, "tasks", "demo", "prompt.md"), "demo prompt\n");
  writeFileSync(join(dir, "AGENTS.md"), `# agents (${version})\n`);
  writeFileSync(
    join(dir, "tasks", "demo", "task.yaml"),
    [
      "# Zadanie-demo.",
      "repo: demo-app",
      "# (placeholder)",
      `commit: "${"0".repeat(40)}"`,
      "timeout_s: 300",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "bench.config.yaml"),
    [
      "# Konfiguracja instancji benchmarku.",
      "base_repos:",
      "  - name: demo-app",
      "    # (placeholder)",
      "    url: git@github.com:example-org/demo-app.git",
      "judge:",
      "  model: openrouter/anthropic/claude-opus-5",
      "",
    ].join("\n"),
  );
  return dir;
}

function baseRequest(templateDir, targetDir, overrides = {}) {
  return {
    contractVersion: 1,
    mode: "init",
    templateDir,
    targetDir,
    tool: { id: "claude-code", skillRoot: ".claude/skills" },
    cwd: targetDir,
    templateRef: "latest",
    templateSource: "https://github.com/przeprogramowani/10x-bench-kit",
    detectedBaseRepo: null,
    now: "2026-08-17T12:00:00.000Z",
    ...overrides,
  };
}

function initInstance(version = "0.1.0", overrides = {}) {
  const template = buildTemplateFixture(version);
  const target = join(tempDir("bootstrap-target-"), "instance");
  const response = runBootstrap(baseRequest(template, target, overrides));
  assert.equal(response.ok, true);
  return { template, target, response };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

test("init: materializuje template bez historii gita i robi świeże repo z commitem", () => {
  const { target, response } = initInstance();

  assert.equal(response.mode, "init");
  assert.equal(response.templateVersion, "0.1.0");
  assert.ok(existsSync(join(target, ".bench-kit", "VERSION")));
  assert.ok(existsSync(join(target, "tasks", "demo", "prompt.md")));
  assert.equal(existsSync(join(target, ".git", "refs")), true); // świeże repo…
  assert.equal(
    readFileSync(join(target, ".git", "HEAD"), "utf8").includes("refs/heads/"),
    true,
  ); // …a nie skopiowany .git template'u (fixture ma HEAD → main)
  assert.equal(response.gitInitialized, true);
  assert.equal(response.committed, true);

  const manifest = JSON.parse(readFileSync(join(target, ".bench-kit", "instance.json"), "utf8"));
  assert.equal(manifest.templateVersion, "0.1.0");
  assert.equal(manifest.templateRef, "latest");
  assert.equal(manifest.initializedAt, "2026-08-17T12:00:00.000Z");
  assert.equal(manifest.tool, "claude-code");
});

test("init: pliki template-only nie trafiają do instancji", () => {
  const { target } = initInstance();

  // Workflowy instancji pochodzą WYŁĄCZNIE z .bench-kit/workflows/.
  assert.equal(
    readFileSync(join(target, ".github", "workflows", "bench-run.yaml"), "utf8"),
    "name: bench-run (0.1.0)\n",
  );
  // Self-test template'u padałby na każdym PR instancji i nic by go nie usunęło.
  assert.equal(existsSync(join(target, ".github", "workflows", "ci.yaml")), false);
  assert.equal(existsSync(join(target, "benchkit.png")), false);
  assert.equal(existsSync(join(target, "docs")), false);
});

test("init: skille lądują wg profilu narzędzia z żądania, bez pustej skorupy .claude/", () => {
  const { target } = initInstance("0.1.0", {
    tool: { id: "codex", skillRoot: ".agents/skills" },
  });

  assert.equal(
    readFileSync(join(target, ".agents", "skills", "bench-task", "SKILL.md"), "utf8"),
    "# bench-task (0.1.0)\n",
  );
  assert.equal(existsSync(join(target, ".claude")), false);
  const manifest = JSON.parse(readFileSync(join(target, ".bench-kit", "instance.json"), "utf8"));
  assert.equal(manifest.tool, "codex");
});

test("init: rejestruje wykryte repo produktowe i pinuje zadanie-demo", () => {
  const head = "c".repeat(40);
  const { target, response } = initInstance("0.1.0", {
    detectedBaseRepo: {
      rootDir: "/somewhere/shop-app",
      name: "shop-app",
      url: "git@github.com:acme/shop-app.git",
      headCommit: head,
      httpsReachable: false,
    },
  });

  const config = readFileSync(join(target, "bench.config.yaml"), "utf8");
  assert.match(config, /name: shop-app/);
  assert.match(config, /url: git@github\.com:acme\/shop-app\.git/);
  assert.ok(!config.includes("demo-app"));
  // Komentarze pliku przeżywają edycję w miejscu.
  assert.match(config, /# Konfiguracja instancji benchmarku\./);

  const taskYaml = readFileSync(join(target, "tasks", "demo", "task.yaml"), "utf8");
  assert.match(taskYaml, /repo: shop-app/);
  assert.ok(taskYaml.includes(head));
  assert.ok(!taskYaml.includes("0".repeat(40)));
  assert.match(taskYaml, /timeout_s: 300/);
  assert.match(taskYaml, /# Zadanie-demo\./);
  assert.equal(response.demoTasksPinned, 1);

  // Instrukcja klonu dla CLI + gitignore zanim klon wyląduje.
  assert.deepEqual(response.baseRepoClone, {
    name: "shop-app",
    url: "git@github.com:acme/shop-app.git",
    rootDir: "/somewhere/shop-app",
    dest: ".repos/shop-app",
  });
  assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes(".repos/"));
  const manifest = JSON.parse(readFileSync(join(target, ".bench-kit", "instance.json"), "utf8"));
  assert.equal(manifest.detectedBaseRepo.name, "shop-app");
});

test("init: preferuje https, gdy CLI zgłasza osiągalność", () => {
  const { target, response } = initInstance("0.1.0", {
    detectedBaseRepo: {
      rootDir: "/somewhere/shop-app",
      name: "shop-app",
      url: "git@github.com:acme/shop-app.git",
      headCommit: "a".repeat(40),
      httpsReachable: true,
    },
  });

  const config = readFileSync(join(target, "bench.config.yaml"), "utf8");
  assert.match(config, /url: https:\/\/github\.com\/acme\/shop-app\.git/);
  assert.ok(!config.includes("git@github.com"));
  assert.equal(response.baseRepoClone.url, "https://github.com/acme/shop-app.git");
});

test("init: zostawia placeholder, gdy init biegnie wewnątrz samej instancji", () => {
  const template = buildTemplateFixture();
  const target = join(tempDir("bootstrap-target-"), "instance");
  const response = runBootstrap(
    baseRequest(template, target, {
      detectedBaseRepo: {
        rootDir: target,
        name: "instance",
        url: "git@github.com:acme/instance.git",
        headCommit: "b".repeat(40),
        httpsReachable: false,
      },
    }),
  );

  assert.equal(response.ok, true);
  assert.match(readFileSync(join(target, "bench.config.yaml"), "utf8"), /name: demo-app/);
  assert.equal(response.baseRepo, null);
  assert.equal(response.baseRepoClone, null);
});

test("init: odmawia niepustego katalogu, który nie jest instancją", () => {
  const template = buildTemplateFixture();
  const target = tempDir("bootstrap-target-");
  writeFileSync(join(target, "unrelated.txt"), "not an instance\n");

  assert.equal(codeOf(() => runBootstrap(baseRequest(template, target))), "target_not_empty");
});

test("repair: nie nadpisuje istniejących plików, przywraca brakujące, bez git init", () => {
  const template = buildTemplateFixture();
  const target = tempDir("bootstrap-target-");
  // Istniejąca instancja: VERSION jest, plik firmy zmieniony, plik template'u brakuje.
  mkdirSync(join(target, ".bench-kit"), { recursive: true });
  writeFileSync(join(target, ".bench-kit", "VERSION"), "0.1.0\n");
  writeFileSync(join(target, "bench.config.yaml"), "base_repos: [edited by company]\n");
  mkdirSync(join(target, ".github", "workflows"), { recursive: true });
  writeFileSync(join(target, ".github", "workflows", "bench-run.yaml"), "name: customized\n");
  mkdirSync(join(target, ".claude", "skills", "bench-task"), { recursive: true });
  writeFileSync(join(target, ".claude", "skills", "bench-task", "SKILL.md"), "# customized skill\n");

  const response = runBootstrap(baseRequest(template, target));

  assert.equal(response.ok, true);
  assert.equal(response.mode, "repair");
  // Brakujący plik template'u przywrócony…
  assert.ok(existsSync(join(target, "tasks", "demo", "prompt.md")));
  // …treść firmy nietknięta…
  assert.match(readFileSync(join(target, "bench.config.yaml"), "utf8"), /edited by company/);
  assert.equal(
    readFileSync(join(target, ".github", "workflows", "bench-run.yaml"), "utf8"),
    "name: customized\n",
  );
  assert.equal(
    readFileSync(join(target, ".claude", "skills", "bench-task", "SKILL.md"), "utf8"),
    "# customized skill\n",
  );
  // …i żadnego świeżego git init w trybie repair.
  assert.equal(existsSync(join(target, ".git")), false);
  assert.equal(response.gitInitialized, false);
});

test("repair: zachowuje initializedAt i narzędzie z istniejącego manifestu", () => {
  const template = buildTemplateFixture();
  const target = tempDir("bootstrap-target-");
  mkdirSync(join(target, ".bench-kit"), { recursive: true });
  writeFileSync(join(target, ".bench-kit", "VERSION"), "0.1.0\n");
  writeFileSync(
    join(target, ".bench-kit", "instance.json"),
    JSON.stringify({
      templateVersion: "0.1.0",
      templateRef: "latest",
      templateSource: "https://github.com/przeprogramowani/10x-bench-kit",
      initializedAt: "2026-08-01T00:00:00.000Z",
      tool: "codex",
    }),
  );

  // Żądanie niesie domyślne narzędzie CLI — repair ma uszanować manifest
  // (codex) poprzez mapę toolProfiles, bez czytania instance.json w CLI.
  const response = runBootstrap(
    baseRequest(template, target, {
      toolProfiles: { "claude-code": ".claude/skills", codex: ".agents/skills" },
    }),
  );

  assert.equal(response.ok, true);
  assert.equal(response.tool, "codex");
  assert.equal(response.skillRoot, ".agents/skills");
  assert.ok(existsSync(join(target, ".agents", "skills", "bench-task", "SKILL.md")));
  assert.equal(existsSync(join(target, ".claude")), false);
  const manifest = JSON.parse(readFileSync(join(target, ".bench-kit", "instance.json"), "utf8"));
  assert.equal(manifest.tool, "codex");
  assert.equal(manifest.initializedAt, "2026-08-01T00:00:00.000Z");
});

test("update: strefy — runtime wymieniony, propozycje zsynchronizowane, strefa firmy nietknięta", () => {
  const { target } = initInstance("0.1.0");
  // Edycje firmy od initu: własny skill, zmieniony config, osierocony plik runtime.
  mkdirSync(join(target, ".claude", "skills", "company-skill"), { recursive: true });
  writeFileSync(join(target, ".claude", "skills", "company-skill", "SKILL.md"), "# ours\n");
  writeFileSync(join(target, "bench.config.yaml"), "base_repos: [edited by company]\n");
  mkdirSync(join(target, "evaluation-pool"), { recursive: true });
  writeFileSync(join(target, "evaluation-pool", "company.md"), "# rubryka firmy\n");
  writeFileSync(join(target, ".bench-kit", "obsolete.txt"), "old runtime file\n");
  // Bramka czystego drzewa: firma commituje swoje edycje przed update.
  spawnSync("git", ["add", "-A"], { cwd: target });
  spawnSync("git", ["commit", "-m", "company edits"], { cwd: target });

  const newTemplate = buildTemplateFixture("0.2.0");
  const response = runBootstrap(
    baseRequest(newTemplate, target, {
      mode: "update",
      toolProfiles: { "claude-code": ".claude/skills", codex: ".agents/skills" },
    }),
  );

  assert.equal(response.ok, true);
  assert.equal(response.upToDate, false);
  assert.equal(response.fromVersion, "0.1.0");
  assert.equal(response.templateVersion, "0.2.0");
  // Runtime wymieniony w całości — osierocony plik znika.
  assert.equal(readFileSync(join(target, ".bench-kit", "VERSION"), "utf8").trim(), "0.2.0");
  assert.equal(existsSync(join(target, ".bench-kit", "obsolete.txt")), false);
  // Workflowy na nowej wersji.
  assert.equal(
    readFileSync(join(target, ".github", "workflows", "bench-run.yaml"), "utf8"),
    "name: bench-run (0.2.0)\n",
  );
  // Skill template'u zaktualizowany w miejscu (git diff to propozycja)…
  assert.equal(
    readFileSync(join(target, ".claude", "skills", "bench-task", "SKILL.md"), "utf8"),
    "# bench-task (0.2.0)\n",
  );
  // …skill firmy nigdy nie kasowany, pula ocen i config firmy nietknięte.
  assert.equal(
    readFileSync(join(target, ".claude", "skills", "company-skill", "SKILL.md"), "utf8"),
    "# ours\n",
  );
  assert.match(readFileSync(join(target, "bench.config.yaml"), "utf8"), /edited by company/);
  assert.equal(readFileSync(join(target, "evaluation-pool", "company.md"), "utf8"), "# rubryka firmy\n");
  // Pliki współdzielone korzenia — propozycja jak skille.
  assert.equal(readFileSync(join(target, "AGENTS.md"), "utf8"), "# agents (0.2.0)\n");

  // Manifest przeżywa wymianę, z podbitą wersją.
  const manifest = JSON.parse(readFileSync(join(target, ".bench-kit", "instance.json"), "utf8"));
  assert.equal(manifest.templateVersion, "0.2.0");
  assert.equal(manifest.initializedAt, "2026-08-17T12:00:00.000Z");
  assert.equal(manifest.updatedAt, "2026-08-17T12:00:00.000Z");
  assert.equal(response.zones.benchKit, "replaced");
  assert.equal(response.zones.skills.updated, 1);
  assert.equal(response.zones.shared.updated, 1);
});

test("update: honoruje narzędzie z manifestu poprzez mapę toolProfiles", () => {
  const { target } = initInstance("0.1.0");
  const manifestPath = join(target, ".bench-kit", "instance.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.tool = "codex";
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  spawnSync("git", ["add", "-A"], { cwd: target });
  spawnSync("git", ["commit", "-m", "switch tool"], { cwd: target });

  const newTemplate = buildTemplateFixture("0.2.0");
  const response = runBootstrap(
    baseRequest(newTemplate, target, {
      mode: "update",
      toolProfiles: { "claude-code": ".claude/skills", codex: ".agents/skills" },
    }),
  );

  assert.equal(response.ok, true);
  assert.equal(response.tool, "codex");
  assert.equal(
    readFileSync(join(target, ".agents", "skills", "bench-task", "SKILL.md"), "utf8"),
    "# bench-task (0.2.0)\n",
  );
});

test("update: no-op, gdy instancja już jest na wersji template'u", () => {
  const { target } = initInstance("0.1.0");
  const sameTemplate = buildTemplateFixture("0.1.0");
  const response = runBootstrap(baseRequest(sameTemplate, target, { mode: "update" }));
  assert.equal(response.ok, true);
  assert.equal(response.upToDate, true);
});

test("update: odmawia brudnego drzewa i niczego nie dotyka", () => {
  const { target } = initInstance("0.1.0");
  writeFileSync(join(target, "bench.config.yaml"), "base_repos: [uncommitted edit]\n");

  const newTemplate = buildTemplateFixture("0.2.0");
  assert.equal(
    codeOf(() => runBootstrap(baseRequest(newTemplate, target, { mode: "update" }))),
    "dirty_tree",
  );
  assert.equal(readFileSync(join(target, ".bench-kit", "VERSION"), "utf8").trim(), "0.1.0");
});

test("update: odmawia katalogu, który nie jest instancją", () => {
  const template = buildTemplateFixture("0.2.0");
  const target = tempDir("bootstrap-target-");
  assert.equal(
    codeOf(() => runBootstrap(baseRequest(template, target, { mode: "update" }))),
    "not_an_instance",
  );
});

test("kontrakt: niedopasowana contractVersion → ok:false, kod contract_mismatch (przez stdin/stdout)", () => {
  const template = buildTemplateFixture();
  const target = join(tempDir("bootstrap-target-"), "instance");
  const request = baseRequest(template, target, { contractVersion: 999 });

  const result = spawnSync(process.execPath, [BOOTSTRAP], {
    input: JSON.stringify(request),
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n");
  const response = JSON.parse(lines[lines.length - 1]);
  assert.equal(response.ok, false);
  assert.equal(response.code, "contract_mismatch");
  assert.ok(response.hint.length > 0);
  assert.equal(existsSync(target), false);
});

test("kontrakt: niekompletny template (brak VERSION) → template_incomplete", () => {
  const template = tempDir("bootstrap-template-");
  const target = join(tempDir("bootstrap-target-"), "instance");
  assert.equal(
    codeOf(() => runBootstrap(baseRequest(template, target))),
    "template_incomplete",
  );
});
