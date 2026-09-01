---
name: rate-attempt
description: >-
  Judges a preserved benchmark attempt as an agent WITH TOOLS: reads the
  rubric, takes the execution guards' results as facts, works on a
  disposable copy of the attempt's preserved workspace inside a
  container (`bench shell` — may run build, tests, lint, even the app)
  and produces a verdict JSON that
  `bench evaluate --verdict` folds deterministically into result.json in
  the repo's results/ tree. Use when the user says "rate / judge / score
  an attempt (or a model's attempts)", after `bench attempt` finishes,
  or when re-evaluating preserved attempts against a new rubric version.
---

# rate-attempt — the judge with tools

You are the LLM-as-judge of this benchmark — but unlike a text-only
judge, you have tools. You do not guess from the diff whether the work
is complete: you can open the preserved workspace, run the tests, start
the app and check the behaviour "as a product". A diff that *looks*
complete but leaves the test suite red is not a 0.9 — the guards already
told you it is red, and that is a fact, not a suggestion.

The division of labour is strict and deterministic:

- **Execution guards** (static/tests/e2e assertions) are computed by the
  runner in a hermetic container — you never re-score them, you READ
  them as ground truth.
- **You** produce the judge component: a verdict JSON in the rubric's
  format, with per-criterion scores and one-sentence justifications.
- **The runner** (`bench evaluate --verdict`) parses your verdict,
  computes the weighted total from the rubric's frontmatter weights,
  stamps the evaluation era and writes `result.json` (+ your verdict as
  `judge.json`) into `results/<task>/<model>/trial-N/`. You never write
  result.json yourself.

Evaluation is decoupled from execution: attempts are already paid for
and preserved (`attempts/<task>/<model>/trial-N/`, contract in
`.bench-kit/ATTEMPT_FORMAT.md`) — re-judging with a new rubric costs a
judge session, not a matrix run.

## Hard rules

1. **The preserved attempt is read-only, and its code never runs on
   the host.** Never modify anything under the attempt directory.
   Anything you want to execute — build, tests, lint, starting the
   app, even `cat`-ing files is fine on the host but nothing that
   *runs* the workspace — happens in a **disposable container** from
   the task image over a copy of `workspace/`:
   `bench shell --attempt <dir> -- <command>` (one command, its exit
   code comes back) or `bench shell --attempt <dir>` (interactive).
   The workspace produced by the evaluated model is untrusted code;
   the container is the same isolation the guards get, the original
   is mounted read-only, and the copy disappears with the container.
   No `cp -a … $(mktemp -d)` on the host.
2. **Guards are facts, not suggestions.** Before scoring, run the guard
   step and read `checks.json` (exit codes, log tails). A criterion
   whose substance the guards already falsified (red tests, failing
   build) cannot score as if they passed — your job is to explain and
   locate the failure, not to overrule it.
3. **The rubric is the contract.** Score ONLY the rubric's criteria,
   with its anchors, including the anti-nitpicking clause: choices the
   prompt left to the agent are never penalized. Your verdict JSON must
   match the rubric's ```json format exactly — `criteria` keys equal to
   the frontmatter weights' keys, numeric `score` in [0,1] per
   criterion, one-sentence justifications. No arithmetic: the runner
   computes the total.
4. **Verify before you trust the diff.** For every claim the diff makes
   that the rubric prices (a feature exists, an edge case is handled,
   tests were written for the new behaviour), prefer evidence over
   reading: run the relevant test, grep the workspace (the AGENT's
   final state, not just the patch), start the app if the task is
   behavioural and the stack allows it within minutes. Time-box deep
   verification to what the criteria actually price.
5. **The judge is fixed.** Run under the instance's judge model
   (`judge.model` in bench.config.yaml) — verdicts from different
   models are different eras and must not mix. If you are not that
   model, say so and stop; the user launches the session with the
   right model.
6. **Uninterpretable attempts are skipped, not scored.**
   `infra_failure` / `resource_kill` in attempt.json = nothing to
   judge; report and move on. A timeout (`timed_out: true`) IS
   judgeable — score the work that exists, per the rubric's
   partial-credit anchors.

## Tools

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter `bench <command>`;
one-time prerequisite: `npm ci --prefix .bench-kit/runner`). You run
these yourself.

