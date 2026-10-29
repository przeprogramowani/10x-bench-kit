# Build report template — `reports/<task-name>-build.md`

A file, not a chat message. It lives outside `tasks/` so it never
enters `task_hash` or the agent's workspace. It's what the user reads
before committing, and what bench-evaluate reads before the first run
(and again when failures cluster on one hidden case).

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

## Guard audit

<BUILD.md step 5: one row per assertion group of every case the change
added or edited. Source is a quoted sentence of prompt.md, "pin:
<existing behaviour>", or "reference" (then Decision says what was done
about it). Kind is behaviour, an edge (empty / all / limit / partial
state / error path / order), or a shape kind from MINING.md §3.>

| File › case | Asserts | Kind | Source | Decision |
|---|---|---|---|---|
| <file › test name> | <what, in a few words> | <kind> | <"…" / pin: … / reference> | <keep / stated in prompt / loosened: how / dropped> |

<Then: every edit to a copied test with its reason (it carries a
`bench:` comment in the file); the case you're least sure a correct
but different implementation passes, so the first run's check starts
there. Post-run fixes append a dated line here (BUILD.md, "After the
first run").>

## Rubric

<criterion → weight → source axis in the order; the criterion you're
least sure the judge will resolve, so the first run's spot-check starts
there>

## Weights

<evaluation[] with weights and reference declarations>

## Validate

<pasted `bench validate` summary line>
```
