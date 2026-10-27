#!/usr/bin/env node
/**
 * Bootstrap instancji — strona kitu kontraktu z 10x-cli.
 *
 * Zasada podziału: kit zna siebie, CLI zna maszynę użytkownika. CLI
 * klonuje template (sieć), wykrywa repo bazowe i profil narzędzia,
 * po czym woła:
 *
 *     node <klon>/.bench-kit/bootstrap/index.mjs   # żądanie JSON na stdin
 *
 * Cała wiedza o układzie plików kitu i semantyce jego treści żyje tutaj —
 * dzięki temu `update` wykonuje bootstrap z NOWEJ wersji kitu, więc
 * template, który zmienia układ, przywozi ze sobą kod migracji.
 *
 * Granica zaufania: CLI wykonuje ten plik wyłącznie z klonu
 * TEMPLATE_REPO_URL i wyłącznie z tagu.
 *
 * Odpowiedź: JSON w OSTATNIEJ linii stdout (postęp idzie na stderr).
 * Błąd: { ok: false, code, message, hint } i wyjście 1.
 *
 * Kody błędów: contract_mismatch, invalid_request, template_incomplete,
 * target_not_empty, not_an_instance, dirty_tree, git_init_failed,
 * bootstrap_failed.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  BASE_REPOS_DIR,
  ensureIgnored,
  loadYaml,
  pinPlaceholderTasks,
  registerBaseRepo,
  toHttpsUrl,
} from "./content.mjs";
import {
  readInstanceVersion,
  readManifest,
  readTemplateVersion,
  writeManifest,
} from "./manifest.mjs";
import {
  SHARED_ROOT_FILES,
  addSync,
  installWorkflows,
  isTemplateOnly,
  materialize,
  relPosix,
  removeRetiredSkills,
  syncDir,
  syncFile,
  templateSkillSource,
} from "./zones.mjs";

export const CONTRACT_VERSION = 1;

const log = (msg) => process.stderr.write(`bootstrap: ${msg}\n`);

class BootstrapError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    error: result.stderr ?? (result.error ? result.error.message : ""),
  };
}

/**
 * `bench doctor --json` zaraz po init: braki (silnik, klucze, repo bazowe)
 * wychodzą w terminalu init, ZANIM użytkownik otworzy agenta — sesja
 * agenta dziedziczy env, w którym ją uruchomiono, więc klucz dodany
 * później wymagałby restartu narzędzia. Porażka samego doctora = null
 * (raport init bez sekcji środowiska), nigdy błąd init.
 */
function runDoctor(targetDir) {
  const entry = join(targetDir, ".bench-kit", "runner", "src", "index.ts");
  if (!existsSync(entry)) return null;
  log("sprawdzam środowisko (bench doctor)");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", entry, "doctor", "--json", "--root", targetDir], {
    encoding: "utf8",
    timeout: 120_000,
  });
  try {
    const report = JSON.parse((result.stdout ?? "").trim().split("\n").pop() ?? "");
    return {
      missing: report.missing,
      warns: report.warns,
      ok: report.checks.filter((c) => c.status === "OK").map((c) => c.name),
      problems: report.checks.filter((c) => c.status !== "OK"),
    };
  } catch {
    return null;
  }
}

const TOOL_NAMES = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  codex: "Codex",
  gemini: "Gemini CLI",
  kiro: "Kiro",
  factory: "Factory",
  "devin-desktop": "Devin",
};

