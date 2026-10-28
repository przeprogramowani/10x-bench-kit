---
name: bench-create-task
description: >-
  Creates benchmark tasks from merged changes in the company's own git
  history, in a short conversation. When the user names a change (PR
  number, commit, title or a few words about it), finds that merged
  commit and confirms it. When they name nothing, a cheap subagent
  (Sonnet- or Flash-class) reviews the last quarter of history and
  proposes 3–5 candidates (a bugfix, a feature, a refactor); the user
  picks. A merged change with tests becomes a task: pin = the change's
  parent, its tests = the hidden fail-to-pass guard, its intent = the
  prompt. Building is static: files plus `bench validate`, with no
  containers, no judge calls and no model attempts; everything that
  needs a run happens in bench-evaluate. Use when the user wants
  tasks, says "create a task / add tasks / turn PR #123 into a task /
  build the backlog / new task", or bench backlog shows a class without
  enough tasks. Also use to fix a task's rubric ("the rubric scores
  this wrong / tighten criterion X"): edit per RUBRIC_AUTHORING.md,
  bump the rubric's version, re-evaluate the preserved attempts.
---

# bench-create-task — from merged changes to tasks

The first of three skills: **create task** (this one) → **evaluate**
(bench-evaluate runs models and judges them) → **analysis**
(bench-analysis turns results into a routing decision).

A merged change that came with tests is a task someone already paid
for:

| Part of the change | Becomes |
|---|---|
| its parent commit | the **pin**, the state before the work |
| its tests (post-merge version) | the hidden guard `tests/<task>-pr` |
| its intent (PR description, issue, commit message) | `prompt.md` |
| its code | nothing: it's the reference, named by SHA, never shown to the agent |

| Step | File |
|---|---|
| Find candidates, check coupling | [MINING.md](MINING.md) + `mine-prs.mjs` |
| Order format | [BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md) |
| Build one order | [BUILD.md](BUILD.md) |
| Write the rubric | [RUBRIC_AUTHORING.md](RUBRIC_AUTHORING.md) |
| Build report | [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) |

## Hard rules

1. **Build is static.** No `bench assert`, no `bench judge`, no
   `bench attempt`, no `bench validate --assert`, no probe, empty or
   variant diffs. The build ends at a green `bench validate`. Whether
   the guards behave on the pin, whether a model can solve the task and
   whether the rubric separates good from bad work are all answered by
   bench-evaluate, on the real run.
2. **The agent never sees the solution, the tests or the evaluation.**
   The prompt comes from the change's intent, never from its diff.
   Tests and rubrics live in `evaluation-pool/`; nothing from there is
   copied into `tasks/`.
3. **Hidden tests must not encode implementation shape.** A test that
   asserts a name the change *introduced* is admissible only if the
   prompt states that name verbatim. Tests that assert internal
   structure (new module paths, helper names) are dropped (MINING.md
   §3).
4. **Zero git.** Orders are edits to `tasks/backlog.md`; built tasks are
   files plus `reports/<task>-build.md`. At handover, `bench changes`
   prints the commit plan, and the user commits.

## Procedure

1. **Read the state.** `bench backlog`: orders by stage, classes and
   what each class's task count can resolve.
2. **Find the change.**
   - **The user named one:** resolve it to a merged commit (MINING.md
     §1), show SHA, title, date, files, tests yes/no and coupling, and
     ask "is this the one?".
   - **The user named nothing:** one cheap subagent proposes 3–5
     candidates from the last quarter (MINING.md §2). Show one table
     and ask: all, a subset, or something else?
3. **Write orders.** For each accepted change: coupling decision
   (MINING.md §3), then one entry in `tasks/backlog.md` per
   BACKLOG_TEMPLATE.md. Propose Class and Decision for the whole batch
   in one question; the user confirms or corrects.
4. **Build.** BUILD.md, one order at a time, or one subagent per order
   when there are several. Each ends with `bench validate` green and
   `reports/<task>-build.md` written.
5. **Hand over.** `bench backlog` (the new tasks read `ready`), then
   `bench changes` and paste its commit plan. Next step:
   **bench-evaluate**, which proves the new tasks on the pin before it
   pays for any attempt.
