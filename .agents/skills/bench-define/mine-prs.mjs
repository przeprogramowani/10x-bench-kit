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
 * Wynik nie zależy od konfiguracji gita użytkownika (noprefix, kolory,
 * zewnętrzny diff, textconv, quotePath) — każde wywołanie ją nadpisuje.
 *
 * Tryby:
 *   scan   (domyślny) — lista kandydatów z historii first-parent gałęzi
 *   show   <sha>      — szczegóły jednego kandydata (pliki, sprzężenie)
 *   emit   <sha> --out <dir> — artefakty do budowy zadania:
 *            reference.diff  zmiany kodu z manifestami/lockfile'ami, bez docs
 *                            i plików instrukcji agentów (rozwiązanie; tylko dowód)
 *            tests.diff      zmiany testowe (do raportu)
 *            files/<ścieżka> wersje plików testowych PO merge'u, bajt w bajt
 *                            (do evaluation-pool/tests/<zadanie>-pr/files/)
 *            meta.json       pin, merge, PR, pliki, identyfikatory
 *
 * Użycie:
 *   node mine-prs.mjs --repo .repos/<nazwa> [--ref origin/HEAD] [--since 365]
 *        [--max-files 12] [--max-lines 800] [--limit 30] [--all] [--json]
 *   node mine-prs.mjs --repo .repos/<nazwa> show <sha> [--json]
 *   node mine-prs.mjs --repo .repos/<nazwa> emit <sha> --out <dir>
 *
 * Formaty merge'y: GitHub (`Merge pull request #N from …`, squash `… (#N)`),
 * GitLab (`Merge branch 'x' into 'y'` + `See merge request grupa/projekt!N`
 * w treści → pr "!N"), Bitbucket (`Merged in x (pull request #N)`), Azure
 * (`Merged PR N: tytuł`). Synchronizacje gałęzi (back-merge stable→main,
 * `Merge remote-tracking branch`, lokalne `Merge branch 'x'`) to nie zadania.
 *
 * Sprzężenie interfejsu (coupled): identyfikatory i nowe pliki, które PR
 * DODAJE w kodzie, a jego testy ich używają. Takie testy wymuszają kształt
 * implementacji — wolno ich użyć tylko wtedy, gdy prompt podaje ten
 * interfejs dosłownie (wyjątek z zasady neutralności kształtu). Testy
 * bez sprzężenia sprawdzają zachowanie przez interfejs, który istnieje
 * już na pinie — dwie poprawne implementacje przechodzą je tak samo.
 * To heurystyka (wzorce składni, nie parser): "nie wykryto" znaczy
 * "przeczytaj testy", nie "na pewno brak".
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Błąd zgłaszany użytkownikowi (bez stosu): zły sha, korzeń historii, granica płytkiego klonu.
class MineError extends Error {}

