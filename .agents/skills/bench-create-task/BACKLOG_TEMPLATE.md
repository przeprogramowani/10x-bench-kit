# Order backlog template — `tasks/backlog.md`

The backlog is the decision document of bench-create-task: its sources
(INTERVIEW.md, MINING.md) append orders, and its build step (BUILD.md)
turns them into tasks.
The runner ignores it (in `tasks/` it reads only task directories), so
it does not affect scoring. Skills only edit this file in the working
tree — git (commit, push) is managed by the user.

**The backlog records decisions; the disk records progress.** The
**Status** field carries only the two states a person decides:

- `pending` — the order stands (set by bench-create-task);
- `dropped` — the order was abandoned, with a one-sentence reason. Do
  not delete entries; the decision history stays.

How far an order has got is **derived, never written**:
`bench backlog` reads the facts the workflow already leaves on disk
and reports each order's stage:

| Stage | The fact it is derived from |
|---|---|
| `ordered` | no `tasks/<name>/task.yaml` yet |
| `building` | `tasks/<name>/todo.md` exists (a build subagent is working; a todo.md untouched for hours is flagged) |
| `built` | `task.yaml` exists, the report `reports/<name>-build.md` has no filled `## Batch gate` section yet |
| `ready` | the report carries the batch gate; no attempts yet |
| `measuring` | attempts exist, but not every model in `defaults.models` has `defaults.trials` attempts evaluated in the current era |
| `measured` | every cell has its target of current-era evaluations, so bench-analysis can use it |

A status nobody has to update cannot drift. When a session dies in the
middle of a build, `bench backlog` shows the order as building (todo.md
still there) or ordered again. It never stays stuck on a stale
`in-progress`. And because no skill rewrites status lines, a build
batch no longer creates edits that conflict with whoever else changed
the backlog meanwhile. Two branches that each append an order still
meet at the end of the file. Resolve that conflict by keeping both
blocks; `bench backlog` flags an entry that lost its Status line or
gained a second one.

Legacy values (`in-progress`, `built`, `done`) in existing backlogs are
still read. `bench backlog` reports when one contradicts the disk, for
example an orphaned `in-progress`, or a `done` whose report has no gate
evidence. Do not write them in new entries.

Document template:

```markdown
# Task order backlog

Orders are created and built by the **bench-create-task** skill
(interview or PR mining, then build). Status: pending / dropped — progress (ordered →
building → built → ready → measuring → measured) is derived from disk
by `bench backlog`, never written here. Skills only edit this file —
git is managed by the user.

## <task-name>

- **Status**: pending
- **Added**: <YYYY-MM-DD>
- **Source**: <interview | pr <merge-sha> (#<PR number>) | refresh> —
  where the order came from. `pr` orders (MINING.md) also carry Pin,
  Reference, Hidden tests and Coupled names below.
- **Decision**: <the routing question this task's result would settle,
  verbatim from the user — e.g. "can feature work in edu-platform go
  to a cheap model instead of a sonnet-class one?". An order without
  one is not built (INTERVIEW.md rule 7).>
- **Class**: <discovery-heavy / bugfix / localized refactor /
  greenfield component / … — the kind of work this task stands for.
  Results aggregate per class: one task is a hypothesis about one
  class, never a routing rule for the whole repo.>
- **Work baseline**: <roughly how often this work comes up and what it
  costs today (a human's afternoon / a run of the expensive model) —
  what the measurement is read against, and why this order was worth
  a build cycle.>
- **Type**: <implementation / bugfix / refactor / documentation>
- **Base repo**: <name from base_repos in bench.config.yaml>
- **Guidance level**: <product-level / directional / surgical>
- **Difficulty / time limit**: <easy|medium|hard> / <N> min
- **Human time**: <~N min (confirmed | estimated: <basis>)> — how long
  this work takes a developer. It feeds the time-horizon report
  (bench-analysis: "this model reliably handles N-minute tasks"). An
  estimate is marked as one, never written as a fact.
- **Evaluation axis**: <what differentiates scores in this task — the
  user's do's and don'ts (e.g. "reward a minimal diff", "the public
  API must not change"), and for large tasks the milestone/phase map
  for partial credit. This is the primary grading source: there is no
  reference implementation (a `pr` order's merged change proves
  solvability, but grades nothing) — the rubric is derived from these
  criteria (written by the build subagent, calibrated by the first real
  attempts). For a `pr` order the axis is proposed from the PR
  description and review comments (MINING.md §5). When the user
  deliberately named no axis: "at the builder's discretion".>
- **Premises**: <the order's load-bearing claims about the base repo,
  one line each, carrying the probe's verdict and the SHA it read:
  "confirmed @<sha> — <evidence>" / "partly true @<sha> — <what holds,
  what does not>". A refuted premise never appears here as a claim —
  the order was reshaped around it before being written. A claim that
  was not probed is marked "assumed, unverified" in plain words, so the
  builder can see what is load-bearing and unchecked. A `pr` order
  carries one line instead: "intent holds at pin @<sha> — proven at
  build by reference.diff" (MINING.md §5).>
- **Description**: <2–6 sentences: what is to be done, the symptom/goal,
  boundaries ("change nothing beyond…"). For bugfix-type tasks (not
  `pr` orders — a mined task has no overlay, the change's absence at
  the pin is the task): what bug is to be seeded via the overlay and
  how to tell it is fixed.>
- **Pin** (`pr` only): <full SHA — the mined change's parent>
- **Reference** (`pr` only): <full SHA of the mined change — the
  solution, never shown to the agent; proof of solvability at build.
  Its diff is regenerated with `mine-prs.mjs emit` when needed and
  never stored in the instance>
- **Hidden tests** (`pr` only): <the change's test files used as the
  `tests/<task>-pr` guard, and any dropped, with why>
- **Coupled names** (`pr` only): <names the hidden tests assert that
  the change introduced (`mine-prs.mjs show`, confirmed by reading the
  tests) — the prompt must state each verbatim; "none" when the tests
  only touch interfaces that exist at the pin>
- **Notes**: <optional: ideas for assertions/evaluation components,
  whether a judge component is expected, the verification expectation
  for the prompt, other decisions from the interview>
- **Build log**: <optional, appended by bench-create-task only — one dated
  line per failed build or failed batch gate: "<YYYY-MM-DD> refused —
  <reason>" / "<YYYY-MM-DD> gate red — <assertion, one line>". This is
  the order's history; its stage stays derived (`bench backlog`).>
```

Entry rules:

- The entry name = the target `tasks/<name>/` directory name
  (kebab-case, says WHAT is to be done). No collisions with existing
  tasks or other entries.
- The entry must be self-sufficient: the build subagent
  (TASK_AUTHORING.md) has no access to the conversation in which the
  order was created.
- The **Description** and **Notes** fields are design decisions, not
  the content of `prompt.md` — the build subagent (TASK_AUTHORING.md)
  will write the prompt at the declared guidance level.
- **Premises** are probed, never assumed (INTERVIEW.md step 1a). The
  field exists because a false premise survives the interview intact
  and only breaks in the build subagent (TASK_AUTHORING.md), after a
  whole authoring cycle has
  been spent on it — and a "partly true" one can survive even that,
  into a rubric that grades solvers against a half of the repo that
  does not exist.
