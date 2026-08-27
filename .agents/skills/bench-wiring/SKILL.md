---
name: bench-wiring
description: >-
  Takes a fresh bench-kit instance from `bench-kit init` to a green
  `bench validate` and the first measured attempt ON THE OPERATOR'S
  MACHINE. First a check that the instance holds together (filling gaps
  left by init + `bench validate`, within a minute), then the first
  local run: container engine, API keys in the environment, a smoke
  `bench attempt` + `bench evaluate`, committed results; optionally the
  publication path (instance repo on GitHub, readiness + leaderboard
  workflows). Use when the user has a fresh benchmark instance to
  configure, wants to hook up a base repo or models, or says "wiring /
  configure the benchmark / hook up the benchmark".
---

# bench-wiring — from init to the first measured attempt

You close out the decisions that `bench-kit init` deliberately does not
make. Two divisions of labor shape the entire procedure:

- **What init already did is not wiring work.** Init launched from
  inside a product repo detects it, registers it in `base_repos`
  (https instead of SSH when it responds), pins the demo tasks to its
  HEAD, and clones the repo into `.repos/<name>/`. Wiring reads that
  and fills the gaps — it does not repeat it.
- **The benchmark runs LOCALLY.** The operator's machine (or a VPS —
  from the kit's perspective the same thing: a long-lived host with a
  container engine) executes attempts (`bench attempt`) and evaluations
  (`bench evaluate` / rate-attempt). GitHub Actions is plain CI/CD:
  `readiness` (consistency on every push) and `leaderboard` (a static
  build published when results/ changes). No dispatches, no results
  PRs, no paid minutes.

Hence two phases — **working names internal to this document, not words
you use in conversation** (rule 8):

- **Phase A — first check (budget: one minute, no containers).** Proof
  that the instance holds together: gaps left by init filled,
  `bench validate` green.
- **Phase B — first measurement (local).** Container engine alive, API
  keys in the environment, a smoke attempt on the demo task, its
  evaluation, results committed to `results/`. Optionally: publication
  (remote repo, leaderboard).

The decision-split principle: **whatever has a good default in the
template is not a conversation**. Confirm every "done" state with proof
from the runner (`bench` output) — never eyeball it.

## Hard rules

1. **Output via PR.** Wiring changes `bench.config.yaml` (which affects
   scoring: models, judge, rubric versions) — branch
   `bench-wiring/<description>` + PR per [PR_TEMPLATE.md](PR_TEMPLATE.md);
   a human merges. Exception: the first configuration of a fresh
   instance whose master is still just the template skeleton — there a
   commit to master is acceptable with the user's explicit consent
   (there are no results yet that the change could invalidate). The
   exception **also covers re-pinning the demo task** from the
   placeholder to a real pin: formally that is a `task_hash` change,
   but a task with no results has no era to invalidate.
2. **You never touch secrets.** You generate a checklist of variable
   NAMES and verify mere presence (`[ -n "$VAR" ]`; for optional repo
   secrets: `gh secret list`) — you never read, print, or store values.
   Setting values is always the user's step.
3. **Do not touch `.bench-kit/`** (the tool's zone). Do not edit the
   base Dockerfile; report runner gaps (as an issue), do not work
   around them.
4. **The runner is your instrument.** Configuration is confirmed by
   `bench validate`; execution by a completed smoke `bench attempt` +
   `bench evaluate` with a result in `results/`. Never eyeball that
   something will work.
5. **Judge ≠ evaluated models.** A hard rule (validate enforces it);
   the judge is a fixed, strong model — changing the judge or the
   rubric version (frontmatter `version` in the rubric) closes the
   comparability era of the tasks that use it. Preserved attempts
   survive such a change — only evaluations are redone.
6. **Budget instead of a consent ritual.** `defaults.max_cost_usd` is
   the cost ceiling of a WHOLE matrix run — `bench attempt` projects
   the cost from results/ history before starting and stops
   commissioning trials once the sum exceeds it. Human consent is only
   needed to **raise** the budget. After each run report the actual
   cost (`metrics.json` / the evaluate summary); do not negotiate
   estimates.
7. **Era awareness.** Wiring defines the instance's first era (judge +
   rubric versions). The PR says so explicitly; later changes to those
   fields re-version the evaluations (cheap: re-evaluate preserved
   attempts), not the attempts themselves.
