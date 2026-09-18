---
name: bench-summary
description: >-
  Executive snapshot of the instance's current results: computes the
  economics deterministically (pass rate with a confidence interval,
  cost per ACCEPTABLE result including retries, review burden) with
  summarize.mjs over the tracked `results/` tree, renders a
  self-contained one-page HTML verdict, and writes a short narrative
  the operator can act on. Answers "which model should I route this
  work to, and what will it cost me" — not "who tops the leaderboard".
  Use after a measurement, when picking a model for a class of work,
  or when the user asks "summarize the results / what do we use".
---

# bench-summary — the one-peek answer

The leaderboard exists to compare models in public. This skill exists
to settle an internal decision: **which model gets this class of work,
and what does one acceptable result cost.** Same `results/` tree, a
different question, and a different unit — not the median score but:

```
expected cost per acceptable result = cost per attempt ÷ pass rate
```

That number folds quality and price into one figure, because a model
that fails half the time costs double per usable output. A model with
no passes has no such number — that is reported as **"brak"**, never
as a large one.

## Hard rules

1. **Arithmetic is computed, never estimated.** Every figure comes
   from `summarize.mjs` in this skill's directory — run it, read its
   JSON. Do not do the division in your head and do not retype numbers
   from a previous message: rounding drift and a mis-ranked tie are
   exactly what this skill exists to prevent.
2. **You never change scoring.** No edits to `results/`, `attempts/`,
   tasks, rubrics or `bench.config.yaml`. This skill reads and
   renders. A wrong score is bench-explain-results (one anomaly) or
   bench-rubric (unstable verdicts); a missing cell is bench-measure.
3. **Reliability first, price second — and ties are reported as ties.**
   Ranking runs on the LOWER bound of the pass-rate interval, never on
   the median score and never on price alone: a small sample is itself
   uncertainty and has to count against a model, otherwise 2/2 reads
   as "100% reliable" and the cheapest model wins on two trials.
   Price decides only between models of practically equal reliability.
   When intervals overlap, say the difference is unresolved and that
   the honest response is more trials — not "so take the cheaper one".
   This is the single most common way a summary misleads.
4. **Eras are not mixed.** `summarize.mjs` collects the stamps tuple
   (`task_hash`, `judge_model`, `rubric_version`). If more than one
   era appears, say so and do not aggregate across them — the numbers
   answer different questions.
5. **An unmeasured cell is not a zero.** A model absent from
   `results/`, or present only through `infra_failure` /
   `provider_error`, is reported as **unmeasured, with the reason**.
   A provider outage is not a capability finding.
6. **The recommendation carries its confidence and its expiry.** Say
   how many trials it rests on, and that model versions move underneath
   it. `n=2` supports "this model can do the task", not "this model
   does it 100% of the time".
7. **Review burden never enters scoring.** It is reported as a column
   about the operator's time. The moment it is weighted it becomes an
   axis models are optimized against, and it stops being an honest
   observation.

## Tools

From the instance root, with this skill's directory as `<skill>`:

```bash
node <skill>/summarize.mjs --root . --html summary.html   # page
node <skill>/summarize.mjs --root . --out summary.json    # data
node <skill>/summarize.mjs --root . --task <slug>         # one task
```

It reads only git-tracked trees — `results/**/result.json` for score,
cost, duration and stamps, `attempts/**/patch.diff` for review burden —
so it works on a fresh clone, without `workspace/`. It writes nothing
except the files you name.

**There is one presentation in this kit, and it is the leaderboard
template** (`.bench-kit/runner/assets/leaderboard/`: `template.html` +
`style.css` + `app.js`). This skill does not ship its own HTML — it
feeds the shared template, so `--html` here and `bench leaderboard`
produce the same page, with the same labels, the same tooltips and the
same verdict banner. Two templates over one `results/` tree always end
up disagreeing; one template cannot. The output is a single
self-contained file (no bundler, no network, assets inlined). Changing
the presentation therefore means editing those three shared files, and
it changes both surfaces at once — which is the point.

`--html` needs `--root` to point at an instance, because that is where
the shared template lives.

## Procedure

### 1. Establish what exists

`bench status` first: which cells are preserved, which are evaluated,
which are still running, which are empty. A summary written over a
half-evaluated matrix reads as a verdict on models when it is a verdict
on how far the run got. Say plainly what is missing.

### 2. Compute

Run `summarize.mjs`. Read the JSON: per task × model it gives trials,
passes, pass rate with a 95% Wilson interval, mean and total cost,
expected cost per acceptable result, median total, duration, and the
average diff size. The `recommendation` block already applies rule 3 —
cheapest expected cost among models that pass, plus everyone whose
interval overlaps it.

### 3. Render

Produce the page with `--html`. It leads with the verdict — the model,
the price of one acceptable result, and the tie note if there is one —
then the table, then the footnotes that define the two non-obvious
columns.

### 4. Write the narrative

The page carries the numbers; your text carries what the numbers do not
say. Keep it to a few lines and include, when true:

- **the decision**: route this class of work to X at $N per acceptable
  result;
- **what the failures were**, if any model failed — one sentence of
  cause from the preserved attempts (bench-explain-results does the
  deep version; do not duplicate it here);
- **the confidence**: trial counts, and which comparisons the sample
  cannot support;
- **the gaps**: unmeasured cells with reasons, more than one era,
  guards that discriminated nothing;
- **the expiry**: this holds for these model versions and this task
  definition.

### 5. Hand over

The page and JSON are artifacts in the working tree, not results.
They are safe to regenerate at any time and safe to delete —
`results/` is the source of truth, and committing the rendered page is
the user's choice.

## What this skill is not

- Not a diagnosis. A surprising score goes to **bench-explain-results**
  (one chain, one fault class, evidence from the attempt).
- Not judge calibration. Unstable verdicts on similar diffs go to
  **bench-rubric**.
- Not a measurement. Missing cells and thin trial counts go back to
  **bench-measure** — and "buy more trials on the cheap models" is
  frequently the right recommendation to end on, because pass rate is
  the only number the decision is truly sensitive to.

## Closing message

End with: the decision in one line, the path to the rendered page, the
trial counts it rests on, the gaps (unmeasured cells, eras), and one
next step — more trials where they are cheap, a new task class to widen
the conclusion, or nothing, because the decision is made.
