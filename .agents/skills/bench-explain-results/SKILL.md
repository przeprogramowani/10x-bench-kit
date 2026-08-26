---
name: bench-explain-results
description: >-
  Diagnoses benchmark run results: descends from report.json through
  result.json to trial artifacts (agent.log, patch.diff, checks.json,
  judge.json) and classifies the cause — model fault, task fault, or
  infrastructure fault. Works on both local and CI runs — starts by
  asking about the source of the results and fetches artifacts itself
  via gh. The output is a comment or issue with evidence, never a
  scoring change. Use after a run when a result is surprising, a model
  dropped between runs, a trial failed, or the user asks "why did this
  model score that / analyze the run".
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

1. **You never change the scoring.** No edits to `result.json`,
   `report.json`, the `bench-data` branch, tasks, assertions, rubrics,
   or `bench.config.yaml`. Even when an assertion bug is obvious:
   diagnosis → issue → fix via the appropriate skill (bench-build /
   bench-refresh-task / bench-rubric), never an edit as part of triage.
   Trial artifacts are read-only.
2. **Hypothesis → proof by command.** Verify suspicions about an
   assertion or the judge with the runner (`bench assert`,
   `bench judge`), not "by eye". A diagnosis without reproduction is
   speculation — label it as such.
3. **Classification is mandatory.** Every diagnosis ends with one of
   the three classes + evidence. When evidence is missing, say plainly
   what was missing (e.g. artifacts expired) — do not guess the class.
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
   instance repo; do not paste entire hidden tests or rubrics.

## Where the artifacts are

- **Local run**: `out/<run-id>/<task>/<model>/trial-N/`.
- **CI run**: `results-<slug>` artifacts (per model×task, same layout
  as local) + `report` — you download them to disk via `gh` (step 1).
  CI artifacts expire; the history of the reports themselves is
  permanent on the `bench-data` branch (`runs/<run_id>.json`).
- **Trial files**: `trial.json` (metadata), `execution.json` (agent
  exit code; 124 = timeout), `agent.log` (full OpenCode output),
  `patch.diff` (the agent's work vs the starting commit),
  `metrics.json` (cost/tokens/time; `"incomplete": true` = the adapter
  found no data), `container.log` (exists only on infrastructure
  failure), `signal.json` (exists only when the agent was killed by a
  signal even after retry — signal name, hint, memory limit, log tail;
  such a trial has `resource_kill: true` in trial.json and is excluded
  from evaluation), `eval-plan.json`, `checks.json` (score per non-LLM
  assertion), `judge.json` (verdicts + the judge's raw response),
  `result.json` (scores, total, era stamps).

## Procedure

### 1. Source of the results (always first)

Before reading anything, establish **where the artifacts come from** —
without that you have no `report.json` on disk. Ask via your tool's
question mechanism (AskUserQuestion / request_user_input; if
unavailable — a plain question in the conversation), in a single block,
with the options:

- **local run** — an `out/<run-id>/` directory; if there are several,
  propose the newest and confirm. Take a path given by the user as-is,
  without asking.
- **CI run** — you fetch via `gh`. Without a given id = the **latest**
  run of the `bench-run` workflow in the instance repo.

Exception: when the user already indicated the source in their request
(gave a path, a run id, a link to a run/PR, or wrote "the latest CI
run") — do not ask, just confirm in one sentence what you are taking.

Fetching from CI (the instance repo, not the template):

```bash
# id of the latest run, when the user did not provide one
RUN_ID=$(gh run list --workflow bench-run --limit 1 --json databaseId \
  --jq '.[0].databaseId')
gh run download "$RUN_ID" --dir out/ci-$RUN_ID     # results-* + report
```

The `results-<slug>` artifacts have the same layout as a local run, so
from this point on the procedure is identical; `report.json` lives in
the `report` artifact. Settle two edge cases immediately, before going
further:

- **artifacts expired** (repo retention) — only
  `runs/<run_id>.json` on the `bench-data` branch remains, i.e. the
  report level alone. Say so plainly: the diagnosis then descends at
  most to step 3, and the cause class cannot be determined (rule 3).
- **run unfinished / the `aggregate` job failed** — no `report`
  artifact; `results-*` may exist. Descend straight to the trials and
  note that you have no comparison against medians.

### 2. Question and scope

Establish what you are diagnosing: a single trial / model×task / the
whole run / a change between runs. For cross-run comparisons — rule 4
first (identical stamps or not).

### 3. Top-down: report.json

- medians of total/cost/time per model×task — what stands out,
- **pass@1 vs pass@k**: a gap (e.g. 0.33 vs 1.0) = instability, not
  inability — pick a pair of trials to descend into: one that passed
  and one that did not,
- total ≈ 0 has no single cause — an empty diff (the agent did
  nothing), a destructive file overwrite, and work scored 0 look
  identical in report.json. Do not conclude from the median; the
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
| `trial.json` with `provider_error: true` | `agent.log` (5xx/429), `provider-error-attempt-1/` | transient provider outage; the runner did 1 retry — if that failed too, infrastructure fault (provider), not the model |
| `metrics.json` incomplete | `agent.log`, OpenCode storage | adapter/OpenCode version → infrastructure fault |
| assertion 0 in `checks.json` | assertion log + read the hidden test + cross-attempt check: does ANY trial green it? (`bench assert --task <t> --patch <trial-1/patch.diff> --patch <trial-2/patch.diff> …`) | red across all attempts incl. ones whose diffs plausibly do the work → suspect-harness (agent-chosen path guessed, broken env — check the canary output), task fault; green for some attempts → model fault |
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
