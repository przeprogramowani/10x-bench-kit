// Testy jednostkowe czystych funkcji runnera i skilli — bez kontenerów,
// bez sieci, bez kluczy. Moduły runnera są w TypeScripcie, więc:
//   node --experimental-strip-types --test .github/tests/units.test.mjs
// (wymaga `npm ci --prefix .bench-kit/runner` — zod/yaml).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = (name) => import(join(ROOT, ".bench-kit", "runner", "src", "lib", name));
const skill = (path) => import(join(ROOT, ".agents", "skills", path));
const command = (name) => import(join(ROOT, ".bench-kit", "runner", "src", "commands", name));

// Katalogi tymczasowe testów — sprzątane po całym pliku (nie zostają w /tmp).
const tempDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("harness: id modelu → harness, routing, model CLI", async () => {
  const { parseModelId } = await lib("harness.ts");
  const cases = [
    ["openrouter/anthropic/claude-sonnet-5", "opencode", "openrouter", "openrouter/anthropic/claude-sonnet-5"],
    ["openrouter/qwen/qwen3-coder:free", "opencode", "openrouter", "openrouter/qwen/qwen3-coder:free"],
    ["claude-code:claude-sonnet-4-5", "claude-code", "native", "claude-sonnet-4-5"],
    ["claude-code:openrouter/anthropic/claude-sonnet-4.5", "claude-code", "openrouter", "anthropic/claude-sonnet-4.5"],
    ["codex:gpt-5.1-codex", "codex", "native", "gpt-5.1-codex"],
    ["codex:openrouter/openai/gpt-5.1-codex", "codex", "openrouter", "openai/gpt-5.1-codex"],
  ];
  for (const [id, harness, route, cliModel] of cases) {
    const p = parseModelId(id);
    assert.deepEqual([p.harness, p.route, p.cliModel], [harness, route, cliModel], id);
  }
});

test("harness: klucze, literówki prefiksu, tożsamość modelu", async () => {
  const { requiredKeysFor, unknownHarnessPrefix, underlyingModel } = await lib("harness.ts");
  assert.deepEqual(requiredKeysFor("codex:gpt-5.1-codex"), ["OPENAI_API_KEY", "CODEX_API_KEY"]);
  assert.deepEqual(requiredKeysFor("claude-code:openrouter/x/y"), ["OPENROUTER_API_KEY"]);
  assert.equal(unknownHarnessPrefix("claude:sonnet"), "claude");
  assert.equal(unknownHarnessPrefix("openrouter/qwen/qwen3-coder:free"), null);
  // Sędzia przez inny prefiks/routing to nadal ten sam model.
  for (const id of ["openrouter/anthropic/claude-opus-5", "claude-code:claude-opus-5", "claude-code:openrouter/anthropic/claude-opus-5"]) {
    assert.equal(underlyingModel(id), "anthropic/claude-opus-5", id);
  }
  assert.equal(underlyingModel("claude-code:claude-sonnet-4-5-20250929"), "anthropic/claude-sonnet-4.5");
});

test("pricing: polityka, slugi katalogu, wycena tokenów, domknięcie kosztu", async () => {
  const { parseModelId } = await lib("harness.ts");
  const { costPolicy, catalogSlugFor, priceTokens, finalizeCost, resolvePrice } = await lib("pricing.ts");
  assert.equal(costPolicy(parseModelId("openrouter/x/y")), "harness");
  assert.equal(costPolicy(parseModelId("claude-code:claude-sonnet-5")), "harness-or-priced");
  assert.equal(costPolicy(parseModelId("claude-code:openrouter/anthropic/claude-sonnet-5")), "priced");
  assert.equal(catalogSlugFor(parseModelId("claude-code:claude-3-5-sonnet-20241022")), "anthropic/claude-3.5-sonnet");
  assert.equal(catalogSlugFor(parseModelId("claude-code:sonnet")), null);
  assert.equal(priceTokens({ input: 1e6, output: 1e5, cache_read: 1e6, cache_write: 0 }, { input: 1.25, output: 10, cache_read: 0.125 }), 2.375);
  const cfg = { pricing: { "codex:gpt-5.1-codex": { input: 1, output: 2 } } };
  const catalog = new Map([["openai/gpt-5.1-codex", { input: 9, output: 9 }]]);
  assert.equal(resolvePrice(parseModelId("codex:gpt-5.1-codex"), cfg, catalog).source, "config");
  // Claude Code przez OpenRouter: koszt harnessu zastąpiony wyceną, zachowany do porównania.
  const m = { cost_usd: 0.5, cost_source: "harness", harness_cost_usd: 0.5, tokens: { input: 1e6, output: 0 } };
  finalizeCost(m, parseModelId("claude-code:openrouter/anthropic/claude-sonnet-5"), { input: 3, output: 15, source: "openrouter:x" });
  assert.equal(m.cost_usd, 3);
  assert.equal(m.harness_cost_usd, 0.5);
  // Brak ceny → koszt nieznany, nigdy zero.
  const u = { cost_usd: null, tokens: { input: 5, output: 5 } };
  finalizeCost(u, parseModelId("codex:gpt-x"), null);
  assert.equal(u.cost_usd, null);
  assert.equal(u.incomplete, true);
});

