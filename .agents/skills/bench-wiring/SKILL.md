---
name: bench-wiring
description: >-
  Takes a fresh bench-kit instance from `bench-kit init` to a green
  `bench validate` and the first run in CI. First a check that the
  instance holds together (filling gaps left by init + `bench validate`,
  locally, no containers, within a minute), then the first run: the
  instance repo on GitHub, secrets, dispatching the `bench-run`
  workflow, a green run. Use when the user has a fresh benchmark
  instance to configure, wants to hook up a base repo or models, or
  says "wiring / configure the benchmark / hook up the benchmark".
---

# bench-wiring — from init to the first green run

You close out the decisions that `bench-kit init` deliberately does not
make. Two divisions of labor shape the entire procedure:

- **What init already did is not wiring work.** Init launched from
  inside a product repo detects it, registers it in `base_repos`
  (https instead of SSH when it responds), pins the demo tasks to its
  HEAD, and clones the repo into `.repos/<name>/`. Wiring reads that
  and fills the gaps — it does not repeat it.
- **What CI can do is not local-machine work.** The `bench-run`
  workflow validates, builds images (cached in GHCR), runs trials,
  evaluates, and aggregates on its own. The first run happens in GH
  Actions — local containers are only needed by task authors
  (bench-build).

Hence two paths — **A and B are working names internal to this
document, not words you use in conversation** (rule 8):

- **Path A — first check (budget: one minute, local).** Proof that the
  instance holds together: gaps left by init filled, `bench validate`
  green. No containers, no discussions about defaults.
- **Path B — first run (in CI).** Instance repo on GitHub, secrets,
  dispatch `bench-run`, green run. The message for the user is simple:
  "create a repository (or hook up an existing one), launch the first
  workflow, and wait for green".

The decision-split principle: **whatever has a good default in the
template is not a conversation**. Confirm every "done" state with proof
from the runner — locally with `bench` output, in CI with a green
workflow run.

## Hard rules

1. **Output via PR.** Wiring changes `bench.config.yaml` (which affects
   scoring: models, judge, rubric versions) — branch
   `bench-wiring/<description>` + PR per [PR_TEMPLATE.md](PR_TEMPLATE.md);
   a human merges. Exception: the first configuration of a fresh
   instance whose master is still just the template skeleton — there a
   commit to master is acceptable with the user's explicit consent
   (there are no results yet that the change could invalidate); this
   exception is what enables the first dispatch, since
   `workflow_dispatch` requires the workflows to exist on the default
   branch. The exception **also covers re-pinning the demo task** from
   the placeholder to a real pin: formally that is a `task_hash`
   change, but a task with no results has no era to invalidate.
2. **You never touch secrets.** You generate a checklist of secret
   NAMES and verify mere presence (`gh secret list`, `[ -n "$VAR" ]`) —
   you never read, print, or store values. Setting values is always the
   user's step.
3. **Do not touch `.bench-kit/`** (the tool's zone). Do not edit the
   base Dockerfile; report runner gaps (as an issue), do not work
   around them.
4. **The runner is your instrument.** Configuration is confirmed by
   `bench validate`; execution by a green `bench-run` in CI (or a local
   smoke, when the user deliberately chose to work locally). Never
   eyeball that something will work.
5. **Judge ≠ evaluated models.** A hard rule (validate enforces it);
   the judge is a fixed, strong model — changing the judge or the
   rubric version (frontmatter `version` in the rubric) closes the
   comparability era of the tasks that use it.
6. **Budget instead of a consent ritual.** `defaults.max_cost_usd` is
   already in the template — the runner aborts a run once it is
   exceeded, so you do not ask for permission before every launch.
   Human consent is only needed to **raise** the budget. After each run
   report the actual cost (`report.json`); do not negotiate estimates.
7. **Era awareness.** Wiring defines the instance's first era (judge +
   rubric versions). The PR says so explicitly; later changes to those
   fields invalidate the comparability of existing results.
