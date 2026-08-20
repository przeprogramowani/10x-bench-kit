# Task refresh PR template (bench-refresh-task)

Title: `bench-refresh-task: <task-name>`

```markdown
## Reason for the refresh

<the `expires` warning from bench validate (date), or the explicit
reason — e.g. the base repo drifted from the pin in the task's area.>

## Pin change

- old: `<SHA>` (from <date/context>)
- new: `<SHA>` (why this commit — e.g. latest green on CI)
- what happened between the pins in the task's area: <summary of
  `git log old..new -- <paths>`; "nothing" is also an answer>

## Sense verdict and adaptations

<sense unchanged / sense after adaptation / no longer makes sense (in
which case the PR retires the task). Per adaptation
(prompt/overlay/assertions/reference solution): what and why; the
task's intent unchanged. Shared assertions: new version in the pool,
no in-place edits.>

## Proofs from the new reference

<paste command outputs — not claims:>

- starting state: `bench assert --task <name>` → <result per assertion>
- overlay counter-proof: `--no-overlay` / reference solution → <result>
- reference solution: `bench assert --task <name> --patch <reference>`
  → <result>; judge on the reference solution → <result>
- empty diff does not pass: <result>
- `bench validate --assert` → 0 errors, no expires warning

## Comparability impact

<this opens a new era for this task (new task_hash) — existing results
remain as history; new ones are not comparable with them. Fate of the
judge's calibration set: ported and re-measured / belongs to the old
era, recalibration due at the next sign of drift.>

## New expires date

<date + horizon>

## Self-check cost

<cost of the trial run / judge calls (model, $), or "none — no models
were run".>
```