// --- git niezależny od konfiguracji użytkownika --------------------------------
// -c nadpisuje konfigurację plików i GIT_CONFIG_*; flagi diffu poniżej
// (prefiksy, --no-color, --no-ext-diff, --no-textconv) wygrywają z nią i tak.
// --literal-pathspecs: ścieżka z `*`, `:` czy `[` to ścieżka, nie wzorzec.
const GIT_BASE = [
  "-c", "color.ui=never", "-c", "color.diff=never", "-c", "color.grep=never",
  "-c", "core.quotePath=true", "-c", "log.showSignature=false",
  "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.relative=false",
  "--literal-pathspecs",
];
const env = { ...process.env, GIT_PAGER: "cat", LC_ALL: "C" };
delete env.GIT_EXTERNAL_DIFF;
const runGit = (a, opts = {}) => execFileSync("git", ["-C", repo, ...GIT_BASE, ...a], { maxBuffer: 1 << 30, env, ...opts });
const git = (...a) => runGit(a, { encoding: "utf8" });
// Bufor surowych bajtów: pliki binarne i teksty w innym kodowaniu niż UTF-8.
const gitBuf = (...a) => runGit(a);
// Sondy (cat-file -e, grep) kończą się kodem ≠ 0 z założenia — bez stderr.
const tryGit = (...a) => {
  try {
    return runGit(a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};
const tryGitBuf = (...a) => {
  try {
    return runGit(a, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};
// Patch jako tekst do zapisu/`git apply`: prefiksy a/ b/ i brak kolorów niezależnie od configu.
const DIFF = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-relative", "--src-prefix=a/", "--dst-prefix=b/", "--no-renames"];

// Bloby hurtem: jedno `cat-file --batch` na wywołanie (start procesu gita
// kosztuje więcej niż czytanie bajtów). Kolejne piny dzielą większość blobów,
// więc wynik leksera jest cache'owany po oid — skan nie lekse ten sam plik dwa razy.
const BLOB_MAX = 4 << 20;
const blobCache = new Map(); // oid → { text, lexed: Map<ext, lex> }
function blobs(specs) {
  const ok = specs.filter((sp) => !sp.includes("\n"));
  const found = new Map(); // spec → blob z cache'u | null (istnieje, ale nie blob tekstowy do czytania)
  if (ok.length) {
    if (blobCache.size > 5000) blobCache.clear();
    const buf = runGit(["cat-file", "--batch"], { input: ok.join("\n") + "\n" });
    let pos = 0;
    for (const sp of ok) {
      const nl = buf.indexOf(10, pos);
      const m = buf.toString("latin1", pos, nl).match(/^([0-9a-f]{40,64}) (\w+) (\d+)$/);
      pos = nl + 1;
      if (!m) continue; // "<spec> missing"
      const size = Number(m[3]);
      if (m[2] === "blob" && size <= BLOB_MAX) {
        if (!blobCache.has(m[1])) blobCache.set(m[1], { text: buf.toString("utf8", pos, pos + size), lexed: new Map() });
        found.set(sp, blobCache.get(m[1]));
      } else found.set(sp, null);
      pos += size + 1;
    }
  }
  return specs.map((sp) => ({ exists: found.has(sp), blob: found.get(sp) ?? null }));
}
const lexBlob = (blob, ext) => {
  if (!blob.lexed.has(ext)) blob.lexed.set(ext, lex(blob.text, ext));
  return blob.lexed.get(ext);
};

// --- klasyfikacja plików ------------------------------------------------------
const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|pyi|rb|go|rs|java|kt|kts|scala|groovy|cs|fs|php|swift|mm?|c|cc|cpp|cxx|h|hh|hpp|ex|exs|erl|clj|dart|lua|sh|bash|pl|r|jl|vue|svelte|elm|hs|ml|zig)$/i;
const TEST = [
  /(^|\/)(tests?|__tests__|__snapshots__|__mocks__|__fixtures__|e2e|testdata|test-d|testutils?|testhelpers?)\//i,
  /\.Tests?\//, // projekty testowe .NET: Foo.Tests/
  /\.snap$/i,
  /\.(test|spec|test-d)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb|[cm]?[jt]sx?|rs|exs?|dart|c|cc|cpp)$/,
  /_spec\.(rb|[cm]?[jt]sx?|lua|exs?)$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)(tests?|conftest)\.py$/,
  /(Tests?|Spec)\.(java|kt|cs|php|swift|scala|groovy)$/,
];
// spec/ to testy tylko dla kodu (RSpec, Jasmine) i ich fixture'ów;
// `api/spec/v1.yaml` to kontrakt OpenAPI, nie test.
const SPEC_DIR = /(^|\/)specs?\//i;
const SPEC_FIXTURE = /(^|\/)specs?\/(.*\/)?(fixtures?|support|factories|snapshots?|__snapshots__)\//i;
// Lockfile'y i artefakty: nie kod, ale część rozwiązania (wchodzą do reference.diff).
const LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|Cargo\.lock|go\.sum|go\.work\.sum|Gemfile\.lock|composer\.lock|packages\.lock\.json|gradle\.lockfile|[^/]+\.lock)$/;
const NOISE = [
  LOCK,
  /\.(svg|png|jpe?g|gif|ico|webp|bmp|woff2?|ttf|otf|eot|pdf)$/i,
  /\.min\.(js|css)$/i,
  /\.(js|css)\.map$/i,
  // Tylko katalogi wyjściowe w korzeniu (tools/build/*.ts to kod).
  /^(dist|build|out|vendor|generated)\//,
  /(^|\/)(node_modules|__generated__)\//,
];
// Manifesty zależności i budowania: część rozwiązania, nie dokumentacja
// (requirements.txt, CMakeLists.txt kończą się na .txt).
const MANIFEST = [
  /(^|\/)(requirements|constraints)[\w.-]*\.(txt|in)$/i,
  /(^|\/)requirements\/[^/]+\.(txt|in)$/i,
  /(^|\/)(CMakeLists\.txt|[^/]+\.cmake|go\.mod|go\.work|package\.json|pyproject\.toml|setup\.py|setup\.cfg|Pipfile|tox\.ini|MANIFEST\.in|Cargo\.toml|Gemfile|[^/]+\.gemspec|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|Makefile|GNUmakefile|[^/]+\.mk|Dockerfile|Dockerfile\.[\w.-]+|[^/]+\.Dockerfile|composer\.json|[^/]+\.csproj|[^/]+\.fsproj|Directory\.(Build|Packages)\.(props|targets)|Package\.swift|Podfile|pubspec\.yaml|mix\.exs|build\.sbt|meson\.build|BUILD(\.bazel)?|WORKSPACE(\.bazel)?|MODULE\.bazel|deno\.jsonc?|environment\.ya?ml|\.python-version|\.nvmrc|\.node-version|\.tool-versions|rust-toolchain(\.toml)?)$/,
];
// Konfiguracja narzędzi i CI (dotfile'e, workflowy; skrypty w .github/ to kod): nie kod zmiany, ale wchodzi
// do referencji (.npmrc, .babelrc potrafią zmienić build).
const CONFIG = [/^\.(github|gitlab|circleci|husky|vscode|idea|devcontainer)\/(?!.*\.(?:[cm]?[jt]sx?|py|rb|go|rs|sh)$)/, /(^|\/)\.[^/]+$/, /(^|\/)(azure-pipelines\.ya?ml|Jenkinsfile|codecov\.ya?ml|renovate\.json5?|\.?dependabot\.ya?ml)$/];
const DOCS = [/\.(md|mdx|rst|txt|adoc)$/i, /(^|\/)docs?\//i, /(^|\/)(LICENSE|CHANGELOG|CHANGES|CODEOWNERS|AUTHORS|NOTICE)/i];
const kindOf = (path) =>
  TEST.some((r) => r.test(path)) || (SPEC_DIR.test(path) && (CODE_EXT.test(path) || SPEC_FIXTURE.test(path)))
    ? "test"
    : NOISE.some((r) => r.test(path))
      ? "noise"
      : MANIFEST.some((r) => r.test(path))
        ? "manifest"
        : CONFIG.some((r) => r.test(path))
          ? "config"
          : DOCS.some((r) => r.test(path))
            ? "docs"
            : "src";
// Pliki instrukcji agentów: nigdy w referencji (start workspace'u bywa przepisany wyrównaniem).
const CONTEXT = /(^|\/)(AGENTS|CLAUDE|CLAUDE\.local|GEMINI)\.md$/;

// --- patch → linie (z rozszerzeniem pliku i numerem linii po zmianie) --------
// Ścieżka w nagłówku patcha bywa cytowana (core.quotePath): "b/\305\274…".
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  const ESC = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, "\\": 92 };
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== "\\") {
      bytes.push(...Buffer.from(s[i], "utf8"));
      continue;
    }
    const n = s[i + 1];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(ESC[n] ?? n.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
// [{ path, ext, lines: [{ n, text, added }] }] — linie obrazu PO zmianie (kontekst + dodane).
function parsePatch(patch) {
  const files = [];
  let cur = null;
  let n = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      cur = { path: null, ext: "", lines: [] };
      files.push(cur);
    } else if (cur && raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") {
        cur.path = unquote(p).replace(/^b\//, "");
        cur.ext = (cur.path.match(/\.([^./]+)$/)?.[1] ?? "").toLowerCase();
      }
    } else if (cur && raw.startsWith("@@")) {
      n = Number(raw.match(/\+(\d+)/)?.[1] ?? 1);
    } else if (cur && raw.startsWith("+")) {
      cur.lines.push({ n: n++, text: raw.slice(1), raw: raw.slice(1), added: true });
    } else if (cur && raw.startsWith(" ")) {
      cur.lines.push({ n: n++, text: raw.slice(1), added: false });
    }
  }
  return files.filter((f) => f.path);
}
// Linie dodane widziane przez lekser obrazu PO zmianie: `code` (bez komentarzy
// i docstringów) i `bare` (także bez treści stringów). Lekser na całym pliku,
// bo komentarz blokowy bez `*` na początku linii (JSDoc w ky) inaczej wygląda jak kod.
function lexAdded(files, sha) {
  const withAdded = files.filter((f) => f.lines.some((l) => l.added));
  const post = blobs(withAdded.map((f) => `${sha}:${f.path}`));
  for (const [i, f] of withAdded.entries()) {
    const blob = post[i].blob;
    if (!blob) continue;
    const text = blob.text;
    const lexed = lexBlob(blob, f.ext);
    const { code, bare } = lexed;
    // Czy pozycja w pliku leży na linii dodanej przez zmianę (do form kontraktu w kodzie zmiany).
    const starts = [0];
    for (let k = text.indexOf("\n"); k >= 0; k = text.indexOf("\n", k + 1)) starts.push(k + 1);
    const addedNos = new Set(f.lines.filter((l) => l.added).map((l) => l.n));
    const addedAt = (pos) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return addedNos.has(lo + 1);
    };
    f.lexed = { path: f.path, ext: f.ext, ...lexed, addedAt };
    const codeLines = code.split("\n");
    const bareLines = bare.split("\n");
    for (const l of f.lines) {
      l.code = codeLines[l.n - 1] ?? l.text;
      l.bare = bareLines[l.n - 1] ?? l.text;
      l.text = l.bare;
    }
  }
  for (const f of files) for (const l of f.lines) (l.code ??= l.text), (l.bare ??= l.text);
  return files;
}

