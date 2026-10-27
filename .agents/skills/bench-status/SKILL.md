---
name: bench-status
description: >-
  Checks that this benchmark instance is ready for real work and names
  the one next step — machine (container engine, memory, base image),
  API keys, base repos and their local clones, models and judge in
  bench.config.yaml, a green `bench validate`, and where the task
  backlog stands. Fills the gaps `bench-kit init` left (placeholder
  base repo, additional repo) and warms the base image in the
  background. Use first in a fresh instance, after `bench-kit update`,
  on a new machine, or when the user asks "is it ready / where do we
  stand / what's next / why does nothing run".
---

# bench-status — is this instance ready, and what is next

The entry point of an instance. It proves the instance can do real work
**on the company's own tasks** — there is no demo task to rehearse on —
and hands over to the skill that moves it forward:

1. **define**: what we measure (bench-define);
2. **measure**: run models on it (bench-measure);
3. **decide**: what the results mean (bench-decide).

Budget: a couple of minutes, no paid model calls. Everything here is a
check the runner can prove; the only conversation is about the things
init deliberately does not decide (models, judge, extra repos).

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter `bench <command>`).
You run it yourself; the user's surface is the config, environment
variables, and git — never hand them a `bench …` command.

## Hard rules

1. **Proof, not expectation.** Every "ready" claim cites runner output
   (`bench doctor`, `bench validate`, `bench status`, `bench backlog`).
   Do not re-check by hand what doctor already proved.
2. **Secrets: names and presence only.** Never read, print or store a
   key's value. Setting it is the user's step — and an agent session
   only sees the environment it was launched with, so a key exported
   now needs the tool restarted from that shell. Say so.
3. **Do not touch `.bench-kit/`** (the kit's zone) or the base repos
   (read-only; `.repos/<name>/` is a local clone for reading).
4. **Config changes are scoring changes.** `bench.config.yaml` edits
   (models, judge, judge path, thresholds, resources) go to the user as
   a diff to review. On a fresh instance with no `results/` a direct
   commit is fine with explicit consent; otherwise a branch + PR
   (`bench changes` prints the plan and says which case applies).
5. **Say what is true about the instance, not what this procedure calls
   its steps.**

## Procedure

### 1. Machine and keys — `bench doctor`

Run `bench doctor`. A MISSING container engine, runner dependencies or
API key blocks measuring; list each with its fix. Keys follow from the
config: the providers of `defaults.models` and `judge.model` (one
aggregator such as OpenRouter = one key), plus `BASE_REPO_TOKEN` for a
private base repo reached over https. Remind about provider credit — an
empty balance fails the first paid call in a way no check catches.

If doctor shows the base image as not built yet (`obraz bazowy` WARN),
**start the build in the background now** — a one-time 1–4 min wait
that otherwise lands on the first task build:

```
nohup node --experimental-strip-types .bench-kit/runner/src/index.ts doctor --warm --offline > .bench-warm.log 2>&1 &
```

Before handing over, look for the `obraz bazowy` line in
`.bench-warm.log` (gitignored): `OK … (<n> s)` = built; no such line yet
= still building, say so. Ignore the rest of that log — it repeats the
checklist from a background shell.

### 2. What init left — base repos

Read `.bench-kit/instance.json` (`detectedBaseRepo`) and `base_repos` in
`bench.config.yaml`. The norm: init registered the product repo and
cloned it into `.repos/<name>/` with full history — nothing to do.
Gaps:

- **Placeholder** (`demo-app` / `example-org`, init ran outside a
  product repo): ask for the repo, add `name` + `url` (https preferred;
  SSH works for local runs with the operator's keys), clone it:
  `git clone <url> .repos/<name>`.
- **Another base repo** the user wants measured: same.
- **Shallow clone** (`git -C .repos/<name> rev-parse
  --is-shallow-repository` → `true`, older init or `--shallow`):
  `git -C .repos/<name> fetch --unshallow` — PR mining reads history.

### 3. Models and judge — confirm once

Show the current `defaults.models`, `judge.model`, `judge.mode`,
`defaults.trials` and `defaults.max_cost_usd` in one short block and
ask whether they answer the user's question. Keep the defaults unless
the user says otherwise. Guidance when they do:

- **Models under test**: the id's prefix picks the harness that runs
  the trial — none = OpenCode (`openrouter/<provider>/<model>`),
  `claude-code:<model>`, `codex:<model>`; insert `openrouter/` after
  the prefix to route through OpenRouter. *Which model?* → keep the
  harness fixed; *which tool?* → keep the model fixed. Mixing both
  axes makes neither readable. Ids are checked against the OpenRouter
  catalog by `bench validate`; a model without a price needs
  `pricing["<id>"]`.
- **Judge**: strong, stable, a different provider family than every
  model under test (validate warns otherwise). Changing the judge, its
  path (`agent` = judge with tools per attempt, the default; `api` =
  cheaper, diff only), the pass threshold or a rubric version closes a
  comparability era — cheap to redo (re-evaluate preserved attempts),
  but do it before results pile up.
- **Budget** (`defaults.max_cost_usd`) caps a whole matrix run; raising
  it needs the user's consent. `resources.memory_mb` is an era stamp —
  raise it now, not after results exist.

### 4. Gate — `bench validate`

Full validate (network: base repos reachable, pins exist, model ids in
the catalog). Iterate on schema errors with `--offline`. Green is the
precondition for any spend.

### 5. Where the work stands — route

`bench backlog` and `bench status`, then pick **one** next step:

| State | Next step |
|---|---|
| Anything MISSING in steps 1–4 | The user's fix list; nothing else until it is green |
| No tasks, no backlog | **bench-define** — mine merged PRs for task candidates (default), or interview for work without history |
| Orders in `tasks/backlog.md` not built | **bench-define** — build the pending backlog |
| Tasks built, cells missing trials | **bench-measure** — run the matrix within budget |
| Preserved attempts not evaluated / stale era | **bench-measure** — evaluate |
| Results complete for a question | **bench-decide** — the verdict |
| Uncommitted results or tasks | The commit plan from `bench changes` first |

The first real task is also the first end-to-end proof of the container
path: bench-define's build runs its guards in containers on the pin and
on the reference solution (`bench validate --assert`), and the first
bench-measure run produces the first preserved attempt and result.
Nothing is rehearsed on a toy task.

## Handover

Three short blocks, then one ask:

- **Ready** — each fact with its proof (`bench doctor: 0 missing`,
  `bench validate: 0 errors`, `base image built (52 s)`, `3 models ×
  judge confirmed`).
- **Fix first** — only what is open, numbered, each with the exact
  command or field (`export OPENROUTER_API_KEY=…` in your shell profile,
  then restart the agent from that shell). Omit the block when empty.
- **Changed in this session** — files you touched, or "nothing — init
  had done everything".

End with the single next step as a prompt the user can send, e.g.
"Use bench-define to mine our merged PRs for tasks." One ask, not a menu.
