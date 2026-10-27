/**
 * bench doctor — deterministyczna checklista środowiska instancji.
 *
 * To, co dotąd było prozą w preflighcie skilla bench-measure (i pracą agenta powtarzaną
 * w każdej firmie), a jest w 100% deterministyczne: silnik kontenerów,
 * wersja node, zależności runnera, klucze API (sama obecność, nigdy
 * wartości), remote repo instancji, klonowalność repo bazowych, workflows.
 *
 * Wyjście: tabela OK/BRAK + jedno zdanie "co zrobić" przy każdym braku.
 * Kod 0 gdy wszystko OK (warningi dopuszczalne), 1 gdy jakikolwiek BRAK.
 *
 * `--json`: jeden obiekt { root, checks, missing, warns } na stdout — tak
 * bootstrap `bench-kit init` pokazuje stan maszyny, zanim ktokolwiek
 * otworzy agenta (sesja agenta dziedziczy env, w którym ją uruchomiono).
 *
 * `--warm`: po checkliście buduje obraz bazowy prób (jednorazowo 1–4 min,
 * potem cache silnika) — bench-status puszcza to w tle, zanim użytkownik
 * skończy wybierać zadania, więc pierwsza budowa zadania na nim nie czeka.
 *
 * Użycie: bench doctor [--offline] [--json] [--warm] [--engine docker|podman] [--root <dir>]
 */
import { existsSync, readdirSync, statfsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findInstanceRoot, loadConfig } from "../lib/instance.ts";
import type { BenchConfig } from "../schemas/config.ts";
import { baseImageTag, engineMemoryBytes, ensureBaseImage, sh } from "../lib/containers.ts";
import { gitAuthArgs } from "../lib/git-auth.ts";
import { requiredKeysFor } from "../lib/harness.ts";

interface Options {
  root: string;
  offline: boolean;
  json: boolean;
  warm: boolean;
  engine: string | null;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), offline: false, json: false, warm: false, engine: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--offline") opts.offline = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--warm") opts.warm = true;
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

