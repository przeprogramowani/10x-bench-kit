// Testy jednostkowe czystych funkcji runnera i skilli — bez kontenerów,
// bez sieci, bez kluczy. Moduły runnera są w TypeScripcie, więc:
//   node --experimental-strip-types --test .github/tests/units.test.mjs
// (wymaga `npm ci --prefix .bench-kit/runner` — zod/yaml).
import assert from "node:assert/strict";
import { mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = (name) => import(join(ROOT, ".bench-kit", "runner", "src", "lib", name));
const skill = (path) => import(join(ROOT, ".agents", "skills", path));

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
  const a = mkdtempSync(join(tmpdir(), "cf-a-"));
  writeFileSync(join(a, "AGENTS.md"), "x");
  assert.deepEqual(unifyContextFiles(a, "unified"), ["CLAUDE.md → import @AGENTS.md"]);
  assert.deepEqual(unifyContextFiles(a, "native"), []);
  const b = mkdtempSync(join(tmpdir(), "cf-b-"));
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
