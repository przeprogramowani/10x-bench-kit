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

One entry point and three concepts: **status, then create task → evaluate → analysis.** Each
SKILL.md is short and routes to the procedures beside it, loaded only
when the step needs them:

- **bench-status**: is the instance ready, and what is next. Machine,
  keys, base repos, models and judge, a green `bench validate`
  (warming the base image in the background), then one routed next
  step. The entry point of a fresh instance — there is no demo task.
- **bench-create-task**: what we measure. Real work becomes tasks.
  - **PR mining** is the only source (`MINING.md`, `mine-prs.mjs`).
    A merged change that brought tests becomes a task: the pin is its
    parent, its tests are a hidden fail-to-pass guard admitted only
    without shape coupling.
  - Orders go to `tasks/backlog.md` (`BACKLOG_TEMPLATE.md`). **Build**
    (`BUILD.md`, `RUBRIC_AUTHORING.md`) is static: task files, rubric,
    a report (`REPORT_TEMPLATE.md`) and a green `bench validate`. No
    containers, no judge, no attempts, no git.
- **bench-evaluate**: run models on it.
  - New tasks proven on the pin (`bench validate --assert`) before
    their first attempt.
  - The matrix run: cost projection against the budget, preserved
    attempts, top-up.
  - Evaluation with `bench evaluate`: guards plus the API judge on the
    diff. A new model is the same run with `--models <new>`.
- **bench-analysis**: what it means.
  - `summarize.mjs` + `analytics.mjs` compute the routing decision:
    pass rate with interval and pass^k per task × model; class × model
    with tasks as the unit; paired comparisons by sign test; the
    resolution of the task set.
  - Output is one HTML verdict plus a narrative. `EXPLAIN.md` diagnoses
    a surprising result from its preserved attempt.

Two read-only runner views tie the cycle together. `bench backlog`
derives each order's stage from disk (the backlog stores decisions
only), and `bench changes` turns the uncommitted working tree into a
commit plan grouped by scoring impact. Skills end their handover with
that plan instead of a list of paths.

In the template, skills live under the tool-agnostic `.agents/skills/`;
`10x bench-kit init` materializes them in the instance under the path of
the chosen agent tool (`.claude/skills/` for Claude Code, `.agents/skills/`
for Codex, etc. — the choice is recorded in `instance.json`).

Zone contract during `bench-kit update`: the kit **proposes a diff** of new
skill versions — the company decides what to accept. Local modifications
are legitimate and expected (per-company customization).
