/**
 * Wspólna obsługa kontenerów — silnik (docker/podman) i obraz bazowy.
 * Używane przez run / evaluate / assert / validate --assert.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function sh(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024, ...opts });
}

export function must(cmd: string, args: string[], what: string, opts: Parameters<typeof sh>[2] = {}): string {
  const result = sh(cmd, args, opts);
  if (result.status !== 0) {
    throw new Error(`${what}: ${cmd} ${args.join(" ")}\n${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
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

/** Pamięć maszyny silnika kontenerów w bajtach (docker/podman), null gdy nieznana. */
export function engineMemoryBytes(engine: string): number | null {
  const format = engine === "podman" ? "{{.Host.MemTotal}}" : "{{.MemTotal}}";
  const result = sh(engine, ["info", "--format", format], { timeout: 15_000 });
  const bytes = Number(result.stdout?.trim());
  return result.status === 0 && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/** Buduje (lub odświeża z cache) obraz bazowy `bench-base:<opencode>` i zwraca jego tag. */
export function ensureBaseImage(engine: string, root: string): string {
  const opencodeVersion = readFileSync(join(root, ".bench-kit", "docker", "opencode.version"), "utf8").trim();
  const image = `bench-base:${opencodeVersion}`;
  // CI: obraz przywrócony z cache (docker load) — pomiń rebuild. Świeżość
  // gwarantuje klucz cache'u (hash .bench-kit/docker/**), nie ten kod;
  // lokalnie flagi nie ustawiaj, bo edycja Dockerfile'a nie miałaby efektu.
  if (process.env.BENCH_REUSE_BASE_IMAGE === "1" && sh(engine, ["image", "inspect", image], { timeout: 30_000 }).status === 0) {
    return image;
  }
  must(
    engine,
    ["build", "-q", "--build-arg", `OPENCODE_VERSION=${opencodeVersion}`, "-t", image, join(root, ".bench-kit", "docker")],
    "budowa obrazu bazowego",
    { timeout: 900_000 },
  );
  return image;
}
