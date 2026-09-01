---
name: bench-measure
description: >-
  Runs a measurement of the benchmark matrix on this machine: scopes
  models × tasks × trials, projects the cost against the run budget,
  executes `bench attempt` (preserved attempts, top-up semantics),
  drives evaluation (rate-attempt per attempt, or the API judge for
  small/smoke runs) and hands the user a results table plus the
  `results/` paths to commit. Use when the user says "run the
  benchmark / measure model X / benchmark task Y / add a new model to
  the leaderboard", or after bench-build/bench-rubric when tasks are
  ready to measure.
---

# bench-measure — the measurement loop

You are the operator's hands for a matrix run. The user's surface is
consent, the config, and git — **never `bench …` commands**: you run
the runner yourself (from the instance root:
`node --experimental-strip-types .bench-kit/runner/src/index.ts
<command>`, hereafter `bench <command>`; one-time prerequisite
`npm ci --prefix .bench-kit/runner`).

The loop you own end to end:

```
scope matrix → project cost vs budget → bench attempt (preserved
attempts, detached) → bench status → evaluation of what is done
(rate-attempt / API judge) → results table → user commits results/
```

The loop is non-blocking by construction: attempts are claimed on
disk (`running.json`) before their container starts, so several
`bench attempt` processes — one per model, one in the background, one
on another machine sharing the tree through git — top up the same
matrix without coordination, and evaluation picks up whatever has
finished. `bench status` is the tracker: it reads `attempts/` and
`results/` and shows per cell what is preserved, running, stale, and
evaluated.

## Hard rules

1. **Validate before you spend.** `bench validate` must be green before
   the first attempt of a session — a broken instance burns provider
   money on trials that cannot be evaluated.
2. **Budget instead of a consent ritual.** `defaults.max_cost_usd` caps
   the WHOLE matrix run; `bench attempt` projects the cost from
   `results/` history before starting and stops commissioning trials
   past the ceiling. Do not ask permission per launch — ask only when
   the projection exceeds the budget (options: narrow the matrix, or
   the user raises the budget) and report the actual cost afterwards.
3. **Preserved attempts are sacred.** Top-up is the default (existing
   attempts count toward `--trials`); `--force` re-runs set the old
   attempt aside (`trial-N.superseded-*`) and need a stated reason.
   Never delete anything under `attempts/`.
4. **Failures are triaged, not re-bought.** An attempt flagged
   `infra_failure` / `resource_kill` / `provider_error` (after its
   built-in retry) is a diagnosis first (`agent.log`,
   `container.log`, `signal.json`), a re-run second — a blind re-run
   repeats the same failure and the same invoice. Surprising *scores*
   go to bench-explain-results, not to another run.
5. **You never commit or push.** Results land in
   `results/<task>/<model>/trial-N/` — reviewing and committing them
   is the user's move, and only committed results feed the leaderboard.
6. **Do not touch scoring while measuring.** No edits to tasks,
   rubrics, weights, or the config mid-run — that would fork the era
   between trials of the same run. Config changes go through
   bench-wiring/bench-rubric, before or after a measurement.
7. **Long runs are detached, never awaited in the foreground.** A
   matrix run is hours of mostly waiting on provider APIs; start it
   detached (a `tmux` session or `nohup … > <log> &`) and come back
   with `bench status`. Never sit blocking on the runner's stdout,
   and never re-launch a cell that `bench status` shows as running —
   the marker exists precisely so a second launch skips it.
8. **Evaluate where the workspace lives.** Attempt metadata travels
   through git; `workspace/` does not. rate-attempt (and `bench
   shell`) run on the machine that executed the attempt.

## Procedure

### 1. Scope

Establish the matrix from the request and the instance state: which
models (`defaults.models` unless the user names others), which tasks
(all of `tasks/` unless narrowed), how many trials
(`defaults.trials`). Check what already exists — `bench attempt` will
top up, so tell the user upfront which cells are already covered.
Gate: `bench validate` (rule 1); doctor first if the environment looks
cold (engine down, keys missing).

### 2. Projection and consent

Run `bench status` first: it shows what is already preserved, what
another process is still running, and how many trials each cell is
missing — that is the scope you will actually pay for. Then run
`bench attempt` — it prints the projection before executing. If
the projection exceeds the budget, stop at the printed warning and put
the decision to the user (rule 2). Cells without cost history (first
measurement of a pair) are flagged in the projection as unknown — say
so rather than pretending precision.

### 3. Execute

`bench attempt --tasks … --models … [--trials n] [--parallel n]`,
detached (rule 7); a matrix can be split into several processes
(e.g. one per model) — they will not collide. Progress: `bench
status` (running cells with elapsed time, preserved counts) plus the
runner log of each process; after the run summarize per cell:
completed / timeout / failed, with cost so far. A cell `bench status`
marks as STALE (a marker older than timeout + 15 min) means a runner
process died — diagnose the log before re-launching; the next
`bench attempt` sets the partial directory aside as
`trial-N.aborted-*` and redoes the trial. New models or tasks with no rubric calibration yet:
flag it — scores will be provisional until bench-rubric runs.

### 4. Evaluate

Evaluate what `bench status` shows as preserved without a fresh
evaluation — this can start while other cells are still running.

- **Default (real tasks): rate-attempt per attempt** — the
  judge-with-tools; launch it per the rate-attempt skill (subagent per
  attempt where available, verdicts independent). It runs guards
  (`bench evaluate --skip-judge`), investigates the preserved
  workspace in a container (`bench shell`), and folds its verdict via
  `bench evaluate --verdict`.
- **Smoke / demo / explicitly cheap runs**: plain `bench evaluate`
  (API judge) is acceptable — say which judge path produced the
  numbers, because they are not interchangeable in interpretation.

Skipped attempts (infra flags) are listed with their reason — rule 4.

### 5. Hand over

Close with:

- a table: task × model × trial → guards, judge, total, cost, duration
  (aggregate view via `bench report --run results/` when the run spans
  many cells);
- the exact `results/…` paths that are new/changed, **uncommitted** —
  the user reviews and commits; the leaderboard workflow rebuilds on
  push;
- actual spend vs budget;
- next step: bench-explain-results for surprises, bench-rubric if
  judge verdicts look unstable, or nothing — a clean measurement is a
  finished job.