8. **Say what is happening to the instance — not what the step is
   called.** "Path A/B", "step A1/B4", and this file's section names
   are the procedure's internal structure; the user does not know them
   and has no reason to. Never write "starting path A" or "this belongs
   to path B" — say what you are doing and why, in the language of the
   instance's state:
   - instead of "starting with path A — reading what init left behind" →
     "checking what `bench-kit init` already configured, so I don't
     repeat its work",
   - instead of "path A closed, moving to B" → "the instance holds
     together — `bench validate` is green; now the first run in CI:
     repository, secrets, workflow",
   - instead of "step B2" → "checking the secrets in the instance repo".
   The same rule covers unexplained tool jargon (dispatch, pin, era,
   overlay) — use it only with a brief "meaning…" when it carries
   substance. Report regularly: before a longer operation say what you
   are about to do; afterwards, what came of it.

## Tools

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter: `bench <command>`).

- `bench doctor` — deterministic environment checklist: an OK/MISSING
  table with fix instructions. Do not check these things manually and
  do not later re-verify what doctor already confirmed. Mind the exit
  code: a MISSING **container engine does not block wiring** — the
  first run happens in CI, and local containers are only needed for
  `bench assert` (bench-build). What does block at this stage are
  config and runner gaps.
- `bench validate` — the full gate: schemas, consistency of
  evaluation[] with the pool, weights, judge ≠ evaluated, clonability
  of base repos + existence of pins. The network phase takes seconds
  per repo. `--offline` skips the network (for iterating on schema
  errors), `--assert` requires containers — in wiring it is only needed
  when existing tasks have `reference` declarations.
- **The `bench-run` workflow** (`workflow_dispatch` in GH Actions) —
  the full cycle with no local work: validate gate, image builds cached
  in GHCR, trials in parallel, evaluation, `report.json` as an
  artifact. Parameters: `models`, `tasks`, `trials` (empty = defaults
  from the config).

## Path A — first check (budget: one minute, local)

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
- `.github/workflows/` — are `bench-run.yaml` and `leaderboard.yaml`
  present; if not (an older init), copy them from
  `.bench-kit/workflows/`.

### A2. Fill the gaps left by init — gaps only

The norm: init did everything and this step is empty. Exceptions:

- **Standalone init** (launched outside a product repo — the config
  has a placeholder): fill in `base_repos` (`name` + `url`, always
  `https://…`; public repos need no secrets, private ones → a single
  `BASE_REPO_TOKEN` per instance: fine-grained PAT, contents:read),
  re-pin the demo task to a real SHA that exists on the remote, and
  clone a working copy into `.repos/<name>/`.
- **An additional base repo** beyond the detected one: add the entry +
  clone as above. Do not re-pin the demo task — it is already pinned.

The benchmark never modifies base repos — if the user proposes writing
to them, that is a misunderstanding to straighten out.

### A3. Gate: validate

`bench validate` (full, with network — it takes seconds). Iterate on
schema errors with `--offline`. **A green validate concludes the first
check** — tell the user so explicitly, but in terms of the instance's
state (rule 8): the configuration holds together, the template's
settings are in effect, the next step is the first run in CI. What you
do NOT do at this stage: no discussing models/judge/budget, no building
images, no running anything in containers, no measuring cold cycles.

## Path B — first run (in CI)

The message for the user: "create a repository or hook up an existing
one, launch the workflow, and wait for green". Your job is to close out
the conditions that make that sentence true.

### B1. Remote instance repo

`bench doctor` showed whether an origin exists. If not — the user
creates the repo (e.g. `gh repo create <owner/name> --private`), and
you hook it up and push master (fresh instance: the rule-1 exception,
with explicit consent):

```
git remote add origin https://github.com/<owner/instance-repo>.git
git push -u origin master
```

### B2. Secrets in the instance repo

Doctor checked the local env; workflows run on **repo** secrets —
a separate place. The list of names follows from the config (and any
B3 decisions): the API key for the evaluated models' provider, the key
for the judge's provider (often the same one), `BASE_REPO_TOKEN` for
private base repos. Verification: `gh secret list --repo
<owner/instance-repo>`. Print any gaps as ready-to-run user commands:

```
gh secret set OPENROUTER_API_KEY --repo <owner/instance-repo>
gh secret set BASE_REPO_TOKEN --repo <owner/instance-repo>
```

(or the UI path: Settings → Secrets and variables → Actions).

### B3. Models and judge — only when the defaults are not enough

Otherwise note "template defaults" and move on:

- **Evaluated models** (`defaults.models`): OpenCode format
  `<provider>/<model>`; steer toward a single aggregator provider
  (e.g. `openrouter/…`) = one secret per instance.