export async function doctorCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench doctor [--offline] [--json] [--warm] [--engine docker|podman] [--root <dir>]");
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

  // `info` odpowiada też wtedy, gdy kontener nie wystartuje (np. po OOM padł
  // menedżer systemd użytkownika: crun "sd-bus call: Access denied") — próbny
  // start na obrazie, który już jest lokalnie; bez obrazów nie ma czego sprawdzić.
  if (alive) {
    const probeImage =
      sh(alive, ["image", "inspect", baseImageTag(root)], { timeout: 30_000 }).status === 0
        ? baseImageTag(root)
        : (sh(alive, ["images", "-q"], { timeout: 30_000 }).stdout ?? "").split("\n").find(Boolean);
    if (probeImage) {
      const run = sh(alive, ["run", "--rm", "--network", "none", probeImage, "true"], { timeout: 120_000 });
      if (run.status !== 0) {
        const out = `${run.stderr ?? ""}${run.stdout ?? ""}`;
        const line = out.split("\n").find((l) => /error|denied|failed/i.test(l))?.trim() ?? `exit ${run.status}`;
        checks.push({
          name: "start kontenera",
          status: "BRAK",
          detail: line.slice(0, 200),
          fix: /sd-bus|systemd|Access denied/i.test(out)
            ? "menedżer systemd użytkownika nie działa (częste po OOM): `sudo systemctl restart user@$(id -u)`; doraźnie w tym shellu: plik containers.conf z `[engine]\\ncgroup_manager = \"cgroupfs\"` wskazany przez CONTAINERS_CONF_OVERRIDE"
            : `sprawdź silnik: \`${alive} run --rm ${probeImage} true\``,
        });
      } else {
        checks.push({ name: "start kontenera", status: "OK", detail: `próbny kontener (${probeImage.slice(0, 40)})` });
      }
    }
  }

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

  // --- pamięć maszyny silnika kontenerów (OOM.md, warstwa 1) ---
  // Za mały pułap = próby zabijane SIGKILL-em w trakcie weryfikacji pracy
  // przez agenta — kara spada dokładnie na modele, które pracują porządnie.
  if (alive) {
    const memBytes = engineMemoryBytes(alive);
    const MIN_GIB = 4;
    if (memBytes === null) {
      checks.push({ name: "pamięć maszyny silnika", status: "WARN", detail: "nie udało się odczytać", fix: "sprawdź `docker info` / `podman info` ręcznie" });
    } else {
      const gib = memBytes / 1024 ** 3;
      const configuredMb = config?.resources.memory_mb ?? null;
      if (configuredMb !== null && memBytes < configuredMb * 1024 ** 2) {
        checks.push({
          name: "pamięć maszyny silnika",
          status: "BRAK",
          detail: `${gib.toFixed(1)} GiB < resources.memory_mb (${configuredMb} MiB) z bench.config.yaml`,
          fix: "podnieś pamięć maszyny silnika (Docker Desktop → Resources / `podman machine set -m …`) albo obniż limit w configu",
        });
      } else if (gib < MIN_GIB) {
        checks.push({
          name: "pamięć maszyny silnika",
          status: "WARN",
          detail: `${gib.toFixed(1)} GiB — poniżej ${MIN_GIB} GiB instalacja zależności dużego projektu ginie od OOM (agent exit 137)`,
          fix: "podnieś pamięć maszyny silnika do pułapu najcięższej operacji stacku z zapasem (duże monorepo JS/TS: ~8 GiB)",
        });
      } else {
        const limitNote = configuredMb !== null ? `, limit prób/oceny: ${configuredMb} MiB (resources.memory_mb)` : ", bez jawnego limitu prób (rozważ resources.memory_mb — stempel ery i atrybucja OOM)";
        checks.push({ name: "pamięć maszyny silnika", status: "OK", detail: `${gib.toFixed(1)} GiB${limitNote}` });
      }
    }
  }

  // --- wolne miejsce: attempts/ (workspace każdej zachowanej próby) i TMPDIR
  // (stan startowy assert/validate, kontekst budowy obrazu zadania) ---
  const MIN_FREE_GB = 10;
  for (const [label, target] of [
    ["attempts/", join(root, "attempts")],
    ["TMPDIR", tmpdir()],
  ] as const) {
    let probe = target;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    try {
      const fs = statfsSync(probe);
      const freeGb = (fs.bavail * fs.bsize) / 1e9;
      // tmpfs: df pokazuje wolne miejsce, a zapis potrafi dostać EDQUOT
      // (limit per użytkownik) dużo wcześniej — i trzyma dane w RAM-ie.
      const tmpfsNote = fs.type === 0x01021994 ? "; tmpfs — dane zajmują RAM, a limit per użytkownik może odciąć zapis wcześniej niż pokazuje df" : "";
      const perTrial = label === "attempts/" ? workspacePerTrialMb(target) : null;
      const capacity = perTrial ? `; zachowany workspace ≈${perTrial} MB/próbę → miejsce na ~${Math.floor((freeGb * 1000) / perTrial)} prób` : "";
      const detail = `${freeGb.toFixed(1)} GB wolne (${target})${capacity}${tmpfsNote}`;
      checks.push(
        freeGb >= MIN_FREE_GB
          ? { name: `dysk ${label}`, status: "OK", detail }
          : {
              name: `dysk ${label}`,
              status: "WARN",
              detail: `${detail} — poniżej ${MIN_FREE_GB} GB`,
              fix:
                label === "TMPDIR"
                  ? "workspace stanu startowego (assert/validate, z task.prepare) to setki MB na wywołanie — wskaż większy dysk: `export TMPDIR=<katalog>`"
                  : "workspace każdej zachowanej próby to setki MB — zwolnij miejsce albo trzymaj instancję na większym dysku (próby są nienaruszalne, nie kasuj ich)",
            },
      );
    } catch (err) {
      checks.push({ name: `dysk ${label}`, status: "WARN", detail: `nie udało się odczytać (${err instanceof Error ? err.message : String(err)})` });
    }
  }

  // --- pozostałości przerwanych procesów (OOM, kill): katalogi bench-* w TMPDIR
  // i /tmp starsze niż 12 h — finally ich nie sprzątnęło ---
  const leftovers = staleBenchTempDirs([tmpdir(), "/tmp"]);
  if (leftovers.length > 0) {
    checks.push({
      name: "pozostałości tymczasowe",
      status: "WARN",
      detail: `${leftovers.length} katalog(ów) bench-* starszych niż 12 h (przerwane procesy): ${leftovers.slice(0, 3).join(", ")}${leftovers.length > 3 ? ", …" : ""}`,
      fix: `usuń, gdy nic nie biegnie: rm -rf ${[...new Set(leftovers.map((d) => `${dirname(d)}/bench-*`))].join(" ")} (pliki z kontenera: podman unshare rm -rf …)`,
    });
  }

  const presentKeys = Object.keys(process.env).filter((name) => /_API_KEY$/.test(name));
  if (config) {
    // Alternatywy (np. OPENAI_API_KEY | CODEX_API_KEY): wystarczy którakolwiek.
    const needed = new Map<string, string[]>();
    for (const keys of [config.judge.model, ...config.defaults.models].map(requiredKeysFor)) {
      if (keys) needed.set(keys.join(" | "), keys);
    }
    for (const [label, keys] of [...needed].sort(([a], [b]) => a.localeCompare(b))) {
      checks.push(
        keys.some((k) => presentKeys.includes(k))
          ? { name: `klucz ${label}`, status: "OK", detail: "obecny w env" }
          : {
              name: `klucz ${label}`,
              status: "BRAK",
              detail: "brak w env",
              fix: `wyeksportuj ${keys[0]} w env maszyny operatora (benchmark pracuje lokalnie — sekrety repo są potrzebne tylko workflowom publikacji)`,
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

  // --- remote repo instancji (publikacja: readiness CI + leaderboard) ---
  // Benchmark pracuje LOKALNIE — remote nie blokuje prób ani oceny;
  // potrzebny do współdzielenia wyników (results/ w repo) i publikacji.
  const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 10_000 });
  checks.push(
    remote.status === 0
      ? { name: "remote instancji", status: "OK", detail: remote.stdout.trim() }
      : {
          name: "remote instancji",
          status: "WARN",
          detail: "brak origin",
          fix: "utwórz repo instancji i `git remote add origin …` (lokalne próby działają bez tego; remote = współdzielenie results/ i publikacja leaderboardu)",
        },
  );

  // --- workflows (GHA = readiness + publikacja, NIE wykonanie prób) ---
  for (const workflow of ["readiness.yaml", "leaderboard.yaml"]) {
    const path = join(root, ".github", "workflows", workflow);
    checks.push(
      existsSync(path)
        ? { name: `workflow ${workflow}`, status: "OK", detail: `.github/workflows/${workflow}` }
        : {
            name: `workflow ${workflow}`,
            status: "WARN",
            detail: "nie istnieje",
            fix: "skopiuj z .bench-kit/workflows/ (init/update robi to automatycznie)",
          },
    );
  }

  // --- klonowalność repo bazowych ---
  if (opts.offline) {
    if (!opts.json) console.log("info:  --offline — pomijam klonowalność repo bazowych");
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

  // --- obraz bazowy (opcjonalnie, długie) ---
  if (!opts.warm && alive) {
    const image = baseImageTag(root);
    checks.push(
      sh(alive, ["image", "inspect", image], { timeout: 30_000 }).status === 0
        ? { name: "obraz bazowy", status: "OK", detail: image }
        : {
            name: "obraz bazowy",
            status: "WARN",
            detail: "jeszcze nie zbudowany",
            fix: "`bench doctor --warm` buduje go teraz (1–4 min, jednorazowo); inaczej zbuduje się przy pierwszej budowie zadania",
          },
    );
  }
  if (opts.warm) {
    if (!alive) {
      checks.push({ name: "obraz bazowy", status: "BRAK", detail: "brak silnika kontenerów", fix: "uruchom silnik i powtórz `bench doctor --warm`" });
    } else {
      const started = Date.now();
      try {
        const image = ensureBaseImage(alive, root);
        checks.push({ name: "obraz bazowy", status: "OK", detail: `${image} (${Math.round((Date.now() - started) / 1000)} s)` });
      } catch (err) {
        checks.push({
          name: "obraz bazowy",
          status: "BRAK",
          detail: (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "budowa nie powiodła się",
          fix: "sprawdź sieć i miejsce na dysku silnika; pełny log: `<engine> build .bench-kit/docker`",
        });
      }
    }
  }

  const missing = checks.filter((c) => c.status === "BRAK").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  if (opts.json) {
    console.log(JSON.stringify({ root, checks, missing, warns }));
    return missing > 0 ? 1 : 0;
  }

  // --- tabela ---
  const nameWidth = Math.max(...checks.map((c) => c.name.length));
  console.log(`bench doctor: ${root}\n`);
  for (const check of checks) {
    console.log(`${check.status.padEnd(4)}  ${check.name.padEnd(nameWidth)}  ${check.detail}`);
    if (check.fix) console.log(`${"".padEnd(6 + nameWidth)}  → ${check.fix}`);
  }
  console.log(`\nbench doctor: ${missing} BRAK, ${warns} WARN — ${missing === 0 ? "środowisko gotowe" : "uzupełnij braki powyżej"}`);
  return missing > 0 ? 1 : 0;
}

/** Katalogi tymczasowe runnera (mkdtemp bench-*) starsze niż maxAgeH — pozostałości procesów zabitych przed finally. */
export function staleBenchTempDirs(dirs: string[], maxAgeH = 12, now = Date.now()): string[] {
  const found = new Set<string>();
  for (const dir of new Set(dirs)) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^bench-(reference|assert-out|prepare|validate)-/.test(name)) continue;
      try {
        if (now - statSync(join(dir, name)).mtimeMs > maxAgeH * 3_600_000) found.add(join(dir, name));
      } catch {
        // zniknął w międzyczasie
      }
    }
  }
  return [...found].sort();
}

/** Rozmiar (MB) najnowszego zachowanego workspace/ w attempts/ — miara "ile prób się zmieści"; null bez prób. */
function workspacePerTrialMb(attemptsDir: string): number | null {
  if (!existsSync(attemptsDir)) return null;
  const found = spawnSync("sh", ["-c", 'ls -td "$1"/*/*/trial-*/workspace 2>/dev/null | head -1 | xargs -r du -sm | cut -f1', "sh", attemptsDir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const mb = Number(found.stdout?.trim());
  return Number.isFinite(mb) && mb > 0 ? mb : null;
}
