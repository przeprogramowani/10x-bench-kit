---
name: bench-rubric
description: >-
  Thin proxy over `bench calibrate`: measures how stably a task's rubric
  is read by the API judge — or compares two judge models on it — using
  REAL preserved attempts as the calibration set (plus the empty diff).
  Requires attempts in `attempts/<task>/`; does not write rubrics (that
  is bench-build's RUBRIC_AUTHORING.md) and fabricates no synthetic
  diffs. Use when judge verdicts on similar diffs look unstable, when
  choosing or changing the judge model, or when the user says
  "calibrate the judge / compare judges".
---

# bench-rubric — judge calibration on real attempts

This skill answers one question: **is the measuring instrument stable?**
Not "is the rubric right" — the rubric is written by bench-build
(RUBRIC_AUTHORING.md) and corrected by reading real attempts against
it — but "given this rubric, does the judge return the same verdict on
the same diff, and do two judges rank the diffs the same way?". It is
a diagnostic, not a phase of the pipeline: a new task goes
bench-build → bench-measure without passing through here.

The tool is `bench calibrate --task <name> --set <dir>` (from the
instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts calibrate …`): it evaluates every diff
in the set `--repeats` times through the **API judge** (the same path
as `bench evaluate` without `--verdict`) and prints min/med/max per
diff, medians per criterion, spread, and the cost. `--model` switches
the judge model for the round; `--label` names the round in the set's
`results.json`; `--json` returns the summary structurally.

**What this measures and what it does not.** `bench calibrate` drives
the text-only API judge. On real tasks the leaderboard verdicts come
from **rate-attempt** — the judge with tools. Stability measured here
transfers to rate-attempt only to the extent the rubric text is the
common factor: a rubric the API judge reads consistently is a rubric
rate-attempt reads consistently; a rubric with 0.3 spread on the API
path will not be rescued by tools. Say this in the summary — do not
present a calibration number as a property of the leaderboard's judge.

## Hard rules

1. **Real attempts or nothing.** The calibration set is built from
   `patch.diff` of preserved attempts (`attempts/<task>/<model>/
   trial-N/patch.diff`) plus one empty diff. If `attempts/<task>/`
   holds no completed attempts, stop: tell the user the task has not
   been measured yet and that the first measurement (bench-measure)
   is what produces calibration material — there is nothing to
   fabricate.
2. **You assess the diffs before the judge does.** Every diff in the
   set gets a line in `expected.md`: your manual read against the
   rubric (a score range per criterion is not needed — a ranking
   relative to its neighbours and one sentence why is). A diff you
   cannot rank has no place in the set. Read the diff *and* the
   attempt's guard results (`checks.json` if evaluated) — a diff that
   looks complete with red tests is ranked with the red tests in mind.
3. **The set lives in `evaluation-pool/judge/<task>-calibration/`**,
   never in `tasks/` (it would leak into the agent's workspace). Diffs
   are copied in under attempt-derived names
   (`<model>-trial-N.diff`); `results.json` accrues rounds.
   Successive rounds on the same rubric use **the same set**.
4. **No rubric edits here.** If the measurement shows the rubric is
   *wrong* (ranking disagrees with your `expected.md`), the fix is a
   rubric edit per bench-build's RUBRIC_AUTHORING.md — name the
   criterion and the anchor in your summary and hand it over; a bump
   of `version` is due if results were computed with the rubric, and
   the follow-up is re-evaluating the preserved attempts, never a
   re-run. If the measurement shows the judge is *unstable* (spread)
   with a ranking that matches — that is a judge-model or
   conciseness-contract finding, also reported, not fixed here.
5. **Judge-model changes are a global era.** `judge.model` in
   bench.config.yaml stamps every result; changing it closes the
   comparability era for the whole instance. A comparison round with
   `--model` is free of that (it writes nothing to `results/`), the
   decision to switch is the user's and goes through the config PR.
6. **Budget instead of a consent ritual.** A round is `diffs × repeats`
   judge calls per model — report the actual cost from the command's
   output. Ask before measuring only when the round is clearly larger
   than usual (several judges × a large set × many repeats).

## Procedure

### 1. Intake — what is being asked

Two shapes, and you ask which if the invocation does not say:

- **Stability of one judge** on the task's rubric (the default when
  bench-measure or bench-explain-results sent you here because
  verdicts on similar diffs diverged).
- **Comparison of judge models** — the user names two (or more)
  `provider/model` ids, or asks you to propose a cheaper candidate
  against the configured `judge.model`. Ask for the candidate ids
  explicitly; do not pick a second judge silently.

Also confirm the rubric under test: the task's `judge/*` entry from
`evaluation[]` (with several, `--rubric` picks one).

### 2. Set from preserved attempts

`bench status --json` (or a listing of `attempts/<task>/`) shows which
attempts exist. Build the set:

- copy `patch.diff` of every completed attempt (skip `running.json`,
  `*.aborted-*`, infra-flagged attempts) into the set directory;
  cap at ~8 diffs — pick across models and across outcomes
  (complete, partial, empty-ish) so the set spans the scale;
- add `empty.diff` (`: > empty.diff`) — the floor probe, free;
- write `expected.md`: per diff, the source attempt, your ranking
  relative to the neighbours, one sentence why, and — if the attempt
  was already evaluated — the recorded judge score from `results/`.

### 3. Measure

```
bench calibrate --task <task> --set evaluation-pool/judge/<task>-calibration \
  --repeats 3 [--model <provider/model>] [--label <round>] [--parallel 3]
```

One round per judge under test, same set, same `--repeats`. Diagnostic
rounds with `--repeats 2` are fine when you are only looking for
ranking errors; a confirming round at `--repeats 3–5` once. Drop
`--parallel` to 1 under provider rate limits.

### 4. Read the table

- **Ranking** — do the medians order the diffs the way `expected.md`
  does? A disagreement is a rubric finding (rule 4), unless your own
  read was wrong — say which.
- **Separation** — adjacent diffs' ranges do not overlap (max of the
  worse < min of the better).
- **Stability** — spread per diff ≤ ~0.1. Larger with a correct
  ranking = the judge is noisy on this rubric: check the conciseness
  contract and `finish_reason` in the raw verdicts before blaming the
  model.
- **Threshold** — diffs you ranked as passing sit above
  `defaults.pass_threshold`, the others below; the empty diff clearly
  below.
- **Between judges** (comparison shape) — same ranking? similar
  separation? cost per verdict? A cheaper judge that reproduces the
  configured judge's ranking with comparable spread is a candidate;
  one that reorders the middle of the scale is not, however cheap.

### 5. Finalize

Leave in the working tree: the set directory (diffs, `expected.md`,
`results.json` with the rounds). Nothing in git. In your summary: the
medians table per round, the reading from step 4, the cost, and the
finding class — *stable*, *rubric finding* (criterion + anchor to fix,
handed to a rubric edit per RUBRIC_AUTHORING.md), *judge finding*
(noise / format), or *judge comparison* (recommendation + what a switch
would cost in eras).

### 6. Next step

End with a **Next step** section: the instance state in one sentence,
**one** recommendation with a one-sentence justification, at most two
alternatives with their cost, and — separately — what awaits a human
decision. Typical transitions:

- **stable** → nothing; continue measuring with bench-measure.
- **rubric finding** → edit the rubric (RUBRIC_AUTHORING.md), bump
  `version` if results exist, re-evaluate preserved attempts via
  rate-attempt — list the tasks whose era closes.
- **judge comparison favours a switch** → `judge.model` change through
  the config PR (bench-wiring's era rules), then re-evaluation of
  preserved attempts under the new judge — a human decision.
