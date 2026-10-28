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

1. **create task**: what we measure (bench-create-task);
2. **evaluate**: run models on it and judge the attempts (bench-evaluate);
3. **analysis**: what the results mean (bench-analysis).

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
6. **Report as you go.** The user watches the instance come green check
   by check, never one silent stretch followed by a verdict. See below.

## Progress — one line per check, as it lands

Print a short progress line **right after each check returns**, before
you start the next one. Do not batch results for the handover and do not
reason at length between checks — read the output, print the line, run
the next command.

```
✓ doctor — podman, 22.9 GiB, OPENROUTER_API_KEY present (2.7 s)
… base image building in the background (1–4 min)
✓ base repo — przeprogramowani-edu, full history in .repos/
✓ config — 3 models, judge claude-opus-5.5 (agent), 3 trials, $10
… validate — checking repos, pins and model ids online
✓ validate — 0 errors, 1 warning (Sonnet judged by Opus: same family)
✓ backlog — 0 tasks, 0 orders
```

- `✓` passed, `✗` blocks measuring (name the fix in a few words; the
  full fix goes in the handover), `!` a warning that does not block,
  `…` started and still running — say so **before** a step that takes
  more than a few seconds (full validate, the image build), so the
  pause has a reason.
- One line per check, with the proof that matters (a count, a name, a
  duration). No paragraphs; details belong in the handover.
- A `✗` does not stop the walk: keep going through the remaining checks
  that do not depend on it, so the user gets the whole fix list at
  once.
- When step 3 needs the user's answer, the lines so far are already on
  screen; ask, then continue with the next line.

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

Show the current `defaults.models`, `judge.model`,
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
  model under test (validate warns otherwise). Changing the judge, the
  pass threshold or a rubric version closes a
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
| No tasks, no backlog | **bench-create-task** — the user names a merged PR, or a subagent proposes 3–5 from the last quarter |
| Orders in `tasks/backlog.md` not built | **bench-create-task** — build the pending backlog |
| Tasks built, cells missing trials | **bench-evaluate** — run the matrix within budget |
| Preserved attempts not evaluated / stale era | **bench-evaluate** — evaluate |
| Results complete for a question | **bench-analysis** — the verdict |
| Uncommitted results or tasks | The commit plan from `bench changes` first |

The first real task is also the first end-to-end proof of the container
path: bench-create-task's build runs its guards in containers on the pin and
on the reference solution (`bench validate --assert`), and the first
bench-evaluate run produces the first preserved attempt and result.
Nothing is rehearsed on a toy task.

## Handover

**Only when steps 1–4 are all green** (doctor 0 missing, validate 0
errors), open with an **Instance brief** — what this instance measures
today, read from `bench.config.yaml`, `bench backlog` and `bench
status` (no extra checks):

- **What we test** — base repos (name → url); tasks built, with their
  classes; backlog orders still pending.
- **On which models** — each `defaults.models` id with its harness
  (OpenCode / Claude Code / Codex) and route (direct / OpenRouter).
- **How we judge** — `judge.model`,
  `defaults.pass_threshold` (0.7 when absent).
- **Run shape** — `defaults.trials`, `defaults.max_cost_usd`,
  `defaults.parallel`, `resources.memory_mb`.
- **Results so far** — preserved attempts, evaluated in the current
  era, stale; or "no results yet".

A compact table or a few lines, no commentary. If anything in steps 1–4
is open, skip the brief entirely and say nothing about it — the fix
list comes first.

Then three short blocks and one ask:

- **Ready** — one line tallying the progress lines already on screen
  (`6/6 checks green; base image built (52 s)`); do not repeat them.
- **Fix first** — only what is open, numbered, each with the exact
  command or field (`export OPENROUTER_API_KEY=…` in your shell profile,
  then restart the agent from that shell). Omit the block when empty.
- **Changed in this session** — files you touched, or "nothing — init
  had done everything".

End with the single next step as a prompt the user can send, e.g.
"Use bench-create-task to create our first tasks." One ask, not a menu.