/** README instancji — o TEJ instancji, nie o template'cie (ten zostaje w repo kitu). */
function instanceReadme({ name, baseRepo, tool, skillRoot, templateVersion, templateSource }) {
  return `# ${name}

AI agent benchmark for ${baseRepo ? `\`${baseRepo.name}\` (${baseRepo.url})` : "your product repositories"},
created with \`10x bench-kit init\` from [10x-bench-kit](${templateSource || "https://github.com/przeprogramowani/10x-bench-kit"}) ${templateVersion}.

## Start here

Open this directory in ${tool} and ask:

> ${FIRST_STEP.prompt}

All benchmark work goes through three skills (installed in \`${skillRoot}/\`):

| Skill | Use it to |
|---|---|
| **bench-define** | Turn merged PRs (or an interview) into tasks: \`tasks/\`, \`evaluation-pool/\`, \`reports/\`. |
| **bench-measure** | Set up the instance, run models on tasks within budget, evaluate attempts. |
| **bench-decide** | Get a verdict: which model (and CLI) for which class of work, at what cost. |

Skills leave files in the working tree and end with a commit plan; you review and commit.

## What lives where

| Path | Contents |
|---|---|
| \`bench.config.yaml\` | Base repos, models under test, judge, budget, trials. |
| \`tasks/\` | Tasks (pin, prompt, overlay) and \`tasks/backlog.md\`. |
| \`evaluation-pool/\` | Rubrics and guards — never visible to the agent under test. |
| \`attempts/\` | Preserved trials (gitignored, local disk). |
| \`results/\` | Evaluated results — commit these. |
| \`.repos/\` | Local clones of base repos (gitignored). |
| \`.bench-kit/\` | Runner and contracts, owned by the kit — do not edit. |

## Update the kit

\`\`\`bash
10x bench-kit update
\`\`\`

Release notes: ${(templateSource || "https://github.com/przeprogramowani/10x-bench-kit").replace(/\.git$/, "")}/blob/master/CHANGELOG.md
`;
}

/**
 * `npm ci` w runnerze instancji — PRZED chirurgią na yamlu, bo content.mjs
 * pożycza pakiet `yaml` z `.bench-kit/runner/node_modules`. Porażka
 * degraduje do warninga, nigdy nie blokuje.
 */
function installRunnerDependencies(targetDir) {
  const runnerDir = join(targetDir, ".bench-kit", "runner");
  if (!existsSync(join(runnerDir, "package.json"))) return "skipped";
  log("instaluję zależności runnera (npm ci w .bench-kit/runner)");
  const result = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: runnerDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    log(`npm ci padło (${(result.stderr ?? "").trim().split("\n").pop() ?? ""})`);
    return "failed";
  }
  return "installed";
}

function validateRequest(request) {
  if (typeof request !== "object" || request === null) {
    throw new BootstrapError("invalid_request", "Żądanie nie jest obiektem JSON.");
  }
  if (request.contractVersion !== CONTRACT_VERSION) {
    throw new BootstrapError(
      "contract_mismatch",
      `Bootstrap obsługuje kontrakt ${CONTRACT_VERSION}, żądanie niesie ${request.contractVersion}.`,
      "Zaktualizuj 10x-cli albo wskaż tag template'u pasujący do tej wersji CLI.",
    );
  }
  for (const field of ["mode", "templateDir", "targetDir"]) {
    if (typeof request[field] !== "string" || request[field] === "") {
      throw new BootstrapError("invalid_request", `Żądanie nie ma pola '${field}'.`);
    }
  }
  if (!["init", "update", "repair"].includes(request.mode)) {
    throw new BootstrapError("invalid_request", `Nieznany tryb '${request.mode}'.`);
  }
  if (typeof request.tool?.id !== "string" || typeof request.tool?.skillRoot !== "string") {
    throw new BootstrapError("invalid_request", "Żądanie nie ma pola 'tool' ({ id, skillRoot }).");
  }
  if (request.deepClone !== undefined && typeof request.deepClone !== "boolean") {
    throw new BootstrapError("invalid_request", "Pole 'deepClone' musi być boolean.");
  }
  if (request.shallowClone !== undefined && typeof request.shallowClone !== "boolean") {
    throw new BootstrapError("invalid_request", "Pole 'shallowClone' musi być boolean.");
  }
}

function requireTemplateVersion(templateDir) {
  const version = readTemplateVersion(templateDir);
  if (version === null) {
    throw new BootstrapError(
      "template_incomplete",
      "Klon template'u nie ma pliku .bench-kit/VERSION.",
      "Wskaż poprawny tag template'u.",
    );
  }
  return version;
}

