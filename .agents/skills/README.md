# .agents/skills — shared zone (agent skills)

Everything that requires judgment happens in a conversation with an agent —
not in the CLI. This is where the skills supporting the instance lifecycle
live.

Convention: `bench <command>` in these skills is shorthand for the runner
entrypoint (`node --experimental-strip-types .bench-kit/runner/src/index.ts
<command>`, run from the instance root after `npm ci --prefix
.bench-kit/runner`) — there is no `bench` executable in PATH. It is
benchmark internals: agents run it themselves and never instruct the user
to; the user's surface is the config, environment variables, and git. The
benchmark runs LOCALLY (operator machine / VPS) — GitHub Actions is only
readiness CI and leaderboard publication.

Target set (concept: SKILLS_DESIGN in the project repo):

- **bench-wiring** *(available)* — from a fresh `init` to a green
  `validate` and the first measured attempt on the operator's machine:
  base repo, models, API keys in the environment, a smoke
  `bench attempt` + `bench evaluate`, committed results; optionally the
  publication path (remote repo, readiness + leaderboard workflows).
- **bench-new-task** *(available)* — a short interview → a new task
  request in the stateful backlog `tasks/backlog.md`; a single session
  can define 5–10 requests without building anything.
- **bench-build** *(available)* — builds tasks from pending backlog
  requests: distributes them across subagents, each of which performs
  full authoring (prompt + pin + overlay + assertions with `reference`
  declarations + weights, all proven on the starting state via
  `bench assert` / `bench validate --assert`; no reference
  implementation — expectations for future attempts live in the review
  criteria and assertions); the result lands as files in the working
  tree with a per-task evidence report — git stays on the user's side.
- **bench-rubric** *(available)* — builds LLM-as-judge rubrics from
  the task's review criteria and calibrates them on a synthetic
  calibration set of designed quality (CALIBRATION_SET.md; real
  attempt diffs from `attempts/` join as runs accrue), measuring the
  judge's resolution and stability (`bench calibrate`), iterating on
  criteria, and a PR bumping the rubric version (frontmatter
  `version`). Calibration is cheap by construction: attempts are
  preserved, so a new rubric version means re-evaluating them, not
  re-running the matrix.
- **bench-measure** *(available)* — the measurement loop on this
  machine: scopes the matrix (models × tasks × trials), projects cost
  against the run budget, executes `bench attempt` (preserved
  attempts, top-up semantics), drives evaluation (rate-attempt per
  attempt, or the API judge for smoke runs) and hands the user the
  results table plus the `results/` paths to commit. The user's
  surface is consent and git — never runner commands.
- **rate-attempt** *(available)* — the judge as an agent WITH TOOLS:
  takes a preserved attempt (`attempts/<task>/<model>/trial-N/`),
  reads the rubric, treats guard results as facts, investigates a
  disposable copy of the preserved workspace (build, tests, running
  the app) and produces a verdict that `bench evaluate --verdict`
  folds into `results/` deterministically. Batch mode: a thin loop /
  subagent per attempt.
- **bench-refresh-task** *(available)* — refreshes an expired task
  (new pin + assertions) → a PR opening a new era of the task.
- **bench-explain-results** *(available)* — diagnoses results:
  drilling down from the aggregate through result.json to the
  preserved attempt's artifacts and classifying the root cause
  (model / task / infrastructure fault) with evidence; the output is
  a comment or an issue, never a scoring change.

In the template, skills live under the tool-agnostic `.agents/skills/`;
`10x bench-kit init` materializes them in the instance under the path of
the chosen agent tool (`.claude/skills/` for Claude Code, `.agents/skills/`
for Codex, etc. — the choice is recorded in `instance.json`).

Zone contract during `bench-kit update`: the kit **proposes a diff** of new
skill versions — the company decides what to accept. Local modifications
are legitimate and expected (per-company customization).