test("era: świeżość oceny obejmuje ścieżkę oceny i próg; klucz ery je rozróżnia", async () => {
  const { staleReasons } = await lib("matrix.ts");
  const { eraKey } = await lib("era.ts");
  const era = { scoring_version: "3", task_hash: "h", judge_model: "j", rubric_version: "r@1", judge_mode: "agent", pass_threshold: 0.7 };
  const base = { scoring_version: "3", task_hash: "h", judge_model: "j", rubric_version: "r@1" };
  assert.deepEqual(staleReasons({ ...base, judge_mode: "agent", pass_threshold: 0.7 }, era), []);
  assert.match(staleReasons({ ...base, judge_mode: "api", pass_threshold: 0.7 }, era)[0], /ścieżka oceny api→agent/);
  assert.match(staleReasons({ ...base, judge_mode: "agent", pass_threshold: 0.5 }, era)[0], /próg zaliczenia/);
  assert.notEqual(eraKey({ ...base, judge_mode: "agent", pass_threshold: 0.7 }), eraKey({ ...base, judge_mode: "api", pass_threshold: 0.7 }));
});

test("context files: wyrównanie pary i wiszący symlink bez wywrotki", async () => {
  const { unifyContextFiles } = await lib("context-files.ts");
  const a = tempDir("cf-a-");
  writeFileSync(join(a, "AGENTS.md"), "x");
  assert.deepEqual(unifyContextFiles(a, "unified"), ["CLAUDE.md → import @AGENTS.md"]);
  assert.deepEqual(unifyContextFiles(a, "native"), []);
  const b = tempDir("cf-b-");
  writeFileSync(join(b, "CLAUDE.md"), "x");
  symlinkSync("missing.md", join(b, "AGENTS.md"));
  assert.deepEqual(unifyContextFiles(b, "unified"), []);
  assert.equal(readlinkSync(join(b, "AGENTS.md")), "missing.md");
});

test("power: runner i bench-analysis liczą tę samą rozdzielczość; <6 zadań = żadna", async () => {
  const runner = await lib("power.ts");
  const decide = await skill("bench-analysis/analytics.mjs");
  for (const n of [4, 5, 6, 10, 20, 40, 80]) assert.equal(runner.resolvableGap(n), decide.resolvableGap(n), `n=${n}`);
  assert.equal(decide.resolvableGap(5), null);
  assert.equal(decide.tasksNeeded(0.2), 57);
  assert.equal(decide.tasksNeeded(0.5), 17);
});

test("analytics: test znaków dokładny, pass^k, bootstrap deterministyczny", async () => {
  const { signTestP, passHatK, bootstrapMean } = await skill("bench-analysis/analytics.mjs");
  // Brute force: dwustronny dokładny test dwumianowy.
  const brute = (w, n) => {
    const c = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
    const k = Math.min(w, n - w);
    let tail = 0;
    for (let i = 0; i <= k; i++) tail += c(n, i);
    return Math.min(1, (2 * tail) / 2 ** n);
  };
  for (let n = 1; n <= 20; n++) for (let w = 0; w <= n; w++) assert.ok(Math.abs(signTestP(w, n) - brute(w, n)) < 1e-12);
  assert.equal(signTestP(5, 5), 0.0625);
  assert.equal(passHatK(5, 4, 3), 0.4);
  assert.equal(passHatK(2, 2, 3), null);
  assert.deepEqual(bootstrapMean([1, 0, 1, 1, 0.5]), bootstrapMean([1, 0, 1, 1, 0.5]));
});

test("analytics: parser backlogu zgodny z runnerem (pierwsze wystąpienie, kontynuacje, nieznane pola)", async () => {
  const { parseBacklogMeta } = await skill("bench-analysis/analytics.mjs");
  const meta = parseBacklogMeta(
    "## a\n- **Class**: feature\n- **Class**: anchor\n- **Human time**: ~45-60 min (estimated)\n\n" +
      "## b\n- **Class**:\n  bugfix — scoped\n\n## c\n- **Time limit**: 30 min\n",
  );
  assert.deepEqual(meta.get("a"), { class: "feature" });
  assert.deepEqual(meta.get("b"), { class: "bugfix" });
  assert.deepEqual(meta.get("c"), { class: null });
});

