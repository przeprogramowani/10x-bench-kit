---
name: bench-create-task
description: >-
  Creates benchmark tasks from the company's real work, in a short
  conversation. When the user names a change (PR number, commit, title
  or a few words about it), finds that merged commit and confirms it
  with them. When they name nothing, a cheap subagent (Sonnet- or
  Flash-class) reviews the last quarter of git history and proposes 3–5
  candidates — a bugfix, a feature, a refactor — and the user picks all,
  a subset or something else. A merged change with tests becomes a task
  (pin = state before the change, its tests = hidden fail-to-pass guard,
  the change itself = proof the task is solvable). Other sources: a short
  interview (work that has no PR yet) and refreshing an expired task.
  Orders land in tasks/backlog.md; building them produces task files
  with evidence reports — no git. Use when the user wants tasks, says
  "create a task / add tasks / turn PR #123 into a task / build the
  backlog / new task / refresh task", or bench backlog shows a class
  without enough tasks.
  Also use to fix or edit a task's rubric ("the rubric scores this
  wrong / fix the rubric / tighten criterion X"): the edit follows
  RUBRIC_AUTHORING.md, bumps the rubric's version and re-evaluates the
  preserved attempts.
---

# bench-create-task — from real work to tasks

This is the first of the benchmark's three concepts:

1. **create task**: what we measure (this skill);
2. **evaluate**: run models on it and judge the attempts (bench-evaluate);
3. **analysis**: what the results mean for routing work (bench-analysis).

Everything here produces one thing: **tasks a model can be fairly
measured on, each tied to a decision the company will make.** The
procedures live next to this file and are loaded when needed:

| Step | Procedure | When |
|---|---|---|
| Source: merged change | [MINING.md](MINING.md) + `mine-prs.mjs` | default — the user names a change (§1), or a subagent proposes 3–5 from the last quarter (§2) |
| Source: interview | [INTERVIEW.md](INTERVIEW.md) | work that has no merged change to mine (new kinds of work, hypotheticals) |
| Source: refresh | [REFRESH.md](REFRESH.md) | `bench validate` warns a task expired |
| Backlog contract | [BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md) | every order, whatever its source |
| Build | [BUILD.md](BUILD.md) (orchestrator) → [TASK_AUTHORING.md](TASK_AUTHORING.md) + [RUBRIC_AUTHORING.md](RUBRIC_AUTHORING.md) (subagent per order) → [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) | orders at stage `ordered` |
| Rubric fix | [RUBRIC_AUTHORING.md](RUBRIC_AUTHORING.md) ("After the first run") | real attempts show the rubric ranks wrong: edit, bump `version`, re-evaluate preserved attempts |

## Why mining is the default

A benchmark's verdicts are only as strong as its task count. Two
models compared on the same tasks can be told apart by a sign test,
and its resolution grows with tasks, not trials. **10 tasks resolve
only a ~70-point gap; 40 tasks get to ~26 points** (`bench backlog`
prints this per class). Hand-authored tasks cost an interview, a
build subagent and a batch gate each, so instances stall at 5–15
tasks: too few to settle anything close.

A merged change that came with tests is a task someone already paid
for:

- **Real work.** Taken from the company's own history, and
  uncontaminated, because the model never saw that private repo.
- **Fail-to-pass ground truth.** The change's tests, which engineers
  trust more than an LLM judge.
- **Proof of solvability.** The change itself is a reference
  implementation the agent never sees.

That is the SWE-bench recipe applied to the company's own repo.

## Hard rules

1. **Every order names a decision.** Whatever the source, an order
   records which routing decision its result settles, the class of work
   and what that work costs today (INTERVIEW.md rule 7). A mined PR is
   only a candidate until it is tied to a decision; mining a hundred
   changes of one class buys one hypothesis a hundred times.
2. **The agent never sees the solution, the tests or the evaluation.**
   The prompt is reverse-engineered from the change's *intent* (issue,
   PR description), never from its diff. Hidden tests and rubrics live
   in `evaluation-pool/`. The reference is the merged commit (SHA in
   the order and the build report); its diff is regenerated with
   `mine-prs.mjs emit` when needed and never stored in the instance.
3. **Hidden tests must not encode implementation shape.** A test
   asserting a name the change *introduced* forces the solver to guess
   it. Mined tests are admissible only when every interface they touch
   exists at the pin, or the prompt states it verbatim. `mine-prs.mjs`
   flags these as *coupled*; the builder confirms by reading the tests.
   Anything else is graded by the judge in plain language.
4. **Proven on the starting state, both directions.** A mined guard is
   red at the pin for the right reason (the change's new assertions
   fail; the rest of the suite passes) and green with the reference
   diff applied (`bench assert --patch`). Without both, it does not
   ship.
5. **Zero git.** Orders are edits to `tasks/backlog.md`; built tasks are
   files plus `reports/<task>-build.md`. At handover, `bench changes`
   prints the commit plan, and the user commits.

## Procedure

1. **Read the state.** Run `bench backlog`: stages per order, classes and
   what each class's task count can resolve. A class whose resolution
   is too coarse for the decision it carries is where new tasks pay
   most.
2. **Find the change — a conversation, not a scan dump.**
   - **The user named one** (PR number, SHA, title, "the fix for the
     login redirect"): find the merged commit (MINING.md §1) and show
     what you found — SHA, title, date, files, whether it brought tests,
     coupling. Ask "is this the one?" before anything else. Several
     matches → show them all; none → say so and offer §2.
   - **The user named nothing**: spawn one subagent on a cheap model
     (Sonnet-class in Claude Code, a mini/Flash model elsewhere) to
     review the last quarter and propose **3–5 candidates**, at least
     one bugfix, one feature and one refactor when history has them
     (MINING.md §2). Present the proposals in one table and ask: all of
     them, a subset, or something else? "Something else" loops back to
     the named-change path or another proposal round.
   - **No merged precedent** for the work the user wants measured:
     interview (INTERVIEW.md). **Expired task**: refresh (REFRESH.md).
3. **Write orders.** Use BACKLOG_TEMPLATE.md for the accepted changes
   (MINING.md §3–5: coupling, human time, the fields you propose).
   Mined orders carry their provenance (Source, Pin, Reference, Hidden
   tests, Coupled names, Human time). Accept the batch with the user
   before writing, ordered by decision value (rule 1).
4. **Build.** Follow BUILD.md: pool inventory, fan-out of one subagent
   per order, then one batch gate (`bench validate --assert`, smoke,
   discrimination counter-proof). Mined orders follow the "mined
   order" path of TASK_AUTHORING.md.
5. **Hand over.**
   - `bench backlog`: the batch's stages, and the resolution each class
     reaches now.
   - `bench changes`: the commit plan, one group per new task with its
     guard, rubric and report.
   - Next step: **bench-evaluate**.