// --- identyfikatory dodane w kodzie -----------------------------------------
const JS_EXT = /^(?:[cm]?[jt]sx?|vue|svelte)$/;
const KEYWORDS = new Set(
  ("if else for while switch case default break continue return function func def class const let var new delete typeof instanceof " +
    "void yield await async try catch finally throw throws with import export from package struct interface type enum this self " +
    "super null None nil true false True False undefined and not or lambda pass raise except elif assert global nonlocal defer " +
    "range chan select goto map make len cap append string int bool float any static public private protected readonly " +
    "constructor get set extends implements abstract override declare module namespace require print " +
    // wbudowane właściwości JS — `.prototype` w teście to nie nowy kontrakt
    "prototype length then call apply bind toString valueOf hasOwnProperty").split(" "),
);
const DEFINES = [
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:declare\s+)?(?:const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/g,
  /^\s*class\s+([A-Za-z_]\w*)/g,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
  /^(?:type|const|var)\s+([A-Za-z_]\w*)/g, // Go: pojedyncza deklaracja
  /\bfn\s+([A-Za-z_]\w*)/g,
  /\b(?:struct|enum|trait|interface|record)\s+([A-Za-z_]\w*)/g,
];
// TS/JS: metody klas i skrót metody w obiekcie (`  name(…) {`, `async name(`),
// funkcje jako właściwości (`name: (…) =>`, `name = async () =>`).
const JS_METHOD = /^\s+(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{;=]+?)?\s*\{\s*(?:\}\s*)?$/;
const JS_ASYNC_METHOD = /^\s+(?:(?:public|private|protected|static|override)\s+)*async\s+\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const JS_PROP_FN = /^\s+([A-Za-z_$][\w$]*)\s*[?!]?\s*[:=]\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;
// Python: parametry w sygnaturach `def` (nowe kwargi); wiele linii — do domknięcia nawiasu.
const PY_PARAM = /(?:^|[(,])\s*\*{0,2}([A-Za-z_]\w*)\s*(?=[:=,)]|$)/g;
// Map nazwa → "def" | "param". Parametry (kwargi Pythona) liczą się tylko,
// gdy testy ich używają — inaczej zalałyby new_identifiers nazwami lokalnymi.
// Dundery (`__init_subclass__`) to protokół języka, nie nowy interfejs.
function definedNames(files) {
  const names = new Map();
  const add = (n, kind = "def") => {
    if (!n || n.length <= 2 || KEYWORDS.has(n) || /^__\w+__$/.test(n)) return;
    if (names.get(n) !== "def") names.set(n, kind);
  };
  for (const f of files) {
    let goBlock = false; // Go: wnętrze `const (` / `var (` / `type (`
    let pyDepth = 0; // Python: głębokość nawiasów w sygnaturze def
    for (const { text, added } of f.lines) {
      if (f.ext === "go") {
        if (/^(?:const|var|type)\s*\(\s*$/.test(text)) {
          goBlock = true;
          continue;
        }
        if (goBlock && /^\)/.test(text)) goBlock = false;
        else if (goBlock && added) add(text.match(/^\s+([A-Za-z_]\w*)\s*(?:,|=|[A-Za-z_*\[(]|$)/)?.[1]);
      }
      if (f.ext === "py" || f.ext === "pyi") {
        const start = text.match(/^\s*(?:async\s+)?def\s+\w+\s*\((.*)$/);
        const sig = start ? start[1] : pyDepth > 0 ? text : null;
        if (sig !== null) {
          if (added) {
            // Nawiasy w wartościach domyślnych i adnotacjach nie są parametrami.
            const flat = sig.replace(/\[[^\]]*\]/g, "").replace(/\([^()]*\)/g, "");
            for (const m of ("(" + flat).matchAll(PY_PARAM)) if (!["self", "cls", "args", "kwargs"].includes(m[1])) add(m[1], "param");
          }
          pyDepth = Math.max(0, (start ? 1 : pyDepth) + (sig.match(/\(/g)?.length ?? 0) - (sig.match(/\)/g)?.length ?? 0));
        }
      }
      if (!added) continue;
      for (const re of DEFINES) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) add(m[1]);
      }
      if (JS_EXT.test(f.ext)) {
        for (const re of [JS_METHOD, JS_ASYNC_METHOD, JS_PROP_FN]) add(text.match(re)?.[1]);
      }
    }
  }
  return names;
}

