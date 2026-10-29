---
name: bench-evaluate
description: >-
  Measures models on the benchmark's tasks on this machine: proves new
  tasks on their pin, runs the matrix (models × tasks × trials) within
  the budget with `bench attempt`, evaluates the preserved attempts
  with `bench evaluate` (guards + the API judge), and hands over the
  results with the `bench changes` commit plan. Use when the user says
  "run the benchmark / measure model X / evaluate the models / a new
  model came out / re-evaluate", or after bench-create-task when tasks
  are ready. Instance readiness is bench-status; what the numbers mean
  is bench-analysis.
---

# bench-evaluate — run and evaluate

The second of three skills: create task (bench-create-task) →
**evaluate** (this one) → analysis (bench-analysis).

Everything here is a runner command; you run them yourself, never hand
them to the user. `bench <command>` means `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` from the instance root
(one-time: `npm ci --prefix .bench-kit/runner`).

```
preflight → scope + cost → one subagent per attempt (attempt + evaluate) → hand over
```

## Hard rules

1. **Budget, not consent.** `defaults.max_cost_usd` caps the whole run;
   you project the cost before the first wave and stop dispatching
   once the reported spend passes the ceiling (step 3). Ask the user only when the
   projection exceeds the budget (narrow the matrix or raise the
   budget). Report the actual cost afterwards.
2. **Preserved attempts are sacred.** Never delete anything under
   `attempts/`. Top-up is the default: existing trials count toward
   `--trials`. `--force` needs a stated reason.
3. **Fix the cause, don't buy the failure again.** An attempt flagged
   `infra_failure` / `resource_kill` / `provider_error` gets a look at
   its `agent.log` and `container.log` before any re-run.
4. **No scoring edits mid-run.** Tasks, rubrics, weights and
   `bench.config.yaml` change before or after a run, never between its
   trials. A rubric edit bumps its `version`, then `bench evaluate`
   re-judges the preserved attempts; it never re-runs them.
5. **Zero git.** Results land in `results/`; the user commits them.

## Procedure

### 1. Preflight

- `bench doctor` and `bench validate`. Red → the bench-status skill.
- **New tasks** (`ready` in `bench backlog`, no attempts yet):
  `bench validate --assert --tasks <new tasks>`. One container pass, no
  model: repo guards must be green on the pin, `tests/<task>-pr` red.
  A task that fails stays out of the matrix; paste its output in the
  handover. A `-pr` guard that's green on the pin measures nothing; one
  that crashes needs a different install or test command
  (bench-create-task, BUILD.md step 2).

### 2. Scope and cost

Models: `defaults.models` unless the user names others (a model id's
prefix is its harness, so `claude-code:X` and `X` are separate
contestants). Tasks: all of `tasks/` unless narrowed. Trials:
`defaults.trials`. A new model is just `--models <new>`: the same
tasks, only its cells get filled.

`bench status` shows what's preserved, running and missing, and each
cell's cost so far. Projection = missing attempts × median cost per
attempt in that cell. A cell with no history uses the same model's
median on other tasks, and you mark that number as an estimate. Over
budget, stop and ask (rule 1).

### 3. Run — one subagent per attempt

An attempt is one `task × model × trial`. Each one runs in its own
subagent (cheap class: Sonnet/Haiku/Flash), so a crashed process, a
hung container or a lost shell kills that attempt only, never the
matrix. The runner already isolates attempts inside one process; this
isolates the process. A tool without subagents gets one detached
`bench attempt` process per attempt instead, with the same brief.

List the missing attempts from `bench status` (top-up: preserved
trials are not in it). Dispatch them in waves of `defaults.parallel`
(or `--parallel`). Put one attempt per task in the first wave, so each
task image gets built once instead of by several subagents at once.

Brief for each subagent (fill in `<task>`, `<model>`, `<n>` and
`<trial dir>` = `attempts/<task>/<model dir>/trial-<n>`, with the model
directory named as in `attempts/`):

```
Instance root: <root>. `bench` = node --experimental-strip-types
.bench-kit/runner/src/index.ts. Run exactly one attempt and evaluate it:
1. mkdir -p attempts/.logs; nohup bench attempt --tasks <task> --models <model> --trial-index <n>
     > attempts/.logs/<task>-<model dir>-<n>.log 2>&1 &
2. bench status --tasks <task> --models <model> --wait --timeout 540;
   repeat on exit 124 until it exits 0.
3. If <trial dir>/attempt.json is missing,
   or has infra_failure: true, stop and report it with the last 30
   lines of the log and of container.log or signal.json.
4. Otherwise: bench evaluate --attempt <trial dir>
5. Reply with ONE line: <task> | <model> | trial <n> | preserved/infra/
   timeout/provider_error | cost $ (metrics.json) | PASS/FAIL/eval error
   + pass_reason or error.
Do not retry, do not use --force, do not delete or edit any file,
do not touch git.
```

Subagents only run and report; decisions stay with you. After each
wave, add up the reported costs. Once the spend passes
`defaults.max_cost_usd`, dispatch no more waves (rule 1). Running
attempts finish on their own. An infra failure is not retried in the
next wave. Look at it first (rule 3), then commission it again with
`--trial-index n --force` and a stated reason.

`bench status` stays the source of truth: a subagent that never
replies leaves a cell that reads STALE or still running there. Read
its log under `attempts/.logs/`; the next dispatch redoes that trial.

### 4. Evaluate

Each subagent evaluates its own attempt (`bench evaluate --attempt …`):
guards in a container, then the API judge on the diff, results in
`results/<task>/<model>/trial-N/`. An evaluation error stays with
that attempt. Once the cause is fixed, re-run
`bench evaluate --attempt <dir>` for it; a bare `bench evaluate`
re-evaluates every preserved attempt. Pass is a gate: every guard with
weight > 0 green **and** the judge ≥ `pass_threshold`.

On a task's first run, read 2–3 `patch.diff`s against their verdicts.
A rubric that ranks them wrong is a rubric fix (rule 4). A guard no
model ever turns green is flagged as a possible task fault, not
reported as a model result.

### 5. Hand over

- `bench status`: per task × model, passes `k/n` and cost.
- Actual spend vs budget.
- Attempts skipped for infra reasons, with the reason.
- Tasks kept out by the preflight, with the pasted output.
- `bench changes`: paste its commit plan.
- Next step: **bench-analysis** for what the numbers mean.
