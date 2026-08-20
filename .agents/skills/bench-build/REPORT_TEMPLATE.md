# Task report template (bench-build)

The task remains as **files in the working tree** — the subagent does
nothing in git. The report takes over the role of a change description:
it carries the evidence, and it is what the user will build an eventual
commit message or PR description from, once they decide what happens
next. The sections below are mandatory — paste command outputs, not
declarations.

```markdown
# <task-name>

## Files

<full list of created/changed paths: tasks/<name>/…, new assertions in
evaluation-pool/…, the calibration set in
evaluation-pool/judge/<task>-calibration/…; without todo.md — you
delete the progress file when handing off the work>

## What the task measures

<type: implementation / bugfix / refactor / documentation; one intent.
Base repo, pin (SHA + why this commit), prompt guidance level
(product-level / directional / surgical — the user's decision from the
backlog order), timeout and its justification.>

## Evidence from the reference

- starting state: `bench assert --task <name>` → <result per assertion>
- clean reference (tasks with an overlay): `bench assert --task <name>
  --no-overlay` → <result>
- reference solution: `bench assert --task <name> --patch <reference>`
  → <result>
- an empty diff does not pass: <work-measure result / judge verdict>
- `bench validate --assert` → 0 errors

## Assertions and weights

<per assertion: reused from the pool or new, its reference declaration
(pass/fail) and why; weights with justification — what each component
actually discriminates. If you deviated from the orchestrator's
assertion decision (reuse instead of new or vice versa) — say so
explicitly, so the orchestrator can close out a possible duplicate in
the pool.>

## Comparability impact

<a new task = a new era for this task (task_hash). If the changes also
touch existing assertions in the pool or rubrics: which previous
results stop being comparable.>

## Self-check cost

<cost of the trial run / judge calls (model, $), or "none — no models
were run".>
```
