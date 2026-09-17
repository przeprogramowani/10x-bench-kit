# RUBRIC_AUTHORING — writing the task's rubric (bench-build subagent)

The rubric is the task's **main assertion artifact**: the execution
guards only say whether the workspace is still green, the rubric grades
the work — how far the attempt got and how well what landed is built.
You write it here, as text, from the order's Evaluation axis and from
the repo you have open at the pin. There is **no calibration step
before the first run**: the rubric is proven by reading (the checklist
below), by the empty-diff floor (`bench judge`), and then by real
attempts — the first measurement is the calibration, and a rubric fix
after it costs a re-evaluation of preserved attempts, never a re-run.

The judge that reads this rubric is **rate-attempt** — an agent with
tools working on a copy of the preserved workspace (it may run the
tests, start the app, grep the code). Write for a senior reviewer who
can verify what the diff claims, not for a text-only reader.

## Where it lives, what it is named

`evaluation-pool/judge/<task-name>-rubric.md`, referenced from the
task's `evaluation[]` as `judge/<task-name>-rubric`. One rubric per
task — rubrics are not shared across tasks (the axes are the task's),
so there is no reuse decision to make; `default-rubric` in the pool is
the demo's generic rubric, not a fallback for real tasks.

## Format contract (checked by `bench validate`)

```markdown
---
version: "1"
weights:
  <criterion-a>: 0.5
  <criterion-b>: 0.3
  <criterion-c>: 0.2
---

# Rubric: <task-name> (v1)

<one paragraph: what this task measures, in the judge's terms — may
name the repo mechanisms the prompt does not (this file never reaches
the agent)>

**Anti-nitpicking clause (applies to every criterion):** implementation
choices the prompt left to the agent — file layout, naming,
decomposition, internal helpers — never lower the score; only
violations of the criteria named below are penalized.

## Criteria

1. **<criterion-a>** (weight 0.5) — <question it answers>. Anchors:
   - 1.0 — …
   - 0.5 — …
   - 0.0 — … (including: no work in this area = 0.0)
…

## Judge response format (required JSON)

```json
{
  "criteria": {
    "<criterion-a>": { "score": 0.0, "justification": "…" },
    …
  }
}
```

Conciseness contract (mandatory): start the response with `{` — no
markdown, no preamble; each `justification` is one sentence ≤ 150
characters, no quotes and no newlines inside; each `score` is a single
decimal in [0, 1] — never an arithmetic expression. A response without
valid JSON = 0 for the judge component.
```

- `weights` sum to 1; the ```json block's `criteria` keys match the
  weights exactly (the runner computes the total — the judge never
  does arithmetic).
- `version: "1"` for a new rubric. A bump is due only when the rubric
  changes **after** results were computed with it (a new era for the
  tasks using it; preserved attempts are re-evaluated, not re-run).
- The anti-nitpicking clause and the conciseness contract appear
  **verbatim** — they are pool contracts, not style.

## Three contracts every rubric honours

1. **Good/bad in behavioural language.** Criteria and anchors describe
   what a good implementation *does* and what a bad one *does* — never
   "file X contains symbol Y". A multi-file task has many correct
   shapes; exact paths/symbols appear only when the prompt itself fixes
   them verbatim. Naming the repo's mechanisms *for the judge* (the
   event the toggles publish, the loader the pages call) is fine and
   useful — that is context, not a required shape.
2. **The anti-nitpicking clause** — verbatim, see above.
3. **Division of labour with the guards.** No criterion whose substance
   is "tests pass / build is green" — the guards measure that, and the
   judge reads their result as fact. The judge's turf is what review
   sees: completeness against the milestones, architecture and
   layering, scope discipline, whether real tests were written for the
   new behaviour. rate-attempt *may* run things to verify a claim the
   diff makes — the rubric does not require it.

## Deriving the criteria

- Each axis of the order's Evaluation section becomes a criterion (or a
  named penalty inside one). No criterion without a source in the
  order; no axis left uncovered. Where the order says "at bench-build's
  discretion", derive the axis from the task type and say so in the
  report.
- **A decisive axis dominates by weight and by anchors**, not by a
  footnote: if the order says "a solution that fails X screenshots
  perfectly", X carries the largest weight and its 0.0 anchor is
  written so that a competent-looking diff that fails X lands there.
  Safety-flavoured axes ("a single leak is a hard fail") become a
  dominating clause — the criterion is 0.0 on the first occurrence,
  regardless of the rest.
- **Milestones map to partial credit.** If the order defines phases,
  the completion criterion's anchors are the milestone map: which
  milestone reaches 0.5, which 0.8, which 1.0 — and which ordering the
  order insists on ("(1)+(2) without (3) must land clearly above
  (1)+(3) without (2)").
- **Price incompletion once (phased tasks).** A property criterion that
  scores 0.0 whenever a later phase was never reached is a hidden second
  completion criterion: completion then controls its own weight *plus*
  every such axis, and the rubric loses resolution exactly among the
  partial attempts it exists to rank. There is no N/A mechanism (the
  runner multiplies every score by its weight), so design around it:
  anchor property criteria to grade **whatever fragment of the
  behaviour landed** (most properties have precursors in earlier
  phases — how errors are handled wherever they are handled so far,
  how text enters the DOM wherever it does); where a property has no
  precursor before its phase, fold it into that phase's completion
  anchors instead of giving it a standalone criterion whose only
  reachable score for an honest partial attempt is 0.0.
- **Asymmetries in the repo go into the rubric, not into the prompt.**
  When the starting state makes an axis vacuous on one surface (there
  is nothing to react to there), say so in the criterion — otherwise
  the judge punishes the solver for not wiring what cannot be wired.

## Rules of thumb: junior, senior, lead

Anchors written only as "good / partial / bad" are abstract; the judge
resolves them better when each criterion also carries a short **rule
of thumb** describing how engineers of different experience typically
handle this axis — **not** a complexity ladder ("the senior writes more
abstractions"), but the pragmatic patterns and mistakes practitioners
recognise from real codebases. Three lines per criterion, roughly:

- **What a junior typically does** — the solution that works on the
  happy path and demos well: a second fetch instead of reusing loaded
  data; a bare `x / y` with no thought for `y = 0`; copy hardcoded in
  one language on a bilingual surface; a progress bar with no text
  equivalent; "fixed it" with no test because the manual check passed;
  a refactor of the neighbouring module "while I was there".
- **What a senior typically does** — the solution that survives
  production: reuses the data and the mechanism the page already has;
  treats "no data" as a legitimate state distinct from zero; follows
  the presentation precedent already in the repo; adds the one test
  that would fail without the feature; keeps the diff to the feature;
  leaves the decision trail in the code where a non-obvious choice was
  made (locked lessons excluded from both numerator and denominator —
  consistently, on purpose).
- **What a lead typically does (or refuses to do)** — the judgment
  calls: notices when the task as stated is asymmetric across surfaces
  and does not force a mechanism where nothing needs it; does not
  open a second source of truth to make the demo smoother; declines
  the "obvious" new endpoint when the number is derivable from data
  already on the page; scopes the change so the next person can read
  it in one sitting; when the codebase's convention is imperfect,
  follows it anyway rather than introducing a competing one in a
  feature PR.

The point of the ladder is to give the judge **recognisable
patterns**, so that "partial" is not a coin flip between two
plausible readings. Anchors stay authoritative; the rules of thumb
illustrate them. Keep them specific to *this* task's axes — a generic
"seniors write tests" line adds nothing.

## Read-only failure checklist (before `bench judge`)

Three defects recur regardless of domain and are found by reading the
rubric once — a minute instead of a wasted measurement:

- [ ] **A criterion with no floor for the degenerate case.** A diff
      that does nothing scores points on "negative" criteria (didn't
      break anything, stayed in scope). Every criterion of that type
      carries an explicit clause: with no work to evaluate — 0.0.
- [ ] **Anchors that count events instead of weighing impact.** "One
      change beyond what was needed → 0.5" is a counting anchor; the
      judge applies it literally and punishes three harmless nits more
      harshly than one risky rewrite. Anchors describe **impact**.
- [ ] **Completion bleed on phased tasks.** For each property
      criterion: can an honest attempt that finished only the early
      phases score on it at all? If not, re-anchor it to grade the
      fragment that exists, or fold it into the completion anchors.

Plus the format checks: weights sum to 1 and match the JSON block;
anti-nitpicking clause and conciseness contract verbatim; `version`
present; no criterion requiring execution; no path/symbol the prompt
does not fix.

## Proof

- `bench validate --offline` green (format contract).
- The empty-diff floor: `bench judge --task <name> --patch <empty.diff>`
  (API judge on the rubric text) scores clearly below
  `defaults.pass_threshold`. This is the one judge call you make; it
  proves the floor, not the resolution — resolution is proven by the
  first real attempts.
- The report carries: the rubric path, the criteria/weights table with
  the source axis of each criterion, the checklist results, and the
  empty-diff verdict pasted.

## After the first run

The first measured attempts are the calibration material. If the
scores disagree with a manual read of two or three `patch.diff`s, fix
the rubric (same rules as above), bump `version` if results were
already computed with it, and re-evaluate the preserved attempts
(rate-attempt / `bench evaluate`). If verdicts on similar diffs look
*unstable* rather than *wrong* — or you want to know whether a
different judge model reads the rubric the same way — that is
bench-rubric's job (`bench calibrate` on the real attempts).
