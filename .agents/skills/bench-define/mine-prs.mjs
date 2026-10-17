#!/usr/bin/env node
/**
 * mine-prs.mjs — kandydaci na zadania z historii repo bazowego (receptura
 * SWE-bench na prywatnym repo): zmergowana zmiana, która przyniosła
 * własne testy, to gotowe zadanie — pin = stan sprzed zmiany, testy PR-a
 * = guard fail-to-pass, kod PR-a = dowód wykonalności (referencja, której
 * agent nigdy nie widzi).
 *
 * Czyta WYŁĄCZNIE lokalnego gita (`.repos/<nazwa>`). Klon płytki działa,
 * o ile jego historia pokrywa okno --since (inaczej ostrzeżenie z komendą
 * pogłębienia). Domyślny --ref to origin/HEAD (tip remote'a po `git fetch`),
 * z powrotem do HEAD. Bez sieci, bez GitHuba, niczego nie zapisuje poza --out.
 *
 * Tryby:
 *   scan   (domyślny) — lista kandydatów z historii first-parent gałęzi
 *   show   <sha>      — szczegóły jednego kandydata (pliki, sprzężenie)
 *   emit   <sha> --out <dir> — artefakty do budowy zadania:
 *            reference.diff  zmiany kodu z manifestami/lockfile'ami, bez docs
 *                            i plików instrukcji agentów (rozwiązanie; tylko dowód)
 *            tests.diff      zmiany testowe (do raportu)
 *            files/<ścieżka> wersje plików testowych PO merge'u (do
 *                            evaluation-pool/tests/<zadanie>-pr/files/)
 *            meta.json       pin, merge, PR, pliki, identyfikatory
 *
 * Użycie:
 *   node mine-prs.mjs --repo .repos/<nazwa> [--ref origin/HEAD] [--since 365]
 *        [--max-files 12] [--max-lines 800] [--limit 30] [--all] [--json]
 *   node mine-prs.mjs --repo .repos/<nazwa> show <sha> [--json]
 *   node mine-prs.mjs --repo .repos/<nazwa> emit <sha> --out <dir>
 *
 * Sprzężenie interfejsu (coupled): identyfikatory i nowe pliki, które PR
 * DODAJE w kodzie, a jego testy ich używają. Takie testy wymuszają kształt
 * implementacji — wolno ich użyć tylko wtedy, gdy prompt podaje ten
 * interfejs dosłownie (wyjątek z zasady neutralności kształtu). Testy
 * bez sprzężenia sprawdzają zachowanie przez interfejs, który istnieje
 * już na pinie — dwie poprawne implementacje przechodzą je tak samo.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const has = (name) => args.includes(name);
const repo = flag("--repo");
if (!repo) {
  console.error("usage: mine-prs.mjs --repo .repos/<nazwa> [scan|show <sha>|emit <sha> --out <dir>] [opcje]");
  process.exit(2);
}
const VALUED = new Set(["--repo", "--ref", "--since", "--max-files", "--max-lines", "--limit", "--out"]);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (VALUED.has(args[i])) i++;
  else if (!args[i].startsWith("--")) positional.push(args[i]);
}
const mode = ["show", "emit", "scan"].includes(positional[0]) ? positional[0] : "scan";
const target = positional[1] ?? null;

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20 });
// Sondy (cat-file -e, grep -q) kończą się kodem ≠ 0 z założenia — bez stderr.
const tryGit = (...a) => {
  try {
    return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

// --- klasyfikacja plików ------------------------------------------------------
const TEST = [/(^|\/)(test|tests|__tests__|__snapshots__|spec|specs|e2e)\//i, /\.snap$/i, /\.(test|spec)\.[cm]?[jt]sx?$/i, /_test\.(go|py|rb)$/, /(^|\/)test_[^/]+\.py$/, /Tests?\.(java|kt|cs)$/];
const DOCS = [/\.(md|mdx|rst|txt|adoc)$/i, /(^|\/)docs?\//i, /(^|\/)(LICENSE|CHANGELOG|CODEOWNERS)/i];
const NOISE = [/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/, /\.(svg|png|jpe?g|gif|ico|lock)$/i, /(^|\/)(dist|build|vendor|generated)\//];
const kindOf = (path) =>
  TEST.some((r) => r.test(path)) ? "test" : NOISE.some((r) => r.test(path)) ? "noise" : DOCS.some((r) => r.test(path)) ? "docs" : "src";

// --- identyfikatory dodane w kodzie -----------------------------------------
const DEFINES = [
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:declare\s+)?(?:const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/g,
  /^\s*class\s+([A-Za-z_]\w*)/g,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
];
function definedNames(addedLines) {
  const names = new Set();
  for (const line of addedLines) {
    for (const re of DEFINES) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) if (m[1] && m[1].length > 2) names.add(m[1]);
    }
  }
  return names;
}
const addedLinesOf = (patch) =>
  patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

// --- jeden kandydat -------------------------------------------------------------
function describe(sha) {
  const [header, ...bodyLines] = git("show", "-s", "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%b", sha).split("\0");
  const full = header;
  const parents = bodyLines[0].trim().split(" ").filter(Boolean);
  const author = bodyLines[1];
  const date = bodyLines[2];
  const subject = bodyLines[3];
  const body = (bodyLines[4] ?? "").trim();
  const pin = parents[0];
  // Granica płytkiego klonu: rodzica nie ma lokalnie — zmiany nie da się porównać.
  if (!pin || tryGit("cat-file", "-e", `${pin}^{commit}`) === null) return null;
  const pr = subject.match(/Merge pull request #(\d+)/)?.[1] ?? subject.match(/\(#(\d+)\)\s*$/)?.[1] ?? null;
  // Commity gałęzi PR-a (tylko dla merge commita): czas pracy nad zmianą.
  let branchSpanHours = null;
  if (parents.length > 1) {
    const dates = (tryGit("log", "--format=%aI", `${parents[0]}..${parents[1]}`) ?? "").split("\n").filter(Boolean);
    if (dates.length) branchSpanHours = Math.round((Date.parse(date) - Date.parse(dates[dates.length - 1])) / 36e5);
  }
  const files = git("diff", "--numstat", "--no-renames", pin, full)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split("\t");
      return { path, added: Number(added) || 0, removed: Number(removed) || 0, kind: kindOf(path) };
    });
  const src = files.filter((f) => f.kind === "src");
  const tests = files.filter((f) => f.kind === "test");
  const srcLines = src.reduce((a, f) => a + f.added + f.removed, 0);

  // Sprzężenie: nazwy zdefiniowane w dodanym kodzie, nieobecne na pinie,
  // używane przez dodane linie testów + nowe pliki kodu importowane w testach.
  let coupled = [];
  let newNames = [];
  if (src.length && tests.length) {
    const srcPatch = git("diff", "--no-renames", pin, full, "--", ...src.map((f) => f.path));
    const testAdded = addedLinesOf(git("diff", "--no-renames", pin, full, "--", ...tests.map((f) => f.path))).join("\n");
    newNames = [...definedNames(addedLinesOf(srcPatch))].filter((name) => tryGit("grep", "-q", "-w", "-F", name, pin) === null);
    coupled = newNames.filter((name) => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(testAdded));
    // Nazwy kontraktu (pola, klucze), na których testy asertują: `.pole`
    // i `klucz:` w dodanych liniach testów, użyte w dodanym kodzie PR-a,
    // a nieobecne nigdzie na pinie — testy wymagają nazwy, której agent
    // nie ma skąd znać, jeśli prompt jej nie poda.
    const srcAdded = addedLinesOf(srcPatch).join("\n");
    const contractTokens = new Set();
    const testCode = testAdded
      .split("\n")
      .filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l))
      .join("\n");
    // Lookbehind z \p{L}: "płytko:" w komentarzu nie może dać tokenu "ytko".
    for (const m of testCode.matchAll(/\.([A-Za-z_$][\w$]{2,})(?![\w$])|(?<![\p{L}\w$])([A-Za-z_$][\w$]{2,})\s*:/gu)) contractTokens.add(m[1] ?? m[2]);
    for (const token of contractTokens) {
      if (coupled.includes(token) || !new RegExp(`\\b${token.replace(/\$/g, "\\$")}\\b`).test(srcAdded)) continue;
      if (tryGit("grep", "-q", "-w", "-F", token, pin) === null) coupled.push(`name:${token}`);
    }
    const newFiles = src.filter((f) => tryGit("cat-file", "-e", `${pin}:${f.path}`) === null);
    for (const f of newFiles) {
      const stem = f.path.split("/").pop().replace(/\.[^.]+$/, "");
      if (stem.length > 2 && testAdded.includes(stem)) coupled.push(`file:${f.path}`);
    }
  }

  const title = subject.replace(/^Merge pull request #\d+ from \S+\s*/, "").trim() || body.split("\n")[0] || subject;
  const conventional = title.match(/^(\w+)(?:\([^)]*\))?!?:/)?.[1]?.toLowerCase() ?? null;
  const classHint =
    { fix: "bugfix", feat: "feature", refactor: "refactor", perf: "performance", test: "test-only" }[conventional] ??
    (/\b(fix|bug|crash|regression|broken|error)\b/i.test(title) ? "bugfix" : /\b(add|support|implement|new|introduce)\b/i.test(title) ? "feature" : null);
  const reasons = [];
  if (/^(chore\(release\)|release|bump|revert|merge branch)/i.test(title) || /^Revert /.test(subject)) reasons.push("release/revert/merge");
  if (/\[bot\]|dependabot|renovate/i.test(author)) reasons.push("bot");
  if (!src.length) reasons.push("brak zmian w kodzie");
  if (!tests.length) reasons.push("brak testów w zmianie");
  return {
    sha: full,
    pin,
    pr,
    title,
    body,
    author,
    date,
    class_hint: classHint,
    src_files: src.map((f) => f.path),
    test_files: tests.map((f) => f.path),
    other_files: files.filter((f) => f.kind !== "src" && f.kind !== "test").map((f) => f.path),
    src_lines: srcLines,
    size: srcLines <= 60 ? "S" : srcLines <= 250 ? "M" : "L",
    branch_span_hours: branchSpanHours,
    new_identifiers: newNames,
    coupled,
    excluded: reasons,
  };
}