test("attempt path: surowe id modelu → katalog komórki; brak → lista istniejących prób", async () => {
  const { resolveAttemptPath, nearest } = await lib("attempt-path.ts");
  const root = tempDir("ap-");
  const cell = join(root, "attempts", "t1", "openrouter-deepseek-deepseek-v4.1-flash");
  mkdirSync(join(cell, "trial-1"), { recursive: true });
  mkdirSync(join(root, "attempts", "t1", "codex-gpt-5.1-codex", "trial-2"), { recursive: true });
  // Istniejąca ścieżka — bez zmian; względna wobec korzenia działa z dowolnego cwd.
  assert.deepEqual(resolveAttemptPath(root, "attempts/t1/openrouter-deepseek-deepseek-v4.1-flash/trial-1", "/"), { ok: true, dir: join(cell, "trial-1"), rewritten: false });
  // Surowe id modelu (z ukośnikami) → slug, także sama komórka i prefiks harnessu.
  const raw = resolveAttemptPath(root, "attempts/t1/openrouter/deepseek/deepseek-v4.1-flash/trial-1", "/");
  assert.deepEqual(raw, { ok: true, dir: join(cell, "trial-1"), rewritten: true });
  assert.equal(resolveAttemptPath(root, join(root, "attempts/t1/openrouter/deepseek/deepseek-v4.1-flash")).dir, cell);
  assert.equal(resolveAttemptPath(root, "attempts/t1/codex:gpt-5.1-codex/trial-2", "/").ok, true);
  // Brak próby → błąd z listą istniejących, najbliższa pierwsza.
  const missing = resolveAttemptPath(root, "attempts/t1/openrouter/deepseek/deepseek-v4.1-flash/trial-3", "/");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /trial-3[\s\S]*attempts\/t1\/openrouter-deepseek-deepseek-v4\.1-flash\/trial-1[\s\S]*codex-gpt-5\.1-codex\/trial-2/);
  assert.match(resolveAttemptPath(root, "attempts/nope/x/trial-1", "/").error, /zadania z próbami.*t1/);
  assert.deepEqual(nearest("deepseek/deepseek-v4.1-flsh", ["openai/gpt-6", "deepseek/deepseek-v4.1-flash"], 1), ["deepseek/deepseek-v4.1-flash"]);
});

test("attempt: następny krok wskazuje dokładnie zachowane próby przy smoke / garści prób", async () => {
  const { nextStepLine } = await command("attempt.ts");
  const root = "/inst";
  assert.match(nextStepLine(root, ["/inst/attempts/demo/m/trial-1"], true), /bench evaluate --attempt attempts\/demo\/m\/trial-1$/);
  const many = Array.from({ length: 6 }, (_, i) => `/inst/attempts/t/m/trial-${i + 1}`);
  assert.doesNotMatch(nextStepLine(root, many, false), /--attempt/);
  assert.match(nextStepLine(root, many.slice(0, 6), true), /trial-6/);
  assert.match(nextStepLine(root, [], false), /bench status/);
  assert.match(nextStepLine(root, ["/inst/attempts/demo/m/trial-1"], true, "agent"), /--attempt attempts\/demo\/m\/trial-1 --no-write-results$/);
  assert.match(nextStepLine(root, many, false, "agent"), /sędzią-agentem/);
});