8. **Say what is happening to the instance — not what the step is
   called.** "Phase A/B" and this file's section names are the
   procedure's internal structure; the user does not know them and has
   no reason to. Say what you are doing and why, in the language of the
   instance's state — instead of "starting phase A" → "checking what
   `bench-kit init` already configured, so I don't repeat its work".
   The same rule covers unexplained tool jargon (pin, era, overlay) —
   use it only with a brief "meaning…" when it carries substance.
   Report regularly: before a longer operation say what you are about
   to do; afterwards, what came of it.

## Tools

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter: `bench <command>`;
one-time prerequisite: `npm ci --prefix .bench-kit/runner`). There is no
`bench` executable in PATH — the shorthand is benchmark internals. You
run these commands yourself; never hand the user a `bench …` command to
execute. The user's surface is the config, environment variables, and
git.

- `bench doctor` — deterministic environment checklist: an OK/MISSING
  table with fix instructions. Do not check these things manually and
  do not later re-verify what doctor already confirmed. Mind the exit
  code: a MISSING **container engine blocks the first measurement**
  (attempts and evaluation run in containers on this machine) but not
  the first check.
- `bench validate` — the full gate: schemas, consistency of
  evaluation[] with the pool, weights, judge ≠ evaluated, clonability
  of base repos + existence of pins. The network phase takes seconds
  per repo. `--offline` skips the network (for iterating on schema
  errors), `--assert` requires containers — in wiring it is only needed
  when existing tasks have `reference` declarations.
- `bench attempt` — local execution producing preserved attempts
  (`attempts/<task>/<model>/trial-N/`, contract in
  `.bench-kit/ATTEMPT_FORMAT.md`). `--smoke` = 1 trial, first model.
- `bench evaluate` — evaluation of preserved attempts; writes
  `result.json` into `results/<task>/<model>/trial-N/` in the repo.
  (For real tasks the judge-with-tools path is the rate-attempt skill;
  for the demo smoke the built-in API judge is enough.)

## Phase A — first check (budget: one minute, no containers)

Goal: a green `bench validate`. No containers, no network beyond
ls-remote/fetch, no decisions beyond those init did not make.

### A1. Read what init did

`bench doctor` plus three files:

- `.bench-kit/instance.json` — template version and `detectedBaseRepo`:
  init launched from inside a product repo has already registered the
  repo in `base_repos`, pinned the demo tasks to its HEAD, and cloned
  the working copy into `.repos/<name>/`.
- `bench.config.yaml` — does `base_repos` have a real entry or a
  placeholder (`demo-app` / `example-org`)? Leave the defaults (models,
  judge, budget, `resources.memory_mb`) as they are.
- `.github/workflows/` — are `readiness.yaml` and `leaderboard.yaml`
  present; if not (an older init), copy them from
  `.bench-kit/workflows/`. Leftover `bench-run.yaml` /
  `bench-cell.yaml` from before the local-first pivot should be
  deleted (`bench-kit update` does this itself).

### A2. Fill the gaps left by init — gaps only

The norm: init did everything and this step is empty. Exceptions:

- **Standalone init** (launched outside a product repo — the config
  has a placeholder): fill in `base_repos` (`name` + `url`, always
  `https://…`; public repos need no credentials, private ones → a
  single `BASE_REPO_TOKEN` env var per machine: fine-grained PAT,
  contents:read), re-pin the demo task to a real SHA that exists on
  the remote, and clone a working copy into `.repos/<name>/`.
- **An additional base repo** beyond the detected one: add the entry +
  clone as above. Do not re-pin the demo task — it is already pinned.

