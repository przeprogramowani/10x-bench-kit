# Order backlog template — `tasks/backlog.md`

One entry per accepted change. The runner doesn't score it; `bench
backlog` reads it to derive each order's stage, and bench-analysis
reads Class.

**Status** is only a decision: `pending` (the order stands) or
`dropped` (with a one-sentence reason; entries are never deleted).
Progress is derived from disk by `bench backlog`, never written:

| Stage | Derived from |
|---|---|
| `ordered` | no `tasks/<name>/task.yaml` |
| `building` | `tasks/<name>/todo.md` exists |
| `ready` | `task.yaml` exists, no attempts yet |
| `measuring` | attempts exist, some cell is short of `defaults.trials` current-era evaluations |
| `measured` | every cell has its target |

```markdown
# Task order backlog

Orders are written and built by **bench-create-task**. Status: pending /
dropped. Progress comes from `bench backlog`.

## <task-name>

- **Status**: pending
- **Added**: <YYYY-MM-DD>
- **Source**: pr <reference-sha> (#<PR number>)
- **Decision**: <the routing question the result settles, e.g. "can
  feature work in <repo> go to <cheap model> instead of <strong
  model>?">
- **Class**: <bugfix / feature / refactor / anchor / …: the kind of
  work this task stands for>
- **Base repo**: <name from base_repos>
- **Guidance level**: <product-level / directional / surgical>
- **Time limit**: <N> min
- **Evaluation axis**: <do's and don'ts from the PR description and
  review comments; becomes the rubric>
- **Description**: <2–6 sentences of intent, nothing from the diff
  beyond Coupled names>
- **Pin**: <full SHA, the change's parent>
- **Reference**: <full SHA of the change, never shown to the agent>
- **Hidden tests**: <test files used; files or cases dropped and why;
  shape flags kept as contract (stated in the prompt) or to loosen>
- **Coupled names**: <names the tests assert that the change introduced,
  each stated verbatim in the prompt, or "none">
- **Build log**: <optional: "<YYYY-MM-DD> refused — <reason>">
```

The entry name is the `tasks/<name>/` directory (kebab-case, says what
is to be done). The entry must stand on its own: the build subagent
never sees the conversation that produced it.