- **Judge** (`judge.model`): host-side support for `anthropic/…` and
  `openrouter/…`; strong, stable, DIFFERENT from the evaluated models
  (rule 5).
- **`judge.max_tokens`** (8192), **`defaults.trials`** (3),
  **`defaults.timeout_s`**, **`defaults.max_cost_usd`** — do not touch
  without a reason; too low a token limit truncates the judge's JSON
  verdict, too short a timeout measures speed, not quality. Raising the
  budget requires human consent (rule 6).

### B4. Smoke: dispatch and a green run

`workflow_dispatch` the `bench-run` workflow with smoke parameters:
`models=<cheapest evaluated>`, `tasks=demo-hello-bench`, `trials=1`.
The workflow will run validate, build the images, and evaluate the
trial on its own — you wait for a green run, download the `report`
artifact, and read the total, cost, and duration from `report.json`.
This is the end-to-end proof of the wiring: secrets, clonability,
images, and the judge tested where they will actually work. A failed
run = go back to the step the cause belongs to, with the job logs in
hand.

Local variant (optional, when the user deliberately wants to iterate
without CI): the one-time base image build takes 2–4 min — start it in
the background ahead of time, then `bench run --smoke --tasks
demo-hello-bench --models <cheap>` + `bench evaluate --run <dir>`.
A local smoke does not test the repo secrets — a green run in CI
remains the gate.

### B5. The "instance wiring" PR

For a fresh instance the wiring went to master (rule 1) — there is no
PR, but leave a summary with the same content in the first run's
description / the instance README. For **changes** to existing wiring:
branch `bench-wiring/<description>`, description per
[PR_TEMPLATE.md](PR_TEMPLATE.md): decisions ("template defaults" is
also a decision) with justification, the secrets checklist with status,
proofs (`validate` output, link to the green `bench-run` with total and
cost), a "Comparability impact" section (the first era: judge + rubric
versions; what will close it in the future).

## Deferred decisions — they do not block wiring

The template ships defaults for environment policy; return to them only
when the first real task touches them (usually in bench-build), and
drive changes via PR like any config change:

- **Assertion dependency cache**: default `evaluation.deps_cache: true`
  (persistent `bench-deps-cache` volume; actions/cache in CI). Turning
  it off — full hermeticity at the cost of time — is a deliberate
  decision per instance (`deps_cache: false`) or per invocation
  (`--no-deps-cache`).
- **Container resource limits**: the template sets
  `resources.memory_mb` (era stamp `memory_limit_mb` — changing it
  closes the era, so if you are going to raise it, do so before any
  results exist). Without a limit, agents verifying their work with a
  build die from the OOM killer with a bare SIGKILL, which looks like
  the model's fault.
- **Verification policy in prompts** (whether the agent should run the
  project to verify): set by the task author in `prompt.md` — the
  bench-build skill's contract, not wiring's.
- **Cost of a cold evaluation cycle** (how long `bench assert` takes on
  a real task): measured by bench-build at the first real task —
  wiring has no task yet on which the measurement would be meaningful.
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
(existence confirmed by fetch)", "base repo is private (unauthenticated
clone → 401)". Never list anything here you merely expect to be true
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
- **Remote instance repo** — `gh repo create <owner/name> --private`
  (or the name of an existing repo to hook up).
- **Repo secrets** — the `gh secret set … --repo …` commands with
  concrete names (rule 2: names and presence only, never values).
- **Provider credit** — if any evaluated model or the judge is paid
  (e.g. via OpenRouter), remind the user to check/top up the account
  balance; an empty balance fails the first run in a way no validate
  catches. Skip this line only when every configured model is free.
- **Decisions awaiting a human** — push consent, budget raise, PR
  merge.

**Call to action** — one closing sentence naming exactly what you need
back to continue (e.g. "reply with the repo name and push consent —
I'll take it from there: hook up origin, dispatch the smoke run, and
report total and cost"). One ask, not a menu. If you also want to give
a recommendation with alternatives, do it *above* the checklists —
never let alternatives dilute the final ask.

Name everything by what it delivers (rule 8): after a green `validate`
the natural recommendation is "first run in CI", not "path B"; after a
green run — **bench-new-task** (commissions for the backlog), then
**bench-build**, because an instance without tasks measures nothing.
