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
(prompt/overlay/assertions/calibration set): what and why; the
task's intent unchanged. Shared assertions: new version in the pool,
no in-place edits.>

## Proofs from the new starting state

<paste command outputs — not claims:>

- starting state: `bench assert --task <name>` → <result per assertion>
- overlay counter-proof: `--no-overlay` green, or bug-inverse probe
  green (`--patch <probe.diff>`, probe diff pasted here) → <result>
- shape-neutrality review on the new pin: <repo-native commands
  re-checked against the new pin's toolchain; findings>
- empty diff does not pass: <result>
- `bench validate --assert` → 0 errors, no expires warning
- smoke run on the new pin: <result per component; assertions no
  attempt greens are diagnosed, not shipped>

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