test("attempt/evaluate: pełny dysk i przerwany kontener mają nazwę, nie 'kodem null:'", async () => {
  const { isDiskFull } = await command("attempt.ts");
  const { containerFailureMessage } = await lib("containers.ts");
  assert.ok(isDiskFull(Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" })));
  assert.ok(isDiskFull(new Error("Unknown system error -122")));
  assert.ok(!isDiskFull(new Error("ENOENT")));
  const killed = containerFailureMessage({ status: null, signal: "SIGKILL", stdout: "", stderr: "" });
  assert.match(killed, /SIGKILL/);
  assert.match(killed, /bench doctor/);
  assert.doesNotMatch(killed, /kodem null/);
  assert.match(containerFailureMessage({ status: 137, stderr: "x" }, 6144), /SIGKILL — prawdopodobnie OOM; limit: 6144 MiB/);
});

test("pin-source: pin z lokalnego klonu .repos/<repo> bez sieci; brak pina → null (remote)", async () => {
  const { localPinClone, fetchPin } = await lib("pin-source.ts");
  const root = tempDir("pin-");
  const clone = join(root, ".repos", "app");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  git("init", "-q", clone);
  writeFileSync(join(clone, "a.txt"), "1\n");
  git("-C", clone, "add", "-A");
  git("-C", clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
  const pin = git("-C", clone, "rev-parse", "HEAD");
  git("-C", clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "two");
  assert.equal(localPinClone(root, "app", pin), clone);
  assert.equal(localPinClone(root, "app", "0".repeat(40)), null);
  assert.equal(localPinClone(root, "missing", pin), null);
  const ws = join(root, "ws");
  git("init", "-q", ws);
  // Remote nieosiągalny: sukces dowodzi, że commit przyszedł z klonu.
  fetchPin(ws, "https://invalid.example/none.git", pin, clone, "fetch");
  git("-C", ws, "checkout", "-q", pin);
  assert.equal(readFileSync(join(ws, "a.txt"), "utf8"), "1\n");
});

test("tmpdir: /tmp na tmpfs-ie bez TMPDIR → .bench-tmp instancji; jawny TMPDIR wygrywa", async () => {
  const { chooseTmpdir } = await lib("tmpdir.ts");
  assert.equal(chooseTmpdir(undefined, "/inst", true), "/inst/.bench-tmp");
  assert.equal(chooseTmpdir("", "/inst", true), "/inst/.bench-tmp");
  assert.equal(chooseTmpdir("/big/tmp", "/inst", true), null);
  assert.equal(chooseTmpdir(undefined, "/inst", false), null);
  assert.equal(chooseTmpdir(undefined, null, true), null);
});

test("status: zero prób to 'jeszcze nic', a samo demo kieruje do bench-create-task", async () => {
  const { statusNextStep } = await command("status.ts");
  const empty = statusNextStep({ allTasks: ["demo-hello-bench"], preserved: 0, running: 0, toEvaluate: 0, missing: 3 });
  assert.doesNotMatch(empty, /ocenione/);
  assert.match(empty, /brak zachowanych prób/);
  assert.match(empty, /bench-create-task/);
  assert.doesNotMatch(empty, /bench attempt/);
  const real = statusNextStep({ allTasks: ["demo-hello-bench", "fix-login"], preserved: 0, running: 0, toEvaluate: 0, missing: 6 });
  assert.match(real, /6 prób\(y\) brakuje do celu → bench run/);
  assert.doesNotMatch(real, /bench-create-task/);
  assert.match(statusNextStep({ allTasks: ["fix-login"], preserved: 3, running: 0, toEvaluate: 0, missing: 0 }), /wszystkie zachowane próby ocenione/);
  assert.match(statusNextStep({ allTasks: [], preserved: 0, running: 0, toEvaluate: 0, missing: 0 }), /brak zadań.*bench-create-task/);
  // Zero zadań, ale zlecenia w backlogu: budowa, nie kopanie od nowa.
  const ordered = statusNextStep({ allTasks: [], preserved: 0, running: 0, toEvaluate: 0, missing: 0, pendingOrders: 3 });
  assert.match(ordered, /tasks\/backlog\.md czekające na budowę: 3 → bench-create-task \(zbuduj backlog\)/);
  assert.doesNotMatch(ordered, /brak zadań|kopanie/);
  // Zadania są, część zleceń niezbudowana: dodatkowa część linii.
  const mixed = statusNextStep({ allTasks: ["fix-login"], preserved: 0, running: 0, toEvaluate: 0, missing: 3, pendingOrders: 2 });
  assert.match(mixed, /3 prób\(y\) brakuje do celu → bench run/);
  assert.match(mixed, /czekające na budowę: 2 → bench-create-task/);
  assert.doesNotMatch(real, /backlog/, "bez niezbudowanych zleceń bez wzmianki o backlogu");
});

test("changes: zmiana pola ery bez wyników otwiera pierwszą erę (bez PR); z wynikami zamyka erę", async () => {
  const { planChanges } = await command("changes.ts");
  const root = tempDir("chg-");
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(root, "bench.config.yaml"), "judge:\n  model: openrouter/a/judge-1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  writeFileSync(join(root, "bench.config.yaml"), "judge:\n  model: openrouter/a/judge-2\n");
  const fresh = planChanges(root, "HEAD").groups.find((g) => g.key === "config");
  assert.equal(fresh.impact, "neutral");
  assert.equal(fresh.needs_pr, false);
  assert.match(fresh.messages.join("\n"), /pierwszą erę/);
  assert.doesNotMatch(fresh.messages.join("\n"), /poprzedniej erze/);
  mkdirSync(join(root, "results", "t1", "m", "trial-1"), { recursive: true });
  writeFileSync(join(root, "results", "t1", "m", "trial-1", "result.json"), JSON.stringify({ stamps: { judge_model: "openrouter/a/judge-1" } }));
  const withResults = planChanges(root, "HEAD").groups.find((g) => g.key === "config");
  assert.equal(withResults.impact, "era");
  assert.equal(withResults.needs_pr, true);
  assert.match(withResults.messages.join("\n"), /poprzedniej erze/);
});

test("validate: id modeli OpenRouter kontra katalog, z podpowiedzią; native pomijane", async () => {
  const { checkOpenRouterIds } = await command("validate.ts");
  const catalog = new Set(["deepseek/deepseek-v4.1-flash", "anthropic/claude-opus-5.5", "openai/gpt-6.1-terra"]);
  const issues = checkOpenRouterIds(
    { defaults: { models: ["openrouter/deepseek/deepseek-v4.1-flsh", "claude-code:claude-sonnet-5", "codex:openrouter/openai/gpt-6.1-terra"] }, judge: { model: "openrouter/anthropic/claude-opus-5.5" } },
    catalog,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, "error");
  assert.match(issues[0].message, /deepseek-v4\.1-flsh.*deepseek\/deepseek-v4\.1-flash/);
});

test("status --wait: postęp z dysku, koniec dopiero bez prób w toku; marker z martwym PID-em nie jest w toku", async () => {
  const { waitProgress, waitLine, waitDone } = await command("status.ts");
  const { runningMarkerState } = await lib("matrix.ts");
  const trial = (state, evaluated = null) => ({ trial: 1, state, cost_usd: null, started_at: null, evaluated, stale_reasons: [], total: null });
  const cells = [
    { task: "t", model: "a", target: 3, trials: [trial("done", "fresh"), trial("done"), trial("running")], aborted: 0, superseded: 0 },
    { task: "t", model: "b", target: 3, trials: [trial("stale"), trial("infra")], aborted: 0, superseded: 0 },
  ];
  const p = waitProgress(cells);
  assert.deepEqual(p, { running: 1, evaluating: 0, preserved: 2, target: 6, evaluated: 1 });
  assert.equal(waitLine(p, false), "1 w toku, 2/6 zachowanych");
  assert.equal(waitLine(p, true), "1 w toku, 2/6 zachowanych, 1/2 ocenionych");
  assert.equal(waitDone(p, false), false);
  // Przeterminowany marker (stale) nie blokuje czekania.
  const idle = { ...p, running: 0 };
  assert.equal(waitDone(idle, false), true);
  assert.equal(waitDone(idle, true), false, "--until-evaluated czeka na świeże oceny");
  assert.equal(waitDone({ ...idle, evaluated: 2 }, true), true);
  // Ocena w toku: widoczna w linii, a --until-evaluated czeka na jej koniec.
  assert.equal(waitLine({ ...idle, evaluating: 1 }, false), "0 w toku, 2/6 zachowanych, 1 oceniane");
  assert.equal(waitDone({ ...idle, evaluated: 2, evaluating: 1 }, true), false);
  assert.equal(waitDone({ ...idle, evaluating: 1 }, false), true, "bez --until-evaluated ocena nie blokuje");

  const now = Date.parse("2026-01-01T01:00:00Z");
  const marker = { started_at: "2026-01-01T00:30:00Z", timeout_s: 3600, pid: 4242, host: "h1" };
  assert.equal(runningMarkerState(marker, now, "h1", () => true), "running");
  assert.equal(runningMarkerState(marker, now, "h1", () => false), "stale", "martwy PID na tej maszynie");
  assert.equal(runningMarkerState(marker, now, "h2", () => false), "running", "PID innej maszyny niesprawdzalny — tylko reguła czasu");
  assert.equal(runningMarkerState({ ...marker, timeout_s: 60 }, now, "h1", () => true), "stale", "timeout + 15 min minął");
  assert.equal(runningMarkerState({}, now, "h1", () => true), "stale");
});

test("evaluate: fold werdyktu używa guardów tylko przy dowiedzionej świeżości", async () => {
  const { guardStampFreshness } = await lib("guard-stamp.ts");
  const fp = { task_hash: "t", assertions: { "tests/a": "x", "static/b": "y" }, image_id: "sha256:1", patch_sha256: "p", memory_mb: 4096, pids_limit: null };
  const stamp = { ...fp, checks_sha256: "c", created_at: "2026-01-01T00:00:00Z" };
  assert.deepEqual(guardStampFreshness(stamp, fp, "c"), { fresh: true });
  const stale = (s, cur, sha) => guardStampFreshness(s, cur, sha).reason;
  assert.match(stale(null, fp, "c"), /brak checks\.stamp\.json/);
  assert.match(stale(stamp, fp, null), /brak checks\.json/);
  assert.match(stale(stamp, fp, "edited"), /checks\.json zmieniony/);
  assert.match(stale(stamp, { ...fp, task_hash: "t2" }, "c"), /task_hash/);
  assert.match(stale(stamp, { ...fp, patch_sha256: "p2" }, "c"), /patch/);
  assert.match(stale(stamp, { ...fp, image_id: "sha256:2" }, "c"), /obraz/);
  assert.match(stale(stamp, { ...fp, assertions: { ...fp.assertions, "tests/a": "x2" } }, "c"), /asercje puli: tests\/a/);
  assert.match(stale(stamp, { ...fp, assertions: { "tests/a": "x" } }, "c"), /static\/b/, "ubyła asercja = inny zestaw guardów");
  assert.match(stale(stamp, { ...fp, memory_mb: 8192 }, "c"), /limity/);
});

test("attempt: projekcja kosztu z zachowanych prób, szacunek z ceny × tokeny przy pierwszym pomiarze", async () => {
  const { costSamples, projectTrialCost, TOKEN_PRIOR } = await command("attempt.ts");
  const { priceTokens, catalogSlugFor } = await lib("pricing.ts");
  const { parseModelId } = await lib("harness.ts");
  const dir = tempDir("bench-proj-");
  const put = (path, data) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(data));
  };
  const tokens = (n) => ({ input: n, output: n / 10, cache_read: n * 10, cache_write: 0 });
  // Smoke: zachowana próba bez wyniku — jej koszt wchodzi do historii.
  put("attempts/t/m-a/trial-1/attempt.json", { model: "m/a" });
  put("attempts/t/m-a/trial-1/metrics.json", { cost_usd: 0.5, cost_source: "harness", tokens: tokens(1000) });
  put("attempts/t/m-b/trial-1/attempt.json", { model: "m/b" });
  put("attempts/t/m-b/trial-1/metrics.json", { cost_usd: null, cost_source: null, tokens: tokens(3000) });
  put("attempts/t/m-b/trial-2.aborted-x/attempt.json", { model: "m/b" });
  // Wynik bez zachowanej próby na tej maszynie + wynik zdublowany z próbą.
  put("results/t/m-c/trial-1/result.json", { model: "m/c", cost_usd: 2, cost_source: "harness" });
  put("results/t/m-a/trial-1/result.json", { model: "m/a", cost_usd: 99, cost_source: "harness" });
  const samples = costSamples(join(dir, "attempts"), join(dir, "results"), "t");
  assert.equal(samples.length, 3, "jedna próbka na trial-N, odłożone pominięte");

  const price = { input: 1, output: 10, cache_read: 0.1 };
  assert.deepEqual(projectTrialCost(samples, "m/a", price), { usd: 0.5, basis: "history", note: "" }, "metrics.json ma pierwszeństwo przed wynikiem");
  const est = projectTrialCost(samples, "m/new", price);
  assert.equal(est.basis, "estimate");
  assert.equal(est.usd, priceTokens(tokens(2000), price), "mediana tokenów prób zadania (dowolny model)");
  assert.match(est.note, /mediana tokenów 2/);
  const prior = projectTrialCost([], "m/new", price);
  assert.equal(prior.usd, priceTokens(TOKEN_PRIOR, price));
  assert.match(prior.note, /TOKEN_PRIOR/);
  assert.deepEqual(projectTrialCost(samples, "m/new", null), { usd: 1.25, basis: "other-models", note: "" });
  assert.equal(projectTrialCost([], "m/new", null), null);
  // Model z historią na innym zadaniu: jego koszt, gdy wyższy niż tokeny innych modeli.
  const other = [{ model: "m/new", cost: 9, tokens: null }];
  const cross = projectTrialCost(samples, "m/new", price, other);
  assert.equal(cross.usd, 9);
  assert.match(cross.note, /innych zadaniach \(1 prób\)/);
  assert.equal(projectTrialCost(samples, "m/new", price, [{ model: "m/new", cost: 0.0001, tokens: null }]).usd, est.usd);
  // OpenCode: slug katalogu bez prefiksu providera openrouter/ (cena do szacunku).
  assert.equal(catalogSlugFor(parseModelId("openrouter/z-ai/glm-5")), "z-ai/glm-5");
});

test("run marker: bench status --wait widzi bieg w fazie przygotowania, martwy PID się nie liczy", async () => {
  const { writeRunMarker, liveRuns } = await lib("matrix.ts");
  const attempts = tempDir("runs-");
  assert.equal(liveRuns(attempts), 0);
  const path = writeRunMarker(attempts, { tasks: ["t"], models: ["m"] });
  assert.equal(liveRuns(attempts), 1);
  assert.equal(readFileSync(join(attempts, ".runs", ".gitignore"), "utf8"), "*\n");
  const marker = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...marker, pid: 2 ** 22 + 12345 }));
  assert.equal(liveRuns(attempts), 0);
});

