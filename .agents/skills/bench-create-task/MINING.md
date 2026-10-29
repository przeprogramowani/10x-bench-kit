<!-- Procedure of the **bench-create-task** skill — loaded from its SKILL.md when needed. -->

# Mining — finding the change

## 0. The clone

Work in `.repos/<name>` (AGENTS.md convention). `git fetch origin`
first. Mining needs history covering the scan window: on a shallow
clone run `git -C .repos/<name> fetch --shallow-since="<N> days ago"
origin` (or `--unshallow`). The scanner warns when the clone's history
ends before `--since`. Pins come from the remote's first-parent
history, so they exist on the remote.

## The scanner — `mine-prs.mjs`

```
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<name> [--ref origin/HEAD] [--since 90] [--limit 30] [--json]
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<name> show <sha> [--json]
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<name> emit <sha> --out <dir>
```

Local git only, no network. The scan lists first-parent changes that
touched both code and tests, within size limits, without release
commits, reverts, bots and docs- or lockfile-only changes (`--all`
shows the excluded ones with reasons). Per candidate: PR number,
size S/M/L, a class hint, and **coupling**, i.e. the names the change
*introduces* that its tests *use*. Product work ranks above
maintenance, low coupling above high, M/S above L, recent above old.
`show` prints one candidate in full; `emit` extracts it for the build
(BUILD.md step 1).

## 1. The user named a change

Resolve it to one merged commit on `origin/HEAD`'s first-parent line:

| The user said | Look up |
|---|---|
| a PR number | `git -C .repos/<name> log --first-parent origin/HEAD -E --grep '#412([^0-9]\|$)' --format='%H %ad %s' --date=short`, or `gh pr view 412 --json mergeCommit,title,body` |
| a SHA | `git -C .repos/<name> rev-parse <sha>^{commit}`, then check it's on the first-parent line |
| a title or description | `git log --first-parent origin/HEAD -i --grep '<words>'`, then `-S` or file paths |

Run `show <sha>` and present SHA, title, date, PR number, files (code /
tests), size, tests yes/no, coupling and the kind of work. Ask "is this
the one?". Several matches: list up to five. None: say what you
searched and offer §2. A change without tests can't become a task.

## 2. The user named nothing

One subagent on a cheap model (`model: sonnet` in Claude Code, a mini
or Flash model elsewhere) runs `mine-prs.mjs --repo .repos/<name>
--since 90 --limit 30 --json` and returns **3–5 candidates**, at least
one bugfix, one feature and one refactor when the quarter has them.
One row each: SHA, PR, title, kind, size, coupling count, one sentence
on what the developer was asked to do, one on why it makes a good task.
Brief it with the classes `bench backlog` reports as thin and the
existing tasks (don't propose those again). It prefers:

- uncoupled or lightly coupled tests (two correct implementations pass
  them alike);
- S/M size: L changes are often several intents in one PR;
- tests that run without external services (databases, APIs) the
  container can't provide.

Fewer than three usable candidates: widen to `--since 180` and say so.
Show the table; ask: all, a subset, or something else?

## 3. Coupling

Read each accepted candidate's test diff yourself; the scanner's list
is a heuristic.

| The tests assert on | Decision |
|---|---|
| only interfaces that exist at the pin | as-is |
| a few **contract** names the change introduced (a request field, CLI flag, config key, route) | keep; the prompt states each verbatim |
| internal structure the change introduced (module paths, helper names) | drop those tests or cases; if nothing is left, drop the candidate |

Record it in **Coupled names** and **Hidden tests**.

## 4. Write the orders

One entry per candidate, per BACKLOG_TEMPLATE.md.

- **From history:** Source, Pin, Reference, Hidden tests, Coupled
  names.
- **Proposed by you:** Guidance level (a symptom-only issue reads as
  product-level, a PR naming the module as directional), Time limit,
  Evaluation axis (what reviewers asked for or pushed back on),
  Description (intent only).
- **Confirmed by the user, once per batch:** Class (from the class
  hint) and Decision (default: "can <cheapest model in defaults.models>
  replace <the strongest> on <class> in this repo?").

Show the batch as one table and write it after the user accepts.

## Public repositories

Mining works on public repos too, but models may have seen the change
and trial containers have network access. Such tasks are **anchors**
(`Class: anchor`): they check the harness against published numbers
and never settle a routing decision.
