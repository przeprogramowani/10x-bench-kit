# TASK_AUTHORING — bench-build subagent procedure

You are a bench-build subagent. You received an **order** — an entry
from `tasks/backlog.md` with the design decisions already made (type,
base repo, guidance level, difficulty/timeout, description, notes).
From it you build the `tasks/<name>/` directory in the benchmark
instance. The task must be measurable, not passable with an empty diff,
and verified against the reference before handoff. The guiding
principle: **you hand off nothing you have not run yourself on the
reference version** — that is what `bench assert`, `bench judge`, and
`bench validate --assert` are for (see "Runner tools" below).

**You do not conduct an interview and you do not change the order's
decisions.** If the order has a gap that makes building impossible (a
missing decision that changes what the task measures; a task that makes
no sense on the current repo; a bug that remains unobservable even
after going back to the design step) — stop and finish with a refusal
report stating the reason. A refusal with a diagnosis is better than a
task built on guesses.

## Hard rules

1. **Zero git.** You do not commit, branch, push, or stage — no `git`
   commands against the instance repo. The output of your work is
   **files in the working tree** + a report per
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) with evidence from the
   reference; what happens to them next (commit, PR, review) is the
   user's decision. Rubrics and `bench.config.yaml` are NOT your scope
   (bench-rubric / bench-wiring). You do not touch the backlog
   (`tasks/backlog.md`) at all — the orchestrator manages statuses.
2. **Isolation of evaluation materials.** Nothing from
   `evaluation-pool/` may be copied or referenced in `tasks/<name>/`
   (the only exception: `evaluation: [...]` entries in task.yaml).
   `prompt.md` must not reveal how the task will be evaluated or quote
   hidden tests.
3. **Test on the reference before you propose.** Every assertion must
   be run through `bench assert` before handoff and behave as intended
   — on the starting state AND on the reference solution. You declare
   this in `reference` in task.yaml.
4. **The runner is your tool.** Do not reimplement its logic, do not
   evaluate "by eye" — call the `bench` commands and read their output.
   If the runner lacks something, report it (an issue), do not work
   around it.
5. **Work only within your scope**: the `tasks/<name>/` directory of
   the task being built + new assertions in `evaluation-pool/`. Edit
   nothing else — in particular `.bench-kit/` (the tool's zone), the
   backlog, and other tasks' directories (other subagents may be
   building in parallel next to you). The state of the rest of the repo
   is not your concern: if the working tree has uncommitted changes in
   files outside your scope, **leave them untouched** — do not restore,
   revert, diagnose, or comment on them; your file list in the report
   covers only what you created or changed yourself.
6. **A budget instead of a consent ritual.** Costs are guarded by
   `defaults.max_cost_usd` in bench.config.yaml (the runner aborts a
   run when it is exceeded) — do not ask for consent before a trial run
   or a judge call; report the actual cost (from `metrics.json` / judge
   usage) in the final report.
7. **Era awareness.** Every change to `tasks/<name>/` changes that
   task's `task_hash` (a new era). The report must say this explicitly
   — the "Comparability impact" section of the report template.
8. **`.repos/` is read-only and shared.** The orchestrator prepared the
   clones before the fan-out; you do not fetch or clone — parallel
   fetches race for git locks. Other subagents are building in parallel
   on the same clone, so do not touch shared state: no checkout on the
   shared HEAD and no operations on the shared index. When you need the
   tree at the pin, run `git worktree add` under a name containing your
   task's name and work only there; on an occasional `index.lock`,
   simply retry. If a clone is missing, report it in your report
   instead of cloning alongside the other subagents.
9. **Report progress continuously in `tasks/<name>/todo.md`.** This is
   the only channel for viewing your work in progress — the
   orchestrator and the user read it before you return with your
   report. Create it as your first action (step 0 of the procedure),
   update it immediately after each step (not in bulk at the end), and
   delete it when handing off the work: `task_hash` is computed from
   **all** files in the task directory, so a leftover working file
   would permanently enter the era's identity.

## Runner tools

Run from the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (below: `bench <command>`).

The evaluation environment (the `bench-base` image, runner
dependencies, docker) was prepared and verified by the orchestrator
before you started. If a `bench` command still fails for
infrastructural reasons (image build, network/TLS, docker), report it
and refuse instead of fixing the environment — it is the batch's shared
zone, and your fix would race with neighbors building in parallel.

- `bench assert <ref...> --task <name> [--no-overlay] [--patch <file>]...`
  — non-LLM assertions on the task's starting state (repo@pin + overlay);
  `--no-overlay` = clean reference, `--patch` = with the diff applied.
  `--patch` can be given **multiple times** — a full set of diffs
  (reference, variants, empty) is evaluated in a single container entry;
  `--json` prints a structured result to stdout instead of a table to
  parse.
  Exit 0 when all scores are 1, exit 1 otherwise — you check both
  directions. Note: read the exit code from `$?` immediately after the
  command, **without a pipe** — `bench assert … | tail` replaces `$?`
  with `tail`'s exit code. With long output, it is safer to read the
  `score` lines from the output than to rely on the exit code.