test("run marker: odświeżenie przedłuża życie markera długiego procesu (supervisor bench run)", async () => {
  const { writeRunMarker, refreshRunMarker, liveRuns } = await lib("matrix.ts");
  const attempts = tempDir("runs-refresh-");
  const path = writeRunMarker(attempts, { run: "r-x" });
  const old = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...old, started_at: "2000-01-01T00:00:00Z" }));
  assert.equal(liveRuns(attempts), 0, "TTL minął");
  refreshRunMarker(path, { run: "r-x" });
  assert.equal(liveRuns(attempts), 1);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).run, "r-x");
});

test("bench run: dopuszczenie wg wolnej pamięci — własne próby w toku, okres łaski, pamięć nieznana", async () => {
  const { admit, ADMISSION_GRACE_S, DEFAULT_ADMISSION_MB } = await lib("queue.ts");
  const now = 1_000_000_000;
  assert.deepEqual(admit({ needMb: 4096, freeMb: null, ownActive: 0, waitingSince: null, now }), { admit: true, reason: null, forced: false }, "nieznana pamięć = bez kontroli");
  assert.equal(admit({ needMb: 4096, freeMb: 8000, ownActive: 3, waitingSince: null, now }).admit, true);
  const own = admit({ needMb: 4096, freeMb: 1000, ownActive: 2, waitingSince: now - 3600_000, now });
  assert.equal(own.admit, false, "własne próby w toku — czekamy bez limitu, aż któraś się skończy");
  assert.match(own.reason, /potrzeba 4096 MiB, wolne 1000 MiB — ruszy po zakończeniu/);
  const estimate = admit({ needMb: null, freeMb: DEFAULT_ADMISSION_MB - 1, ownActive: 0, waitingSince: null, now });
  assert.equal(estimate.admit, false);
  assert.match(estimate.reason, /szacunek — brak resources\.memory_mb/);
  assert.match(estimate.reason, new RegExp(`start mimo to za ${ADMISSION_GRACE_S} s`));
  const waiting = admit({ needMb: 4096, freeMb: 0, ownActive: 0, waitingSince: now - 30_000, now });
  assert.equal(waiting.admit, false);
  assert.match(waiting.reason, new RegExp(`za ${ADMISSION_GRACE_S - 30} s`));
  assert.deepEqual(admit({ needMb: 4096, freeMb: 0, ownActive: 0, waitingSince: now - ADMISSION_GRACE_S * 1000, now }), { admit: true, reason: null, forced: true }, "po okresie łaski start z ostrzeżeniem");
});

