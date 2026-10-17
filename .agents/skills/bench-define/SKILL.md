---
name: bench-define
description: >-
  Defines what the benchmark measures: turns the company's real work into
  benchmark tasks. Default source is PR mining — merged changes from the
  base repo's history that brought their own tests become tasks (pin =
  state before the change, the change's tests = hidden fail-to-pass
  guard, the change itself = proof the task is solvable). Other sources:
  a short interview (work that has no PR yet) and refreshing an expired
  task. Orders land in tasks/backlog.md; building them produces task
  files with evidence reports — no git. Use when the user wants tasks,
  says "add tasks / build the backlog / mine our PRs / new task /
  refresh task", or bench backlog shows a class without enough tasks.
  Also use to fix or edit a task's rubric ("the rubric scores this
  wrong / fix the rubric / tighten criterion X"): the edit follows
  RUBRIC_AUTHORING.md, bumps the rubric's version and re-evaluates the
  preserved attempts.
---

# bench-define — from real work to tasks

This is the first of the benchmark's three concepts:

1. **define**: what we measure (this skill);
2. **measure**: run models on it (bench-measure);
3. **decide**: what the results mean for routing work (bench-decide).

Everything here produces one thing: **tasks a model can be fairly
measured on, each tied to a decision the company will make.** The
procedures live next to this file and are loaded when needed:

| Step | Procedure | When |
|---|---|---|
| Source: mine PRs | [MINING.md](MINING.md) + `mine-prs.mjs` | default — the base repo has history with tested changes |
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
2. **Pick the source.** Mine when the base repo has history (MINING.md).
   Interview when the work has no merged precedent (INTERVIEW.md).
   Refresh when `validate` says a task expired (REFRESH.md). The
   sources mix: a mined batch is usually 70–90% of a backlog, and the
   interview fills classes the history lacks.
3. **Write orders.** Use BACKLOG_TEMPLATE.md. Mined orders carry their
   provenance (Source, Pin, Reference, Hidden tests, Coupled names,
   Human time). Accept the batch with the user before writing,
   ordered by decision value (rule 1).
4. **Build.** Follow BUILD.md: pool inventory, fan-out of one subagent
   per order, then one batch gate (`bench validate --assert`, smoke,
   discrimination counter-proof). Mined orders follow the "mined
   order" path of TASK_AUTHORING.md.
5. **Hand over.**
   - `bench backlog`: the batch's stages, and the resolution each class
     reaches now.
   - `bench changes`: the commit plan, one group per new task with its
     guard, rubric and report.
   - Next step: **bench-measure**.
