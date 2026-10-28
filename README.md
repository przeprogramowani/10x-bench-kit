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

Trials run in one of three agent CLIs ("harnesses"), all preinstalled in
the trial image at pinned versions: **OpenCode**, **Claude Code**, and
**OpenAI Codex CLI**. The harness is part of the model id, so the same
model in two CLIs shows up as two contestants:

| Model id in `defaults.models` | Runs in | Key |
|---|---|---|
| `openrouter/anthropic/claude-sonnet-5` | OpenCode (no prefix, as before) | `OPENROUTER_API_KEY` |
| `claude-code:claude-sonnet-5` | Claude Code, Anthropic API | `ANTHROPIC_API_KEY` |
| `claude-code:openrouter/anthropic/claude-sonnet-5` | Claude Code via OpenRouter | `OPENROUTER_API_KEY` |
| `codex:gpt-5.1-codex` | Codex CLI, OpenAI API | `OPENAI_API_KEY` |
| `codex:openrouter/openai/gpt-5.1-codex` | Codex CLI via OpenRouter | `OPENROUTER_API_KEY` |

The benchmark measures quality, cost, and execution time. Where a CLI
does not report a trustworthy cost (Codex, or Claude Code routed through
OpenRouter), the runner prices the trial's tokens. Prices come from the
`pricing` map in `bench.config.yaml` or from OpenRouter's public model
catalog, and the source is recorded with the cost. A model that cannot
be priced is refused before any money is spent.

## Get started

You need [10xCLI](https://github.com/przeprogramowani/10x-cli), an AI coding
tool that supports the installed skills, Docker or Podman, Node.js, and
provider API keys in your shell environment.

From your product repository, create a benchmark instance next to it:

```bash
cd my-product
10x bench-kit init      # creates ../my-product-bench; add --tool claude-code --yes in a non-interactive shell
```

Init registers the product repository as the first base repo and leaves
a full-history working clone in `.repos/` (PR mining reads that history).
It checks your machine on the spot (container engine, memory, API keys:
fix anything it flags *before* opening the agent, which inherits your
shell's environment) and ends by printing the exact first prompt. Open
`../my-product-bench` in the AI coding tool you selected and ask:

> Use bench-status to check this instance, then bench-create-task to create our first tasks.

bench-status confirms machine, keys, base repo, models and judge (a
couple of minutes, no paid calls), warms the base image in the
background and, when everything is green, prints a brief of the
instance: what it tests, on which models, how it judges, budget and
results so far. There is no demo task: bench-create-task proposes 3–5
candidates from your last quarter of merged PRs (or takes the one you
name), and building the first one is the first end-to-end proof that
execution and evaluation work. Publication is optional.

**Init and update are the user-facing CLI operations.** All benchmark
work goes through skills. The agent invokes the internal runner and
checks its output as part of each skill's procedure.

## Three concepts: create task → evaluate → analysis

The whole workflow is three skills, plus **bench-status** as the entry
point ("is this instance ready, and what's next?"). Name one in your
message to the agent; each loads its detailed procedures only when it
needs them.

| Concept | Skill | Example prompts | What you get |
|---|---|---|---|
| **Create task** — what we measure | [bench-create-task](.agents/skills/bench-create-task/SKILL.md) | “Use bench-create-task.” · “Use bench-create-task to turn PR #412 into a task.” · “Use bench-create-task to build the pending backlog.” | Tasks taken from your real work, in a short conversation. Name a PR or commit and the agent finds it and confirms it with you; name nothing and a cheap subagent reviews the last quarter and proposes 3–5 candidates (a bugfix, a feature, a refactor) for you to pick from. A merged change with tests becomes a task, with its tests as the hidden grader. Orders tied to a decision land in `tasks/backlog.md`. Building is static (task files, rubric, `reports/<task>-build.md`, a green `bench validate`); the first run proves the task on its pin before paying for attempts. |
| **Evaluate** — run models and judge them | [bench-evaluate](.agents/skills/bench-evaluate/SKILL.md) | “Use bench-evaluate to compare our configured models within the budget.” · “A new model came out — measure it against what we use.” | Preflight (setup, keys, engine), preserved attempts, new tasks proven on their pin, evaluation with guards plus an API judge on the diff, actual spend, pass counts per task × model. |
| **Analysis** — what it means | [bench-analysis](.agents/skills/bench-analysis/SKILL.md) | “Use bench-analysis to show which model and tool we should use for bugfixes.” · “Why did model X fail here?” | An agent-supported analysis in conversation, ending in a one-page HTML verdict. It covers pass rate with uncertainty, cost per acceptable result and review burden; class × model comparisons that count tasks, not trials; whether a difference is actually resolved; what your task set can resolve and how many tasks a closer call needs; and the time horizon (“reliably handles ~N-minute tasks in your repo”). |

**Why mining matters:** comparing two models on the same tasks resolves
small differences only with many tasks. 10 tasks tell apart a ~70-point
gap, 40 tasks a ~26-point one. `bench backlog` shows this per class of
work, and mining is how you get to dozens of real tasks without
authoring each by hand.

**You review and commit the files.** Skills leave task files, reports, and
results in the working tree; they do not commit or push them. Each skill
ends its handover with a **commit plan**: changes grouped by intent (new
task with its grader and report, new evaluations, a rubric bump with its
re-evaluations, backlog). Each group is marked neutral, data, or
era-closing (needs a PR) and comes with ready `git add` / `git commit`
lines. You review what each group does to comparability rather than a
flat list of paths. If you configure leaderboard publication, pushing
committed results triggers its rebuild.

The configured `defaults.max_cost_usd` limits the measurement run.
Skills project cost before execution and report actual spend afterwards.
Raising the budget requires your approval.

Skill links point to this template's `.agents/skills/` directory. Init
installs them in the directory appropriate for your selected tool; the
selection is recorded in `.bench-kit/instance.json`.

## What an instance keeps

| Location | Contents |
|---|---|
| `tasks/` | Backlog and tasks: pinned starting points and prompts. |
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
diff against the task rubric. Results are written separately to `results/`.

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
Use **bench-evaluate** when a
scoring change calls for re-evaluation of
preserved attempts.
