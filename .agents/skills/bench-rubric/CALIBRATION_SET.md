# CALIBRATION_SET — fabricating a synthetic calibration set

There is no reference implementation in this benchmark: the judge is
calibrated on **synthetic diffs** — material you fabricate from the
task's review criteria so that its quality is known *by design*. This
works because the judge only ever reads a diff as text (it never
applies, builds, or runs it), so calibration material does not need to
be executable — it needs to be **realistic** and to sit at a **known
point** on the rubric's scale.

## What each synthetic diff is for

A calibration diff is a probe of one question about the judge, not a
plausible solution for its own sake. Before writing a diff, name the
question; the canonical roster (see SKILL.md, step 1) maps to:

- **empty diff** — floor probe: do "negative" criteria (didn't break
  anything, stayed in scope) leak points to no work at all?
- **hard violation** — dominance probe: does one violation of a
  dominating axis (a safety do-not) pull the total below the threshold
  even when everything around it looks competent? Make the diff
  *otherwise good* on purpose — a violation inside sloppy code tests
  nothing.
- **partial milestone** — partial-credit probe: does the rubric grade
  "how far it got" monotonically? Sketch exactly one milestone/phase,
  done properly, and nothing beyond it.
- **complete but sloppy** — do's/don'ts probe: full scope, but
  breaking the *non*-dominating criteria (scope creep, logic buried in
  a component instead of a testable module, hardcoded copy, missing
  tests). This is the diff that separates a rubric from a diff-size
  detector.
- **complete and good** — ceiling probe: does material that follows
  every axis actually reach the top of the scale?

One diff = one question. A diff that mixes a violation with partial
scope produces a verdict you cannot interpret.

## Realism rules (binding)

The judge must not be able to tell the material is synthetic, and the
material must exercise the same reading skills as a real attempt:

1. **Real paths and symbols.** Every file path, import, and symbol you
   touch must exist in the repo at the task's pin (or be a file the
   task plausibly creates, in a directory the prompt/plan names).
   Verify against the repo (`.repos/<name>/`, worktree at the pin) —
   never from memory.
2. **Plausible hunks.** Context lines copied from the real files at
   the pin, correct-looking hunk headers, the repo's real naming and
   code style. A diff with invented context is fantasy code — a judge
   calibrated on it is calibrated on nothing.
3. **Proportional size.** A "complete" diff for an 18-file task does
   not have to be 18 files of finished code, but it cannot be 40 lines
   either: sketch every area the plan names, with real signatures and
   representative bodies (elision comments inside a body are
   acceptable; eliding whole files is not).
4. **The violation is findable, not labeled.** A hard-violation diff
   plants the violation the way a careless agent would — no comments
   pointing at it, no suspicious naming.
5. **Bilingual with the repo.** Copy, identifiers, and conventions
   follow the base repo, not your habits.

## expected.md

Next to the diffs, `expected.md` records per diff: the question it
probes, the axis it exercises, the expected score range, and the
expected *ranking* relative to its neighbours. Rankings are what
calibration checks first — absolute values drift, order must not.

## Lifecycle

- The set is fabricated once per task, from the order's Evaluation
  axis and bench-build's criteria digest — ideally right after
  bench-build, before the first run (calibrating a fresh rubric before
  first use does not close an era; see SKILL.md rule 2).
- **Real attempt diffs replace synthetics over time.** After the first
  run, pull `patch.diff` from trials whose quality you have manually
  assessed and add them to the set with your assessment in
  `expected.md`. Real material trumps synthetic on every axis except
  availability; a mature set keeps synthetics only for points the real
  attempts never hit (usually the hard violation — models rarely
  oblige).
- Re-measuring an already-used rubric on the extended set and changing
  it closes an era for its tasks (SKILL.md rule 2) — plan
  recalibration at era boundaries, not casually.

## Anti-patterns

- **Calibrating on your own criteria's echo** — a diff whose only sin
  is literally quoting a don't ("// storing key on server") tests
  string matching, not judgment.
- **Overfitting the rubric to the synthetics** — synthetics stress
  designed failure modes; when the rubric starts naming details that
  only exist in your fabricated diffs, stop (SKILL.md step 3's
  stopping rule applies).
- **One mega-diff probing everything** — uninterpretable verdicts, see
  above.
- **Skipping the ceiling probe** — a rubric checked only against bad
  material can be a rubric nothing can pass.
