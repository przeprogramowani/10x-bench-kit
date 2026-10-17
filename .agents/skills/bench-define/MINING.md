<!-- Procedure of the **bench-define** skill — loaded from its SKILL.md when needed. -->

# PR mining — tasks from the base repo's history

A merged change that came with its own tests is a ready-made task:

| Part of the change | Becomes |
|---|---|
| its parent commit | the **pin** (the state before the work) |
| its tests (post-merge version) | the **hidden fail-to-pass guard** |
| its code diff | the **reference**: proof the task is solvable at the pin. The merged commit is named by SHA in the order and the build report; its diff is regenerated with `mine-prs.mjs emit` when needed, never stored in the instance and never shown to the agent |
| its intent (PR description, linked issue, commit message) | the **prompt**, rewritten as a request at the order's guidance level |

You reverse-engineer the work order a developer received, from the
work they delivered.

## 0. Prerequisites (orchestrator, once)

- The base repo clone in `.repos/<name>` (AGENTS.md convention). It is
  shallow by default and mining needs history covering the scan window.
  Deepen it **here, once**, never in a subagent:
  `git -C .repos/<name> fetch --shallow-since="<N> days ago" origin`
  (N = the scan's `--since`), or `--unshallow` for everything. The scan
  runs on a shallow clone too, but warns when the clone's history ends
  before the `--since` window and prints that command: changes older
  than the clone's history are simply missing from the list, so deepen
  and re-scan rather than mine a truncated window.
- `git fetch origin` first, so the history is current. The scan reads
  `origin/HEAD` by default (falling back to `HEAD` when the clone has
  no `origin/HEAD`), so a fetched-but-not-pulled clone is scanned at the
  remote's tip. Pins must be commits that exist on the remote; taking
  them from the remote's first-parent history guarantees that.

## 1. Scan

```
node <skills>/bench-define/mine-prs.mjs --repo .repos/<name> [--ref origin/HEAD] [--since 365] [--limit 30] [--json]
```

The scan reads only local git: no network, nothing written. `--ref`
defaults to `origin/HEAD` (see §0); pass another ref only on purpose.
It lists
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
- **Recent pins.** A mined task's pin can never move past its change
  (REFRESH.md, "Mined task"), so a pin from last month stays buildable
  on today's toolchain longer than an old one.
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
`Source: pr`. Who fills which field:

- **Facts from history** — Source, Pin, Reference, Hidden tests,
  Coupled names, and the basis of Human time (§4): you fill them from
  the scan and from §3–4.
- **Proposed by you, per candidate** — the fields an interview would
  settle, derived here from the change:
  - **Type** — from what the change does (bugfix / implementation /
    refactor / documentation);
  - **Guidance level** — from how specific the intent is (an issue
    describing a symptom reads as product-level; a PR naming the
    module, as directional);
  - **Difficulty / time limit** in minutes — consistent with the
    guidance level (INTERVIEW.md), and sanity-checked against Human
    time: a limit the work plausibly cannot fit in, or one many times
    the human estimate, means the size or the estimate is off;
  - **Evaluation axis** — from the PR description and its review
    comments: what reviewers asked for, pushed back on or rejected is
    the task's do's and don'ts;
  - **Description** — the intent in 2–6 sentences, with nothing from
    the diff beyond the Coupled names.
- **The user's** — **Decision**, **Class** and **Work baseline**.

Present the batch for acceptance before writing, as INTERVIEW.md step
2 does: one table (name, class, type, guidance, time limit, Human time,
evaluation axis, one-sentence description), your proposals marked as
proposals, accepted or corrected by the user — never written as
decisions on your own.

**Premises.** Mined orders carry facts, not premises: pin, reference
and tests come from history, so the premise probe of INTERVIEW.md step
1a shrinks to one line in the **Premises** field:
`intent holds at pin @<sha> — proven at build by reference.diff`.

## 6. Build hand-off

BUILD.md builds mined orders like any other, and TASK_AUTHORING.md has
the **mined order** path:

- `mine-prs.mjs emit <sha> --out <scratch>` extracts the reference
  diff (code changes only: docs, lockfiles and other noise, and
  AGENTS.md / CLAUDE.md are left out), the post-merge test files
  (snapshots under `__snapshots__/` and `*.snap` count as test files)
  and the metadata;
- the hidden guard `tests/<task>-pr` copies those test files over the
  workspace, runs the repo's own test command for them, and restores
  the workspace as it found it;
- the guard is proven red at the pin and green with `--patch
  reference.diff`; the diff is proof material, deleted at handoff and
  regenerated with `emit` whenever it is needed again;
- the task gets `expires` like any other; its refresh keeps the pin
  (REFRESH.md, "Mined task");
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
