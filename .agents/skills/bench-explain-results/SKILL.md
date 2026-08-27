---
name: bench-explain-results
description: >-
  Diagnoses benchmark results: descends from the aggregate (report over
  results/) through result.json to the preserved attempt's artifacts
  (agent.log, patch.diff, workspace/, checks.json, judge.json) and
  classifies the cause — model fault, task fault, or infrastructure
  fault. Everything lives on this machine: results/ in the repo,
  attempts/ on disk. The output is a comment or issue with evidence,
  never a scoring change. Use after a run when a result is surprising,
  a model dropped between runs, a trial failed, or the user asks "why
  did this model score that / analyze the run".
---

# bench-explain-results — reading the results

A trial's score is the end of a chain of evidence: report → result →
artifacts. Your job is to walk down that chain and **name the cause**
as one of three classes: *model fault* (the leaderboard tells the
truth), *task fault* (the assertion/overlay/prompt/rubric punishes the
wrong thing), *infrastructure fault* (container, timeout, adapter,
secrets). A diagnosis ends with a comment or an issue delegating the
fix — never with changing the results.

## Hard rules

1. **You never change the scoring.** No edits to `result.json`, the
   `results/` tree, preserved attempts (`attempts/`), tasks,
   assertions, rubrics, or `bench.config.yaml`. Even when an assertion
   bug is obvious:
   diagnosis → issue → fix via the appropriate skill (bench-build /
   bench-refresh-task / bench-rubric), never an edit as part of triage.
   Trial artifacts are read-only.
2. **Hypothesis → proof by command.** Verify suspicions about an
   assertion or the judge with the runner (`bench assert`,
   `bench judge` — no `bench` executable exists in PATH; from the
   instance root run `node --experimental-strip-types
   .bench-kit/runner/src/index.ts <command>`, after a one-time
   `npm ci --prefix .bench-kit/runner`; you run these yourself, never
   as instructions handed to the user), not "by eye". A diagnosis without reproduction is
   speculation — label it as such.
3. **Classification is mandatory.** Every diagnosis ends with one of
   the three classes + evidence. When evidence is missing, say plainly
   what was missing (e.g. the attempt directory no longer exists on
   this machine) — do not guess the class.
4. **Eras before comparisons.** Before concluding "the model dropped
   between runs", check the stamps tuple (`template_version`,
   `task_hash`, `judge_model`, `rubric_version`) — different eras are
   not a model regression, just a change of measure. The leaderboard
   does not mix them; neither do you.
5. **A budget instead of a consent ritual.** Re-judging and
   re-asserting cost money (judge calls, containers), but the
   instance's budget guards them — after a series, report the actual
   cost; consent is required only for a series clearly larger than
   usual or for raising the budget.
6. **Link evaluation materials, do not copy them.** In comments/issues,
   quote the minimal fragments needed as proof plus paths in the
   instance repo; do not paste entire assertions or rubrics.

## Where the artifacts are

Everything is local — no artifact downloads, no retention windows:

- **Results (committed)**: `results/<task>/<model>/trial-N/`
  (`result.json` + `judge.json`) in the instance repo — the canonical
  tree the leaderboard reads; git history holds prior evaluations
  (re-runs after rubric calibration).
- **Preserved attempts (disk)**: `attempts/<task>/<model>/trial-N/` —
  the full evidence chain (contract: `.bench-kit/ATTEMPT_FORMAT.md`).
  Superseded re-runs live next door as
  `trial-N.superseded-<stamp>/`.
- **Attempt files**: `attempt.json` (metadata, format version),
  `execution.json` (agent exit code; 124 = timeout), `agent.log`
  (full OpenCode output; on disk, gitignored), `patch.diff` (the
  agent's work vs the starting commit), `workspace/` (the agent's
  final workspace state — on disk, gitignored), `metrics.json`
  (cost/tokens/time from the trial's local opencode.db;
  `"incomplete": true` = the adapter found no data), `container.log`
  (exists only on infrastructure failure), `signal.json` (exists only
  when the agent was killed by a signal even after retry — signal
  name, hint, memory limit, log tail; such an attempt has
  `resource_kill: true` in attempt.json and is excluded from
  evaluation), `eval-plan.json`, `checks.json` (score per non-LLM
  assertion), `judge.json` (verdicts + justifications), `result.json`
  (scores, total, era stamps).

## Procedure

### 1. Scope the evidence (always first)

Locate what you are diagnosing on disk. The default is unambiguous:
`results/` in the repo for scores, `attempts/` for the evidence chain
— confirm in one sentence what you are taking (a path given by the
user wins as-is). Aggregate context (medians, pass@k) does not exist
as a stored file: compute it with `bench report --run results/` (or
over a narrower directory) when you need it, or read the leaderboard's
`data.json` if one was built.

Settle two edge cases immediately, before going further:

- **attempt missing for a result** — `result.json` exists in
  `results/` but the attempt directory is gone (another machine,
  disk cleanup). Say so plainly: the diagnosis then stops at the
  result.json level, and the cause class cannot be determined (rule 3).
- **run failed mid-way** — a preserved attempt with
  `infra_failure`/`resource_kill` produced no `result.json` and never
  will. Descend straight to the attempt's diagnostics
  (`container.log` / `signal.json`) and note that you have no
  comparison against medians.

### 2. Question and scope

Establish what you are diagnosing: a single trial / model×task / the
whole run / a change between runs. For cross-run comparisons — rule 4
first (identical stamps or not).

### 3. Top-down: the report level

(Synthesize it first: `bench report --run results/` — see step 1.)

- medians of total/cost/time per model×task — what stands out,
- **pass@1 vs pass@k**: a gap (e.g. 0.33 vs 1.0) = instability, not
  inability — pick a pair of trials to descend into: one that passed
  and one that did not,
