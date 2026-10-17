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

Three skills, three concepts: **define → measure → decide.** Each
SKILL.md is short and routes to the procedures beside it, loaded only
when the step needs them:

- **bench-define**: what we measure. Real work becomes tasks.
  - **PR mining** is the default source (`MINING.md`, `mine-prs.mjs`).
    A merged change that brought tests becomes a task: the pin is its
    parent, its tests are a hidden fail-to-pass guard admitted only
    without shape coupling, and its code proves solvability.
  - The **interview** (`INTERVIEW.md`) covers work without history, and
    **refresh** (`REFRESH.md`) handles expired tasks.
  - Orders go to `tasks/backlog.md` (`BACKLOG_TEMPLATE.md`). **Build**
    (`BUILD.md`) fans out one subagent per order (`TASK_AUTHORING.md`,
    `RUBRIC_AUTHORING.md`), runs a batch gate and writes evidence
    reports (`REPORT_TEMPLATE.md`). No git.
- **bench-measure**: run models on it.
  - **Preflight / wiring** (`WIRING.md`).
  - The matrix run: cost projection against the budget, preserved
    attempts, top-up.
  - Evaluation by the **judge with tools**, one subagent per attempt
    (`RATE_ATTEMPT.md`; verdicts signed with `--judge-mode`).
  - **Judge diagnostics** (`JUDGE_DIAGNOSTICS.md`), and the "new model
    came out" re-run on the same tasks.
- **bench-decide**: what it means.
  - `summarize.mjs` + `analytics.mjs` compute the routing decision:
    pass rate with interval and pass^k per task × model; class × model
    with tasks as the unit; paired comparisons by sign test; the
    resolution of the task set; the time horizon.
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