/**
 * init/repair: materializacja template'u, skille wg profilu narzędzia,
 * workflowy, npm ci, rejestracja wykrytego repo bazowego, manifest,
 * świeże `git init` + pierwszy commit. Zwraca instrukcję klonu repo
 * bazowego — sam klon wykonuje CLI (sieć zostaje po jego stronie).
 * Instrukcja niesie `depth`: null (pełna historia, domyślnie) albo 1
 * (sam HEAD, gdy żądanie ma `shallowClone: true`).
 */
function runInit(request) {
  const { templateDir, targetDir } = request;
  const warnings = [];
  const templateVersion = requireTemplateVersion(templateDir);

  const existingVersion = readInstanceVersion(targetDir);
  const repair = request.mode === "repair" || existingVersion !== null;
  if (!repair && existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new BootstrapError(
      "target_not_empty",
      `Katalog '${targetDir}' nie jest pusty i nie jest instancją benchmarku.`,
      "Wskaż pusty lub nieistniejący katalog.",
    );
  }
  const existingManifest = repair ? readManifest(targetDir) : null;

  // Repair szanuje narzędzie z manifestu instancji (skille wracają tam,
  // gdzie instancja je trzyma), chyba że użytkownik jawnie wybrał inne
  // (--tool → request.tool.explicit). Mapę id → skillRoot dostarcza CLI.
  let tool = request.tool;
  const profiles = request.toolProfiles ?? {};
  if (
    repair &&
    request.tool.explicit !== true &&
    typeof existingManifest?.tool === "string" &&
    typeof profiles[existingManifest.tool] === "string"
  ) {
    tool = { id: existingManifest.tool, skillRoot: profiles[existingManifest.tool] };
  }

  mkdirSync(targetDir, { recursive: true });
  const skillSource = templateSkillSource(templateDir);
  // Skille idą wg profilu narzędzia, więc materializacja je pomija;
  // wpisy template-only (własne CI template'u, grafika README) nie należą
  // do instancji wcale.
  const copied = materialize(templateDir, targetDir, {
    skipExisting: repair,
    skip: (rel) => {
      const posix = relPosix(rel);
      if (isTemplateOnly(posix)) return true;
      return posix === skillSource || posix.startsWith(`${skillSource}/`);
    },
  });
  const readmePath = join(targetDir, "README.md");
  const writeReadme = !existsSync(readmePath);
  const skills = syncDir(join(templateDir, skillSource), join(targetDir, tool.skillRoot), {
    overwrite: !repair,
  });
  const workflows = installWorkflows(targetDir, { skipExisting: repair });

  // npm ci PRZED chirurgią yaml — patrz content.mjs.
  const runnerDeps = installRunnerDependencies(targetDir);

  let baseRepo = null;
  let demoTasksPinned = 0;
  let baseRepoClone = null;
  const detected = request.detectedBaseRepo ?? null;
  if (!repair && detected !== null && resolve(detected.rootDir) !== resolve(targetDir)) {
    // https zamiast SSH, gdy repo odpowiada publicznie: https klonuje się
    // w CI/kontenerach bez sekretów, SSH zawsze żąda klucza. Sondę
    // osiągalności wykonało CLI (sieć) — tu tylko decyzja.
    let repo = { ...detected };
    delete repo.httpsReachable;
    const https = toHttpsUrl(detected.url);
    if (https !== null && detected.httpsReachable === true) {
      repo = { ...repo, url: https };
      log(`repo odpowiada po https — używam ${https} zamiast SSH`);
    } else if (https !== null) {
      warnings.push(
        `The base repo is registered with its SSH URL (${detected.url}) because ${https} did not answer without credentials. ` +
          "Local runs use your SSH keys; for CI set BASE_REPO_TOKEN (see the comment in bench.config.yaml).",
      );
    }
    const yaml = loadYaml(targetDir);
    if (yaml === null) {
      warnings.push(
        "Pakiet yaml niedostępny (npm ci padło?) — repo bazowe niezarejestrowane; uzupełnij bench.config.yaml ręcznie.",
      );
    } else if (registerBaseRepo(yaml, join(targetDir, "bench.config.yaml"), repo)) {
      baseRepo = repo;
      log(`zarejestrowałem repo bazowe ${repo.name} (${repo.url})`);
      demoTasksPinned = pinPlaceholderTasks(yaml, join(targetDir, "tasks"), repo);
      if (demoTasksPinned > 0) {
        log(`zapinowałem ${demoTasksPinned} zadanie/zadania-demo na ${repo.headCommit.slice(0, 12)}`);
      }
    }
    if (baseRepo !== null) {
      ensureIgnored(targetDir, `${BASE_REPOS_DIR}/`);
      // Domyślnie PEŁNA historia (`depth: null`): kopanie PR-ów — domyślne
      // źródło zadań od 0.33.0 — czyta historię, a klon idzie z lokalnej
      // kopii roboczej (hardlinki obiektów: sekundy, prawie zero dysku).
      // Dogłębianie płytkiego klonu szłoby za to przez sieć do origin
      // (SSH/token) — wolniej i z ryzykiem auth w samym środku budowy.
      // `--shallow` w CLI (request.shallowClone) zostawia sam HEAD dla
      // repo, których historii nie chcesz kopiować.
      baseRepoClone = {
        name: baseRepo.name,
        url: baseRepo.url,
        rootDir: detected.rootDir,
        dest: `${BASE_REPOS_DIR}/${baseRepo.name}`,
        depth: request.shallowClone === true ? 1 : null,
      };
    }
  }

  const now = request.now ?? new Date().toISOString();
  const manifest = {
    templateVersion,
    templateRef: request.templateRef ?? "latest",
    templateSource: request.templateSource ?? existingManifest?.templateSource ?? "",
    initializedAt: existingManifest?.initializedAt ?? now,
    tool: tool.id,
    skillRoot: tool.skillRoot,
    ...(existingManifest?.updatedAt === undefined ? {} : { updatedAt: existingManifest.updatedAt }),
    ...(baseRepo !== null
      ? { detectedBaseRepo: baseRepo }
      : existingManifest?.detectedBaseRepo !== undefined
        ? { detectedBaseRepo: existingManifest.detectedBaseRepo }
        : {}),
  };
  writeManifest(targetDir, manifest);
  if (writeReadme) {
    writeFileSync(
      readmePath,
      instanceReadme({
        name: basename(targetDir),
        baseRepo,
        tool: TOOL_NAMES[tool.id] ?? "your AI coding tool",
        skillRoot: tool.skillRoot,
        templateVersion,
        templateSource: manifest.templateSource,
      }),
    );
  }

  let committed = false;
  if (!repair) {
    const init = runGit(["init"], targetDir);
    if (!init.ok) {
      throw new BootstrapError(
        "git_init_failed",
        "Nie udało się zainicjalizować repozytorium git w katalogu instancji.",
        init.error ? `Git: ${init.error.trim()}` : undefined,
      );
    }
    const add = runGit(["add", "-A"], targetDir);
    const commit = add.ok
      ? runGit(["commit", "-m", `chore: bench-kit init (template ${templateVersion})`], targetDir)
      : add;
    if (!commit.ok) {
      warnings.push("Pierwszy commit nie powstał — pliki są w stage'u, zacommituj ręcznie.");
    } else {
      committed = true;
    }
  }

  const doctor = !repair && runnerDeps === "installed" ? runDoctor(targetDir) : null;

  return {
    ok: true,
    mode: repair ? "repair" : "init",
    doctor,
    templateVersion,
    tool: tool.id,
    skillRoot: tool.skillRoot,
    manifest,
    filesCopied: copied + skills.added,
    summary: [
      { zone: ".bench-kit/", action: repair ? "restored" : "materialized" },
      { zone: ".github/workflows/", ...workflows },
      { zone: `${tool.skillRoot}/`, ...skills },
    ],
    baseRepo,
    demoTasksPinned,
    baseRepoClone,
    runnerDeps,
    gitInitialized: !repair,
    committed,
    warnings,
    nextSteps: repair
      ? ["Przejrzyj przywrócone pliki; zadania, evaluation-pool i config zostały nietknięte."]
      : ["Podepnij sekrety, potem uruchom 'npm run bench --prefix .bench-kit/runner -- validate' przed pierwszym runem."],
    // Pierwsze polecenie dla agenta w nowej instancji — CLI drukuje je
    // dosłownie (kit zna nazwy swoich skilli, CLI nie).
    ...(repair ? {} : { nextStep: FIRST_STEP }),
  };
}

