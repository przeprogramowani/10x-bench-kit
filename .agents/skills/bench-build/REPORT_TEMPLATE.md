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
backlog order), the time limit in minutes and its justification. Human-in-the-loop scan
(step 3 of TASK_AUTHORING): which documents the prompt points the agent
at were scanned for instructions presupposing an interactive human, and
what the prompt overrides — or "none found".>

## Evidence from the starting state (subagent)

- guards you created: `bench assert <ref> --task <name>` → <pasted
  result>; guards reused from the pool on the batch pin: "reference:
  pass — proven at the batch gate" (no container entry of your own)
- overlay counter-proof (bugfix tasks): `bench assert <ref> --task
  <name>` → red, `--no-overlay` → green; for an overlay adding files —
  the bug-inverse probe: `--patch <probe.diff>` → <result> + the probe
  diff pasted here (the file itself is deleted at handoff)
- an empty diff does not pass: <judge verdict; for a guard-observed
  bugfix seed also the red guard>
- `bench validate --offline` → 0 errors

## Batch gate (orchestrator)

<left as this placeholder by the subagent; the orchestrator pastes
here, once for the batch: `bench validate --assert` → <result for this
task's reference declarations>; smoke attempt `bench attempt --smoke`
+ `bench evaluate --no-write-results` → <result per component, or
"deferred — no secrets in the session">. The smoke run is the
solvability probe — an assertion no attempt greens is flagged
suspect-harness here, not counted against models.>

## Shape-neutrality checklist

<per scripted assertion: the repo-native commands it runs;
confirmation it encodes no implementation shape (no paths, symbols,
grep discovery, copied-in test files, forced environments — paths the
prompt fixes verbatim are the only exception); how pre-existing repo
problems are not punished; dependency self-install.>

## Rubric

<for tasks with a judge component — the task's main assertion
artifact, written per RUBRIC_AUTHORING.md: the rubric's path
(`evaluation-pool/judge/<name>-rubric.md`, version 1); a table
criterion → weight → source axis in the order (every axis covered, no
criterion without a source); how decisive axes dominate and how
milestones map to partial credit; for phased orders, where
incompletion is priced (once, in the completion criterion) and how
property criteria grade the fragment that exists; the repo asymmetries
the rubric encodes; the read-only checklist results (floor clauses,
impact anchors, no completion bleed, format contract); the empty-diff
verdict pasted from `bench judge`. The rubric is calibrated by the
first real attempts — say so, and name which criterion you are least
sure the judge will resolve, so the first measurement's manual
spot-check starts there.>

## Assertions and weights

<per assertion: reused from the pool or new, its reference declaration
(pass/fail) and why; weights with justification — what each component
actually discriminates. If you deviated from the orchestrator's
assertion decision (reuse instead of new or vice versa) — say so
explicitly, so the orchestrator can close out a possible duplicate in
the pool.

Per assertion also state its **counter-proof** (SKILL.md rule 10) —
red on the starting state / red on a deliberate break (paste the
failing output) / cannot go red → weight 0 with a note. "Green at the
start" is not a counter-proof: a guard that is green before the agent
runs and green whatever it does carries no information, and its weight
belongs to the judge explicitly rather than by accident.>

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
and time limit; the smoke run's actual cost, when available, is the best
anchor), compared against defaults.max_cost_usd — remember the budget
covers the whole run, so a batch shares it across all its tasks. If the
projection does not fit: say so explicitly and recommend the mitigation
(single-model smoke dispatch first, or a budget raise — which stays a
human decision). A truncated matrix wastes the spend and produces a
partial, misleading leaderboard; this section is what lets the user see
that before dispatching.

State per model **how many trials the budget actually buys**, not just
the matrix total. The decision this task feeds (the order's Decision
field) rests on a pass rate, and a pass rate needs trials: n=2 supports
"this model can do the task", never "it does it reliably". Where an
expensive model's trial cost means the budget buys only two or three,
say it plainly and recommend the asymmetric split — many trials where
they cost cents, an existence proof where they cost dollars. That is a
better use of the same ceiling than an even matrix in which no cell is
measured well enough to act on.>
```
