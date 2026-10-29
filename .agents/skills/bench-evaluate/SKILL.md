---
name: bench-evaluate
description: >-
  Measures models on the benchmark's tasks on this machine: proves new
  tasks on their pin, starts the matrix (models × tasks × trials) as a
  supervised background run with `bench run` (one process per attempt,
  each attempt evaluated by `bench evaluate` right after it, the budget
  enforced live), reports its progress without blocking, and hands
  over the results with the `bench changes` commit plan. Use when the user says
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
preflight → scope + cost → bench run (background; status on demand) → hand over
```

## Hard rules

1. **Budget, not consent.** `defaults.max_cost_usd` (or `--max-cost`)
   caps the whole run, and `bench run` enforces it: it refuses to start
   when the projection exceeds the budget (exit 3), and once finished
   plus live cost passes the ceiling it stops dispatching and stops the
   running attempts. Exit 3 is the one moment to ask the user: narrow
   the matrix or raise the budget. Report the actual cost afterwards.
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

### 3. Run — `bench run`, never block the turn

```
bench run [--tasks x,y] [--models a,b] [--trials n] [--parallel n] [--max-cost <usd>]
```

It plans the missing attempts (top-up: preserved trials are skipped),
checks the budget (rule 1), starts a detached supervisor and returns a
run id within a second. Report the id, the attempt count and the
projection, then hand the turn back. The supervisor builds the images
once, runs **one `bench attempt` process per attempt** (a crash, OOM
or hang ends that attempt, never the matrix), admits attempts by free
engine memory, and evaluates each preserved attempt right after it.

When the user asks how it's going, read `bench run status --json`
(or the table without `--json`). Per attempt it shows the phase
(`queued` → `starting` → `running` → `eval-queued` → `evaluating` →
`done` / `failed` / `cancelled`), the agent's last activity, live
`~$` cost, why a queued attempt is waiting, and a "BRAK PULSU" warning
when an attempt has been silent for over 2 minutes. `--watch` is for a
human at a terminal; never use it, or `bench status --wait`, to hold
your own turn open.

- **Control:** `bench run pause|resume|cancel [<id>]`. A cancel or a
  budget stop interrupts running attempts with SIGINT. They're
  preserved with `attempt.json.stopped` (the money is spent and the
  artifacts stay), but they're excluded from evaluation and still count
  toward `--trials`. Re-run one only on purpose, with
  `bench attempt --trial-index n --force` and a stated reason.
- **Supervisor died** (`SUPERVISOR NIE ODPOWIADA` in status, e.g. after
  a reboot or a killed shell): `bench run resume <id>`. The new
  supervisor rebuilds the state from disk, adopts attempts that are
  still running, evaluates preserved ones, and requeues the rest.
- **Failed attempt:** its reason is in the status row, the full log
  in `attempts/.runs/<id>/jobs/`. An infra failure isn't retried
  automatically. Look at it first (rule 3).
- `bench status` stays the source of truth for the matrix as a whole.
  It lists running attempts with their activity and cost, evaluations
  in progress, and active `bench run`s.

### 4. Evaluate

Evaluation is automatic under `bench run` (`--no-evaluate` turns it
off): guards in a container, then the API judge on the diff, results
in `results/<task>/<model>/trial-N/`. An evaluation error stays with
that attempt. Once the cause is fixed, run
`bench evaluate --attempt <dir>` for it. A bare `bench evaluate` is
for re-evaluation: it re-judges every preserved attempt, e.g. after a
rubric bump (rule 4). Pass is a gate: every guard with weight > 0
green **and** the judge ≥ `pass_threshold`.

On a task's first run, read 2–3 `patch.diff`s against their verdicts.
A rubric that ranks them wrong is a rubric fix (rule 4). A guard no
model ever turns green is flagged as a possible task fault, not
reported as a model result. So are failures that cluster on one hidden
case across models in attempts the judge scores high: check the case
against `prompt.md` and the build report's Guard audit, then fix it per
bench-create-task BUILD.md, "After the first run" (a pool fix plus
re-evaluation; a prompt fix needs new attempts).

### 5. Hand over

- `bench status`: per task × model, passes `k/n` and cost.
- Actual spend vs budget.
- Attempts skipped for infra reasons or stopped (cancel / budget), with
  the reason.
- Tasks kept out by the preflight, with the pasted output.
- `bench changes`: paste its commit plan.
- Next step: **bench-analysis** for what the numbers mean.
