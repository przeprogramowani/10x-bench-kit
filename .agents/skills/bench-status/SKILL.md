---
name: bench-status
description: >-
  Read-only health check of a bench-kit instance and a single
  recommendation of what to do next. Always checks what varies per
  machine and session (`bench doctor`: container engine running,
  memory, runner deps, API keys exported, base repos reachable; clones
  in `.repos/`), re-validates instance content only when it could have
  drifted from the template (tasks exist or config edited), and reads
  the workload (tasks,
  backlog orders, expired tasks, preserved attempts and evaluations,
  uncommitted results), then routes to the ONE skill whose work is
  actually relevant now — so the next session works on the company's
  real tasks instead of setup leftovers. Spends nothing, changes
  nothing. Use at the start of a session, after `bench-kit init` or
  `bench-kit update`, or when the user asks "where are we / is the
  benchmark ready / what next / status".
---

# bench-status — is the instance ready, and what is worth doing next

You answer two questions and change nothing:

1. **Is this machine and this instance in a state where real work can
   happen?** (environment)
2. **Given what already exists, which piece of work is relevant to the
   user right now?** (workload)

The template ships **no demo task**: an instance measures only the
company's own tasks, so there is no fake attempt to "prove the pipe".
The environment is proven by deterministic checks here; the first paid
attempt is the batch-gate smoke of the first REAL task (bench-build).
This skill is what lets the next session skip straight to that work.

**Not to be confused with the runner command `bench status`** — that
one is the attempt tracker (preserved / running / evaluated per cell).
This skill uses it as one of its inputs.

## Hard rules

1. **Read-only.** No edits to any file, no git writes (reading
   `git status` / `git log` is fine; not even `fetch`), no
   `bench attempt`, no
   `bench evaluate`, no judge calls, no image builds started on your
   own. The only network traffic is what `bench doctor` / `bench
   validate` do themselves (ls-remote / shallow fetch of pins). If a
   check reveals something to fix, you name the skill or the user step
   that fixes it — you do not fix it here.
2. **Secrets: names and presence only** (`bench doctor` reports them).
   Never read, print, or store a value.
3. **The runner is your instrument.** Every "OK" carries the command
   output that proves it. Something you did not check is reported as
   "not checked", never as OK.
4. **One recommendation.** The output ends with exactly one next step,
   chosen by the routing table below — not a menu.
5. **Speak in the instance's state, not in tool jargon** (same as
   bench-wiring rule 8): "the base repo is reachable and pinned tasks
   exist on the remote", not "network phase green".
6. **Check what varies, not what is correct by construction.** A
   fresh instance is valid the moment init finishes — the template is
   tested in CI. What differs per machine and per session is the
   environment (engine running, keys exported, credentials, local
   clones), and that is what you always check. Instance content
   (config, tasks) is re-validated only when something could have
   moved it away from the template: a human edit, a task whose pin or
   `expires` ages, an update.

## Tools

`bench <command>` = `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` from the instance root
(prerequisite: `npm ci --prefix .bench-kit/runner` — if
`node_modules` is missing, that is itself a finding: report it and
route to bench-wiring, do not install). You run these yourself; never
hand the user a `bench …` command.

## Procedure

### 1. Environment — always (this is what varies)

Two checks, in one batch:

- `bench doctor` — one command for everything machine- and
  session-specific: container engine **running**, engine memory vs
  `resources.memory_mb`, node, runner deps installed, API keys for the
  configured models and judge **exported in this shell**, base repos
  reachable **with this machine's credentials**. Exit 1 = at least one
  MISSING; carry each line with its fix. Do not re-check by hand what
  doctor reports. Its two publication lines (instance remote,
  workflows) are WARN by design — mention them only as optional
  publication, never as a gap.
- Local clones: for each `base_repos[].name`, does `.repos/<name>/`
  exist (`git -C .repos/<name> rev-parse HEAD`)? `.repos/` is
  gitignored, so a second machine or a fresh clone of the instance
  repo has none — authoring skills would have nothing to read.

A base repo MISSING in doctor whose URL is still the template
placeholder (`example-org/demo-app`) is not a credentials problem: the
instance was never wired (standalone init) — say so and route to
bench-wiring.

Provider credit balance is the one thing no local check sees: list it
as "unverifiable from here" (an empty balance fails the first attempt),
not as a gap.

