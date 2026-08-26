#!/usr/bin/env node
// Release template'u — jedyna wspierana ścieżka wydania (AGENTS.md).
// Robi atomowo wszystkie kroki, których rozjazd już raz kosztował
// force-move tagu (0.19.0: tag i CHANGELOG poszły bez bumpu
// .bench-kit/VERSION, więc `bench-kit update` widział starą wersję —
// CLI porównuje wersje z TEGO pliku, nie z tagów gita).
//
// Użycie:  node .github/scripts/release.mjs <wersja> "<opis do commita>"
// Przykład: node .github/scripts/release.mjs 0.20.0 "bench-build: ..."
//
// Kroki: walidacja (semver, wpis w CHANGELOG, brak tagu) → zapis
// .bench-kit/VERSION → commit `chore(release): <wersja> — <opis>`
// (obejmuje wszystko z working tree — konwencja: release = zmiany +
// bump w jednym commicie) → tag vX.Y.Z → push master + tag.
// Opcjonalny trailer commita przez env RELEASE_TRAILER.
//
// Skrypt żyje w .github/ (strefa repo template'u, wycinana przy
// materializacji instancji) — instancje go nie dostają.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };

const [version, description] = process.argv.slice(2);
if (!version || !description) fail('użycie: release.mjs <wersja> "<opis do commita>"');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" nie jest wersją semver (X.Y.Z)`);

// CHANGELOG: najnowszy wpis (pierwszy nagłówek `## `) musi być dla tej wersji.
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const top = changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1];
if (top !== version) fail(`najnowszy wpis CHANGELOG to ${top ?? "brak"}, oczekiwano ${version} — najpierw wpis w CHANGELOG.md`);

// Tag nie może istnieć (release się nie powtarza; poprawka = kolejny patch).
if (git("tag", "--list", `v${version}`)) fail(`tag v${version} już istnieje — poprawki wydawaj jako kolejny patch`);

// Gałąź: release wychodzi z mastera.
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "master") fail(`release wychodzi z mastera, jesteś na "${branch}"`);

writeFileSync(join(root, ".bench-kit", "VERSION"), `${version}\n`);

git("add", "-A");
if (!git("status", "--porcelain")) fail("brak zmian do wydania (working tree czyste i VERSION już aktualne?)");

const trailer = process.env.RELEASE_TRAILER ? `\n\n${process.env.RELEASE_TRAILER}` : "";
git("commit", "-m", `chore(release): ${version} — ${description}${trailer}`);
git("tag", `v${version}`);
git("push", "origin", "master");
git("push", "origin", `v${version}`);

console.log(`release: ${version} wydane — commit ${git("rev-parse", "--short", "HEAD")}, tag v${version}, wypchnięte.`);
