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

const MINE = resolve(dirname(fileURLToPath(import.meta.url)), "../../.agents/skills/bench-create-task/mine-prs.mjs");

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

// Kształt: dodane linie testów, które przypinają sposób implementacji
// referencji (kolejność/liczba wywołań, dokładny tekst wprowadzony przez
// zmianę, struktura DOM, snapshoty). Linie z pinu, komentarze, dane
// fixture'ów i teksty istniejące na pinie nie są flagowane.
test("mine-prs: show flaguje kształt tylko w dodanych liniach testów", () => {
  const dir = mkdtempSync(join(tmpdir(), "mine-shape-"));
  const git = (...a) =>
    execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  try {
    git("init", "-q", "-b", "main");
    write("src/store.ts", 'export function old() {\n  throw new Error("Old message here");\n}\n');
    write("src/store.test.ts", 'import { old } from "./store";\ntest("old", () => {\n  expect(db.first).toHaveBeenNthCalledWith(1, "pin");\n});\n');
    git("add", "-A");
    git("commit", "-qm", "chore: init");
    write(
      "src/store.ts",
      'export function old() {\n  throw new Error("Old message here");\n}\n' +
        'export function save(db) {\n  db.first();\n  db.second();\n  throw new Error(`Save failed: ${db.reason}`);\n}\n' +
        'export const label = "Delete all";\n',
    );
    const added = [
      'expect(db.mock.calls).toEqual([["first"], ["second"]]);', // 6 call-order
      'expect(db.first).toHaveBeenNthCalledWith(1, "x");', // 7 call-order
      "expect(db.first).toHaveBeenCalledTimes(2);", // 8 call-count
      'expect(() => save(db)).toThrow("Save failed: disk");', // 9 exact-error
      'expect(() => old()).toThrow("Old message here");', // 10 — tekst z pinu
      'expect(screen.getByText("Delete all")).toBeTruthy();', // 11 exact-copy
      'expect(screen.getByText("Fixture row")).toBeTruthy();', // 12 — dane fixture'a
      'expect(el.closest("a")).toBeNull();', // 13 dom-structure
      "expect(html).toMatchSnapshot();", // 14 snapshot
      "// expect(x).toHaveBeenNthCalledWith(1);", // 15 — komentarz
      "expect(db.mock.calls[0][0]).toBe(1);", // 16 — argumenty wywołania, nie kolejność
    ];
    write(
      "src/store.test.ts",
      'import { old } from "./store";\ntest("old", () => {\n  expect(db.first).toHaveBeenNthCalledWith(1, "pin");\n});\n' +
        `test("save", () => {\n${added.map((l) => `  ${l}\n`).join("")}});\n`,
    );
    write("src/__snapshots__/store.test.ts.snap", "exports[`save 1`] = `x`;\n");
    git("add", "-A");
    git("commit", "-qm", "feat: save (#7)");
    const sha = git("rev-parse", "HEAD").trim();
    const c = JSON.parse(execFileSync(process.execPath, [MINE, "--repo", dir, "show", sha, "--json"], { encoding: "utf8" }));
    const got = c.shape.map((s) => `${s.kind}@${s.path}:${s.line}`).sort();
    assert.deepEqual(
      got,
      [
        "call-count@src/store.test.ts:8",
        "call-order@src/store.test.ts:6",
        "call-order@src/store.test.ts:7",
        "dom-structure@src/store.test.ts:13",
        "exact-copy@src/store.test.ts:11",
        "exact-error@src/store.test.ts:9",
        "snapshot@src/__snapshots__/store.test.ts.snap:null",
        "snapshot@src/store.test.ts:14",
      ].sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