/**
 * update: `.bench-kit/` wymieniane w całości (manifest przeżywa,
 * z podbitą wersją); workflowy, skille i pliki współdzielone korzenia
 * synchronizowane do working tree jako niezacommitowana propozycja —
 * stąd bramka czystego drzewa. Strefa firmy (tasks/, evaluation-pool/,
 * bench.config.yaml) nietykalna.
 */
function runUpdate(request) {
  const { templateDir, targetDir } = request;
  const warnings = [];

  const currentVersion = readInstanceVersion(targetDir);
  if (currentVersion === null) {
    throw new BootstrapError(
      "not_an_instance",
      `Katalog '${targetDir}' nie jest instancją benchmarku (brak .bench-kit/VERSION).`,
      "Uruchom '10x bench-kit init <katalog>', żeby ją utworzyć.",
    );
  }
  const newVersion = requireTemplateVersion(templateDir);

  // Propozycja przyjeżdża jako niezacommitowane zmiany; brudne drzewo
  // zmieszałoby ją z niepowiązanymi edycjami i uniemożliwiło review.
  const status = runGit(["status", "--porcelain"], targetDir);
  if (status.ok && status.stdout.trim() !== "") {
    throw new BootstrapError(
      "dirty_tree",
      "Instancja ma niezacommitowane zmiany — update dostarcza propozycję jako git diff i wymaga czystego drzewa.",
      "Zacommituj albo zestashuj zmiany i uruchom update ponownie.",
    );
  }
  if (!status.ok) {
    warnings.push("To nie jest repozytorium git — przejrzyj zmiany bez git diff.");
  }

  const manifest = readManifest(targetDir);
  if (newVersion === currentVersion) {
    return {
      ok: true,
      mode: "update",
      upToDate: true,
      templateVersion: currentVersion,
      warnings,
      nextSteps: [],
    };
  }

  // Profil narzędzia: manifest instancji wie, dla jakiego narzędzia
  // została zainicjalizowana; mapę id → skillRoot dostarcza CLI
  // (to wiedza o maszynie użytkownika, nie o kicie).
  const profiles = request.toolProfiles ?? {};
  let tool = request.tool;
  if (manifest?.tool !== undefined && typeof profiles[manifest.tool] === "string") {
    tool = { id: manifest.tool, skillRoot: profiles[manifest.tool] };
  }

  const now = request.now ?? new Date().toISOString();
  const updatedManifest = {
    templateVersion: newVersion,
    templateRef: request.templateRef ?? "latest",
    templateSource: request.templateSource ?? manifest?.templateSource ?? "",
    initializedAt: manifest?.initializedAt ?? now,
    tool: tool.id,
    skillRoot: tool.skillRoot,
    updatedAt: now,
    ...(manifest?.detectedBaseRepo === undefined
      ? {}
      : { detectedBaseRepo: manifest.detectedBaseRepo }),
  };

  // Strefa .bench-kit/ — wymiana w całości, w miarę atomowa: nowe drzewo
  // (z podbitym manifestem) staje obok starego, potem swap — crash w pół
  // kopii nie zostawi bezwersyjnej pół-instancji.
  const staging = join(targetDir, ".bench-kit.update-staging");
  rmSync(staging, { recursive: true, force: true });
  cpSync(join(templateDir, ".bench-kit"), staging, { recursive: true });
  writeFileSync(join(staging, "instance.json"), `${JSON.stringify(updatedManifest, null, 2)}\n`);
  rmSync(join(targetDir, ".bench-kit"), { recursive: true, force: true });
  renameSync(staging, join(targetDir, ".bench-kit"));

  const workflows = installWorkflows(targetDir, { skipExisting: false });

  const skillSource = templateSkillSource(templateDir);
  const skills = syncDir(join(templateDir, skillSource), join(targetDir, tool.skillRoot), {
    overwrite: true,
  });
  const retiredSkills = removeRetiredSkills(join(templateDir, skillSource), join(targetDir, tool.skillRoot));
  skills.removed = retiredSkills.length;
  if (retiredSkills.length > 0) {
    warnings.push(
      `Wycofane skille usunięte (procedury przeniesione do bench-define / bench-measure / bench-decide): ${retiredSkills.join(", ")}. ` +
        "Lokalne dostosowania tych skilli są w historii gita — przenieś je do nowych plików procedur, jeśli były.",
    );
  }

  const shared = { added: 0, updated: 0, unchanged: 0 };
  for (const file of SHARED_ROOT_FILES) {
    addSync(shared, syncFile(join(templateDir, file), join(targetDir, file)));
  }

  // Wymiana w całości właśnie skasowała node_modules runnera — reinstalacja,
  // żeby pierwsza komenda `bench` po update nie padła na MODULE_NOT_FOUND.
  const runnerDeps = installRunnerDependencies(targetDir);

  return {
    ok: true,
    mode: "update",
    upToDate: false,
    fromVersion: currentVersion,
    templateVersion: newVersion,
    manifest: updatedManifest,
    tool: tool.id,
    skillRoot: tool.skillRoot,
    runnerDeps,
    zones: { benchKit: "replaced", workflows, skills, shared },
    summary: [
      { zone: ".bench-kit/", action: "replaced" },
      { zone: ".github/workflows/", ...workflows },
      { zone: `${tool.skillRoot}/`, ...skills },
      { zone: SHARED_ROOT_FILES.join(", "), ...shared },
    ],
    warnings,
    nextSteps: [
      "Przejrzyj 'git diff', uruchom 'npm run bench --prefix .bench-kit/runner -- validate' (wyłapie zmiany schematu), potem commit przez PR.",
    ],
  };
}

