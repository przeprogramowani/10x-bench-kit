---
name: bench-measure
description: >-
  Runs a measurement of the benchmark matrix on this machine: scopes
  models × tasks × trials, projects the cost against the run budget,
  executes `bench attempt` (preserved attempts, top-up semantics),
  drives evaluation (rate-attempt per attempt, or the API judge for
  small/smoke runs) and hands the user a reliability-first results
  table (pass rate with interval, cost as a column) plus the
  `results/` paths to commit. Use when the user says "run the
  benchmark / measure model X / benchmark task Y / add a new model to
  the leaderboard", or after bench-build when tasks are ready to
  measure.
---

# bench-measure — the measurement loop

You are the operator's hands for a matrix run. The user's surface is
consent, the config, and git — **never `bench …` commands**: you run
the runner yourself (from the instance root:
`node --experimental-strip-types .bench-kit/runner/src/index.ts
<command>`, hereafter `bench <command>`; one-time prerequisite
`npm ci --prefix .bench-kit/runner`).

**The deliverable of a run is a pass rate with an interval, per
(task × model) — not a median score.** Everything below is ordered by
that: how many trials a cell needs, when to stop buying them, and what
the handover is allowed to claim. A median says how good a *successful*
attempt was; a pass rate says how often you get one. Only the second
one routes work, and it is the number the smallest samples get most
wrong.

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

1. **Reliability is the unit; cost is a tiebreaker.** Never rank or
   recommend models by median score or by price across cells whose
   pass-rate intervals do not overlap. A cheaper model that fails more
   often is not "cheaper per result" in any sense the operator can
   act on until you have priced the retry AND the review of the
   failures (see rule 11). State every pass rate as `k/n` with its
   95% interval, never as a bare percentage.
2. **Validate before you spend.** `bench validate` must be green before
   the first attempt of a session — a broken instance burns provider
   money on trials that cannot be evaluated.
3. **Budget instead of a consent ritual.** `defaults.max_cost_usd` caps
   the WHOLE matrix run; `bench attempt` projects the cost from
   `results/` history before starting and stops commissioning trials
   past the ceiling. Do not ask permission per launch — ask only when
   the projection exceeds the budget (options: narrow the matrix, or
   the user raises the budget) and report the actual cost afterwards.
4. **Preserved attempts are sacred.** Top-up is the default (existing
   attempts count toward `--trials`); `--force` re-runs set the old
   attempt aside (`trial-N.superseded-*`) and need a stated reason.
   Never delete anything under `attempts/`.
5. **Failures are triaged, not re-bought.** An attempt flagged
   `infra_failure` / `resource_kill` / `provider_error` (after its
   built-in retry) is a diagnosis first (`agent.log`,
   `container.log`, `signal.json`), a re-run second — a blind re-run
   repeats the same failure and the same invoice. Surprising *scores*
   go to bench-explain-results, not to another run.
6. **You never commit or push.** Results land in
   `results/<task>/<model>/trial-N/` — reviewing and committing them
   is the user's move, and only committed results feed the leaderboard.
7. **Do not touch scoring while measuring.** No edits to tasks,
   rubrics, weights, or the config mid-run — that would fork the era
   between trials of the same run. Config changes go through
   bench-wiring, rubric edits through bench-build's RUBRIC_AUTHORING.md
   (version bump + re-evaluation) — before or after a measurement.
8. **Long runs are detached, never awaited in the foreground.** A
   matrix run is hours of mostly waiting on provider APIs; start it
   detached (a `tmux` session or `nohup … > <log> &`) and come back
   with `bench status`. Never sit blocking on the runner's stdout,
   and never re-launch a cell that `bench status` shows as running —
   the marker exists precisely so a second launch skips it.
9. **Evaluate where the workspace lives.** Attempt metadata travels
   through git; `workspace/` does not. rate-attempt (and `bench
   shell`) run on the machine that executed the attempt.

10. **A cell with fewer than 3 trials makes no reliability claim.**
   Report it as measured-but-unresolved and say so in the handover: at
   n=2 a perfect cell and a coin flip are the same evidence. This is a
   reporting rule, not a spending mandate — an expensive model may
   legitimately stop at n=2 (the existence proof in step 3), but then
   the conclusion stops there too.

11. **Price the failures, not just the trials.** Expected cost per
   acceptable result (`cost ÷ pass rate`) assumes a retry costs only
   tokens. Before handing that number over, check how a failure
   *presents*: if the execution guards are green on it, the cost of
   catching it lands on human review and the arithmetic understates
   the true price. Say which of the two worlds the run is in — it
   routinely flips the recommendation.

