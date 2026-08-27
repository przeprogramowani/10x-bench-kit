---
name: bench-new-task
description: >-
  Collects an order for a new benchmark task in a short interview and
  appends it to the backlog (`tasks/backlog.md`) — without building
  anything. A single session can define 5–10 orders; building is done
  later by the bench-build skill. Use when the user wants to add a task
  to the benchmark, has task idea(s), or says "new task / task for the
  bench / add to the backlog".
---

# bench-new-task — ordering a task into the backlog

You turn the user's idea into an **order** in the stateful backlog
`tasks/backlog.md`. An order is the complete set of the task's design
decisions — everything that changes WHAT the task measures — written
precisely enough that a bench-build subagent can build the task from it
**without asking the user anything**. This skill is deliberately fast:
interview only, no cloning repos, no containers, no runner commands.

## Hard rules

1. **Zero building.** You do not pick a pin, write `prompt.md`, an
   overlay, or assertions, and you do not call `bench` commands. That
   is bench-build's job. If the user wants to build right away, record
   the order and point them to bench-build — do not build within this
   skill.
2. **Zero git.** This skill's output is an edit to `tasks/backlog.md`
   in the working tree — you do not commit, branch, or push; when and
   how the backlog reaches git is the user's decision. The backlog is
   coordination state, not scoring (the runner ignores files in
   `tasks/` that are not task directories).
3. **Decisions belong to the user.** Order fields are settled by the
   interview, not by your guesses — a wrongly chosen guidance level or
   timeout changes what the task measures. Inferences from the user's
   description are proposals to be accepted, not decisions.
4. **One order = one intent.** The idea "fix X and refactor Y while
   you're at it" is two orders.
5. **The order must be self-sufficient.** The bench-build subagent will
   receive the backlog entry and nothing else — no access to this
   conversation. Everything you agreed on must be in the entry.

## Procedure

### 1. Interview (short)

Collect the user's ideas — they may give several at once. For each,
derive proposed order field values from the description (entry schema:
[BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md)) and mark what is inferred
versus what the description does not say. Ask questions via your tool's
question mechanism (AskUserQuestion / request_user_input; if
unavailable — plain questions in the conversation), **in a single block
for the whole batch of orders**, only about gaps and ambiguities — with
two exceptions you always ask about:

- **Evaluation axis (rubric calibration)** — what in THIS task should
  differentiate scores between executions: the user often has specific
  do's and don'ts in mind (e.g. "a minimal diff is what counts", "the
  public API must not be touched", "we reward a regression test") and
  those are what should be recorded in the entry, instead of leaving
  the differentiation to the guesses of the agent building the rubric.
  This is the task's **primary grading source**: the benchmark keeps
  no reference implementation, so the rubric and its synthetic
  calibration set are derived from these criteria — the more concrete
  the do's/don'ts (and, for large tasks, the milestone/phase map for
  partial credit), the better the task grades. Phrase the axes as
  **behaviour** — what a good implementation does and what a bad one
  does — never as expected file names or symbols: scripted assertions
  are repo-native execution guards only (the repo's own lint / build /
  suite), and everything about the implementation's shape is graded by
  the judge as a code review, without nitpicking.
  If the user has no opinion, propose an axis derived from the task
  type and get acceptance; record a missing axis explicitly as "at
  bench-build's discretion".
- **Prompt guidance level** — unless the description settles it
  explicitly, with the consequences stated alongside the options:
  - *product-level* — symptom/goal only, no files or symbols; measures
    locating the code + execution — harder, longer timeout;
  - *directional* — a named area/module; middle of the scale;
  - *surgical* — specific files/symbols; measures execution alone —
    easier, shorter timeout.

When the user chooses the **surgical** level, the backlog entry must
name specific files/symbols — perform the base-repo analysis in
`.repos/` needed to determine them via an **independent subagent** (the
agent receives the repo name and the task's intent, and returns a list
of files/symbols with a short justification). Do not read the base repo
yourself in this session — this is this skill's only permitted contact
with `.repos/`, and it still is not building (rule 1).

Remaining fields (ask only when the description does not settle them):

- **What the task measures**: implementation / bugfix / refactor /
  documentation.
- **Base repo** — must be in `base_repos` in bench.config.yaml
  (check!); if it is not, bench-wiring comes first, not this order.
- **Difficulty and `timeout_s`** (typically 300–900 s; consistent with
  the guidance level — a too-short timeout measures speed, not
  quality).
- (Workspace preservation is not a decision anymore: every trial keeps
  its full post-agent workspace on disk — the preserved-attempt
  contract, `.bench-kit/ATTEMPT_FORMAT.md` — so manual launch and the
  judge-with-tools always have the real state to work with.)
- **Task name**: kebab-case, saying what is to be done
  (e.g. `fix-cart-total-rounding`), not how (`edit-cart-ts`).

### 2. Batch acceptance

Present the orders collectively (a table: name, type, repo, guidance,
timeout, evaluation axis + a one-sentence description) and get the
user's acceptance. Only then write to the backlog.

### 3. Writing to the backlog

If `tasks/backlog.md` does not exist, create it per
[BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md). Append each order as an
entry with status `pending` and a date. An order's name must not
collide with an existing `tasks/<name>/` directory or another backlog
entry. Nothing in git (rule 2) — the file stays in the working tree.

### 4. Next step

End your summary response with a **Next step** section: how many orders
are waiting in the backlog (`pending`), **one** recommendation —
usually: add more orders (this skill) or launch **bench-build** when
the batch is ready — and what awaits a human decision.
