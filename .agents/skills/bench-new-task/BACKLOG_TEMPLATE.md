# Order backlog template — `tasks/backlog.md`

The backlog is a stateful coordination document between bench-new-task
(which appends orders) and bench-build (which builds tasks from them).
The runner ignores it (in `tasks/` it reads only task directories), so
it does not affect scoring. Skills only edit this file in the working
tree — git (commit, push) is managed by the user.

Entry status lifecycle:

`pending` → `in-progress` (bench-build launched a subagent) →
`done` (the task's complete set of files is ready in the working tree)
or back to `pending` with a note when the build failed. Mark abandoned
orders as `dropped` with a one-sentence reason — do not delete entries,
the decision history stays.

Document template:

```markdown
# Task order backlog

Orders are created by the **bench-new-task** skill and built by the
**bench-build** skill. Statuses: pending / in-progress / done / dropped.
Skills only edit this file — git is managed by the user.

## <task-name>

- **Status**: pending
- **Added**: <YYYY-MM-DD>
- **Type**: <implementation / bugfix / refactor / documentation>
- **Base repo**: <name from base_repos in bench.config.yaml>
- **Guidance level**: <product-level / directional / surgical>
- **Difficulty / timeout**: <easy|medium|hard> / <timeout_s> s
- **Evaluation axis**: <what differentiates scores in this task — the
  user's do's and don'ts (e.g. "reward a minimal diff", "the public
  API must not change"); bench-build calibrates the rubric and variants
  against this. When the user deliberately named no axis: "at
  bench-build's discretion".>
- **Description**: <2–6 sentences: what is to be done, the symptom/goal,
  boundaries ("change nothing beyond…"). For bugfix-type tasks: what
  bug is to be seeded via the overlay and how to tell it is fixed.>
- **Notes**: <optional: ideas for assertions/evaluation components,
  whether a judge component is expected, the verification expectation
  for the prompt, other decisions from the interview>
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