## Procedure

### 1. Scope

Establish the matrix from the request and the instance state: which
models (`defaults.models` unless the user names others), which tasks
(all of `tasks/` unless narrowed), how many trials
(`defaults.trials`) — and treat that trial count as a **floor set by
the reliability you need to claim**, not as the scope. If the run is
meant to answer "which model do we route this to", a matrix of n=2
cells cannot answer it at any budget; say that at scoping time rather
than at handover. Check what already exists — `bench attempt` will
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
`trial-N.aborted-*` and redoes the trial. **A task's first measurement
is its rubric's calibration**: flag the tasks measured for the first
time — their build report names the criterion to spot-check first —
and read 2–3 of their `patch.diff`s against the verdicts before
treating the numbers as settled. A disagreement is a rubric edit
(RUBRIC_AUTHORING.md, version bump if results were written) followed by
re-evaluation of the preserved attempts, never a re-run.

**Spend trials where they buy information.** `defaults.trials` is a
floor, not a quota to apply evenly. Trial cost across models of one
matrix differs by one to two orders of magnitude, and the number the
decision rests on — the pass rate — needs samples:

- **Cheap models deserve more.** At cents per trial, going from 2 to 5
  or 8 trials costs less than one trial of the expensive model and
  turns "it passed twice" into a usable failure rate. `bench attempt`
  tops up, so this is a second invocation with a higher `--trials`,
  not a fresh matrix.
- **Expensive models deserve an existence proof, then an exit.** Once
  a model has failed every trial it has been given and its per-trial
  cost dominates the budget, further trials buy precision about a
  model already out of contention. Stop, and say that it stopped for
  economic reasons rather than reporting it as fully measured.
- **"Both pass everything" at n=2 is not a tie — it is two unmeasured
  cells.** Two-for-two gives a 95% interval of roughly 0.34–1.00: it
  cannot distinguish a model that always works from one that works two
  times in three. Resolving such a pair on price is the single most
  common way this skill produces a wrong recommendation. Buy trials
  until the intervals separate, or hand over the tie *as a tie* with
  both intervals printed. Price decides only between cells whose
  reliability is genuinely comparable.
- **Keep the sample symmetric enough to compare.** Topping up only the
  cheap side is the natural move (it is affordable) and it quietly
  produces a well-measured cheap model against a barely-measured
  expensive one — an asymmetry that flatters whichever side has fewer
  trials, because small samples cannot show failures. If you top up
  one side, say so explicitly in the handover and name what the
  comparison therefore cannot support.

Say which split you used and why — an even matrix in which no cell has
enough trials to act on is a worse use of the same ceiling.

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

- **a reliability table first**: task × model → `k/n` passes, pass rate
  with its 95% interval, cost per trial, cost per acceptable result —
  ordered by reliability, with cost as a column rather than a ranking
  key. The per-trial detail (guards, judge, total, cost, duration)
  goes below it, not above; `bench report --run results/` gives the
  aggregate when the run spans many cells. Never lead with a median:
  it is the answer to a question nobody is routing work on.
- **what a failure looks like**, for every model that failed at least
  once: whether the execution guards caught it or it shipped green
  (rule 11). A failure mode that passes lint, types, build and the
  suite is a review cost, and it belongs next to the price, not in a
  footnote;
- the exact `results/…` paths that are new/changed, **uncommitted** —
  the user reviews and commits; the leaderboard workflow rebuilds on
  push;
- actual spend vs budget;
- **which guard components discriminated nothing**, if any — a
  component scoring identically across every attempt of the run told
  you nothing at its weight, and that is a finding about the task
  (bench-build rule 10), not about the models;
- **which comparisons this sample cannot support** — name them. Cells
  under 3 trials (rule 10), pairs whose intervals overlap, and any
  side of the matrix that got fewer trials than the other. This is the
  part an operator cannot reconstruct from the numbers and the part
  they will otherwise assume away;
- next step: **bench-summary** when the question behind the run was
  "which model do we use for this work" — it computes the economics
  deterministically (cost per acceptable result, ties reported as
  ties) and renders the one-page verdict; bench-explain-results for
  surprises; bench-rubric if judge verdicts on similar diffs look
  unstable (it calibrates on the attempts just preserved); more trials
  on the cheap models when a pass rate is still thin (step 3); or
  nothing — a clean measurement is a finished job.