export const FIRST_STEP = {
  skill: "bench-status",
  prompt: "Use bench-status to check this instance is ready, then use bench-define to mine our merged PRs for tasks.",
};

export function runBootstrap(request) {
  validateRequest(request);
  return request.mode === "update" ? runUpdate(request) : runInit(request);
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let response;
  try {
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      throw new BootstrapError("invalid_request", "Żądanie na stdin nie jest poprawnym JSON-em.");
    }
    response = runBootstrap(request);
  } catch (err) {
    const known = err instanceof BootstrapError;
    response = {
      ok: false,
      code: known ? err.code : "bootstrap_failed",
      message: err instanceof Error ? err.message : String(err),
      ...(known && err.hint !== undefined ? { hint: err.hint } : {}),
    };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exit(response.ok ? 0 : 1);
}

// Uruchomiony jako skrypt (nie zaimportowany w testach) — czytaj stdin.
// realpathSync po obu stronach: node rozwiązuje symlinki w ścieżce entry
// (import.meta.url), argv[1] zostaje surowe — bez tego wywołanie z klonu
// w macOS-owym tmpdir (/var/folders → /private/var) cicho pomija main().
const { pathToFileURL } = await import("node:url");
if (process.argv[1]) {
  let invoked = resolve(process.argv[1]);
  try {
    invoked = realpathSync(invoked);
  } catch {
    // Ścieżka nie istnieje — porównanie i tak nie trafi.
  }
  if (import.meta.url === pathToFileURL(invoked).href) {
    await main();
  }
}