The benchmark never modifies base repos — if the user proposes writing
to them, that is a misunderstanding to straighten out.

### A3. Gate: validate

`bench validate` (full, with network — it takes seconds). Iterate on
schema errors with `--offline`. **A green validate concludes the first
check** — tell the user so explicitly, in the language of the
instance's state (rule 8): the configuration holds together, the
template's settings are in effect, the next step is the first
measurement on this machine.

## Phase B — first measurement (local)

The message for the user: "one command from zero to an attempt, one to
an evaluation; the results land as files you commit". Your job is to
close out the conditions that make that sentence true.

### B1. Machine readiness

`bench doctor` already showed it: container engine responding (Docker
Desktop / `podman machine start`), machine memory vs
`resources.memory_mb` (too small a ceiling kills agents mid-build with
a bare SIGKILL), node >= 20, runner dependencies.

### B2. API keys in the environment

The keys follow from the config: the evaluated models' provider and
the judge's provider (often the same aggregator = one key), plus
`BASE_REPO_TOKEN` for private base repos. They live in the OPERATOR'S
environment (shell profile / VPS env), not in repo secrets —
verification is `bench doctor` (presence only, rule 2). Print any gaps
as ready-to-run user steps (`export OPENROUTER_API_KEY=…` in the shell
profile). Also remind about provider credit — an empty balance fails
the first attempt in a way no validate catches.

### B3. Models and judge — only when the defaults are not enough

Otherwise note "template defaults" and move on:

- **Evaluated models** (`defaults.models`): OpenCode format
  `<provider>/<model>`; steer toward a single aggregator provider
  (e.g. `openrouter/…`) = one key per machine.
- **Judge** (`judge.model`): host-side support for `anthropic/…` and
  `openrouter/…`; strong, stable, DIFFERENT from the evaluated models
  (rule 5).
- **`judge.max_tokens`** (8192), **`defaults.trials`** (3),
  **`defaults.timeout_s`**, **`defaults.max_cost_usd`** — do not touch
  without a reason; too low a token limit truncates the judge's JSON
  verdict, too short a timeout measures speed, not quality. Raising the
  budget requires human consent (rule 6).

### B4. Smoke: attempt + evaluate, locally

The one-time base image build takes 2–4 min — start it by launching the
smoke and telling the user what is happening:

```
bench attempt --smoke --tasks demo-hello-bench --models <cheapest>
bench evaluate
```

The attempt lands in `attempts/demo-hello-bench/<model>/trial-1/`
(attempt.json + patch.diff + workspace/ on disk), the evaluation writes
`results/demo-hello-bench/<model>/trial-1/result.json`. Read total,
cost, and duration from the output and report them. A failed step = go
back to the step the cause belongs to, with `agent.log` /
`container.log` in hand (diagnosis is `ls` + `cat`, not artifact
downloads).

**Committing `results/` is part of the smoke** — it proves the results
path end to end (the user commits; you never commit or push). From here
the natural cycle is: attempts → rate-attempt/evaluate → commit
results/ → leaderboard rebuild on push.

### B5. Publication path (optional, does not block measuring)

- **Remote instance repo** — needed to share results and publish the
  leaderboard, not to measure. If absent: the user creates it
  (`gh repo create <owner/name> --private`), you hook up origin and
  push master (fresh instance: the rule-1 exception, with explicit
  consent).
- **Workflows** — `readiness.yaml` (validate on every push; no secrets
  needed) and `leaderboard.yaml` (rebuilds the dashboard when a push
  touches `results/`; publishes to Cloudflare Pages when
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets exist,
  GitHub Pages when the plan allows — otherwise the dashboard is
  always available as the `leaderboard-site` artifact).

### B6. The "instance wiring" PR

