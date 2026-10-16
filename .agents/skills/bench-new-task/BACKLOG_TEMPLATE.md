# Order backlog template — `tasks/backlog.md`

The backlog is a stateful coordination document between bench-new-task
(which appends orders) and bench-build (which builds tasks from them).
The runner ignores it (in `tasks/` it reads only task directories), so
it does not affect scoring. Skills only edit this file in the working
tree — git (commit, push) is managed by the user.

**The backlog records decisions; the disk records progress.** The
**Status** field carries only the two states a person decides:

- `pending` — the order stands (set by bench-new-task);
- `dropped` — the order was abandoned, with a one-sentence reason. Do
  not delete entries; the decision history stays.

How far an order has got is **derived, never written**:
`bench backlog` reads the facts the workflow already leaves on disk
and reports each order's stage:

| Stage | The fact it is derived from |
|---|---|
| `ordered` | no `tasks/<name>/task.yaml` yet |
| `building` | `tasks/<name>/todo.md` exists (a bench-build subagent is working; a todo.md untouched for hours is flagged) |
| `built` | `task.yaml` exists, the report `reports/<name>-build.md` has no filled `## Batch gate` section yet |
| `ready` | the report carries the batch gate; no attempts yet |
| `measuring` | attempts exist, but not every model in `defaults.models` has `defaults.trials` attempts evaluated in the current era |
| `measured` | every cell has its target of current-era evaluations, so bench-summary can use it |

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

Orders are created by the **bench-new-task** skill and built by the
**bench-build** skill. Status: pending / dropped — progress (ordered →
building → built → ready → measuring → measured) is derived from disk
by `bench backlog`, never written here. Skills only edit this file —
git is managed by the user.

## <task-name>

- **Status**: pending
- **Added**: <YYYY-MM-DD>
- **Decision**: <the routing question this task's result would settle,
  verbatim from the user — e.g. "can feature work in edu-platform go
  to a cheap model instead of a sonnet-class one?". An order without
  one is not built (bench-new-task rule 7).>
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
- **Evaluation axis**: <what differentiates scores in this task — the
  user's do's and don'ts (e.g. "reward a minimal diff", "the public
  API must not change"), and for large tasks the milestone/phase map
  for partial credit. This is the primary grading source: there is no
  reference implementation — the rubric is derived from these criteria
  (written by bench-build, calibrated by the first real attempts).
  When the user deliberately named no axis: "at bench-build's
  discretion".>
- **Premises**: <the order's load-bearing claims about the base repo,
  one line each, carrying the probe's verdict and the SHA it read:
  "confirmed @<sha> — <evidence>" / "partly true @<sha> — <what holds,
  what does not>". A refuted premise never appears here as a claim —
  the order was reshaped around it before being written. A claim that
  was not probed is marked "assumed, unverified" in plain words, so the
  builder can see what is load-bearing and unchecked.>
- **Description**: <2–6 sentences: what is to be done, the symptom/goal,
  boundaries ("change nothing beyond…"). For bugfix-type tasks: what
  bug is to be seeded via the overlay and how to tell it is fixed.>
- **Notes**: <optional: ideas for assertions/evaluation components,
  whether a judge component is expected, the verification expectation
  for the prompt, other decisions from the interview>
- **Build log**: <optional, appended by bench-build only — one dated
  line per failed build or failed batch gate: "<YYYY-MM-DD> refused —
  <reason>" / "<YYYY-MM-DD> gate red — <assertion, one line>". This is
  the order's history; its stage stays derived (`bench backlog`).>
```

Entry rules:

- The entry name = the target `tasks/<name>/` directory name
  (kebab-case, says WHAT is to be done). No collisions with existing
  tasks or other entries.
- The entry must be self-sufficient: the bench-build subagent has no
  access to the conversation in which the order was created.
- The **Description** and **Notes** fields are design decisions, not
  the content of `prompt.md` — bench-build will write the prompt at the
  declared guidance level.
- **Premises** are probed, never assumed (bench-new-task step 1a). The
  field exists because a false premise survives the interview intact
  and only breaks in bench-build, after a whole authoring cycle has
  been spent on it — and a "partly true" one can survive even that,
  into a rubric that grades solvers against a half of the repo that
  does not exist.
