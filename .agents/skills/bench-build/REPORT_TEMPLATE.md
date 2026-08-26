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
evaluation-pool/…; without todo.md or working proof diffs — you delete
those when handing off the work>

## What the task measures

<type: implementation / bugfix / refactor / documentation; one intent.
Base repo, pin (SHA + why this commit), prompt guidance level
(product-level / directional / surgical — the user's decision from the
backlog order), timeout and its justification.>

## Evidence from the starting state

- starting state: `bench assert --task <name>` → <result per assertion>
- overlay counter-proof (bugfix tasks): `bench assert --task <name>
  --no-overlay` → <result>; for an overlay adding files — the
  bug-inverse probe: `--patch <probe.diff>` → <result> + the probe
  diff pasted here (the file itself is deleted at handoff)
- an empty diff does not pass: <work-measure result / judge verdict>
- `bench validate --assert` → 0 errors
- smoke run: <result per component, or "deferred — no secrets in the
  session"; the smoke run is the solvability probe — an assertion no
  attempt greens is flagged suspect-harness here, not counted against
  models>

## Hidden-test robustness checklist

<per hidden test: which prompt/plan-fixed surfaces it depends on (and
where they are fixed verbatim); how agent-chosen names are avoided or
discovered dynamically; the environment canary; dependency
self-install.>

## Criteria digest for bench-rubric

<only for tasks with a judge component: per evaluation axis from the
order — the concrete, greppable signals in this repo (paths, symbols,
patterns) that distinguish compliance from violation; milestone map
for partial credit if the order defines phases. bench-rubric builds
the rubric and its synthetic calibration set from this.>

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