For a fresh instance the wiring went to master (rule 1) — there is no
PR, but leave a summary with the same content in the instance README /
first commit description. For **changes** to existing wiring: branch
`bench-wiring/<description>`, description per
[PR_TEMPLATE.md](PR_TEMPLATE.md): decisions ("template defaults" is
also a decision) with justification, the environment checklist with
status, proofs (`validate` output, the smoke's total and cost, the
committed result path), a "Comparability impact" section (the first
era: judge + rubric versions; what will re-version evaluations in the
future).

## Deferred decisions — they do not block wiring

The template ships defaults for environment policy; return to them only
when the first real task touches them (usually in bench-build), and
drive changes via PR like any config change:

- **Assertion dependency cache**: default `evaluation.deps_cache: true`
  (persistent `bench-deps-cache` volume). Turning it off — full
  hermeticity at the cost of time — is a deliberate decision per
  instance (`deps_cache: false`) or per invocation (`--no-deps-cache`).
- **Container resource limits**: the template sets
  `resources.memory_mb` (era stamp `memory_limit_mb` — changing it
  closes the era, so if you are going to raise it, do so before any
  results exist). Without a limit, agents verifying their work with a
  build die from the OOM killer with a bare SIGKILL, which looks like
  the model's fault.
- **Verification policy in prompts** (whether the agent should run the
  project to verify): set by the task author in `prompt.md` — the
  bench-build skill's contract, not wiring's.
- **VPS / scheduled runs**: a VPS is just a bigger operator machine
  with the same DX — defer until nightly matrix runs are actually
  wanted.
- **Toolchain in the agent's trial**: the base image is node + git +
  pinned OpenCode; any toolchain the assertions need is installed by
  the `check.yaml` commands themselves (the evaluation stage may use
  the network; only agent trials are offline). If the stack requires a
  toolchain already in the **agent's trial**, that is currently a
  runner gap — file an issue with specifics (rule 3), do not edit the
  base Dockerfile.

## Closing message — checklist + call to action

Every summary response ends with a fixed, scannable structure. The
reader must be able to extract "what is true, what changed, what do I
do" without rereading prose. Three checklists, then one call to action:

**1. Confirmed** — facts proven by the runner or by inspection, each
with its proof in brackets. Examples: "config holds together
(`bench validate`: 0 errors)", "demo task pinned to a real SHA
(existence confirmed by fetch)", "smoke attempt evaluated (total 0.93,
$0.04)". Never list anything here you merely expect to be true
(rule 4).

**2. Done in this session** — every change you made to the instance,
however small, as its own line with the file it touched. If you changed
nothing, say "no changes — init had done everything" as the single line.

**3. Your steps** — the actions only the user can take, as a numbered
checklist in execution order, each with the ready-to-run command or
exact file/field to edit. Include only the ones actually open, drawn
from this standard set:

- **Models in `bench.config.yaml`** — confirm the template defaults or
  edit `defaults.models` / `judge.model` (state the current values so
  confirming takes one glance).
- **API keys in the environment** — the `export <NAME>=…` lines with
  concrete names (rule 2: names and presence only, never values).
- **Provider credit** — if any evaluated model or the judge is paid
  (e.g. via OpenRouter), remind the user to check/top up the account
  balance. Skip this line only when every configured model is free.
- **Commit `results/`** — after the smoke: the exact paths to review
  and commit.
- **Publication (optional)** — `gh repo create …`, push consent,
  Cloudflare/Pages secrets if a hosted dashboard is wanted.
- **Decisions awaiting a human** — push consent, budget raise, PR
  merge.

**Call to action** — one closing sentence naming exactly what you need
back to continue (e.g. "reply with consent to run the smoke on
<model> — I'll run the attempt and its evaluation, and report total
and cost"). One ask, not a menu. If you also want to give a
recommendation with alternatives, do it *above* the checklists — never
let alternatives dilute the final ask.

Name everything by what it delivers (rule 8): after a green `validate`
the natural recommendation is "the first measurement on this machine";
after a committed smoke result — **bench-new-task** (commissions for
the backlog), then **bench-build**, because an instance without tasks
measures nothing; once tasks exist, every measurement runs through
**bench-measure**.
