---
name: bench-analysis
description: >-
  Agent-supported analysis of the benchmark's results, in conversation
  with the user, ending in a decision: which model (and which tool — Claude
  Code, Codex, OpenCode) gets which class of work, at what cost per
  acceptable result, with how much confidence. Computes everything
  deterministically with summarize.mjs over the tracked results/ tree —
  per task: pass rate with interval, pass^k, cost per acceptable
  result, review burden, excluded attempts; across tasks: class × model
  (tasks as the unit), paired comparisons on shared tasks (sign test),
  how big a difference the task set can resolve, and the time horizon
  ("reliably handles N-minute tasks"). Renders a one-page HTML verdict
  and a short narrative; explains surprising results from preserved
  attempts (EXPLAIN.md). Use after bench-evaluate, when a new model is
  compared with the incumbent, or when the user asks "analyse the
  results / summarize / what do we use / why did X fail".
---

# bench-analysis — the one-peek answer

The third of the benchmark's three concepts:

1. **create task**: what we measure (bench-create-task);
2. **evaluate**: run models on it and judge the attempts (bench-evaluate);
3. **analysis**: what the results mean (this skill).

A surprising single result is explained from its preserved attempt with
[EXPLAIN.md](EXPLAIN.md) (template: [EXPLAIN_TEMPLATE.md](EXPLAIN_TEMPLATE.md)).

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
   renders. A wrong score is EXPLAIN.md's job; a missing cell is
   bench-evaluate.
3. **Reliability first, price second — and ties are reported as ties.**
   Ranking runs on the LOWER bound of the pass-rate interval, never on
   the median score and never on price alone: a small sample is itself
   uncertainty and has to count against a model, otherwise 2/2 reads
   as "100% reliable" and the cheapest model wins on two trials.
   Price decides only between models of practically equal reliability.
   When intervals overlap, say the difference is unresolved and that
   the honest response is more trials — not "so take the cheaper one".
   This is the single most common way a summary misleads.
4. **Eras are not mixed.** `summarize.mjs` keeps only each task's
   current era (highest scoring version, preferring the era judged on
   the configured `judge.mode` path) and counts the rest per cell as
   `other_era_trials`. Those are results from an older rubric, judge,
   judge path, pass threshold or scoring rule. Say how many were left out; re-evaluating
   the preserved attempts brings them back.
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

8. **Class claims rest on tasks, not trials.** Five trials of one task
   measure that task. A statement about "bugfixes" needs bugfix
   *tasks*. `classes[].claim` is `class` only from 5 tasks up;
   below that it is a `hypothesis`, and you say so in those words.
   Model A "beats" model B only when the paired comparison on their
   shared tasks is `resolved` (exact sign test, p < 0.05). Otherwise
   the difference is unresolved, and you name the gap the current
   task count *can* resolve (`resolvable_gap_pp`) and how many tasks a
   smaller gap needs (`power.tasks_needed`). More tasks, which are
   cheap to mine (bench-create-task), is usually the honest next step.
9. **Excluded attempts are visible.** Infrastructure failures and
   resource kills do not enter `n`. When a model has a high exclusion
   rate (a caveat in the JSON), its pass rate may be flattering it, and
   that goes into the narrative.
10. **Anchors are not decisions.** Tasks in class `anchor` (mined from
    public repos, MINING.md) check the setup against published numbers.
    `summarize.mjs` keeps them out of `paired`, `horizons` and `power`
    and reports them in a separate `anchors` block (`classes` still
    lists the anchor class). Report them apart; never route work on
    them.

## Tools

From the instance root, with this skill's directory as `<skill>`:

```bash
node <skill>/summarize.mjs --root . --html summary.html   # page
node <skill>/summarize.mjs --root . --out summary.json    # data
node <skill>/summarize.mjs --root . --task <slug>         # one task

# header — editorial, asked for, never invented silently
node <skill>/summarize.mjs --root . --html summary.html \
  --eyebrow "<kicker>" --title "<title>" --lede "<one or two sentences>"
```

`--title`, `--lede` and `--eyebrow` set the masthead. Omit one and the
page falls back to the template's neutral default; pass `""` to drop
that element entirely.

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

Run `summarize.mjs` and read the JSON.

