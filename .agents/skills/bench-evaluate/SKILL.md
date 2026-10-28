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
preflight → scope + cost → bench attempt (detached) → bench evaluate → hand over
```

## Hard rules

1. **Budget, not consent.** `defaults.max_cost_usd` caps the whole run;
   `bench attempt` projects the cost before it starts and stops
   commissioning past the ceiling. Ask the user only when the
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

`bench status` shows what's preserved, running and missing. The
projection printed by `bench attempt` is what you'll pay; over budget,
stop and ask (rule 1).

### 3. Run

```
nohup bench attempt --tasks … --models … [--trials n] [--parallel n] > <log> 2>&1 &
bench status --wait [--timeout <s>]
```

Always detached; re-issue `bench status --wait` on exit 124 (timeout).
Several processes (one per model, another machine) can fill the same
matrix: each attempt is claimed on disk before it starts. A cell marked
STALE means a runner process died; read its log, then the next
`bench attempt` redoes that trial.

### 4. Evaluate

`bench evaluate`: guards in a container, then the API judge on the
diff, results written to `results/<task>/<model>/trial-N/`. It can run
while other cells are still going. Pass is a gate: every guard with
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
