/**
 * Wspólna obsługa kontenerów — silnik (docker/podman) i obraz bazowy.
 * Używane przez run / evaluate / assert / validate --assert.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { HARNESSES, harnessVersion, type HarnessName } from "./harness.ts";

export function sh(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024, ...opts });
}

/**
 * Asynchroniczny odpowiednik sh() — dla równoległych prób (`bench attempt
 * --parallel`): spawnSync blokuje pętlę zdarzeń, więc pool kontenerów
 * potrzebuje wariantu na spawn. Ten sam kształt wyniku co sh()
 * (status/stdout/stderr); timeout kończy proces SIGKILL-em.
 */
export function shAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGKILL"), opts.timeout) : null;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      done({ status: null, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      done({ status: code, stdout, stderr });
    });
  });
}

export function must(cmd: string, args: string[], what: string, opts: Parameters<typeof sh>[2] = {}): string {
  const result = sh(cmd, args, opts);
  if (result.status !== 0) {
    throw new Error(`${what}: ${cmd} ${args.join(" ")}\n${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

/**
 * Sprzątanie katalogu tymczasowego (workspace referencyjny, wyjście oceny)
 * — wołane w `finally`, więc NIGDY nie rzuca: porażka sprzątania nie może
 * przykryć właściwego wyniku. Pliki utworzone w kontenerze bywają własnością
 * roota albo subuid-ów (docker rootful, rootless podman z użytkownikiem
 * kontenera ≠ root) i host-owy rmSync kończy się EACCES — wtedy próba
 * w przestrzeni nazw silnika: `podman unshare rm -rf` albo `docker run --rm`
 * z katalogiem nadrzędnym zamontowanym do podanego obrazu. Na koniec warn
 * ze ścieżką do ręcznego usunięcia.
 */
export function removeTree(dir: string, fallback: { engine: string; image: string } | null = null): void {
  let error: unknown;
  try {
    rmSync(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    error = err;
  }
  if (fallback) {
    const args =
      fallback.engine === "podman"
        ? ["unshare", "rm", "-rf", dir]
        : ["run", "--rm", "-v", `${dirname(dir)}:/bench-cleanup`, fallback.image, "rm", "-rf", `/bench-cleanup/${basename(dir)}`];
    sh(fallback.engine, args, { timeout: 300_000 });
    if (!existsSync(dir)) return;
  }
  const why = error instanceof Error ? error.message.split("\n")[0] : String(error);
  console.error(`warn:  nie udało się usunąć katalogu tymczasowego ${dir} (${why}) — usuń ręcznie`);
}

/** docker jeśli daemon odpowiada, inaczej podman — albo wymuszony --engine. */
export function detectEngine(forced: string | null): string {
  const candidates = forced ? [forced] : ["docker", "podman"];
  for (const engine of candidates) {
    if (sh(engine, ["info"], { timeout: 15_000 }).status === 0) return engine;
  }
  throw new Error(
    forced
      ? `${forced} nie odpowiada — czy daemon/machine działa?`
      : "ani docker, ani podman nie odpowiada — uruchom daemon/machine albo wskaż --engine",
  );
}

/**
 * Trwały cache artefaktów zależności dla kontenerów OCENY (N1 z
 * OPTIMIZATION.md): nazwany wolumen silnika współdzielony między
 * wywołaniami `assert` / `validate --assert` / `evaluate`. Asercje dalej
 * same instalują swoje zależności (kontrakt bez zmian), ale instalacje
 * trafiają w ciepły cache zamiast w zimną sieć. Kontenery PRÓBY agenta
 * celowo go nie dostają — próba mierzy agenta w zastanym środowisku.
 *
 * Źródłem jest nazwany wolumen silnika; env BENCH_DEPS_CACHE_DIR podmienia
 * go na bind-mount katalogu hosta — dla CI, gdzie wolumen żyje tylko przez
 * czas joba, a katalog da się przenieść actions/cache między runami.
 */
export function depsCacheArgs(enabled: boolean): string[] {
  if (!enabled) return [];
  let source = "bench-deps-cache";
  const hostDir = process.env.BENCH_DEPS_CACHE_DIR;
  if (hostDir && hostDir.trim() !== "") {
    source = resolve(hostDir.trim());
    mkdirSync(source, { recursive: true });
  }
  return [
    "-v",
    `${source}:/bench/deps-cache`,
    "-e",
    "npm_config_cache=/bench/deps-cache/npm",
    "-e",
    "YARN_CACHE_FOLDER=/bench/deps-cache/yarn",
    "-e",
    "npm_config_store_dir=/bench/deps-cache/pnpm-store",
    "-e",
    "PIP_CACHE_DIR=/bench/deps-cache/pip",
    "-e",
    "UV_CACHE_DIR=/bench/deps-cache/uv",
    "-e",
    "PLAYWRIGHT_BROWSERS_PATH=/bench/deps-cache/ms-playwright",
    "-e",
    "XDG_CACHE_HOME=/bench/deps-cache/xdg",
  ];
}

/**
 * Jawne limity zasobów kontenera (OOM.md, warstwa 2). memory-swap = memory
 * (bez swapu): przekroczenie limitu kończy się killem OZNACZONYM przez
 * mechanizm kontenera, zamiast cichego SIGKILL-a z jądra maszyny silnika.
 */
export function resourceLimitArgs(memoryMb: number | null, pidsLimit: number | null): string[] {
  const args: string[] = [];
  if (memoryMb !== null) args.push("--memory", `${memoryMb}m`, "--memory-swap", `${memoryMb}m`);
  if (pidsLimit !== null) args.push("--pids-limit", String(pidsLimit));
  return args;
}

/** Nazwy sygnałów istotne w triage'u kodów wyjścia 128+N. */
const SIGNAL_NAMES: Record<number, string> = {
  4: "SIGILL",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  9: "SIGKILL",
  11: "SIGSEGV",
  15: "SIGTERM",
};

/**
 * Klasyfikacja kodu wyjścia z rodziny sygnałowej (128+N). SIGKILL przy
 * braku timeoutu prawie zawsze oznacza wyczerpanie zasobów (OOM killer) —
 * OOM.md, warstwa 3. Zwraca null dla zwykłych kodów (w tym 124 = timeout).
 */
export function signalFromExit(exitCode: number): { signal: number; name: string; likely_oom: boolean } | null {
  if (exitCode <= 128 || exitCode > 128 + 64) return null;
  const signal = exitCode - 128;
  return { signal, name: SIGNAL_NAMES[signal] ?? `SIG${signal}`, likely_oom: signal === 9 };
}

/**
 * Komunikat o nieudanym kontenerze oceny. status null = proces silnika
 * zabity sygnałem albo niewystartowany (spawn error, timeout) — wtedy
 * "kodem null:" z pustym ogonem nic nie mówi; nazywamy przyczynę i krok.
 */
export function containerFailureMessage(
  result: { status: number | null; signal?: NodeJS.Signals | null; error?: Error; stdout?: string | null; stderr?: string | null },
  memoryMb: number | null = null,
): string {
  const tail = (result.stderr || result.stdout || "").slice(-1000).trim();
  let what: string;
  if (result.status === null) {
    const cause = result.error ? result.error.message : result.signal ? `sygnał ${result.signal}` : "przyczyna nieznana";
    what =
      `kontener oceny przerwany przed końcem (${cause}) — to awaria maszyny/silnika, nie wynik próby; ` +
      "sprawdź `bench doctor` (silnik, pamięć; przy wielu równoległych ocenach zmniejsz ich liczbę) i powtórz ocenę tej próby";
  } else {
    const signal = signalFromExit(result.status);
    const signalNote = signal
      ? ` (${signal.name}${signal.likely_oom ? ` — prawdopodobnie OOM; limit: ${memoryMb !== null ? `${memoryMb} MiB` : "brak, sufit = pamięć maszyny silnika"}` : ""})`
      : "";
    what = `kontener oceny zakończony kodem ${result.status}${signalNote}`;
  }
  return tail ? `${what}:\n${tail}` : `${what} (brak wyjścia kontenera)`;
}

/** Pamięć maszyny silnika kontenerów w bajtach (docker/podman), null gdy nieznana. */
export function engineMemoryBytes(engine: string): number | null {
  const format = engine === "podman" ? "{{.Host.MemTotal}}" : "{{.MemTotal}}";
  const result = sh(engine, ["info", "--format", format], { timeout: 15_000 });
  const bytes = Number(result.stdout?.trim());
  return result.status === 0 && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/**
 * Buduje (lub odświeża z cache) obraz bazowy z wszystkimi harnessami
 * (OpenCode, Claude Code, Codex CLI) w pinowanych wersjach i zwraca jego
 * tag. Wersje są w tagu, więc bump pinu jednego CLI daje nowy obraz,
 * a nie cichą podmianę narzędzia pod istniejącymi próbami.
 */
/** Tag obrazu bazowego dla przypiętych wersji harnessów instancji. */
export function baseImageTag(root: string): string {
  const versions = Object.fromEntries(HARNESSES.map((h) => [h, harnessVersion(root, h)])) as Record<HarnessName, string>;
  return `bench-base:oc${versions.opencode}-cc${versions["claude-code"]}-cx${versions.codex}`;
}

export function ensureBaseImage(engine: string, root: string): string {
  const versions = Object.fromEntries(HARNESSES.map((h) => [h, harnessVersion(root, h)])) as Record<HarnessName, string>;
  const image = baseImageTag(root);
  must(
    engine,
    [
      "build",
      "-q",
      "--build-arg",
      `OPENCODE_VERSION=${versions.opencode}`,
      "--build-arg",
      `CLAUDE_CODE_VERSION=${versions["claude-code"]}`,
      "--build-arg",
      `CODEX_VERSION=${versions.codex}`,
      "-t",
      image,
      join(root, ".bench-kit", "docker"),
    ],
    "budowa obrazu bazowego",
    { timeout: 900_000 },
  );
  return image;
}