// --- tryby -----------------------------------------------------------------------
if (mode === "scan") {
  // Domyślnie tip remote'a: `git fetch origin` nie przesuwa lokalnego HEAD
  // klonu, a piny muszą istnieć na remote (first-parent gałęzi domyślnej).
  const ref = flag("--ref", tryGit("rev-parse", "--verify", "-q", "origin/HEAD") ? "origin/HEAD" : "HEAD");
  const since = Number(flag("--since", "365"));
  if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
    // Płytki klon wystarcza, o ile historia pokrywa okno --since; inaczej
    // kopiemy to, co jest, i mówimy, czego brakuje.
    const dates = git("log", "--first-parent", "--format=%cI", ref).split("\n").filter(Boolean);
    const oldest = dates.length ? Date.parse(dates[dates.length - 1]) : Date.now();
    if (oldest > Date.now() - since * 86_400_000) {
      console.error(
        `mine-prs: klon płytki — historia sięga ${new Date(oldest).toISOString().slice(0, 10)}, okno --since ${since} dni sięga dalej. ` +
          `Pogłęb raz (orkiestrator, nie subagent):\n  git -C ${repo} fetch --shallow-since="${since} days ago" origin   (albo --unshallow)`,
      );
    }
  }
  const maxFiles = Number(flag("--max-files", "12"));
  const maxLines = Number(flag("--max-lines", "800"));
  const limit = Number(flag("--limit", "30"));
  const shas = git("log", "--first-parent", `--since=${since} days ago`, "--format=%H", ref).split("\n").filter(Boolean);
  const all = [];
  for (const sha of shas) {
    const c = describe(sha);
    if (!c) continue;
    if (c.src_files.length > maxFiles) c.excluded.push(`>${maxFiles} plików kodu`);
    if (c.src_lines > maxLines) c.excluded.push(`>${maxLines} linii kodu`);
    all.push(c);
  }
  // Ranking: testy bez sprzężenia > testy ze sprzężeniem; potem rozmiar M > S > L, świeżość.
  const sizeRank = { M: 0, S: 1, L: 2 };
  const ranked = all
    .filter((c) => has("--all") || c.excluded.length === 0)
    .sort((a, b) => (a.coupled.length > 0) - (b.coupled.length > 0) || sizeRank[a.size] - sizeRank[b.size] || b.date.localeCompare(a.date))
    .slice(0, limit);
  if (has("--json")) {
    console.log(JSON.stringify({ repo: resolve(repo), scanned: all.length, candidates: ranked }, null, 2));
  } else {
    console.log(`mine-prs: ${all.length} zmian w historii (${since} dni), kandydatów: ${ranked.length}${has("--all") ? " (z wykluczonymi)" : ""}\n`);
    for (const c of ranked) {
      const coupling = !c.test_files.length
        ? "bez testów"
        : c.coupled.length
          ? `sprzężone: ${c.coupled.slice(0, 4).join(", ")}${c.coupled.length > 4 ? "…" : ""}`
          : "testy przez istniejący interfejs";
      console.log(
        `${c.sha.slice(0, 10)} ${c.pr ? `#${c.pr}`.padEnd(6) : "      "} ${c.size} ${String(c.class_hint ?? "?").padEnd(11)} ` +
          `${c.src_files.length} kod / ${c.test_files.length} test  ${c.title.slice(0, 70)}`,
      );
      console.log(`             ${coupling}${c.excluded.length ? ` | wykluczony: ${c.excluded.join(", ")}` : ""}`);
    }
  }
} else if (mode === "show") {
  if (!target) throw new Error("show wymaga <sha>");
  const c = describe(target);
  if (has("--json")) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(`${c.sha}  ${c.pr ? `PR #${c.pr}` : "(bez numeru PR)"}  ${c.date}\n${c.title}\n`);
    if (c.body) console.log(`${c.body}\n`);
    console.log(`pin (stan sprzed zmiany): ${c.pin}`);
    console.log(`kod (${c.src_lines} linii, ${c.size}): ${c.src_files.join(", ") || "—"}`);
    console.log(`testy: ${c.test_files.join(", ") || "—"}`);
    if (c.other_files.length) console.log(`pozostałe: ${c.other_files.join(", ")}`);
    console.log(`nowe identyfikatory w kodzie: ${c.new_identifiers.join(", ") || "—"}`);
    console.log(
      c.coupled.length
        ? `SPRZĘŻENIE: testy używają ${c.coupled.join(", ")} — prompt musi podać ten interfejs dosłownie, albo te testy odpadają`
        : "sprzężenie: brak — testy sprawdzają zachowanie przez interfejs istniejący na pinie",
    );
    if (c.branch_span_hours !== null) console.log(`czas gałęzi PR-a: ~${c.branch_span_hours} h (górna granica czasu pracy człowieka)`);
    if (c.excluded.length) console.log(`wykluczenia: ${c.excluded.join(", ")}`);
  }
} else if (mode === "emit") {
  if (!target) throw new Error("emit wymaga <sha>");
  const out = flag("--out");
  if (!out) throw new Error("emit wymaga --out <dir>");
  const c = describe(target);
  if (!c.test_files.length) throw new Error(`${target}: zmiana bez testów — nie ma czego użyć jako guard fail-to-pass`);
  mkdirSync(out, { recursive: true });
  // Referencja = rozwiązanie: kod (z manifestami i lockfile'ami — bez nich
  // instalacja zależności dodanych przez zmianę by padła). Bez dokumentacji
  // i plików instrukcji agentów: start workspace'u bywa przepisany przez
  // wyrównanie AGENTS.md/CLAUDE.md, a docs nie są częścią dowodu.
  const CONTEXT = /(^|\/)(AGENTS|CLAUDE|CLAUDE\.local|GEMINI)\.md$/;
  const nonTest = [...c.src_files, ...c.other_files.filter((p) => kindOf(p) === "noise")].filter((p) => !CONTEXT.test(p));
  writeFileSync(join(out, "reference.diff"), nonTest.length ? git("diff", "--binary", "--no-renames", c.pin, c.sha, "--", ...nonTest) : "");
  writeFileSync(join(out, "tests.diff"), git("diff", "--binary", "--no-renames", c.pin, c.sha, "--", ...c.test_files));
  const snapshots = [];
  for (const path of c.test_files) {
    const content = tryGit("show", `${c.sha}:${path}`);
    if (content === null) continue; // plik testowy usunięty przez PR
    const dest = join(out, "files", path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    snapshots.push(path);
  }
  writeFileSync(join(out, "meta.json"), JSON.stringify({ ...c, snapshot_files: snapshots }, null, 2) + "\n");
  console.log(`mine-prs: ${c.sha.slice(0, 10)} → ${out}`);
  console.log(`  pin ${c.pin}; reference.diff (${c.src_files.length} plików kodu — dowód, nigdy do zadania); files/ (${snapshots.length} plików testów po merge'u)`);
  if (c.coupled.length) console.log(`  UWAGA sprzężenie: ${c.coupled.join(", ")} — prompt musi to podać dosłownie albo testy odpadają`);
}
