/**
 * bench doctor — deterministyczna checklista środowiska instancji.
 *
 * To, co dotąd było prozą w skillu bench-wiring (i pracą agenta powtarzaną
 * w każdej firmie), a jest w 100% deterministyczne: silnik kontenerów,
 * wersja node, zależności runnera, klucze API (sama obecność, nigdy
 * wartości), remote repo instancji, klonowalność repo bazowych, workflows.
 *
 * Wyjście: tabela OK/BRAK + jedno zdanie "co zrobić" przy każdym braku.
 * Kod 0 gdy wszystko OK (warningi dopuszczalne), 1 gdy jakikolwiek BRAK.
 *
 * Użycie: bench doctor [--offline] [--engine docker|podman] [--root <dir>]
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { findInstanceRoot, loadConfig } from "../lib/instance.ts";
import type { BenchConfig } from "../schemas/config.ts";
import { sh } from "../lib/containers.ts";
import { gitAuthArgs } from "../lib/git-auth.ts";

interface Options {
  root: string;
  offline: boolean;
  engine: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), offline: false, engine: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--offline") opts.offline = true;
    else if (arg === "--engine") {
      const value = args[++i];
      if (!value) return null;
      opts.engine = value;
    } else if (arg === "--root") {
      const value = args[++i];
      if (!value) return null;
      opts.root = resolve(value);
    } else return null;
  }
  return opts;
}

interface CheckResult {
  name: string;
  status: "OK" | "BRAK" | "WARN";
  detail: string;
  fix?: string;
}

/** Klucz API wymagany przez model w formacie <provider>/<model>. */
function requiredKeyFor(model: string): string | null {
  const provider = model.split("/")[0];
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "openrouter") return "OPENROUTER_API_KEY";
  return null;
}

export async function doctorCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench doctor [--offline] [--engine docker|podman] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }

  const checks: CheckResult[] = [];

  // --- silnik kontenerów ---
  const engines = opts.engine ? [opts.engine] : ["docker", "podman"];
  const alive = engines.find((engine) => sh(engine, ["info"], { timeout: 15_000 }).status === 0);
  checks.push(
    alive
      ? { name: "silnik kontenerów", status: "OK", detail: alive }
      : {
          name: "silnik kontenerów",
          status: "BRAK",
          detail: `${engines.join("/")} nie odpowiada`,
          fix: "uruchom Docker Desktop / `podman machine start` (próby i ocena biegną w kontenerach)",
        },
  );

  // --- node ---
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push(
    nodeMajor >= 20
      ? { name: "node", status: "OK", detail: `v${process.versions.node}` }
      : { name: "node", status: "BRAK", detail: `v${process.versions.node}`, fix: "zainstaluj node >= 20 (engines runnera)" },
  );

  // --- zależności runnera ---
  const runnerModules = join(root, ".bench-kit", "runner", "node_modules");
  checks.push(
    existsSync(runnerModules)
      ? { name: "zależności runnera", status: "OK", detail: ".bench-kit/runner/node_modules" }
      : {
          name: "zależności runnera",
          status: "BRAK",
          detail: "node_modules nie istnieje",
          fix: "npm ci --prefix .bench-kit/runner (po init i po każdym `bench-kit update`)",
        },
  );

  // --- config + klucze API (sama obecność, nigdy wartości) ---
  let config: BenchConfig | null = null;
  try {
    config = loadConfig(root);
    checks.push({ name: "bench.config.yaml", status: "OK", detail: "parsuje się schematem" });
  } catch {
    checks.push({
      name: "bench.config.yaml",
      status: "BRAK",
      detail: "nie parsuje się schematem",
      fix: "uruchom `bench validate` i popraw zgłoszone pola",
    });
  }

  const presentKeys = Object.keys(process.env).filter((name) => /_API_KEY$/.test(name));
  if (config) {
    const needed = new Set(
      [config.judge.model, ...config.defaults.models].map(requiredKeyFor).filter((k): k is string => k !== null),
    );
    for (const key of [...needed].sort()) {
      checks.push(
        presentKeys.includes(key)
          ? { name: `klucz ${key}`, status: "OK", detail: "obecny w env" }
          : {
              name: `klucz ${key}`,
              status: "BRAK",
              detail: "brak w env",
              fix: `wyeksportuj ${key} lokalnie i ustaw jako sekret repo instancji (dla CI)`,
            },
      );
    }
  } else if (presentKeys.length === 0) {
    checks.push({
      name: "klucze API",
      status: "BRAK",
      detail: "żaden *_API_KEY w env",
      fix: "wyeksportuj klucze modeli i sędziego (np. OPENROUTER_API_KEY)",
    });
  }

  // --- remote repo instancji (potrzebny dla workflows i sekretów CI) ---
  const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 10_000 });
  checks.push(
    remote.status === 0
      ? { name: "remote instancji", status: "OK", detail: remote.stdout.trim() }
      : {
          name: "remote instancji",
          status: "WARN",
          detail: "brak origin",
          fix: "utwórz repo instancji i `git remote add origin …` (bez tego nie ma runów w CI ani sekretów)",
        },
  );

  // --- workflows ---
  for (const workflow of ["bench-run.yaml", "leaderboard.yaml"]) {
    const path = join(root, ".github", "workflows", workflow);
    checks.push(
      existsSync(path)
        ? { name: `workflow ${workflow}`, status: "OK", detail: `.github/workflows/${workflow}` }
        : {
            name: `workflow ${workflow}`,
            status: "BRAK",
            detail: "nie istnieje",
            fix: "skopiuj z .bench-kit/workflows/ (init/update robi to automatycznie w nowszych wersjach CLI)",
          },
    );
  }

  // --- klonowalność repo bazowych ---
  if (opts.offline) {
    console.log("info:  --offline — pomijam klonowalność repo bazowych");
  } else if (config) {
    for (const repo of config.base_repos) {
      const result = spawnSync("git", [...gitAuthArgs(), "ls-remote", "--heads", repo.url], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      checks.push(
        result.status === 0
          ? { name: `base_repos/${repo.name}`, status: "OK", detail: repo.url }
          : {
              name: `base_repos/${repo.name}`,
              status: "BRAK",
              detail: `nieosiągalne (${repo.url})`,
              fix: "sprawdź URL (https); dla repo prywatnych ustaw BASE_REPO_TOKEN (fine-grained PAT, contents:read) — sekret w repo instancji, lokalnie eksport w env albo własne poświadczenia gita",
            },
      );
    }
  }

  // --- tabela ---
  const nameWidth = Math.max(...checks.map((c) => c.name.length));
  console.log(`bench doctor: ${root}\n`);
  for (const check of checks) {
    console.log(`${check.status.padEnd(4)}  ${check.name.padEnd(nameWidth)}  ${check.detail}`);
    if (check.fix) console.log(`${"".padEnd(6 + nameWidth)}  → ${check.fix}`);
  }
  const missing = checks.filter((c) => c.status === "BRAK").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  console.log(`\nbench doctor: ${missing} BRAK, ${warns} WARN — ${missing === 0 ? "środowisko gotowe" : "uzupełnij braki powyżej"}`);
  return missing > 0 ? 1 : 0;
}
