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
attempts) → evaluation (rate-attempt / API judge) → results table →
user commits results/
```

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

Run `bench attempt` — it prints the projection before executing. If
the projection exceeds the budget, stop at the printed warning and put
the decision to the user (rule 2). Cells without cost history (first
measurement of a pair) are flagged in the projection as unknown — say
so rather than pretending precision.

### 3. Execute

`bench attempt --tasks … --models … [--trials n] [--parallel n]`.
Long runs: report progress as trials complete (the runner logs each),
and after the run summarize per cell: completed / timeout / failed,
with cost so far. New models or tasks with no rubric calibration yet:
flag it — scores will be provisional until bench-rubric runs.

### 4. Evaluate

- **Default (real tasks): rate-attempt per attempt** — the
  judge-with-tools; launch it per the rate-attempt skill (subagent per
  attempt where available, verdicts independent). It runs guards
  (`bench evaluate --skip-judge`), investigates the preserved
  workspace, and folds its verdict via `bench evaluate --verdict`.
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
