![](./benchkit.png)

# 10x-bench-kit

A template for your company's AI agent benchmark. Create an instance
with [10xCLI](https://github.com/przeprogramowani/10x-cli), then work
through **skills in your AI coding tool**: define representative tasks,
build them, measure models, and decide which model to use for each
class of work.

**The benchmark is local-first.** Attempts and evaluations run on your
machine or a VPS with a container engine. GitHub Actions handles
readiness checks and optional leaderboard publication. Paid execution
stays on the measurement host.

Trials currently use **OpenCode** as the execution harness. The benchmark
measures quality, cost, and execution time.

## Get started

You need [10xCLI](https://github.com/przeprogramowani/10x-cli), an AI coding
tool that supports the installed skills, Docker or Podman, Node.js, and
provider API keys in your shell environment. The **bench-wiring** skill
checks machine readiness and sets up runner dependencies.

From your product repository, create a benchmark instance:

```bash
10x bench-kit init my-bench
```

Init registers the product repository as the first base repo and leaves
its working clone in `.repos/`. Open the generated `my-bench` directory
in the AI coding tool you selected during init, then ask:

> Use bench-wiring to check this instance and run the first local smoke measurement.

The skill checks configuration, container access, and credentials, then
proves that execution and evaluation work locally. Publication is optional.

**Init and update are the user-facing CLI operations.** All benchmark
work goes through skills. The agent invokes the internal runner and
checks its output as part of each skill's procedure.

## Everyday workflow

Name the skill in your message to the agent. Follow this sequence after
wiring; repeat it as your work and model choices change.

| Step | Skill | Example prompt | What you get |
|---|---|---|---|
| 1. Define tasks | [bench-new-task](.agents/skills/bench-new-task/SKILL.md) | “Use bench-new-task to turn our recurring bug-fix work into benchmark task orders.” | A short interview and orders in `tasks/backlog.md`, tied to a decision, a class of work, and its current cost. |
| 2. Build tasks | [bench-build](.agents/skills/bench-build/SKILL.md) | “Use bench-build to build the pending backlog.” | Pinned tasks, isolated evaluation materials, and evidence in `reports/<task>-build.md`, ready for your review. |
| 3. Measure models | [bench-measure](.agents/skills/bench-measure/SKILL.md) | “Use bench-measure to compare our configured models on these tasks within the current budget.” | Preserved attempts, evaluated results, actual spend, and the `results/` paths to review. |
| 4. Make a decision | [bench-summary](.agents/skills/bench-summary/SKILL.md) | “Use bench-summary to show which model we should use for this work and what it costs.” | A self-contained HTML summary and recommendation based on pass rate, uncertainty, cost per acceptable result, and review burden. |

**You review and commit the files.** Skills leave task files, reports, and
results in the working tree; they do not commit or push them. If you
configure leaderboard publication, pushing committed results triggers
its rebuild.

The configured `defaults.max_cost_usd` limits the measurement run.
Skills project cost before execution and report actual spend afterwards.
Raising the budget requires your approval.

## Setup, diagnosis, and maintenance

Use these skills when you need them; they are not extra mandatory steps
in every measurement.

| Skill | When to use it | Example prompt |
|---|---|---|
| [bench-wiring](.agents/skills/bench-wiring/SKILL.md) | Initial setup or changes to instance wiring. | “Use bench-wiring to check this instance's local setup.” |
| [rate-attempt](.agents/skills/rate-attempt/SKILL.md) | Judge a preserved attempt with tools, or re-evaluate it after a rubric change. Also used by bench-measure. | “Use rate-attempt to evaluate the completed attempts for this task.” |
| [bench-explain-results](.agents/skills/bench-explain-results/SKILL.md) | A result is surprising, a trial failed, or a model regressed. | “Use bench-explain-results to explain this model's failures from the preserved evidence.” |
| [bench-rubric](.agents/skills/bench-rubric/SKILL.md) | Check API-judge consistency or compare judges using real preserved attempts. | “Use bench-rubric to check whether these verdicts are stable.” |
| [bench-refresh-task](.agents/skills/bench-refresh-task/SKILL.md) | A task has expired or its base repository has moved on. | “Use bench-refresh-task to refresh this expired task and document the new comparison era.” |

Skill links point to this template's `.agents/skills/` directory. Init
installs them in the directory appropriate for your selected tool; the
selection is recorded in `.bench-kit/instance.json`.

## What an instance keeps

| Location | Contents |
|---|---|
| `tasks/` | Backlog and tasks: pinned starting points, prompts, and overlays. |
| `evaluation-pool/` | Rubrics and execution guards, isolated from the agent solving the task. |
| `bench.config.yaml` | Base repositories, models, judge, budgets, and run defaults. |
| `attempts/` | Preserved trials: workspace, patch, agent log, and execution metrics. |
| `results/` | Evaluated results and verdicts, versioned by you in git. |
| `reports/` | Task-build evidence for review. |
| `.repos/` | Local base-repository clones, excluded from git. |
| `.bench-kit/` | Internal runner and contracts, maintained by the kit. |

## Attempts, evaluation, and comparability

Execution and evaluation are independent. Each trial runs a model against
a task in an isolated container, with no evaluation materials in its
workspace. The attempt preserves the resulting workspace, patch, logs,
and cost metrics on the measurement host.

Evaluation uses a disposable copy of that workspace in a container.
Repository-native execution guards supply facts; the judge assesses the
implementation against the task rubric and can build, test, and inspect
it with tools. Results are written separately to `results/`.

**Preserved attempts can be evaluated again.** A rubric or judge change
uses the existing attempts, avoiding another model execution. Changing
the task itself requires new attempts. Results carry task, rubric, and
judge version information and are comparable only within the same era.
Scoring changes require evidence and a PR that explains their impact on
comparability.

For artifact details, see the [attempt format](.bench-kit/ATTEMPT_FORMAT.md).

## Update an instance

From the benchmark instance directory:

```bash
10x bench-kit update
```

| Zone | Owner | Update behavior |
|---|---|---|
| `.bench-kit/` | Kit | Replaced atomically. |
| Installed skills and `AGENTS.md` | Shared | Proposed diff for your review. |
| Tasks, evaluation materials, configuration, attempts, and results | You | Left untouched. |

Review the proposed shared-file changes and the [changelog](CHANGELOG.md).
Use **bench-wiring** if the update requires a wiring check, and
**rate-attempt** when a scoring change calls for re-evaluation of
preserved attempts.