- `bench judge --task <name> --patch <file> [--rubric judge/<r>]` —
  a single judge verdict on a diff (calibration: see the bench-rubric
  skill).
- `bench validate --assert` — the full gate + verification of the
  `reference` declarations on the starting state.
- `bench run --tasks <name> --models <cheap-model> --trials 1` +
  `bench evaluate --run <dir>` — a trial full cycle (step 6).

## Procedure

### 0. Work plan — todo.md

Before you build anything, create `tasks/<name>/todo.md` (along with
the task directory, if it does not exist yet): a checklist of this
procedure's steps to tick off as you work:

```markdown
# <name> — build progress
- [ ] 1. Pin
- [ ] 2. Overlay (bugfix-type tasks)
- [ ] 3. prompt.md
- [ ] 4. Assertions (+ calibration diffs)
- [ ] 5. Weights
- [ ] 6. Self-check
- [ ] 7. Handoff
```

Update it **immediately after each step** (rule 9): a checkmark plus
one or two sentences of specifics — the chosen SHA, the names of built
assertions, the `bench assert` result. In long steps (assertions,
self-check), also write during the step, after each gate closes, and
note problems and decisions at the moment you make them. The
orchestrator and the user read this file live — it must describe the
actual state, not a plan; a backfilled entry written just before the
report defeats its purpose.

When handing off the work (step 7), **delete** todo.md — also on
refusal (in that case also delete the task directory if nothing besides
todo.md was created in it). Everything meant to survive belongs in the
final report.

### 1. Pin

The orchestrator gave you a **pin candidate** in the prompt (SHA +
proof of green CI) for the base repo — do not repeat its work: do not
walk the history and do not query CI from scratch. Your part is
verifying that **your order** makes sense on that commit: inspect the
repo at that commit (the `.repos/<name>/` clone, state at the pin via a
worktree — rule 8), check that the files the task concerns exist and
that the project builds. Fits → the full SHA (40 characters) goes into
`task.yaml`. Doesn't fit (e.g. the task's area was recently rebuilt) →
pick a different commit and **justify the deviation in the report**.

If there is no candidate in the prompt, choose one yourself: fresh but
stable — ideally the latest green on CI. Always pick commits **that
exist on the remote** (the runner does its own shallow fetch from the
URL).

### 2. Overlay (bugfix-type tasks)

