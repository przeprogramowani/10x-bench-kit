// mine-prs.mjs: równoległy skan i cache sprzężenia nie zmieniają wyniku.
// Syntetyczne repo z kilkoma "PR-ami" (kod + test), skan szeregowy jako
// wzorzec, potem równoległy bez cache'u, potem dwa razy z cache'em.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MINE = resolve(dirname(fileURLToPath(import.meta.url)), "../../.agents/skills/bench-define/mine-prs.mjs");

function repoWithPrs(count) {
  const dir = mkdtempSync(join(tmpdir(), "mine-prs-"));
  const git = (...a) =>
    execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("src/base.ts", "export const base = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "chore: init");
  for (let i = 1; i <= count; i++) {
    // Co drugi PR wprowadza nową funkcję używaną w teście (sprzężenie),
    // pozostałe zmieniają zachowanie istniejącej (bez sprzężenia).
    if (i % 2) {
      write(`src/feature${i}.ts`, `export function feature${i}(x: number) {\n  return { value: x * ${i} };\n}\n`);
      write(`src/feature${i}.test.ts`, `import { feature${i} } from "./feature${i}";\ntest("f", () => expect(feature${i}(2).value).toBe(${2 * i}));\n`);
    } else {
      write("src/base.ts", `export const base = ${i};\nexport function read() {\n  return { base };\n}\n`);
      write(`src/base${i}.test.ts`, `import { base } from "./base";\ntest("b", () => expect(base).toBe(${i}));\n`);
    }
    git("add", "-A");
    git("commit", "-qm", `feat: change ${i} (#${100 + i})`);
  }
  return dir;
}

const scan = (repo, ...extra) =>
  JSON.parse(execFileSync(process.execPath, [MINE, "--repo", repo, "--all", "--json", ...extra], { encoding: "utf8" }))
    .candidates;

test("mine-prs: skan równoległy i z cache'em = skan szeregowy", () => {
  const repo = repoWithPrs(10);
  try {
    const serial = scan(repo, "--jobs", "1", "--no-cache");
    assert.equal(serial.length, 10);
    assert.ok(serial.some((c) => c.coupled.length > 0), "fixture powinien mieć sprzężonych kandydatów");
    assert.ok(serial.some((c) => c.coupled.length === 0), "…i niesprzężonych");

    assert.deepEqual(scan(repo, "--jobs", "3", "--no-cache"), serial);

    const cacheFile = join(repo, ".git", "bench-kit-mine-cache.json");
    assert.ok(!existsSync(cacheFile));
    assert.deepEqual(scan(repo, "--jobs", "3"), serial); // zimny: liczy i zapisuje
    assert.ok(existsSync(cacheFile));
    assert.deepEqual(scan(repo), serial); // ciepły: z cache'u
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
