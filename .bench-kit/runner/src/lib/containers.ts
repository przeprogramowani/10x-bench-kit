/**
 * Wspólna obsługa kontenerów — silnik (docker/podman) i obraz bazowy.
 * Używane przez run / evaluate / assert / validate --assert.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Buduje (lub odświeża z cache) obraz bazowy `bench-base:<opencode>` i zwraca jego tag. */
export function ensureBaseImage(engine: string, root: string): string {
  const opencodeVersion = readFileSync(join(root, ".bench-kit", "docker", "opencode.version"), "utf8").trim();
  const image = `bench-base:${opencodeVersion}`;
  must(
    engine,
    ["build", "-q", "--build-arg", `OPENCODE_VERSION=${opencodeVersion}`, "-t", image, join(root, ".bench-kit", "docker")],
    "budowa obrazu bazowego",
    { timeout: 900_000 },
  );
  return image;
}
