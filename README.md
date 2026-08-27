![](./benchkit.png)

# 10x-bench-kit

Template repo for an internal AI agent benchmark. This repo is the basis
for a company's **benchmark instance**, created with [10xCLI](https://github.com/przeprogramowani/10x-cli)
(`10x bench-kit init`) — a separate repo that holds the tasks, the
evaluation pool, the configuration, and the results, and runs agent
trials against the company's product repositories in full isolation.

**The benchmark is local-first.** Attempts and evaluations run on the
operator's machine (or a VPS — same thing: a long-lived host with a
container engine). GitHub Actions is plain CI/CD: readiness checks and
leaderboard publication — never paid execution.

Initial harness: **OpenCode** (exclusively). Measured: quality
(execution guards + LLM-as-judge-with-tools), cost, and execution time.

## Prerequisites

- [10xCLI](https://github.com/przeprogramowani/10x-cli) — no global
  install needed (`npx @przeprogramowani/10x-cli bench-kit init <dir>`).
- A container engine: Docker Desktop or Podman.
- Node.js >= 20.
- Provider API keys in the shell environment (e.g. `OPENROUTER_API_KEY`).

## Three zones

The repo structure is split into zones with different owners and different
behavior during `10x bench-kit update`:

| Zone | Owner | On `update` |
|---|---|---|
| `.bench-kit/` | kit (us) | replaced wholesale (atomic) |
| `.agents/skills/` | shared | proposed diff — the company decides |
| `tasks/`, `evaluation-pool/`, `bench.config.yaml`, `results/`, `attempts/` | company | untouchable |

Details of each zone's contract live in that zone's README.

## Execution and evaluation are two independent processes

The core design decision (see `.bench-kit/ATTEMPT_FORMAT.md` for the
full contract):

1. **`bench attempt`** executes trials in throwaway containers and
   produces **preserved attempts** — `attempts/<task>/<model>/trial-N/`
   with `attempt.json`, `patch.diff`, `agent.log`, `metrics.json` (cost
   and tokens read from the trial's local OpenCode storage — a
   trustworthy source), and the full post-agent `workspace/` on disk.
   A paid attempt is never thrown away; re-runs set the old directory
   aside instead of deleting it.
2. **Evaluation** consumes preserved attempts and produces
   `results/<task>/<model>/trial-N/result.json` (+ the judge's verdict
   with justifications) — committed to the repo by the operator.
   - Execution guards (static/tests/e2e assertions) run hermetically in
     an evaluation container; their exit codes are **facts**.
   - The judge is an **agent with tools** (the `rate-attempt` skill):
     it reads the rubric, takes the guards as ground truth, and may
     build, test, and run the app on a disposable copy of the preserved
     workspace before scoring. Its verdict is folded in
     deterministically by `bench evaluate --verdict`. (A built-in
     API-judge path exists for automation/smoke.)
3. Changing a rubric or the judge **re-versions evaluations, not
   attempts**: a new rubric means re-evaluating preserved attempts
   (~judge cost per attempt), not paying for a new matrix run. Results
   compare only within an era (version stamps in every result.json).

## Walkthrough: from zero to a leaderboard

Day to day this whole loop is driven through skills in your agent tool
— **bench-wiring** (steps 1–2), **bench-measure** (steps 3–4: it runs
the attempts, drives rate-attempt judging, and hands you the results to
commit) — you talk to the agent, not to npm. There is no `bench`
executable; the raw runner invocation the skills use under the hood is
npm from the instance root (`npm ci --prefix .bench-kit/runner` once,
after init):

```bash
# 1. Materialize an instance (fresh git repo, manifest, skills, workflows)
10x bench-kit init my-bench && cd my-bench

# 2. Wiring (use the bench-wiring skill in your agent tool):
#    base repo + models + judge in bench.config.yaml, keys in env.
#    Gate: validate — green before anything runs.
npm run bench --prefix .bench-kit/runner --silent -- validate

# 3. Execute attempts (local; projection + budget ceiling up front;
#    top-up semantics: existing preserved attempts count)
npm run bench --prefix .bench-kit/runner --silent -- attempt \
  --tasks my-task --models openrouter/... --trials 3

# 4. Evaluate: guards + judge-with-tools
#    (rate-attempt skill per attempt, or the API judge for automation)
npm run bench --prefix .bench-kit/runner --silent -- evaluate

# 5. Review and commit results/ — the leaderboard workflow rebuilds the
#    dashboard on push (Cloudflare Pages / GH Pages / artifact).
git add results && git commit -m "results: my-task × sonnet"
```

Elsewhere in this repo `bench <command>` is shorthand for exactly that
npm invocation (equivalently: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>`).

Everyday DX principles:

- **One command from zero to an attempt** (`bench attempt <task>
  <model>`), one to an evaluation (`bench evaluate`).
- **Cheap resumability**: an interrupted attempt leaves its workspace on
  disk; diagnosis is `ls` + `cat agent.log`, not artifact downloads.
- **Parallelism without a CI runner ceiling** (`--parallel`).
- **Cost projection before start and a budget ceiling for the whole
  matrix run** (`defaults.max_cost_usd`), not per invocation.

## Trial lifecycle

One trial = one **model × task × trial** in a throwaway container:

1. **Workspace** — a fresh copy of the base repo at the pinned commit +
   the task overlay; empty `XDG_DATA_HOME`; zero evaluation materials.
2. **Execution** — `opencode run` non-interactively with `prompt.md`,
   under a hard timeout.
3. **Preservation** — workspace diff → `patch.diff`; the adapter reads
   OpenCode storage → `metrics.json`; the full workspace is kept on
   disk. The attempt directory is now self-sufficient.
4. **Evaluation** (independent, repeatable) — assertions from the pool
   are mounted only now: static → tests → e2e guards, then the judge
   with tools; the score is a weighted sum per `task.yaml`.
5. **Result** — `result.json` with version stamps (comparability era)
   in `results/`, committed by the operator.

## Versioning and "eras"

Every result is stamped with the scoring version, the task directory
hash, the judge model, and the rubric versions. Results are comparable
only within an era; releases marked `scoring-breaking` in
[CHANGELOG.md](CHANGELOG.md) close an era. Because attempts are
preserved, closing an evaluation era is cheap — re-evaluate; only
changes to the task itself require new attempts.

Full concept document: the benchmark DESIGN (internal repo).
