---
name: bench-rubric
description: >-
  Calibrates the benchmark's LLM-as-judge rubric on diffs of known
  quality: builds a calibration set, measures the judge's resolution
  and stability, iterates on the criteria, and finalizes with a PR that
  bumps the rubric version. Use when creating a rubric for a new task,
  when judge scores look random or drift, or when the user says
  "calibrate the rubric / the judge".
---

# bench-rubric — judge calibration

A rubric without calibration is a number generator, not an evaluation.
You calibrate it empirically: the judge gets diffs whose quality you
**know in advance**, and you check whether its ranking and values match
yours — repeatably. The tool is `bench calibrate --task <name> --set
<set-directory>` (from the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts calibrate …`) — the same evaluation path
as `bench evaluate`, so calibration results transfer 1:1 to real runs.
The runner does the arithmetic (repeats, min/med/max, spread, appending
the round to `results.json`); your contribution is judgment: designing
the set, assessing ranking and separation, deciding whether to iterate.
For a single ad-hoc verdict (e.g. comparing judges) there is
`bench judge --task <name> --patch <file> [--model …]`.

## Hard rules

1. **Output via PR.** A rubric change or version bump never goes
   straight to the instance's master — branch + PR with calibration
   results in the description (proof, not claims).
2. **A rubric change = a new era for the tasks that use it.** The
   version is declared in the rubric's frontmatter (`version`); the era
   stamp is per rubric, so a bump invalidates comparability only for
   tasks with that rubric in their `evaluation[]` — the PR lists them
   explicitly. Calibrating a freshly created rubric before its first
   use does not close an era — which is why you calibrate right after
   building the task with bench-build, before its first run, not after
   results have been computed.
   (The global `judge.rubric_version` in the config is a legacy
   contract for rubrics without frontmatter — migrate them at their
   first calibration.)
3. **The calibration set is evaluation material.** It lives in
   `evaluation-pool/judge/<task>-calibration/`, never in `tasks/`
   (it would leak into the agent's workspace). Successive rubric
   iterations are measured on THE SAME set — otherwise you are
   comparing rubrics on different data.
4. **Budget instead of a consent ritual.** Calibration means dozens of
   judge calls, but costs are guarded by the instance budget, not by
   negotiating estimates — report the actual cost after measuring
   (`bench calibrate` prints it from the judge's usage). User consent
   is only needed for a measurement clearly larger than usual (e.g.
   comparing several judges on a large set).
5. **The response format is a contract.** New rubrics declare criterion
   weights in YAML frontmatter (`weights:`, sum = 1) — the runner
   computes the total from `criteria[*].score`, so the ```json block
   contains only `criteria` with keys matching the weights
   (`bench validate` checks this). Do not ask the judge to do
   arithmetic — it is the source of "expression instead of a number"
   class errors. A rubric without frontmatter is a legacy contract
   (`criteria` + a numeric `total` from the model); a response without
   valid JSON = 0. The rubric also needs a **conciseness contract**
   (see the template's default-rubric for the pattern): start with `{`,
   justification as one sentence ≤ 150 characters with no quotes or
   newlines, score as a single number — with reasoning judges, verbose
   justifications truncate the JSON at the token limit precisely on
   mid-scale diffs.

## Procedure

### 1. Calibration set

3–5 diffs of known quality per task, each with an expected score range.
The canonical set:

| Diff | Source | Expectation |
|---|---|---|
| reference solution | task author (bench-build, "Assertions" step) | high (≈1) |
| partial solution | reference with part of the fix cut out | middle, clearly < reference |
| out of scope | reference + changes nobody asked for | below reference (scope penalty) |
| empty diff | `: > empty.diff` | ≈0 |
| real diffs from runs | `patch.diff` from trial artifacts | per your manual assessment |

The diffs must **apply to the task's starting state** (repo@pin +
overlay). Store the set in `evaluation-pool/judge/<task>-calibration/`
together with `expected.md` (expectations + rationale).

"Applies" does not mean "works" — do not measure material you have not
verified. Entry checklist, **before the first measurement**:

- [ ] The set comes from bench-build (produced alongside the task,
      while the repo context was fresh) — if it does not exist, produce
      the full set in one sitting in the repo, not diff by diff.
- [ ] Every diff applies to the task's starting state.
- [ ] Every diff **compiles / runs** — a gate one rung cheaper than the
      judge, and it catches dead material (the judge reads the diff, it
      does not build the project — it will not detect a diff that does
      not compile, and one such entry wastes a whole round of verdicts).
- [ ] Every diff has a measured score on the task's **non-LLM
      components** — in a single container entry: `bench assert --task
      <t> --patch a.diff --patch b.diff …`. This is not duplicate work:
      those numbers are needed anyway for the variant's real final
      score, and along the way they verify that the diff does what
      `expected.md` claims.
- [ ] Only now the first `calibrate`.

### 2. Resolution measurement

```
bench calibrate --task <task> --set evaluation-pool/judge/<task>-calibration \
  [--repeats 3] [--label <round-name>]
```

The command evaluates each diff `--repeats` times, prints a min/med/max
table + spread per diff and medians per criterion, and appends the
round to the set's `results.json`.

Use a **precision ladder**: diagnostic rounds with the minimum number
of repeats (`--repeats 2`) — you are looking for ranking errors and
gross spread, which needs no precision; the full repeat count
(`--repeats 5`) belongs to the confirming round, **once**, at the end,
after the last rubric change. Not the other way around — the difference
is a dozen-plus model calls per iteration. Calls within a round are
independent of each other — the runner executes them in parallel
(`--parallel`, default 3; drop to 1 under tight provider rate limits).
`--json` returns the round summary structurally, without parsing the
table.

On the measurement table, check:

- **Ranking**: do the medians line up with expectations
  (reference > partial > out-of-scope ≥ … > empty)?
- **Separation**: do the ranges of adjacent diffs avoid overlapping?
  (max of the worse < min of the better — otherwise the judge cannot
  tell them apart)
- **Stability**: spread per diff ≤ ~0.1? Larger = criteria too
  discretionary.
- **Threshold**: are the "passing" diffs above the `pass_threshold`
  from bench.config.yaml, and the failing ones below it?

### 3. Iterating on the criteria

Where the judge confuses good with bad — sharpen the rubric, not the
expectations: spell out in the criterion what exactly 1.0 means and
what 0.5 means (anchors), name the penalties (e.g. "changes not
required by the task lower scope by…"), add a criterion if two aspects
blur together.

Before measuring anything, read the rubric for two failure patterns
that recur regardless of domain and that are fixed by reading alone
(a minute instead of a wasted measurement round):

1. **A criterion with no floor for the degenerate case.** A diff that
   does nothing scores points on "negative" criteria (didn't break
   anything, didn't go out of scope). Every criterion of this type
   needs an explicit clause: with no work to evaluate — zero.
2. **Anchors that count events instead of weighing impact.** "One
   change beyond what was needed" is a counting anchor; the judge will
   apply it literally and punish three harmless nits more harshly than
   one risky rewrite. Anchors should describe **impact**, not counts.

After changing the rubric, measure the **whole set** (otherwise you are
comparing rubrics on different data) — but a diagnostic round may be
narrowed to the diffs the change affects, as long as the confirming
round covers the full set. Stop when ranking + separation + stability
are achieved; do not keep tuning (overfitting the rubric to the set is
also a failure).

### 4. PR

- the new/changed rubric in `evaluation-pool/judge/`,
- the calibration set + `expected.md` + raw measurement results
  (`results.json` with `bench calibrate` rounds) in
  `…/<task>-calibration/`,
- a `version` bump in the rubric's frontmatter **only if** the changed
  rubric has already been used in computed results (rule 2),
- in the PR description: the medians table from step 2, conclusions,
  calibration cost.

### 5. Next step

End your summary response with a **Next step** section: the instance
state in one sentence, **one** recommendation with a one-sentence
justification, at most two alternatives with their cost, and —
separately — whatever awaits a human decision. Typical transition:
rubric calibrated, PR updated → **merge + a full run on 2+ models** —
calibration predicts the results, the run verifies them.
