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

test("power: runner i bench-decide liczą tę samą rozdzielczość; <6 zadań = żadna", async () => {
  const runner = await lib("power.ts");
  const decide = await skill("bench-decide/analytics.mjs");
  for (const n of [4, 5, 6, 10, 20, 40, 80]) assert.equal(runner.resolvableGap(n), decide.resolvableGap(n), `n=${n}`);
  assert.equal(decide.resolvableGap(5), null);
  assert.equal(decide.tasksNeeded(0.2), 57);
  assert.equal(decide.tasksNeeded(0.5), 17);
});

test("analytics: test znaków dokładny, pass^k, bootstrap deterministyczny", async () => {
  const { signTestP, passHatK, bootstrapMean } = await skill("bench-decide/analytics.mjs");
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

test("analytics: horyzont bez ekstrapolacji poza obserwowany zakres", async () => {
  const { timeHorizon } = await skill("bench-decide/analytics.mjs");
  const graded = [];
  [5, 10, 20, 40, 80, 160].forEach((m, i) => { for (let t = 0; t < 4; t++) graded.push({ task: `t${i}`, minutes: m, passed: t < [4, 4, 3, 2, 1, 0][i] }); });
  const h = timeHorizon(graded);
  assert.ok(h.horizon50_min > 20 && h.horizon50_min < 80, JSON.stringify(h));
  const allFail = [];
  [5, 10, 20, 40, 60].forEach((m, i) => { for (let t = 0; t < 3; t++) allFail.push({ task: `t${i}`, minutes: m, passed: false }); });
  const f = timeHorizon(allFail);
  assert.equal(f.horizon50_min, null);
  assert.equal(f.horizon50_bound, "<5");
});

test("analytics: parser backlogu zgodny z runnerem (pierwsze wystąpienie, kontynuacje, zakresy)", async () => {
  const { parseBacklogMeta } = await skill("bench-decide/analytics.mjs");
  const meta = parseBacklogMeta(
    "## a\n- **Class**: feature\n- **Class**: anchor\n- **Human time**: ~45-60 min (estimated)\n\n" +
      "## b\n- **Class**:\n  bugfix — scoped\n- **Human time**: 1,5 h (unconfirmed)\n\n## c\n- **Human time**: 30 min (confirmed)\n",
  );
  assert.deepEqual(meta.get("a"), { class: "feature", human_minutes: 52.5, human_estimated: true });
  assert.deepEqual(meta.get("b"), { class: "bugfix", human_minutes: 90, human_estimated: true });
  assert.equal(meta.get("c").human_estimated, false);
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

test("status: zero prób to 'jeszcze nic', a samo demo kieruje do bench-define", async () => {
  const { statusNextStep } = await command("status.ts");
  const empty = statusNextStep({ allTasks: ["demo-hello-bench"], preserved: 0, running: 0, toEvaluate: 0, missing: 3 });
  assert.doesNotMatch(empty, /ocenione/);
  assert.match(empty, /brak zachowanych prób/);
  assert.match(empty, /bench-define/);
  assert.doesNotMatch(empty, /bench attempt/);
  const real = statusNextStep({ allTasks: ["demo-hello-bench", "fix-login"], preserved: 0, running: 0, toEvaluate: 0, missing: 6 });
  assert.match(real, /6 prób\(y\) brakuje do celu → bench attempt/);
  assert.doesNotMatch(real, /bench-define/);
  assert.match(statusNextStep({ allTasks: ["fix-login"], preserved: 3, running: 0, toEvaluate: 0, missing: 0 }), /wszystkie zachowane próby ocenione/);
  assert.match(statusNextStep({ allTasks: [], preserved: 0, running: 0, toEvaluate: 0, missing: 0 }), /brak zadań.*bench-define/);
  // Zero zadań, ale zlecenia w backlogu: budowa, nie kopanie od nowa.
  const ordered = statusNextStep({ allTasks: [], preserved: 0, running: 0, toEvaluate: 0, missing: 0, pendingOrders: 3 });
  assert.match(ordered, /tasks\/backlog\.md czekające na budowę: 3 → bench-define \(zbuduj backlog\)/);
  assert.doesNotMatch(ordered, /brak zadań|kopanie/);
  // Zadania są, część zleceń niezbudowana: dodatkowa część linii.
  const mixed = statusNextStep({ allTasks: ["fix-login"], preserved: 0, running: 0, toEvaluate: 0, missing: 3, pendingOrders: 2 });
  assert.match(mixed, /3 prób\(y\) brakuje do celu → bench attempt/);
  assert.match(mixed, /czekające na budowę: 2 → bench-define/);
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
  assert.deepEqual(p, { running: 1, preserved: 2, target: 6, evaluated: 1 });
  assert.equal(waitLine(p, false), "1 w toku, 2/6 zachowanych");
  assert.equal(waitLine(p, true), "1 w toku, 2/6 zachowanych, 1/2 ocenionych");
  assert.equal(waitDone(p, false), false);
  // Przeterminowany marker (stale) nie blokuje czekania.
  const idle = { ...p, running: 0 };
  assert.equal(waitDone(idle, false), true);
  assert.equal(waitDone(idle, true), false, "--until-evaluated czeka na świeże oceny");
  assert.equal(waitDone({ ...idle, evaluated: 2 }, true), true);

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
