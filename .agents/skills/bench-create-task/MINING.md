<!-- Procedure of the **bench-create-task** skill — loaded from its SKILL.md when needed. -->

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

- The base repo clone in `.repos/<name>` (AGENTS.md convention). It
  has full history by default (`10x bench-kit init` from 10x-cli 1.31+);
  an older or `--shallow` init leaves it shallow, and mining needs
  history covering the scan window. Deepen it **here, once**, never in a subagent:
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

## The scanner — `mine-prs.mjs`

```
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<name> [--ref origin/HEAD] [--since 90] [--limit 30] [--json]
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<name> show <sha> [--json]
```

The scan reads only local git: no network, and the only write is a
coupling cache in the clone's `.git/` (`--no-cache` skips it). The
coupling analysis runs on all cores (`--jobs <n>` to cap it); a first
scan of a quarter takes seconds to a minute, a re-scan reuses the
cache. `--ref` defaults to `origin/HEAD` (see §0). It lists
first-parent changes that touched both code and tests, within size
limits (`--max-files`, `--max-lines`). It excludes release commits,
reverts, bots, and docs- or lockfile-only changes (`--all` shows the
excluded ones with reasons). Per candidate you get:

- **PR number:** read from GitHub's `Merge pull request #N` or a squash
  suffix `(#N)`, GitLab's `See merge request …!N` (stored as `!N`, with
  the real title taken from the body), Bitbucket's `Merged in … (pull
  request #N)` and Azure's `Merged PR N: …`. Sync and back-merges (`Merge
  remote-tracking branch`, stable/release branches merged into main)
  are excluded; they are not work anyone ordered.
- **Size:** S/M/L by code lines.
- **Class hint:** from a conventional-commit prefix or keywords. It is a
  hint, not a decision.
- **Coupling:** the identifiers, contract names (fields, keys) and new
  files that the change *introduces* and its tests *use*.

The ranking puts product work (feat / fix / perf / refactor) before
maintenance (ci / chore / build / docs / style / test), then candidates
whose coupling is at most 3 names (the prompt can state them verbatim —
that is most feature PRs) before wider coupling, then size M, S, L, then
recency. Coupling is a prompt-writing obligation, not a defect.

`show <sha>` prints one candidate in full: message, files, coupling,
and the PR branch's time span when it was a merge commit.

## 1. The user named a change — find it, confirm it

Whatever the user gave you, resolve it to one merged commit on the
remote's first-parent history:

| The user said | Look up |
|---|---|
| a PR number (`#412`, `!57`, "PR 412") | `git -C .repos/<name> log --first-parent origin/HEAD -E --grep '#412([^0-9]\|$)' --format='%H %ad %s' --date=short`, or the scan (`--since 730 --all --json`) filtered by its `pr` field; with GitHub access in the session, `gh pr view 412 --json mergeCommit,title,body` |
| a SHA (full or short) | `git -C .repos/<name> rev-parse <sha>^{commit}`, then check it is on `origin/HEAD`'s first-parent line |
| a title or a description | `git log --first-parent origin/HEAD -i --grep '<words>'`, widen to `-S`/file paths when the message is terse |

Then run `mine-prs.mjs show <sha>` and present what you found in one
short block:

- SHA, title, merge date, author's PR number;
- files touched (code / tests), size;
- **tests:** did the change bring its own? (No tests → it can still be
  a task, graded by the repo's suite guard plus the judge; say so.)
- **coupling:** names the tests would force into the prompt;
- the class hint and what kind of work it is (bugfix / feature /
  refactor).

Ask **"Is this the one?"** and wait. Several matches: list them (at
most five) and ask which. No match: say what you searched and offer the
proposals of §2 or an interview. Never build from a guess.

## 2. The user named nothing — proposals from the last quarter

Delegate the history review to **one subagent on a cheap, fast model**
— Sonnet-class in Claude Code (`model: sonnet`), a mini or Flash model
in Codex/OpenCode. Reading a quarter of commit messages and test diffs
is skimming, not judgment; the judgment (decisions, coupling, the
order's fields) stays with you.

Brief the subagent with:

- the clone path (`.repos/<name>`) and the scanner command:
  `mine-prs.mjs --repo .repos/<name> --since 90 --limit 30 --json`;
- the classes `bench backlog` reports as thin, and the tasks that
  already exist (do not propose their changes again);
- the selection rules below;
- the output: **3–5 candidates**, at least one **bugfix**, one
  **feature** and one **refactor** when the quarter has them, each as
  one row — SHA, PR, title, kind, size, tests yes/no, coupling count,
  one sentence on what a developer was asked to do, one sentence on why
  it makes a good task. Nothing else: no diffs, no order drafts.

Selection rules (for the subagent's brief and for your own check):

- **Decision value, not volume.** Prefer the classes whose decisions
  are open and whose resolution is too coarse. Twenty bugfixes do not
  answer a question about feature work.
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

When the quarter has fewer than three usable candidates, the subagent
widens to `--since 180` and says so.

Present the proposals to the user in one table and ask one question:
**all of them, a subset, or something else?** "Something else" means
they name a change (→ §1), want another round with a different focus
("more refactors", "only the payments module"), or want work with no
history (→ INTERVIEW.md). Keep the conversation going until the user
has accepted a set; only accepted candidates go on to §3.

Read the PR description and linked issue for each accepted candidate
when you can (GitHub access in the session); they are the intent.
Otherwise the commit message is the intent, which is thinner, so prefer
directional guidance then.

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

The time-horizon report in bench-analysis needs, per task, the minutes
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
- **The user's** — **Decision**, **Class** and **Work baseline**. Ask
  them **once per batch, as proposals**, not three open questions per
  order: derive the default Decision from `defaults.models` in
  `bench.config.yaml` ("can <cheapest configured model> replace <the
  strongest> on <class> in this repo?"), the Class from the class hint,
  and the Work baseline from what the user said they use today (or "no
  agent today" when unknown). One question — "these three, or correct
  any?" — unblocks the whole batch.

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
the models. bench-analysis reports anchors apart from decision classes.