- total ≈ 0 has no single cause — an empty diff (the agent did
  nothing), a destructive file overwrite, and work scored 0 look
  identical at the aggregate level. Do not conclude from the median; the
  artifacts decide (step 5).

### 4. Down: the trial's result.json

Which component drags the total down (`scores.static/tests/e2e/judge`;
`null` = weight 0, not counted). Compare with trials that passed — the
difference usually points to one component, not all of them.

### 5. Artifacts: symptom → path

| Symptom | Where to look | Typical resolution |
|---|---|---|
| empty/near-empty `patch.diff` | `agent.log` | model does not call tools (e.g. literal `<tool_code` printed as text) → model fault; unclear prompt → task fault |
| `execution.json` exit 124 | `agent.log` (was there progress) | going in circles → model fault; making progress but ran out of time → timeout too short, task fault |
| `execution.json` exit 137 (or another 128+N) without a timeout | `signal.json`, tail of `agent.log` | agent killed by a signal — SIGKILL during install/build = resource exhaustion → infrastructure fault (since 0.11.0 the runner classifies this itself: retry, `resource_kill`, exclusion from evaluation; no `signal.json` = run predates that version, classify manually) |
| `container.log` exists | `container.log`, `execution.json` | container died before the agent → infrastructure fault |
| `attempt.json` with `provider_error: true` | `agent.log` (5xx/429), `provider-error-attempt-1/` | transient provider outage; the runner did 1 retry — if that failed too, infrastructure fault (provider), not the model |
| `metrics.json` incomplete | `agent.log`, OpenCode storage | adapter/OpenCode version → infrastructure fault |
| assertion 0 in `checks.json` | assertion log + read the assertion + cross-attempt check: does ANY trial green it? (`bench assert --task <t> --patch <trial-1/patch.diff> --patch <trial-2/patch.diff> …`) | red across all attempts incl. ones whose diffs plausibly do the work → suspect-harness (broken env, repo command drift — and a shape-neutrality violation: the script assuming an implementation shape, the retired convention), task fault; green for some attempts → model fault |
| judge 0 in `judge.json` | raw response in `judge.json` | no valid JSON / wrong format → rubric contract, task fault; a valid verdict with justification → read the criteria |
| judge diverges across trials on similar diffs | `bench judge --task <t> --patch <trial's patch.diff>` ×3 | large spread → rubric needs calibration (bench-rubric), task fault |
| large out-of-scope `patch.diff` | prompt.md + the scope criterion in the verdict | prompt sets no boundaries → task fault; it does → model fault |
| non-empty `patch.diff`, yet judge 0 | hunk headers (`@@ -1,N +1,M @@` spanning the whole file) | destructive overwrite instead of incremental edits → model fault (the judge's verdict will confirm it in the justifications) |

Perform the reproductions from the right column per rules 2 and 5
(proof by command, explicit costs) — with two caveats, because
reproduction is the most expensive activity in this whole skill:

- **Exhaust the artifacts before the first reproduction.** The
  artifacts are already paid for; a reproduction costs a container or
  judge calls. Very often the full diagnosis is in `patch.diff` and the
  log tail — e.g. the process exit code alone plus the last log lines
  unambiguously indicate resource exhaustion, without running anything.
- **Batch the reproductions.** If you must replay an assertion or a
  verdict, do it for all suspect trials at once, not trial by trial as
  you read: `bench assert --task <t> --patch <trial-1/patch.diff>
  --patch <trial-2/patch.diff> …` is one environment entry, N results;
  run judge verdicts in parallel in the background.

### 6. Classification and delegation

**Stop rule:** the cause class is the skill's output — once the
evidence suffices to name it, you are done. Deeper analysis within a
class belongs to the fixing skill, which will start with its own
measurements anyway. And **route recurring diagnoses to the source
skill**: if the same failure class keeps coming back (a pattern, not an
incident), the output of triage is a fix to the procedure in the skill
that produces it — otherwise you pay the same triage every run.

- **Model fault** — the result stands, the leaderboard tells the truth.
  In the output, describe the behavior pattern (more valuable than the
  number: "loses tool calling", "does not respect scope").
- **Task fault** — an issue in the instance repo + delegation:
  assertion / overlay / prompt / timeout → bench-refresh-task (or
  bench-new-task + bench-build for a new task), rubric → bench-rubric.
  Note in the issue which results of the current era are tainted — the
  era will close with the fix anyway.
- **Infrastructure fault** — an issue in the template repo (runner /
  workflow / image) with `container.log` / `execution.json`; mark the
  affected trials' results as uninterpretable, the run to be repeated
  after the fix.

### 7. Output

A comment (on the PR/run) or an issue per
[EXPLAIN_TEMPLATE.md](EXPLAIN_TEMPLATE.md): symptom → chain of
evidence → class → recommendation → triage cost. You do not change the
scoring (rule 1); if the fix is urgent, launch the appropriate skill
separately, after the user's consent.

### 8. Next step

End your summary response with a **Next step** section: the state in
one sentence (what was diagnosed, where the issue is), **one**
recommendation with a one-sentence justification, at most two
alternatives with a price, and — separately — what awaits a human
decision. Typical transitions by class:

- **task fault** → bench-refresh-task or bench-new-task + bench-build —
  depending on whether the fix preserves the task's intent;
- **rubric fault** → bench-rubric;
- **infrastructure fault** → repeat the run after the fix — the
  affected trials' results are uninterpretable;
- **model fault** → nothing in the benchmark — that is the answer, not
  a problem to fix.

Do not propose another run until the previous one is interpreted: if
the run had trials killed by infrastructure, a second run will repeat
the same failure and the same invoice.