// --- kod źródłowy pinu: komentarze i stringi wycięte --------------------------
// Heurystyczny lekser (nie parser): `code` = komentarze zastąpione spacjami,
// `bare` = dodatkowo treść stringów (docstringi!) zastąpiona spacjami.
// Długości i pozycje zachowane, więc oba warianty indeksuje się tak samo.
const HASH_COMMENT = /^(py|pyi|rb|sh|bash|zsh|pl|pm|r|ex|exs|nim|cr|jl|coffee|php)$/;
const SLASH_COMMENT = /^(c|h|cc|cpp|cxx|hpp|hh|m|mm|java|kt|kts|scala|groovy|cs|fs|swift|go|rs|[cm]?[jt]sx?|php|dart|vue|svelte|zig|sol|proto)$/;
function lex(text, ext) {
  const hash = HASH_COMMENT.test(ext);
  const slash = SLASH_COMMENT.test(ext);
  const triple = ext === "py" || ext === "pyi";
  const quotes = ext === "rs" ? "\"" : JS_EXT.test(ext) || ext === "go" ? "\"'`" : "\"'";
  const code = text.split("");
  const bare = text.split("");
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < arr.length; k++) if (arr[k] !== "\n") arr[k] = " ";
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if ((slash && ch === "/" && text[i + 1] === "/") || (hash && ch === "#")) {
      let end = text.indexOf("\n", i);
      if (end < 0) end = n;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
    } else if (slash && ch === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      end = end < 0 ? n : end + 2;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
    } else if (triple && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.slice(i, i + 3);
      let j = i + 3;
      while (j < n && !text.startsWith(q, j)) j += text[j] === "\\" ? 2 : 1;
      // Docstring to dokumentacja, nie kod — wycięty także z `code`.
      blank(code, i + 3, j);
      blank(bare, i + 3, j);
      i = Math.min(n, j + 3);
    } else if (quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && text[j] !== ch) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === "\n" && ch !== "`") break; // niedomknięty (np. regex) — tylko do końca linii
        else j++;
      }
      blank(bare, i + 1, j);
      i = j + 1;
    } else i++;
  }
  const bareText = bare.join("");
  // Najbliższy otwarty nawias dla każdej pozycji (kontekst: `{` obiekt/typ, `(` parametry).
  const opener = new Int32Array(n);
  const stack = [];
  for (let k = 0; k < n; k++) {
    opener[k] = stack.length ? stack[stack.length - 1] : -1;
    const c = bareText[k];
    if (c === "{" || c === "(" || c === "[") stack.push(k);
    else if ((c === "}" || c === ")" || c === "]") && stack.length) stack.pop();
  }
  return { code: code.join(""), bare: bareText, opener };
}

