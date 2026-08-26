---
name: bench-rubric
description: >-
  Builds the rubric from the task's review criteria (the order's
  evaluation axes) and calibrates it on a synthetic calibration set —
  diffs of designed quality fabricated per CALIBRATION_SET.md, plus
  real attempt diffs as runs accrue. Measures the judge's resolution
  and stability, iterates on the criteria, and finalizes with a PR
  that bumps the rubric version. Use when creating a rubric for a new
  task, when judge scores look random or drift, or when the user says
  "calibrate the rubric / the judge".
---

# bench-rubric — judge calibration

A rubric without calibration is a number generator, not an evaluation.
You calibrate it empirically: the judge gets diffs whose quality you
**know in advance** — because you designed them that way — and you
check whether its ranking and values match yours, repeatably. There is
**no reference implementation** in this benchmark: the rubric's
criteria come from the task's review criteria (the order's Evaluation
axis — do's, don'ts, milestones — and bench-build's criteria digest in
its report), and the calibration set is **synthetic**, fabricated from
those criteria per [CALIBRATION_SET.md](CALIBRATION_SET.md). Real
attempt diffs (`patch.diff` from run artifacts) join the set as runs
accrue — they are the best material, they just cannot exist before the
first run. The tool is `bench calibrate --task <name> --set
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

### 1. Rubric v1 + synthetic calibration set

**The rubric first.** Derive the criteria from the order's Evaluation
axis and bench-build's criteria digest: each axis becomes a criterion
(or a named penalty), milestone/phase maps become the partial-credit
scale, safety-flavoured axes ("a single leak is a hard fail") become
dominating clauses, not deductions.

**Price incompletion once (phased tasks).** On a task where most
attempts will land partial, a property criterion that scores 0.0
whenever the phase containing the behaviour was never reached is a
hidden second completion criterion: completion then controls its own
weight *plus* every such axis, and the rubric loses resolution exactly
among the partial attempts it exists to rank (two attempts that both
finished the early phases — one carefully, one sloppily — become
indistinguishable on those axes). The runner computes the total
mechanically from `criteria[*].score` × frontmatter weights, so there
is no N/A mechanism — design around it instead: anchor property
criteria so they grade **whatever fragment of the behaviour landed**
(most properties have precursors in earlier phases — how secrets are
handled wherever they exist so far, how text enters the DOM wherever it
does); where a property genuinely has no precursor before its phase,
fold it into that phase's completion anchors rather than giving it a
standalone criterion whose only reachable score for an honest partial
attempt is 0.0.

Three contracts every rubric must honour:

- **Good/bad in behavioural language.** Criteria and anchors describe
  what a good implementation *does* and what a bad one *does* — never
  "file X contains symbol Y". A multi-file task has many correct
  shapes; the rubric grades substance the way a senior reviewer would,
  and exact paths/symbols appear only when the prompt itself fixes
  them verbatim.
- **The anti-nitpicking clause (mandatory, verbatim in every
  rubric):** implementation choices the prompt left to the agent —
  file layout, naming, decomposition, internal helpers — are never
  penalized; only violations of stated criteria are. This is what
  makes "code review without nitpicking" enforceable rather than
  aspirational.
- **Division of labour with the guards.** The judge reads the diff as
  text and never executes it — do not write criteria that require
  running the code ("all tests pass", "the build is green"): that is
  what the execution guards measure. The judge's turf is what review
  can see: completeness, architecture, scope, whether real tests were
  written for the new behaviour.

**Then the set**: 4–6 diffs of designed quality per task, each with an
expected score range, fabricated per
[CALIBRATION_SET.md](CALIBRATION_SET.md). The canonical roster:

| Diff | How it is made | Expectation |
|---|---|---|
| empty diff | `: > empty.diff` | ≈0 |
| hard violation | a small realistic diff that violates a dominating axis (e.g. leaks the secret into server code) while otherwise looking competent | ≈0 / below threshold — the violation must dominate |
| partial milestone | a plausible sketch of only the first milestone/phase | middle, clearly above empty |
| complete but sloppy | full scope sketched, but breaking the non-dominating do's (scope creep, untestable layering, hardcoded copy) | above partial, clearly below good |
| complete and good | full scope sketched, following the axes | high (≈1) |
| real diffs from runs | `patch.diff` from trial artifacts, once runs exist | per your manual assessment |

**Phased tasks add a mandatory pair**: *early phases done well, later
phase absent* vs *the same completion, done sloppily* (breaking
non-dominating do's within the finished phases). Calibration fails if
these two do not separate — overlap here is the completion-bleed
symptom (see step 1): the property criteria are pricing the missing
phase again instead of grading the work that exists, and the fix is
re-anchoring those criteria, not adjusting expectations.

Synthetic diffs are **judge-only material**: the judge reads the diff
as text and never applies or builds it, so a synthetic diff does not
have to apply or compile — but it must be **realistic**: real paths and
symbols from the repo at the task's pin, plausible hunks and context
lines, size proportional to what it claims to be. A judge calibrated
on fantasy code is calibrated on nothing — CALIBRATION_SET.md's realism
rules are binding. Store the set in
`evaluation-pool/judge/<task>-calibration/` together with `expected.md`
(expectations + rationale, and per diff: which axis it exercises).

Entry checklist, **before the first measurement**:

- [ ] The rubric's criteria trace back to the order's axes / criteria
      digest — no criterion is your invention without a source, no axis
      is left uncovered.
- [ ] The three contracts hold: behavioural anchors (no paths/symbols
      the prompt does not fix), the anti-nitpicking clause present
      verbatim, no criterion that requires executing the code.
- [ ] Phased task → incompletion is priced once: every property
      criterion is scoreable by an honest partial attempt (grades the
      fragment that exists), and the calibration set contains the
      mandatory pair from the roster.
- [ ] Every synthetic diff passes the realism rules of
      CALIBRATION_SET.md (real paths/symbols at the pin, plausible
      hunks, proportional size) — verified against the repo, not from
      memory.
- [ ] Each diff exercises a **named** axis or scale point — a diff you
      cannot say the expected ranking of has no place in the set.
- [ ] Real attempt diffs (if any runs exist) are included and manually
      assessed in `expected.md`.
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
  (good > sloppy > partial > … > hard violation ≈ empty)?
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
3. **Completion bleed on phased tasks.** A property criterion whose
   anchors bottom out at 0.0 when a later phase simply does not exist
   re-prices incompletion outside the completion criterion (see the
   "price incompletion once" rule in step 1). Check each property
   criterion: can an honest attempt that finished only the early phases
   score on it at all? If not, re-anchor it to grade the fragment that
   exists, or fold it into the completion anchors.

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