test("bench run: budżet na żywo, żywotność supervisora, kolejność trial-major, MemUsage", async () => {
  const { budgetState, supervisorLiveness, dispatchOrder, parseMemUsage, SUPERVISOR_STALE_S } = await lib("queue.ts");
  const jobs = [
    { phase: "done", cost_usd: 0.4, live: null },
    { phase: "failed", cost_usd: 0.1, live: null },
    { phase: "running", cost_usd: null, live: { cost_usd: 0.3 } },
    { phase: "starting", cost_usd: null, live: null },
    { phase: "evaluating", cost_usd: 0.2, live: { cost_usd: 9 } },
  ];
  const b = budgetState(jobs, 1);
  assert.ok(Math.abs(b.spent - 0.7) < 1e-9, "zatrzymane/nieudane też kosztują");
  assert.ok(Math.abs(b.live - 0.3) < 1e-9, "puls liczony tylko dla prób w toku");
  assert.equal(b.over, false);
  assert.equal(budgetState(jobs, 0.9).over, true);
  assert.equal(budgetState(jobs, null).over, false);

  const now = Date.parse("2026-01-01T12:00:00Z");
  const run = { status: "running", updated_at: "2026-01-01T11:59:50Z", host: "h1", pid: 42 };
  assert.equal(supervisorLiveness(run, now, "h1", () => true), "alive");
  assert.equal(supervisorLiveness(run, now, "h1", () => false), "dead", "martwy PID na tej maszynie");
  assert.equal(supervisorLiveness(run, now, "h2", () => false), "alive", "inna maszyna — tylko puls");
  assert.equal(supervisorLiveness({ ...run, updated_at: new Date(now - (SUPERVISOR_STALE_S + 1) * 1000).toISOString() }, now, "h2"), "dead", "puls ucichł");
  for (const status of ["done", "cancelled", "failed"]) assert.equal(supervisorLiveness({ ...run, status }, now, "h1", () => false), "finished");

  const order = dispatchOrder([
    { task: "b", model: "m1", trial: 1 },
    { task: "a", model: "m2", trial: 2 },
    { task: "a", model: "m1", trial: 2 },
    { task: "a", model: "m2", trial: 1 },
    { task: "a", model: "m1", trial: 1 },
  ]).map((j) => `${j.task}/${j.model}/${j.trial}`);
  assert.deepEqual(order, ["a/m1/1", "a/m2/1", "b/m1/1", "a/m1/2", "a/m2/2"], "najpierw próba 1 każdej komórki");

  assert.equal(parseMemUsage("1.2GiB / 7.6GiB"), 1.2 * 1024 ** 3);
  assert.equal(parseMemUsage("512MiB / 7.6GiB"), 512 * 1024 ** 2);
  assert.equal(parseMemUsage("1.5GB / 8GB"), 1.5e9);
  assert.equal(parseMemUsage("0B / 0B"), 0);
  assert.equal(parseMemUsage("--"), null);
  assert.equal(parseMemUsage(""), null);
});

