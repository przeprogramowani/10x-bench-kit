# .agents/skills — shared zone (agent skills)

Everything that requires judgment happens in a conversation with an agent —
not in the CLI. This is where the skills supporting the instance lifecycle
live.

Convention: `bench <command>` in these skills is shorthand for the runner
entrypoint (`node --experimental-strip-types .bench-kit/runner/src/index.ts
<command>`, run from the instance root after `npm ci --prefix
.bench-kit/runner`) — there is no `bench` executable in PATH. It is
benchmark internals: agents run it themselves and never instruct the user
to; the user's surface is the `bench-run` workflow, secrets, and git.

Target set (concept: SKILLS_DESIGN in the project repo):

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
- **bench-wiring** *(available)* — from a fresh `init` to a green
  `validate`: base repo, models, secrets, an image matching the
  company's stack.
- **bench-refresh-task** *(available)* — refreshes an expired task
  (new pin + assertions) → a PR opening a new era of the task.
- **bench-rubric** *(available)* — builds LLM-as-judge rubrics from
  the task's review criteria and calibrates them on a synthetic
  calibration set of designed quality (CALIBRATION_SET.md; real
  attempt diffs join as runs accrue), measuring the judge's resolution
  and stability (`bench calibrate`), iterating on criteria, and a PR
  bumping the rubric version (frontmatter `version`).
- **bench-explain-results** *(available)* — diagnoses run results:
  drilling down from report.json through result.json to the attempt
  artifacts and classifying the root cause (model / task /
  infrastructure fault) with evidence; the output is a comment or an
  issue, never a scoring change.

In the template, skills live under the tool-agnostic `.agents/skills/`;
`10x bench-kit init` materializes them in the instance under the path of
the chosen agent tool (`.claude/skills/` for Claude Code, `.agents/skills/`
for Codex, etc. — the choice is recorded in `instance.json`).

Zone contract during `bench-kit update`: the kit **proposes a diff** of new
skill versions — the company decides what to accept. Local modifications
are legitimate and expected (per-company customization).