// Pliki ŹRÓDŁOWE pinu (bez testów, docs, manifestów, szumu), które w ogóle
// zawierają któryś z tokenów — jeden `git grep` na kandydata, potem lekser.
// `probe`: ścieżki, o których istnienie na pinie pytamy przy okazji (nowe pliki zmiany).
function pinSources(pin, tokens, probe = []) {
  const out = (tokens.length && tryGit("grep", "-l", "-I", "-z", "-F", ...tokens.flatMap((t) => ["-e", t]), pin)) || "";
  const prefix = `${pin}:`;
  const paths = out
    .split("\0")
    .filter(Boolean)
    .map((entry) => (entry.startsWith(prefix) ? entry.slice(prefix.length) : entry))
    .filter((path) => kindOf(path) === "src");
  const got = blobs([...paths, ...probe].map((path) => `${pin}:${path}`));
  const sources = [];
  sources.existing = new Set(probe.filter((_, i) => got[paths.length + i].exists));
  for (const [i, path] of paths.entries()) {
    if (!got[i].blob) continue;
    const ext = (path.match(/\.([^./]+)$/)?.[1] ?? "").toLowerCase();
    sources.push({ path, ext, text: got[i].blob.text, ...lexBlob(got[i].blob, ext) });
  }
  return sources;
}
const esc = (t) => t.replace(/\$/g, "\\$");
const wordRe = (t, flags = "") => new RegExp(`(?<![\\w$])${esc(t)}(?![\\w$])`, flags);
// Nazwa istnieje na pinie: słowo w kodzie źródłowym (bez komentarzy, docstringów, stringów).
const nameAtPin = (sources, t) => sources.some((s) => wordRe(t).test(s.bare));
// Token kontraktu (pole, klucz, kwarg) istnieje na pinie jako interfejs, w tej
// samej formie składni: `.tok`, klucz/właściwość `tok:` w `{…}`, klucz w
// cudzysłowie, kwarg `tok=`/parametr `def`, definicja, pole struktury Go.
// Słowo w komentarzu, parametr pozycyjny TS (`(req, init: X)`) czy zmienna
// lokalna się nie liczą.
// `accept(s, pos)` zawęża dopasowania (np. do linii dodanych przez zmianę).
function contractForm(sources, t, accept = () => true) {
  const T = `(?<t>${esc(t)})(?![\\w$])`;
  const ctxOf = (s, pos) => {
    const o = s.opener[pos];
    return { ch: o >= 0 ? s.bare[o] : "", before: o >= 0 ? s.bare.slice(Math.max(0, o - 80), o) : "" };
  };
  const any = (re, s, text, ok = () => true) => {
    for (const m of text.matchAll(re)) {
      const pos = m.indices.groups.t[0];
      if (accept(s, pos) && ok(ctxOf(s, pos))) return true;
    }
    return false;
  };
  for (const s of sources) {
    const py = s.ext === "py" || s.ext === "pyi";
    const go = s.ext === "go";
    if (any(new RegExp(`(?<!\\.)\\.${T}`, "dg"), s, s.bare)) return true;
    if (any(new RegExp(`(["'\`])${T}\\1`, "dg"), s, s.code)) return true;
    if (any(new RegExp(`\\b(?:def|function|func|class|fn|type|interface|struct|enum|trait|module|record|attr_\\w+)\\s+(?:\\([^)\\n]*\\)\\s*)?[*:]?${T}`, "dg"), s, s.bare)) return true;
    if (any(new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:const|let|var)\\s+${T}`, "dg"), s, s.bare)) return true;
    if (any(new RegExp(`^[ \\t]*(?:(?:async|static|get|set|public|private|protected|override|readonly|abstract)\\s+)*\\*?${T}\\s*(?:<[^>\\n]*>)?\\s*\\([^)\\n]*\\)\\s*(?::[^{;\\n]*)?\\{`, "dgm"), s, s.bare, (c) => c.ch === "{")) return true;
    // Klucz/właściwość: w `{…}` (obiekt, typ, interfejs, literał struktury Go); w Pythonie także adnotacje i parametry.
    if (any(new RegExp(`(?:^|[{,;(])[ \\t]*(?:(?:readonly|public|private|protected|static|declare|override)\\s+)*${T}\\s*[?!]?\\s*:(?![:=])`, "dgm"), s, s.bare, (c) => py || c.ch === "{")) return true;
    // JS/TS: właściwość skrócona `{ tok, … }` (zwracany obiekt), destrukturyzacja, import nazwany.
    if (JS_EXT.test(s.ext) && any(new RegExp(`(?:^|[{,])[ \\t]*${T}[ \\t]*(?=[,}]|$)`, "dgm"), s, s.bare, (c) => c.ch === "{")) return true;
    if (py) {
      if (any(new RegExp(`[(,]\\s*${T}\\s*=(?!=)`, "dg"), s, s.bare, (c) => c.ch === "(")) return true; // kwarg / wartość domyślna
      if (any(new RegExp(`[(,]\\s*\\*{0,2}${T}\\s*(?::[^,)=\\n]+)?\\s*[,)]`, "dg"), s, s.bare, (c) => c.ch === "(" && /\bdef\s+\w+\s*$/.test(c.before))) return true;
      if (any(new RegExp(`^(?: {0,4}|\\t?)${T}\\s*(?::[^=\\n]+)?=(?!=)`, "dgm"), s, s.bare)) return true; // atrybut klasy / moduł
    }
    if (go) {
      if (any(new RegExp(`^[ \\t]+${T}[ \\t]+[*\\[\\]\\w.]`, "dgm"), s, s.bare, (c) => c.ch === "{" || (c.ch === "(" && /\b(?:const|var|type)\s*$/.test(c.before)))) return true;
      if (any(new RegExp(`^[ \\t]+${T}\\s*=`, "dgm"), s, s.bare, (c) => c.ch === "(" && /\b(?:const|var)\s*$/.test(c.before))) return true;
    }
  }
  return false;
}

// --- jeden kandydat: metadane i pliki (tanie) ----------------------------------
// Rozpoznanie formatu merge'a: numer PR-a (string; GitLab "!N"), tytuł,
// gałąź źródłowa (do wykrycia back-merge'y).
const LONG_LIVED = /^(?:main|master|trunk|develop|development|dev|stable|next|staging|production|release[\w./-]*|v?\d+(?:\.\d+)*(?:\.x)?|\d+\.\d+\.x)$/i;
function parseMerge(subject, body) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const bodyTitle =
    lines.find((l) => !/^(See merge request|Approved-by:|Reviewed-by:|Signed-off-by:|Co-authored-by:|Merged in |Closes |Fixes |\* )/i.test(l) && l !== subject) ?? null;
  let m;
  const gitlab = body.match(/See merge request\s+\S*?!(\d+)/i);
  if (gitlab) {
    const branch = subject.match(/^Merge branch '([^']+)'/)?.[1] ?? null;
    const generic = /^Merge branch '[^']+'( into '?[^']*'?)?\s*$/.test(subject);
    return { pr: `!${gitlab[1]}`, title: generic ? (bodyTitle ?? branch ?? subject) : subject, branch, via: "gitlab" };
  }
  if ((m = subject.match(/^Merge pull request #(\d+) (?:in \S+ )?from (\S+)(?: to \S+)?\s*$/))) {
    // GitHub: "from owner/gałąź"; Bitbucket Server: "from gałąź" (z `in PROJ/repo`).
    const branch = /\bin \S+ from/.test(subject) ? m[2] : m[2].replace(/^[^/:]+[/:]/, "");
    return { pr: m[1], title: bodyTitle ?? branch, branch, via: "github" };
  }
  if ((m = subject.match(/^Merged in (\S+) \(pull request #(\d+)\)/))) return { pr: m[2], title: bodyTitle ?? m[1], branch: m[1], via: "bitbucket" };
  if ((m = subject.match(/^Merged PR (\d+):\s*(.*)$/))) return { pr: m[1], title: m[2] || bodyTitle || subject, branch: null, via: "azure" };
  if ((m = subject.match(/\(#(\d+)\)\s*$/))) return { pr: m[1], title: subject, branch: null, via: "squash" };
  return { pr: null, title: subject, branch: null, via: null };
}
// Synchronizacja gałęzi, nie zmiana: back-merge stable→main (nawet z `(#N)`),
// merge'e generowane przez gita bez PR-a.
function syncMerge(subject, merge) {
  // PR z gałęzi długowiecznej (stable, release-1.2) to back-merge. main/master
  // jako źródło PR-a na first-parent gałęzi domyślnej to fork kontrybutora, nie sync.
  const src = merge.branch?.replace(/^(?:origin|upstream)\//, "");
  if (src && LONG_LIVED.test(src) && !/^(main|master|trunk)$/i.test(src)) return true;
  if (merge.via && merge.via !== "squash") return false; // PR/MR z gałęzi roboczej
  if (/^Merge (remote-tracking branch|branches|branch '|tag '|commit ')/.test(subject)) return true;
  // Tytuł to sama nazwa gałęzi długowiecznej: "Stable (#3851)".
  if (LONG_LIVED.test(subject.replace(/\s*\(#\d+\)\s*$/, "").replace(/[`'"]/g, "").trim())) return true;
  const into = subject.match(/^merge\s+(?:branch\s+)?[`'"]?([\w./-]+)[`'"]?\s+into\s+[`'"]?([\w./-]+)[`'"]?/i);
  return Boolean(into && [into[1], into[2]].some((b) => LONG_LIVED.test(b.replace(/^(?:origin|upstream)\//, ""))));
}

let shallowSet = null;
function isShallowBoundary(sha) {
  if (shallowSet === null) {
    const p = tryGit("rev-parse", "--git-path", "shallow");
    let text = "";
    try {
      text = p ? readFileSync(resolve(repo, p.trim()), "utf8") : "";
    } catch {}
    shallowSet = new Set(text.split("\n").filter(Boolean));
  }
  return shallowSet.has(sha);
}

// Metadane commita: %H %P %an %aI %s %b, pola rozdzielone \x1f, rekordy \x1e
// (skan czyta je jednym `git log` dla całego okna).
const META_FORMAT = "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b%x1e";
const parseMeta = (out) =>
  out
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => r.split("\x1f"));
function describe(sha, meta = null) {
  if (!meta) {
    const full = tryGit("rev-parse", "--verify", "-q", `${sha}^{commit}`)?.trim();
    if (!full) throw new MineError(`${sha}: nie ma takiego commita w ${repo}`);
    meta = parseMeta(git("show", "-s", "--no-show-signature", META_FORMAT, full))[0];
  }
  const [full, parentsRaw, author, date, subject, bodyRaw] = meta;
  const body = (bodyRaw ?? "").trim();
  const parents = parentsRaw.trim().split(" ").filter(Boolean);
  const pin = parents[0];
  if (!pin) {
    throw new MineError(
      isShallowBoundary(full)
        ? `${full.slice(0, 10)}: granica płytkiego klonu — rodzic nie jest pobrany. Pogłęb: git -C ${repo} fetch --deepen=50 origin`
        : `${full.slice(0, 10)}: commit bez rodzica (korzeń historii) — nie ma stanu sprzed zmiany, nie ma pinu`,
    );
  }
  const merge = parseMerge(subject, body);
  // Commity gałęzi PR-a (tylko dla merge commita): czas pracy nad zmianą.
  let branchSpanHours = null;
  if (parents.length > 1) {
    const dates = (tryGit("log", "--format=%aI", `${parents[0]}..${parents[1]}`) ?? "").split("\n").filter(Boolean);
    if (dates.length) branchSpanHours = Math.round((Date.parse(date) - Date.parse(dates[dates.length - 1])) / 36e5);
  }
  // -z: ścieżki bez cytowania (polskie znaki, spacje, cudzysłowy) — `added\tremoved\tpath\0`.
  const numstat = tryGit(...DIFF, "--numstat", "-z", pin, full);
  // Rodzica nie ma lokalnie (uszkodzony/częściowy klon) — zmiany nie da się porównać.
  if (numstat === null) {
    throw new MineError(`${full.slice(0, 10)}: rodzic ${pin.slice(0, 10)} nie istnieje lokalnie (granica płytkiego klonu?). Pogłęb: git -C ${repo} fetch --deepen=50 origin`);
  }
  const files = numstat
    .split("\0")
    .filter(Boolean)
    .map((rec) => {
      const t1 = rec.indexOf("\t");
      const t2 = rec.indexOf("\t", t1 + 1);
      const [added, removed, path] = [rec.slice(0, t1), rec.slice(t1 + 1, t2), rec.slice(t2 + 1)];
      return { path, added: Number(added) || 0, removed: Number(removed) || 0, binary: added === "-", kind: kindOf(path) };
    });
  const src = files.filter((f) => f.kind === "src");
  const tests = files.filter((f) => f.kind === "test");
  const srcLines = src.reduce((a, f) => a + f.added + f.removed, 0);

  const title = merge.title.trim() || subject;
  const conventional = title.match(/^(\w+)(?:\([^)]*\))?!?:/)?.[1]?.toLowerCase() ?? null;
  const classHint =
    { fix: "bugfix", feat: "feature", refactor: "refactor", perf: "performance", test: "test-only" }[conventional] ??
    (/\b(fix|bug|crash|regression|broken|error)\b/i.test(title) ? "bugfix" : /\b(add|support|implement|new|introduce)\b/i.test(title) ? "feature" : null);
  const reasons = [];
  if (/^(chore\(release\)|release|bump|revert)/i.test(title) || /^Revert /.test(subject)) reasons.push("release/revert");
  if (syncMerge(subject, merge)) reasons.push("sync/back-merge gałęzi (nie PR)");
  if (/\[bot\]|dependabot|renovate/i.test(author)) reasons.push("bot");
  if (!src.length) reasons.push("brak zmian w kodzie");
  if (!tests.length) reasons.push("brak testów w zmianie");
  // Testy tylko usunięte (bez dodanych linii): nie ma czego użyć jako guard fail-to-pass.
  else if (!tests.some((f) => f.added > 0 || f.binary)) reasons.push("testy tylko usunięte");
  return {
    sha: full,
    pin,
    pr: merge.pr,
    title,
    body,
    author,
    date,
    class_hint: classHint,
    src_files: src.map((f) => f.path),
    test_files: tests.map((f) => f.path),
    manifest_files: files.filter((f) => f.kind === "manifest").map((f) => f.path),
    other_files: files.filter((f) => f.kind !== "src" && f.kind !== "test").map((f) => f.path),
    src_lines: srcLines,
    size: srcLines <= 60 ? "S" : srcLines <= 250 ? "M" : "L",
    branch_span_hours: branchSpanHours,
    new_identifiers: null, // liczone w addCoupling — tylko dla kandydatów po tanich wykluczeniach
    coupled: null,
    excluded: reasons,
  };
}

// --- sprzężenie (drogie: diffy + git grep + lekser) ---------------------------
// Nazwy zdefiniowane w dodanym kodzie, nieobecne w kodzie źródłowym pinu,
// używane przez dodane linie testów + tokeny kontraktu + nowe pliki kodu
// importowane w testach.
function addCoupling(c) {
  c.new_identifiers = [];
  c.coupled = [];
  if (!c.src_files.length || !c.test_files.length) return c;
  // Jeden diff kodu i testów, jedno czytanie obrazów po zmianie.
  const patched = lexAdded(parsePatch(git(...DIFF, c.pin, c.sha, "--", ...c.src_files, ...c.test_files)), c.sha);
  const testSet = new Set(c.test_files);
  const srcFiles = patched.filter((f) => !testSet.has(f.path));
  const testFiles = patched.filter((f) => testSet.has(f.path));
  const added = (files, key) => files.flatMap((f) => f.lines.filter((l) => l.added).map((l) => l[key])).join("\n");
  const testBare = added(testFiles, "bare");
  const defs = definedNames(srcFiles);
  const allDefined = [...defs.keys()];
  // Parametr (kwarg) liczy się tylko jako `nazwa=` w wywołaniu w teście —
  // samo słowo bywa zmienną testu (parametrize, lokalna) o tej samej nazwie.
  const defined = allDefined.filter((name) =>
    defs.get(name) === "param" ? new RegExp(`[(,]\\s*${esc(name)}\\s*=(?!=)`).test(testBare) : wordRe(name).test(testBare),
  );
  // Tokeny kontraktu, na których testy asertują (bez komentarzy i treści
  // stringów, poza kluczem w cudzysłowie): `.pole`, `klucz:`, kwarg
  // `nazwa=` w wywołaniu, klucz `["nazwa"]`.
  const contractTokens = new Set();
  // Lookbehind z \p{L}: "płytko:" nie może dać tokenu "ytko".
  const TOKEN_RES = [
    [/(?<!\.)\.([A-Za-z_$][\w$]{2,})(?![\w$])/gu, "bare"],
    [/(?<![\p{L}\w$?])([A-Za-z_$][\w$]{2,})\s*:(?![:=])/gu, "bare"],
    [/(?<=[(,]\s*)([A-Za-z_][\w]{2,})\s*=(?![=>])/gu, "bare"],
    [/\[\s*(["'])([A-Za-z_$][\w$]{2,})\1\s*\]/gu, "code"],
  ];
  for (const [re, key] of TOKEN_RES) for (const m of added(testFiles, key).matchAll(re)) contractTokens.add(m[2] ?? m[1]);
  // Token musi być WPROWADZONY przez kod zmiany w formie kontraktu (klucz,
  // właściwość, `.pole`, kwarg) — samo słowo (parametr, zmienna) to nie interfejs.
  const postSrc = srcFiles.filter((f) => f.lexed).map((f) => f.lexed);
  const tokens = [...contractTokens].filter((t) => !KEYWORDS.has(t) && !defined.includes(t) && contractForm(postSrc, t, (s, pos) => s.addedAt(pos)));
  const sources = pinSources(c.pin, [...new Set([...allDefined, ...tokens])], c.src_files);
  c.new_identifiers = allDefined.filter((name) => (defs.get(name) === "def" || defined.includes(name)) && !nameAtPin(sources, name));
  c.coupled = c.new_identifiers.filter((name) => defined.includes(name));
  for (const t of tokens) if (!contractForm(sources, t)) c.coupled.push(`name:${t}`);
  const testRaw = added(testFiles, "raw");
  for (const path of c.src_files) {
    if (sources.existing.has(path)) continue;
    const stem = path.split("/").pop().replace(/\.[^.]+$/, "");
    if (stem.length > 2 && testRaw.includes(stem)) c.coupled.push(`file:${path}`);
  }
  return c;
}

const prLabel = (pr) => (pr === null ? "" : pr.startsWith("!") ? pr : `#${pr}`);
const NO_COUPLING = "sprzężenia nie wykryto (heurystyka — przeczytaj testy)";

// Komunikat zamiast stosu dla błędów oczekiwanych (show/emit na złym commicie).
function fail(e) {
  if (e instanceof MineError) {
    console.error(`mine-prs: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

// --- tryby -----------------------------------------------------------------------
if (mode === "scan") {
  // Domyślnie tip remote'a: `git fetch origin` nie przesuwa lokalnego HEAD
  // klonu, a piny muszą istnieć na remote (first-parent gałęzi domyślnej).
  const ref = flag("--ref", tryGit("rev-parse", "--verify", "-q", "origin/HEAD") ? "origin/HEAD" : "HEAD");
  const since = Number(flag("--since", "365"));
  // Data ISO zamiast "N days ago": git źle czyta duże N (np. 99999 days ago).
  const sinceDate = new Date(Math.max(0, Date.now() - since * 86_400_000)).toISOString();
  if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
    // Płytki klon wystarcza, o ile historia pokrywa okno --since; inaczej
    // kopiemy to, co jest, i mówimy, czego brakuje.
    const dates = git("log", "--first-parent", "--format=%cI", ref).split("\n").filter(Boolean);
    const oldest = dates.length ? Date.parse(dates[dates.length - 1]) : Date.now();
    if (oldest > Date.parse(sinceDate)) {
      console.error(
        `mine-prs: klon płytki — historia sięga ${new Date(oldest).toISOString().slice(0, 10)}, okno --since ${since} dni sięga dalej. ` +
          `Pogłęb raz (orkiestrator, nie subagent):\n  git -C ${repo} fetch --shallow-since=${sinceDate.slice(0, 10)} origin   (albo --unshallow)`,
      );
    }
  }
  const maxFiles = Number(flag("--max-files", "12"));
  const maxLines = Number(flag("--max-lines", "800"));
  const limit = Number(flag("--limit", "30"));
  const metas = parseMeta(git("log", "--first-parent", "--no-show-signature", `--since=${sinceDate}`, META_FORMAT, ref));
  const all = [];
  for (const meta of metas) {
    let c;
    try {
      c = describe(meta[0], meta);
    } catch (e) {
      if (e instanceof MineError) continue; // korzeń / granica płytkiego klonu
      throw e;
    }
    if (c.src_files.length > maxFiles) c.excluded.push(`>${maxFiles} plików kodu`);
    if (c.src_lines > maxLines) c.excluded.push(`>${maxLines} linii kodu`);
    // Sprzężenie tylko dla tych, którzy przeszli tanie wykluczenia.
    if (!c.excluded.length) addCoupling(c);
    all.push(c);
  }
  // Ranking: testy bez sprzężenia > testy ze sprzężeniem; potem rozmiar M > S > L, świeżość.
  const sizeRank = { M: 0, S: 1, L: 2 };
  const ranked = all
    .filter((c) => has("--all") || c.excluded.length === 0)
    .sort(
      (a, b) =>
        (a.excluded.length > 0) - (b.excluded.length > 0) ||
        (a.coupled?.length > 0) - (b.coupled?.length > 0) ||
        sizeRank[a.size] - sizeRank[b.size] ||
        b.date.localeCompare(a.date),
    )
    .slice(0, limit);
  if (has("--json")) {
    console.log(JSON.stringify({ repo: resolve(repo), scanned: all.length, candidates: ranked }, null, 2));
  } else {
    console.log(`mine-prs: ${all.length} zmian w historii (${since} dni), kandydatów: ${ranked.length}${has("--all") ? " (z wykluczonymi)" : ""}\n`);
    for (const c of ranked) {
      const coupling = !c.test_files.length
        ? "bez testów"
        : c.coupled === null
          ? "sprzężenie nie liczone (wykluczony)"
          : c.coupled.length
            ? `sprzężone: ${c.coupled.slice(0, 4).join(", ")}${c.coupled.length > 4 ? "…" : ""}`
            : NO_COUPLING;
      console.log(
        `${c.sha.slice(0, 10)} ${prLabel(c.pr).padEnd(6)} ${c.size} ${String(c.class_hint ?? "?").padEnd(11)} ` +
          `${c.src_files.length} kod / ${c.test_files.length} test  ${c.title.slice(0, 70)}`,
      );
      console.log(`             ${coupling}${c.excluded.length ? ` | wykluczony: ${c.excluded.join(", ")}` : ""}`);
    }
  }
} else if (mode === "show") {
  if (!target) fail(new MineError("show wymaga <sha>"));
  let c;
  try {
    c = addCoupling(describe(target));
  } catch (e) {
    fail(e);
  }
  if (has("--json")) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(`${c.sha}  ${c.pr ? `PR ${prLabel(c.pr)}` : "(bez numeru PR)"}  ${c.date}\n${c.title}\n`);
    if (c.body) console.log(`${c.body}\n`);
    console.log(`pin (stan sprzed zmiany): ${c.pin}`);
    console.log(`kod (${c.src_lines} linii, ${c.size}): ${c.src_files.join(", ") || "—"}`);
    console.log(`testy: ${c.test_files.join(", ") || "—"}`);
    if (c.manifest_files.length) console.log(`manifesty (w referencji): ${c.manifest_files.join(", ")}`);
    const rest = c.other_files.filter((p) => !c.manifest_files.includes(p));
    if (rest.length) console.log(`pozostałe: ${rest.join(", ")}`);
    console.log(`nowe identyfikatory w kodzie: ${c.new_identifiers.join(", ") || "—"}`);
    console.log(
      c.coupled.length
        ? `SPRZĘŻENIE: testy używają ${c.coupled.join(", ")} — prompt musi podać ten interfejs dosłownie, albo te testy odpadają`
        : "sprzężenie: nie wykryto (heurystyka — przeczytaj testy); testy wyglądają na sprawdzające zachowanie przez interfejs istniejący na pinie",
    );
    if (c.branch_span_hours !== null) console.log(`czas gałęzi PR-a: ~${c.branch_span_hours} h (górna granica czasu pracy człowieka)`);
    if (c.excluded.length) console.log(`wykluczenia: ${c.excluded.join(", ")}`);
  }
} else if (mode === "emit") {
  if (!target) fail(new MineError("emit wymaga <sha>"));
  const out = flag("--out");
  if (!out) fail(new MineError("emit wymaga --out <dir>"));
  let c;
  try {
    c = addCoupling(describe(target));
  } catch (e) {
    fail(e);
  }
  if (!c.test_files.length) fail(new MineError(`${target}: zmiana bez testów — nie ma czego użyć jako guard fail-to-pass`));
  if (c.excluded.includes("testy tylko usunięte")) fail(new MineError(`${target}: zmiana tylko usuwa testy — nie ma czego użyć jako guard fail-to-pass`));
  mkdirSync(out, { recursive: true });
  // Referencja = rozwiązanie: kod z manifestami i lockfile'ami (bez nich
  // instalacja zależności dodanych przez zmianę by padła). Bez dokumentacji
  // i plików instrukcji agentów: start workspace'u bywa przepisany przez
  // wyrównanie AGENTS.md/CLAUDE.md, a docs nie są częścią dowodu.
  const nonTest = [...c.src_files, ...c.other_files.filter((p) => ["noise", "manifest", "config"].includes(kindOf(p)))].filter((p) => !CONTEXT.test(p));
  // Surowe bajty: tekst w innym kodowaniu niż UTF-8 nie może przejść przez dekodowanie.
  writeFileSync(join(out, "reference.diff"), nonTest.length ? gitBuf(...DIFF, "--binary", c.pin, c.sha, "--", ...nonTest) : "");
  writeFileSync(join(out, "tests.diff"), gitBuf(...DIFF, "--binary", c.pin, c.sha, "--", ...c.test_files));
  const snapshots = [];
  for (const path of c.test_files) {
    // cat-file blob: bajty z obiektu, bez textconv i filtrów; null = plik usunięty przez PR.
    const content = tryGitBuf("cat-file", "blob", `${c.sha}:${path}`);
    if (content === null) continue;
    const dest = join(out, "files", path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    snapshots.push(path);
  }
  writeFileSync(join(out, "meta.json"), JSON.stringify({ ...c, snapshot_files: snapshots }, null, 2) + "\n");
  console.log(`mine-prs: ${c.sha.slice(0, 10)} → ${out}`);
  console.log(
    `  pin ${c.pin}; reference.diff (${c.src_files.length} plików kodu` +
      `${c.manifest_files.length ? ` + ${c.manifest_files.length} manifestów` : ""} — dowód, nigdy do zadania); files/ (${snapshots.length} plików testów po merge'u)`,
  );
  if (c.coupled.length) console.log(`  UWAGA sprzężenie: ${c.coupled.join(", ")} — prompt musi to podać dosłownie albo testy odpadają`);
}