### 2. Instance content — only when it could have drifted

Run `bench validate` (full, with network) **only if** at least one of:

- tasks exist under `tasks/` (pins can vanish from the remote,
  `expires` dates pass — validate is the only thing that sees it);
- `bench.config.yaml` or `evaluation-pool/` was changed by hand —
  uncommitted (`git status --porcelain -- bench.config.yaml
  evaluation-pool/`) or committed after the init commit
  (`git log --format=%s -- bench.config.yaml evaluation-pool/` shows
  anything besides `chore: bench-kit init …`).

Otherwise skip it and say why in one line ("configuration untouched
since init — doctor already parsed it"). With zero tasks validate would
only parse the config and warn "no tasks", both of which you already
know.

### 3. Workload — cheap reads, deeper only when there is something

- **Tasks**: directories under `tasks/` with a `task.yaml`; `expires`
  warnings from validate if it ran.
- **Backlog**: `tasks/backlog.md` — count entries by status
  (`pending` / `built` / `done`). Missing file = no orders yet.
- Only when tasks or `attempts/` exist:
  - **Attempts and evaluations**: `bench status` — preserved attempts,
    attempts in progress (`running.json`), attempts without a current
    evaluation, stale evaluations (old `task_hash`).
  - **Uncommitted output**: `git status --porcelain -- results/
    reports/ tasks/ evaluation-pool/` — finished work the user has not
    reviewed or committed yet.

On a fresh instance this step is two file checks and ends with
"no tasks, no backlog".

### 4. Route — the one next step

Walk the table top to bottom; the **first** matching row is the
recommendation. Lower rows may be mentioned as "after that".

| Condition | Next step | Why it is the relevant one |
|---|---|---|
| doctor MISSING on runner deps / config, validate errors (when it ran), placeholder base repo, missing `.repos/` clone | **bench-wiring** | Nothing downstream is trustworthy until the instance holds together |
| doctor MISSING on container engine or API keys | **user step** (start the engine / `export <NAME>=…`), then re-run bench-status | Authoring can proceed without them, but no gate or measurement can |
| Attempts in progress (`running.json`) | **wait / bench-measure** to follow up | A run is already paid for; finish it before starting anything else |
| Uncommitted `reports/` or new `tasks/` from bench-build | **user review + commit** (list the paths) | Built tasks are unreviewed proposals until the user accepts them |
| Backlog has `built` orders (gate not passed) | **bench-build** (batch gate only) | Files exist but the starting state is not proven yet |
| Expired tasks | **bench-refresh-task** | Measuring an expired task measures a stale codebase |
| No tasks and no `pending` orders | **bench-new-task** | The benchmark measures nothing until it holds the company's real work — start from the decision the user needs to make |
| `pending` orders in the backlog | **bench-build** | Orders are waiting to become tasks |
| Tasks with no preserved attempts, or cells below `defaults.trials` | **bench-measure** | The tasks exist but answer no question yet |
| Preserved attempts without a current evaluation | **bench-measure** (evaluation step) / **rate-attempt** | Paid attempts are waiting for a verdict |
| Uncommitted `results/` | **user commit** (list the paths) | Results outside git are invisible to the leaderboard and to bench-summary |
| Everything evaluated and committed | **bench-summary** | The data is there; the remaining work is the decision |

The bench-new-task row is the important one on a fresh instance: do not
suggest a "trial run" on anything other than a real task — there is
none, by design.

## Output

A short status block, then the recommendation. Keep it scannable:

```
Environment (bench doctor)
  ✓ container engine        docker, running
  ✗ engine memory           4 GiB < resources.memory_mb 6144 → raise in Docker Desktop
  ✓ API keys                OPENROUTER_API_KEY exported
  ✓ base repo               acme-web reachable, cloned in .repos/acme-web
  ? provider credit         unverifiable from here — check the balance
  – configuration           not re-validated: untouched since init, no tasks

Workload
  tasks                     0
  backlog                   none (tasks/backlog.md missing)
  attempts / evaluations    — (no tasks)
  uncommitted               nothing
```

Then **Next step**: one sentence naming the skill (or user step) from
the routing table and why it is the relevant one now, plus what you
need back to start it (e.g. "tell me which recurring piece of work you
want to compare models on — I'll start bench-new-task from that").