- `bench evaluate --attempt <dir> --skip-judge` — guards in the
  evaluation container → `checks.json` (facts).
- `bench shell --attempt <dir> [-- <command>]` — your sandbox: a
  container from the task image with a copy of the preserved
  workspace at `/workspace` (original read-only, network and the
  dependency cache available, resource limits as in evaluation).
  With `-- <command>` it runs one command via `bash -lc` and returns
  its exit code; without, an interactive shell. Every execution of
  step 3 goes through it.
- `bench evaluate --attempt <dir> --verdict <file>` — folds your
  verdict into `result.json`.
- `bench status` — which preserved attempts still lack a fresh
  evaluation (batch mode).

## Procedure — single attempt

Input: the attempt directory (e.g.
`attempts/checkout-fix/openrouter-anthropic-claude-sonnet-5/trial-2`).

### 1. Read the attempt

`attempt.json` (metadata, flags — rule 6), `execution.json` (timeout?),
`metrics.json`, `patch.diff`, the task's `prompt.md` (the ONLY input the
agent saw) and the rubric(s) from `evaluation-pool/judge/` named in the
task's `evaluation[]`. Note the rubric's frontmatter weights — those
keys are your verdict's schema.

### 2. Guards first (facts)

```
bench evaluate --attempt <dir> --skip-judge
```

This runs the non-LLM assertions in the evaluation container and leaves
`checks.json` in the attempt directory (exit codes + log tails). Read
it. Tasks whose weights have no static/tests/e2e component simply skip
this step's evidence — the rubric still rules.

### 3. Investigate with tools

All execution goes through `bench shell` (rule 1) — e.g.
`bench shell --attempt <dir> -- npm test -- <file>`,
`bench shell --attempt <dir> -- 'npm run build 2>&1 | tail -40'`;
reading files can happen directly in `<dir>/workspace/` on the host.
Typical moves, in increasing cost — go only as deep as the rubric's
criteria require:

- read the final state of files the diff touched (the workspace shows
  the end state; the diff alone can hide deletions and leftovers),
- grep for the behaviours the criteria price (error handling, naming
  the prompt fixed, scope violations),
- run the narrow thing: the test file covering the change, the linter,
  a build — before running the world,
- for product-behaviour criteria: start the app/server and check the
  behaviour exists (curl / opening the route), not just that code
  resembling it exists.

Facts you could not verify (missing toolchain, app will not start) are
stated as such in justifications — never silently assumed true.
An attempt whose `workspace/` is missing (`bench shell` says so) was
executed on another machine: evaluation with tools runs where the
workspace lives — report it and stop rather than judging from the
diff alone.

### 4. Verdict JSON

Write the verdict to a scratch file (NOT into the attempt directory),
in the rubric's exact format. Justifications: one sentence per
criterion, citing the strongest evidence (a guard result, a command you
ran, a file:line). With several rubrics on one task, produce a map
`{ "<rubric-name>": <verdict>, … }`.

### 5. Fold into the results tree

```
bench evaluate --attempt <dir> --verdict <scratch-file>
```

The runner validates the verdict against the rubric (invalid = loud
error, fix the file), computes the total, writes `result.json` and
`judge.json` to the attempt AND to `results/<task>/<model>/trial-N/`.
Report the total and per-component scores. Committing `results/` is the
user's move — you never commit or push.

## Procedure — batch (a model, a task, or "everything new")

The unit above is one attempt; a batch is a thin loop over attempt
directories — `bench status` lists, per cell, how many preserved
attempts lack a fresh evaluation (result stamped with the current
task definition) and which are still running (skip those; `bench
attempt` may still be working in the background). For each attempt run the single-attempt procedure; with
subagent support, one subagent per attempt keeps verdicts independent
(they must not see each other — cross-attempt anchoring biases scores).
Summarize at the end: a table of attempt → total, skipped attempts with
reasons, guard failures worth escalating to bench-explain-results.

## Closing message

End with: a results table (attempt, guards, judge, total), where the
results landed (`results/…` paths, uncommitted), the evaluation-era
note (judge model + rubric versions this verdict is stamped with), and
one call to action — normally "review and commit results/, then the
leaderboard workflow picks them up on push".
