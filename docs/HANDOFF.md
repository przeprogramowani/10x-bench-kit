# Handoff — after 0.33.0 (define / measure / decide, PR mining, harnesses)

Template-only (`docs/` never reaches an instance). Written for the next
agent picking up this line of work. Read `AGENTS.md` first, then the
0.33.0 entry in `CHANGELOG.md` — it is the spec of what already exists.

## State at handoff

Shipped in this PR and verified offline (no paid model calls):

- **(C) Derived state** — `bench backlog` (ordered → building → built →
  ready → measuring → measured, from facts on disk), `bench changes`
  (commit plan by intent), era-aware `bench status`.
- **(B) Harnesses** — `claude-code:<model>` and `codex:<model>` next to
  OpenCode, native or `openrouter/` routing, pinned CLI versions in
  `.bench-kit/docker/*.version`, token pricing when the harness reports
  no cost (`pricing` in config or the OpenRouter catalog; unpriceable =
  refused before spend, unknown cost is never zero).
- **(A) Three concepts** — `bench-create-task` (interview, **PR mining**,
  build, refresh), `bench-evaluate` (wiring, matrix, rate-attempt, judge
  diagnostics), `bench-analysis` (summary with tasks as the unit,
  bootstrap CI, exact sign test, pass^k, time horizon, resolvable gap,
  explain). Pass is a **gate** (every weighted guard = 1 AND judge ≥
  threshold). Verdicts carry provenance (`agent` / `human` / `api`).
  Scoring version 3 → all older results are a closed era.

Proofs that exist: a mined task from this repo's own history (commit
`3fcf331`, pin `b0009b0`) red at pin / green with the reference diff;
Claude Code and Codex trials end-to-end against the mock in
`.github/tests/harness/`; timeout paths (SIGINT, token fallback from
transcripts/rollout); summary, report and leaderboard rendered in
headless Chromium without console errors; `.github/tests/units.test.mjs`
(pure functions) and `bootstrap.test.mjs` in CI.

**Out of scope by owner decision: egress / network restrictions on
trial containers.** Do not add them as a side effect of anything else.

## Remaining work, in priority order

### 1. Release tag after merge (5 min, required)

`.bench-kit/VERSION` is already `0.33.0` in this PR (CI enforces
VERSION == top CHANGELOG entry), so `.github/scripts/release.mjs 0.33.0`
will refuse on master with "brak zmian do wydania". Tag the merge commit
directly:

```
git checkout master && git pull
git tag v0.33.0 && git push origin v0.33.0
```

### 2. Paid smoke of the new harnesses (small budget, high value)

Everything harness-related was proven against a mock, never a real
provider. With real keys and `defaults.max_cost_usd` set low (~$2):

- `claude-code:<current sonnet id>` native (ANTHROPIC_API_KEY) and
  `claude-code:openrouter/anthropic/<id>`;
- `codex:<current codex id>` native (OPENAI_API_KEY → CODEX_API_KEY)
  and `codex:openrouter/openai/<id>`.

Check per run: the CLI starts as root (`IS_SANDBOX=1`), auth works,
`metrics.json` tokens are non-zero, `cost_source` is what
`costPolicy` predicts, and the priced cost is within ~10% of the
provider's billing (OpenRouter activity page / Anthropic console). If a
pinned CLI version is too old for the current model ids, bump the pin in
`.bench-kit/docker/<harness>.version` (that changes the base image tag
and `harness_version` in attempts — note it in the changelog).

### 3. Offline harness e2e in CI

The mock exists (`.github/tests/harness/mock-llm.mjs`, usage in its
README) but CI only runs the OpenCode demo. Add a job that builds the
base image, starts the mock on the docker bridge gateway, and runs one
`bench attempt` per harness through the OpenRouter route
(`BENCH_OPENROUTER_BASE_URL`, `BENCH_PRICING_CATALOG_URL`,
`OPENROUTER_API_KEY=mock`), then asserts on `attempt.json`
(`harness`, `context_files`) and `metrics.json` (tokens, `cost_source`
= `priced:openrouter…`). This guards the stream parsers in
`.bench-kit/docker/metrics-adapter/` against CLI output drift on every
pin bump.

### 4. Leaderboard parity with bench-analysis

`bench-analysis/summarize.mjs` computes class views, paired comparisons
and the anchors block; the leaderboard
(`.bench-kit/runner/assets/leaderboard/app.js`) shows gated pass and
unknown cost but none of those. Either render them from `report.json`
(move the computation into `bench report` so both consume one source)
or state on the leaderboard that decisions live in the bench-analysis
page. Prefer the former; keep `power.ts` ↔ `analytics.mjs` parity (the
unit test already pins it).

### 5. Dogfood PR mining on a real company-like repo

Mining was tuned on this repo plus small JS / Python / Go fixtures.
Run `bench-create-task` mining end-to-end on one mid-size real repo
(~20 candidate PRs → ~10 tasks) and record what breaks:

- coupling detection (`mine-prs.mjs`, names the PR introduces that the
  tests use must appear verbatim in the prompt) is lexer-light — expect
  misses on TS class fields / decorators, Python dataclass fields, Go
  struct tags; add fixtures for each miss before fixing;
- monorepos where the PR's tests need a workspace-scoped command;
- PRs whose tests only pass with network / external services (should be
  rejected at scan time, not at the gate).

Write findings into `MINING.md`, not into a report in chat.

### 6. Guard hash in the era (scoring-breaking, batch with something else)

The era key covers task hash, judge, rubric versions, mode, threshold —
but `task_hash` is `hashTaskDir(tasks/<task>/)` (`lib/era.ts`), so a
hidden guard edited in `evaluation-pool/tests/<task>-pr/` (or any
script under `evaluation-pool/`) changes scores without changing the
era. Stamp a hash of the task's evaluation inputs (the scripts its
`evaluation[]` references) into results, add it to `eraKey` and
`staleReasons`. This is `[scoring-breaking]` — ship it together with
the next scoring change, not alone.

### 7. OpenRouter provider pinning

The same OpenRouter model id can be served by different providers
(quantization, context limits, price). Record the serving provider per
attempt (from the generation endpoint / response headers) and allow
pinning a provider order in config. Without it, two trials of "the same
model" may not be the same model.

## Environment gotchas (cloud sandbox)

- `dockerd` is not running by default: start it manually
  (`dockerd > /tmp/dockerd.log 2>&1 &`) and wait for the socket.
- Docker Hub rate-limits (429): pull base images through
  `mirror.gcr.io/library/<image>`.
- Image builds behind the agent proxy need the proxy CA inside the build
  and HTTPS apt sources; do that in a throwaway copy of the Dockerfile,
  never in `.bench-kit/docker/Dockerfile`.
- `pkill -f <pattern>` can match your own shell; kill by PID or port.
- Runner modules are TypeScript run via
  `node --experimental-strip-types`; `npm ci --prefix .bench-kit/runner`
  first.

## Checks before any push

```
npm run typecheck --prefix .bench-kit/runner
node --test .github/tests/bootstrap.test.mjs
node --experimental-strip-types --test .github/tests/units.test.mjs
npm run bench --prefix .bench-kit/runner --silent -- validate --offline --root "$PWD"
```

Skill or shared-zone changes are a release (AGENTS.md: SemVer bump,
CHANGELOG entry, `.bench-kit/VERSION`, `release.mjs` on master).
