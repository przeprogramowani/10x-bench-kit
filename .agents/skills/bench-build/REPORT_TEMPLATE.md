# Task report template (bench-build)

The task remains as **files in the working tree** — the subagent does
nothing in git. The report takes over the role of a change description:
it carries the evidence, and it is what the user will build an eventual
commit message or PR description from, once they decide what happens
next. The sections below are mandatory — paste command outputs, not
declarations.

**The report is a file, not a message.** Write it to
`reports/<task-name>-build.md` at the instance root (create `reports/`
if absent) — deliberately **outside** `tasks/<name>/`, so it never
enters `task_hash` and never leaks into an agent's workspace, and
outside `evaluation-pool/`, because it is a change description, not
evaluation material. A report that exists only in a chat message
evaporates at handoff and leaves the `reference` declarations in
task.yaml as exactly the kind of unverifiable claim this benchmark
forbids. The subagent's final message to the orchestrator is a pointer
to the file plus problems encountered — never the report's only copy.

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
backlog order), timeout and its justification. Human-in-the-loop scan
(step 3 of TASK_AUTHORING): which documents the prompt points the agent
at were scanned for instructions presupposing an interactive human, and
what the prompt overrides — or "none found".>

## Evidence from the starting state

- starting state: `bench assert --task <name>` → <result per assertion>
- overlay counter-proof (bugfix tasks): `bench assert --task <name>
  --no-overlay` → <result>; for an overlay adding files — the
  bug-inverse probe: `--patch <probe.diff>` → <result> + the probe
  diff pasted here (the file itself is deleted at handoff)
- an empty diff does not pass: <judge verdict; for a guard-observed
  bugfix seed also the red guard>
- `bench validate --assert` → 0 errors
- smoke run: <result per component, or "deferred — no secrets in the
  session"; the smoke run is the solvability probe — an assertion no
  attempt greens is flagged suspect-harness here, not counted against
  models>

## Shape-neutrality checklist

<per scripted assertion: the repo-native commands it runs;
confirmation it encodes no implementation shape (no paths, symbols,
grep discovery, copied-in test files, forced environments — paths the
prompt fixes verbatim are the only exception); how pre-existing repo
problems are not punished; dependency self-install.>

## Criteria digest for bench-rubric

<the task's main assertion artifact, for tasks with a judge component:
per evaluation axis from the order — what a good implementation looks
like and what a bad one looks like, in behavioural terms (never exact
paths/symbols unless the prompt fixes them verbatim), plus the
concrete signals in this repo that distinguish compliance from
violation; milestone map for partial credit if the order defines
phases. For phased orders, also name which property axes only become
observable in a later phase — bench-rubric needs this to price
incompletion once (in the completion criterion), not again in every
property criterion an unfinished attempt cannot reach.
bench-rubric builds the rubric and its synthetic calibration
set from this.>

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

## Full-run cost projection

<rough cost of one full matrix for this task: defaults.trials ×
defaults.models × expected trial cost (anchor it on the task's scale
and timeout; the smoke run's actual cost, when available, is the best
anchor), compared against defaults.max_cost_usd — remember the budget
covers the whole run, so a batch shares it across all its tasks. If the
projection does not fit: say so explicitly and recommend the mitigation
(single-model smoke dispatch first, or a budget raise — which stays a
human decision). A truncated matrix wastes the spend and produces a
partial, misleading leaderboard; this section is what lets the user see
that before dispatching.>
```