**Per task × model:** trials and passes (by the result's gate, not the
total), pass rate with a 95% Wilson interval, `pass_hat_k` (the chance
that k runs in a row all pass, i.e. "can this run unattended"), mean
and total cost, expected cost per acceptable result (null when any
trial's cost is unknown), median total, duration, diff size, excluded
attempts, and other-era trials left out. The `recommendation` block
already applies rule 3: with `resolved: false` its `model_id` is only
the leader by interval lower bound, not a verdict — report the tie
(`tied_with`, `tie_note`) and the number of tasks it would take to
resolve it; `cheapest_in_tie` is context, never the pick.

**Across tasks:**

- `classes`: class × model, the mean of per-task pass rates with a
  bootstrap interval over tasks, and the claim level;
- `paired`: every model pair on shared tasks, overall and per class,
  with wins/ties/losses, mean difference, sign-test p and `resolved`;
- `power`: what the task set can resolve and what a smaller gap needs;
- `horizons`: per model, the human-minutes length of task it passes
  50% / 80% of the time. It is fitted from each order's **Human time**,
  needs ≥5 tasks spanning ≥4×, and is otherwise null with a reason.
  `horizons[model].estimated_share` is the share of those tasks whose
  Human time is estimated rather than confirmed;
- `anchors`: the `anchor`-class tasks (rule 10), reported per model on
  their own — excluded from `paired`, `horizons` and `power`, so a
  public-repo task never moves a routing comparison.

Class and Human time come from `tasks/backlog.md`.

### 3. Ask for the header

Before rendering, ask the user what the page should be called and what
the opening line should say — one AskUserQuestion with a couple of
concrete options plus your own recommendation, not a blank prompt. The
masthead is the only editorial surface on the page: everything below it
is computed, so this is where the report says who it is for.

Three rules for what you propose:

- **Not the scoring mechanics.** "Reliability first, price second" is
  already spelled out in the "how to read this" section and in the
  column footnotes. A header that repeats it reads like an internal
  memo to the tool's own author.
- **No vocabulary from the data model.** *era*, *stamps*, *rubric*,
  *task hash*, *pass rate*, *judge*, *scoring version*, *trial* are
  field names — they mean something precise inside the kit and nothing
  to a reader outside it. Write what a person would say out loud: not
  "wyniki bieżącej ery" but "co te modele zrobiły z tym zadaniem". If a
  word would need the footnotes to be understood, it belongs in the
  footnotes.
- **A subject, not a procedure.** Name the decision or the body of work
  — the class of task, the shortlist, the period — and let the lede say
  what a reader gets out of the page in one or two sentences.

If the user does not care, take the template's defaults and move on;
this is a question, not a gate.

### 4. Render

Produce the page with `--html`, passing the header flags from step 3.
It leads with the verdict — the model, the price of one acceptable
result, and the tie note if there is one — then the table, then the
footnotes that define the two non-obvious columns.

### 5. Write the narrative

The page carries the numbers; your text carries what the numbers do not
say. Keep it to a few lines and include, when true:

- **the decision**: route this class of work to X at $N per acceptable
  result. It is a *class* decision only when the class view says
  `class` and the paired comparison is `resolved`; otherwise it is a
  per-task observation, and you say so;
- **the horizon**, when computed: "X reliably (80%) handles tasks of
  about N developer-minutes here". This is the sentence an engineering
  leader repeats upward, so give it only when it was computed — and
  when Human time is mostly estimated (`estimated_share`), say so in
  the same sentence: the horizon is then measured in estimated minutes;
- **the anchors**, when any exist: whether the instance's numbers on
  them sit near the published ones. A wild divergence points at the
  setup (harness, judge) before the models;
- **the resolution**: what difference these tasks can tell apart, and
  how many more tasks a closer call would need;
- **what the failures were**, if any model failed — one sentence of
  cause from the preserved attempts (EXPLAIN.md does the deep version;
  do not duplicate it here);
- **the confidence**: trial counts, and which comparisons the sample
  cannot support;
- **the gaps**: unmeasured cells with reasons, more than one era,
  guards that discriminated nothing;
- **the expiry**: this holds for these model versions and this task
  definition.

### 6. Hand over

The page and JSON are artifacts in the working tree, not results.
They are safe to regenerate at any time and safe to delete —
`results/` is the source of truth, and committing the rendered page is
the user's choice.

## What this skill is not

- Not a diagnosis. A surprising score goes to [EXPLAIN.md](EXPLAIN.md)
  (one chain, one fault class, evidence from the attempt).
- Not a measurement. Missing cells and thin trial counts go back to
  **bench-evaluate** — and "buy more trials on the cheap models" is
  frequently the right recommendation to end on, because pass rate is
  the only number the decision is truly sensitive to.

## Closing message

End with: the decision in one line, the path to the rendered page, the
trial counts it rests on, the gaps (unmeasured cells, eras), and one
next step — more trials where they are cheap, a new task class to widen
the conclusion, or nothing, because the decision is made.