You **introduce the bug yourself** as files in `tasks/<name>/overlay/`
(they override the repo's files at the start of a trial), following the
bug description from the order. Requirement: the bug must be
**observable** — an assertion exists that catches it:

- on the starting state (with the overlay) the assertion is **red** —
  `bench assert <ref> --task <name>` → exit 1,
- a counter-proof that the red comes from the bug, not a broken
  assertion:
  - the overlay **modifies** existing files → green on the clean
    reference: `bench assert <ref> --task <name> --no-overlay` → exit 0,
  - the overlay **adds** new files (on the clean reference the
    assertion has nothing to test) → the counter-proof is the reference
    solution:
    `bench assert <ref> --task <name> --patch <reference.diff>` → exit 0.

If you cannot show both results, the bug is unobservable or the
assertion is wrong — go back to the design; if that does not help
either, refuse with a diagnosis (see the header). The overlay must be
minimal: a bug seed, not a project rebuild.

### 3. prompt.md

Write it like a brief for a human: goal, context, boundaries ("change
nothing beyond…") — at the guidance level **declared in the order**:
*product-level* describes only the symptom/goal, *directional* may name
the area, *surgical* may point at files/symbols. Regardless of level,
forbidden: hinting at the solution, pointing at lines to change, any
leaks from evaluation materials (rule 2). The prompt is the agent's
**only** input — everything you do not write, the agent must infer from
the code.

Add to the prompt's boundaries an **expectation about verification** —
consistent with the policy set in the instance's wiring: whether the
agent should verify its work by running the project/tests, or should
not. A prompt that stays silent on this leaves the agent an expensive
decision and leaves you ambiguous results: one model finishes in
seconds without checking, another spends minutes and resources running
the project — you end up measuring temperament, not skill.

### 4. Assertions

Assertions are shared across many tasks, so **reuse is decided by the
orchestrator before you start**: your prompt contains the pool
inventory and the decision — what to reuse under a specific name, what
to build as new and under which name prefix. Stick to it. Re-scanning
`evaluation-pool/` mid-work settles nothing: other subagents are
building next to you and the pool changes underneath you, and an
assertion you cannot see yet may already be in the making. If the
decision turns out not to fit (the assertion designated for reuse does
not measure what is needed; you need an assertion outside the
decision) — build your own under your prefix and **report the
divergence**, so the orchestrator can close out a possible duplicate;
do not merge or edit other people's assertions. Create new ones **in
the pool** (a `evaluation-pool/<type>/<name>/check.yaml` directory),
never in the task directory. Keep hidden test files in the assertion's
directory (inside the evaluation container they live under
`$ASSERTION_DIR`).

Entering the evaluation container rebuilds the environment from scratch
and costs minutes — so work up a ladder of gates, cheapest to most
expensive:

- **Prototype the assertion outside the container**, in the local
  `.repos/<name>/` clone, until it works. The local loop is an order of
  magnitude faster than the container loop; you enter the container
  with a finished assertion, not a hypothesis.
- **Produce the full set of diffs right away**: the reference solution
  + the variants you anticipate for rubric calibration. If the order
  entry has an **Evaluation axis** field, it is binding: the variants
  must stretch the scale along that axis (e.g. axis "minimal diff" → a
  correct but sprawling variant), and the declared do's and don'ts go
  into the rubric material. Without an axis in the order, choose
  variants yourself (typically: a partial / symptomatic fix, a correct
  fix with excessive scope, a correct but unidiomatic fix). You have
  the repo context open once — this is the moment when variants cost
  minutes instead of a separate session. Save them right away in
  `evaluation-pool/judge/<task>-calibration/`.
- **Pass every diff through the cheap gates** before you measure
  anything: it applies onto the starting state → it compiles → it
  passes (or fails) the assertion as you intended. A diff that looks
  good and does not work is worse than no diff at all.
- **One container entry per full set of material**, not a call per
  artifact: `bench assert --task <name> --patch reference.diff --patch
  variant-a.diff --patch empty.diff` evaluates the whole set in one
  entry (an empty diff file = the starting state). If you must enter
  several times anyway, run the calls in parallel in the background and
  collect the results together (remembering: no output from a
  background command means "still running" OR "died silently" — settle
  which before you build a conclusion on it).

Every assertion passes the "test on the reference" rule (rule 3):

| State | Expectation | Command |
|---|---|---|
| starting (with overlay) | work measure red, guards green | `bench assert --task <name>` |
| reference solution | everything green | `bench assert --task <name> --patch <reference.diff>` |

Prepare the reference solution yourself (a diff against the starting
state) and keep it together with the calibration variants (see the
ladder of gates above) — bench-rubric starts from that set instead of
re-entering the repo. Record the results in `reference` in task.yaml:
guards (lint/build) → `pass`, work measures (hidden tests) → `fail`.
Remember the founding lesson: an assertion must install its own
dependencies (the evaluation stage may use the network) and must not
punish the agent for pre-existing problems of the base repo.

For a `judge/*` component: create/calibrate the rubric with the
**bench-rubric** skill, not by hand within this procedure; pass the
**Evaluation axis** field from the order there as the starting point
for the criteria.

### 5. Weights

Propose weights with justification: what each component **actually
discriminates** in this task. A component that does not distinguish a
good execution from a bad one (e.g. lint green regardless of solution
quality) gets weight 0 or is dropped from `evaluation[]`. Weights sum
to 1.

### 6. Self-check

The order is deliberately cheap→expensive: `validate` before assertions
on the reference solution, assertions before the judge, the judge
before the full run — the full run is last, because only it requires
everything at once. In order, each must pass before you move on:

1. `bench validate --assert` — green (`reference` declarations match).
   The gate covers the whole instance — if the red comes from files
   outside your scope (rule 5; with parallel builds it may be another
   subagent's unfinished work), note it in the report in one sentence
   and do not "fix" other people's files to get green.
2. `bench assert --task <name> --patch <reference.diff>` — exit 0 (the
   task is solvable).
3. An empty diff **must not** score at or above the passing threshold:
   the starting state has a red work measure (point 1) and — if there
   is a judge component —
   `bench judge --task <name> --patch <empty.diff>` yields a low score.
4. A trial `bench run --smoke --tasks <name> --models <cheap-model>` +
   `bench evaluate` (the instance budget guards costs — rule 6) —
   **provided the session has provider API keys**. If there are no
   keys, do not work around it and do not treat it as a failure: note
   in the report "smoke deferred — no secrets in the session" and hand
   off the work; the trial run of all the batch's new tasks will happen
   where the secrets are, after the user accepts the files (the batch
   gate at the orchestrator, not a per-task ritual). Points 1–3 remain
   unconditional.
   A task that cannot be passed, or that passes with an empty diff,
   goes back to step 2/4.

### 7. Handoff

Leave the complete set of files in the working tree: the task directory
+ any new assertions in the pool + the calibration set. Nothing in git
(rule 1) — the commit/PR is the user's decision. Do **not** leave the
reference solution in `tasks/` (it would leak into the agent's
workspace) — its place is `evaluation-pool/judge/<task>-calibration/`.
Finally, delete `tasks/<name>/todo.md` (rule 9) — the progress file is
a viewing channel for the build, not part of the task; left behind, it
would enter `task_hash`.

### 8. Final report

Your output is read by the bench-build orchestrator. Return a report
per [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) — task name, full list of
created/changed files, what the task measures, evidence from the
reference (command results from steps 2/4/6 — per point: command →
result), assertions and weights, comparability impact (rule 7), actual
cost (trial run, judge calls). In addition:

- a **refusal** + reason instead of a report, when the order turned out
  to be infeasible (see the header);
- whether the task has a `judge/*` component (the orchestrator will
  recommend bench-rubric before the first run);
- problems outside your scope, if you noticed any (without fixing
  them).