test("bench run: stan biegu na dysku — control.json, linia podsumowania, lista biegów", async () => {
  const q = await lib("queue.ts");
  const root = tempDir("run-state-");
  const id = q.newRunId(new Date("2026-03-04T05:06:07Z"));
  assert.match(id, /^r-20260304-050607-[a-z0-9]{1,4}$/);
  q.ensureRunDir(root, id);
  assert.equal(readFileSync(join(root, "attempts", ".runs", ".gitignore"), "utf8"), "*\n");
  const job = (phase, extra = {}) => ({ phase, cost_usd: null, live: null, result: null, ...extra });
  const run = {
    id, created_at: "", updated_at: "", host: "h", pid: 1, status: "running", stop_reason: null,
    options: { tasks: null, models: null, trials: null, parallel: 2, eval_parallel: 1, evaluate: true, budget_usd: 5, engine: null },
    projection: { projected_usd: 1, projection_unknown: 0, estimated_trials: 0 },
    spent_usd: 0.5, live_usd: 0.25,
    jobs: [job("running"), job("queued"), job("done", { result: { passed: true } }), job("done", { result: { passed: false } }), job("failed")],
  };
  q.writeRun(root, run);
  assert.deepEqual(q.listRuns(root), [id]);
  assert.equal(q.readRun(root, id).spent_usd, 0.5);
  assert.equal(q.runSummaryLine(run), "1 w toku · 1 w kolejce · 2 gotowe (1 PASS) · 1 nieudane — koszt $0.50 (+$0.25 w toku) / $5");
  assert.equal(q.takeControl(root, id), null);
  q.writeControl(root, id, "pause");
  assert.equal(q.takeControl(root, id), "pause");
  assert.equal(q.takeControl(root, id), null, "polecenie zdejmowane raz");
});

