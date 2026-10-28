# Build report template — `reports/<task-name>-build.md`

A file, not a chat message. It lives outside `tasks/` so it never
enters `task_hash` or the agent's workspace. It's what the user reads
before committing, and what bench-evaluate reads before the first run.

```markdown
# <task-name>

## Source

<base repo · pin <full SHA> · reference <full SHA> (#<PR>) · class ·
guidance level · time limit in minutes>

## Files

<every path created: tasks/<name>/…, evaluation-pool/tests/<name>-pr/…,
evaluation-pool/judge/<name>-rubric.md>

## Hidden tests

<test files used, files or cases dropped and why; Coupled names and the
sentence of prompt.md that states each one; the install and test
commands the guard runs>

## Rubric

<criterion → weight → source axis in the order; the criterion you're
least sure the judge will resolve, so the first run's spot-check starts
there>

## Weights

<evaluation[] with weights and reference declarations>

## Validate

<pasted `bench validate` summary line>
```
