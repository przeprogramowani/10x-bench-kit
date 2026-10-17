<!-- Procedure of the **bench-define** skill — loaded from its SKILL.md when needed. -->

# PR mining — tasks from the base repo's history

A merged change that came with its own tests is a ready-made task:

| Part of the change | Becomes |
|---|---|
| its parent commit | the **pin** (the state before the work) |
| its tests (post-merge version) | the **hidden fail-to-pass guard** |
| its code diff | the **reference**: proof the task is solvable at the pin, kept in the build report and never shown to the agent |
| its intent (PR description, linked issue, commit message) | the **prompt**, rewritten as a request at the order's guidance level |

You reverse-engineer the work order a developer received, from the
work they delivered.

## 0. Prerequisites (orchestrator, once)

- The base repo clone in `.repos/<name>` (AGENTS.md convention). It is
  shallow by default and mining needs history. Deepen it **here, once**
  (`git -C .repos/<name> fetch --deepen=500`, or `--unshallow`), never
  in a subagent. `mine-prs.mjs` refuses to run on a shallow clone and
  says so.
- `git fetch origin` first, so the history is current. Pins must be
  commits that exist on the remote; first-parent history of the default
  branch guarantees that.

## 1. Scan

```
node <skills>/bench-define/mine-prs.mjs --repo .repos/<name> [--since 365] [--limit 30] [--json]
```

The scan reads only local git: no network, nothing written. It lists
first-parent changes that touched both code and tests, within size
limits (`--max-files`, `--max-lines`). It excludes release commits,
reverts, bots, and docs- or lockfile-only changes (`--all` shows the
excluded ones with reasons). Per candidate you get:

- **PR number:** read from `Merge pull request #N` or a squash suffix
  `(#N)`.
- **Size:** S/M/L by code lines.
- **Class hint:** from a conventional-commit prefix or keywords. It is a
  hint, not a decision.
- **Coupling:** the identifiers, contract names (fields, keys) and new
  files that the change *introduces* and its tests *use*.

The ranking puts uncoupled candidates first, then size M, S, L, then
recency.

`show <sha>` prints one candidate in full: message, files, coupling,
and the PR branch's time span when it was a merge commit.

## 2. Select — decision value, not volume

Pick candidates the way INTERVIEW.md orders an interview: by the
decision they inform.

- **Class coverage first.** `bench backlog` prints, per class, the gap
  its task count can resolve. Mine into the classes whose decisions are
  open and whose resolution is too coarse. Twenty bugfixes do not answer
  a question about feature work.
- **Prefer uncoupled tests.** They check behaviour through interfaces
  that exist at the pin, so two correct implementations pass them
  equally. Coupled candidates go through step 3.
- **Prefer S/M.** L changes are often several intents in one PR (the
  "one order = one intent" rule) and rarely fit a time limit.
- **Recent pins.** A pin from last month stays valid longer before
  REFRESH.md is needed.
- **Runnable tests.** Drop changes whose tests need services the
  evaluation container cannot provide (databases, external APIs),
  unless the repo's own test setup provides them.

Read the PR description and linked issue when you can (GitHub access in
the session); they are the intent. Otherwise the commit message is the
intent, which is thinner, so prefer directional guidance then.

## 3. Coupling — what the tests force

For each selected candidate, read the test diff yourself. The script's
coupling list is a heuristic and misses fields that already existed
under the same name elsewhere. Then decide:

| What the tests assert on | Decision |
|---|---|
| only interfaces that exist at the pin | **admissible as-is** |
| a few **contract** names the change introduced (a request field, CLI flag, config key, API route) | **admissible if the prompt states them verbatim** as requirements. That is the exception the shape-neutrality rule already allows ("paths the prompt fixes verbatim"), and it is fair, because a real ticket would name them too |
| internal structure the change introduced (new module paths, helper names, class layout) | **drop those tests.** Grade with the repo's suite guard plus the judge, or drop the candidate. Hidden tests that encode structure measure guessing, not work |

Record the decision in the order's **Coupled names** field. The
builder treats it as a contract.

## 4. Human time

The time-horizon report in bench-decide needs, per task, the minutes
the work takes a developer. History gives an upper bound: for merge
commits, the PR branch's span. Combine it with the diff size into an
estimate, put the batch's estimates in front of the user in one table,
and record `Human time: ~N min (estimated: <basis>)`. An unconfirmed
number is marked as estimated. A horizon fitted on invented minutes
is worse than none.

## 5. Write the orders

Write one entry per candidate per BACKLOG_TEMPLATE.md, with
`Source: pr`. Mined orders already carry facts, not premises: pin,
reference and tests come from history, so the premise probe of
INTERVIEW.md shrinks to "does the intent hold at the pin". The
reference diff proves that at build time. The **Decision**, **Class**
and **Work baseline** fields are still the user's. Present the batch
for acceptance before writing, as INTERVIEW.md step 2 does.

## 6. Build hand-off

BUILD.md builds mined orders like any other, and TASK_AUTHORING.md has
the **mined order** path:

- `mine-prs.mjs emit <sha> --out <scratch>` extracts the reference
  diff, the post-merge test files and the metadata;
- the hidden guard `tests/<task>-pr` copies those test files over the
  workspace and runs the repo's own test command for them;
- the guard is proven red at the pin and green with `--patch
  reference.diff`;
- the prompt is reverse-engineered from the intent, with the coupled
  names verbatim and nothing else from the diff.

## Public repositories and anchors

Mining works on any git history, including public repos. A public-repo
task has two weaknesses:

1. models may have seen the change in training;
2. trial containers have network access, so an agent could look up the
   upstream fix.

Use such tasks only as **anchors**: `Class: anchor`, never a routing
decision. A few anchors mined from public benchmark repos (for example
the repositories behind SWE-bench Verified instances) let the instance
check its harness and judge against published numbers. If the
instance's numbers diverge wildly on anchors, suspect the setup before
the models. bench-decide reports anchors apart from decision classes.