test("progress: puls → progress.json z wyceną runnera, prośba o stop pierwsza wygrywa", async () => {
  const p = await lib("progress.ts");
  const { parseModelId } = await lib("harness.ts");
  const dir = tempDir("progress-");
  assert.equal(p.refreshProgress(dir, parseModelId("openrouter/x/y"), null), null, "brak pulsu w pierwszych sekundach");
  const tokens = { input: 1_000_000, output: 100_000, cache_read: 0, cache_write: 0 };
  writeFileSync(join(dir, p.HEARTBEAT_FILE), JSON.stringify({ at: "2026-01-01T00:00:00Z", elapsed_s: 40, events: 7, activity: "Bash: ls", tokens, cost_usd: null, cost_source: null }));
  const price = { input: 1, output: 10, cache_read: 0.1 };
  const progress = p.refreshProgress(dir, parseModelId("claude-code:openrouter/anthropic/claude-haiku-4.5"), price);
  assert.equal(progress.activity, "Bash: ls");
  assert.equal(progress.events, 7);
  assert.equal(typeof progress.cost_usd, "number");
  assert.ok(progress.cost_usd > 0, "koszt z tokenów × cena, jak po próbie");
  assert.deepEqual(p.readProgress(dir), progress);
  assert.ok(p.heartbeatAgeS(dir) <= 1);
  assert.equal(p.requestStop(dir, "budżet biegu", "bench run r-1"), true);
  assert.equal(p.requestStop(dir, "cancel", "bench run r-1"), false);
  assert.equal(p.readStopRequest(dir).reason, "budżet biegu");
  assert.deepEqual(p.stopAgentArgs("c1"), ["exec", "c1", "sh", "-c", 'kill -INT "$(cat /bench/agent.pid)"']);
  p.clearTransient(dir);
  assert.equal(p.readStopRequest(dir), null);
  assert.equal(p.readProgress(dir), null);
  assert.ok(p.containerName("t".repeat(300), "m", 1, 1, 9).length <= 200);
});

test("heartbeat: ostatnia czynność agenta z jego własnego strumienia zdarzeń", async () => {
  const { lastActivity, countEvents } = await import(join(ROOT, ".bench-kit", "docker", "heartbeat.mjs"));
  const cc = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Sprawdzę testy" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Uruchamiam" }, { type: "tool_use", name: "Bash", input: { command: "npm test" } }] } }),
    '{"type":"assis', // linia ucięta w trakcie zapisu
  ].join("\n");
  assert.equal(lastActivity("claude-code", cc), "Bash: npm test");
  assert.equal(countEvents("claude-code", cc), 2);
  assert.equal(lastActivity("claude-code", cc + "\n" + JSON.stringify({ type: "result", subtype: "success" })), "koniec sesji (success)");
  assert.equal(lastActivity("claude-code", ""), null);

  const codex = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "Plan" } }),
    JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "bash -lc 'ls src'" } }),
  ].join("\n");
  assert.equal(lastActivity("codex", codex), "shell: bash -lc 'ls src'");
  assert.equal(countEvents("codex", codex), 1);
  assert.equal(lastActivity("codex", codex + "\n" + JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts" }, { path: "b.ts" }] } })), "edit: a.ts, b.ts");
  assert.match(lastActivity("codex", JSON.stringify({ type: "turn.failed", error: { message: "rate limit" } })), /turn\.failed: rate limit/);

  // OpenCode: tekstowy log — ostatnia niepusta linia bez sekwencji ANSI.
  assert.equal(lastActivity("opencode", "\x1b[90m|  Read     src/a.ts\x1b[0m\n\x1b[32m|  Edit     src/b.ts\x1b[0m\n\n"), "| Edit src/b.ts");
  assert.equal(countEvents("opencode", "x"), null);
  assert.ok(lastActivity("claude-code", JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(500) }] } })).length <= 160);
});

test("changes: pliki przejściowe prób pomijane i nie zwijają git add do katalogu", async () => {
  const { planChanges } = await command("changes.ts");
  const root = tempDir("chg-transient-");
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(root, "bench.config.yaml"), "judge:\n  model: openrouter/a/judge-1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const trial = join(root, "attempts", "t1", "m", "trial-1");
  mkdirSync(trial, { recursive: true });
  writeFileSync(join(trial, "attempt.json"), "{}");
  writeFileSync(join(trial, "heartbeat.json"), "{}");
  writeFileSync(join(trial, "evaluating.json"), "{}");
  const plan = planChanges(root, "HEAD");
  assert.deepEqual(plan.transient.sort(), ["attempts/t1/m/trial-1/evaluating.json", "attempts/t1/m/trial-1/heartbeat.json"]);
  const results = plan.groups.find((g) => g.key === "results:t1");
  assert.deepEqual(results.changes.map((c) => c.path), ["attempts/t1/m/trial-1/attempt.json"]);
  const out = execFileSync(process.execPath, ["--experimental-strip-types", join(ROOT, ".bench-kit", "runner", "src", "index.ts"), "changes", "--json", "--root", root], { encoding: "utf8" });
  const specs = JSON.parse(out).groups.find((g) => g.key === "results:t1").pathspecs;
  assert.deepEqual(specs, ["attempts/t1/m/trial-1/attempt.json"], "git add katalogu wniósłby puls do commita");
});
