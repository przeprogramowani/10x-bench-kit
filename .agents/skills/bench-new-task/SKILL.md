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
6. **A premise is not a fact until it is probed.** Every claim the
   order makes about the base repo is checked against the repo before
   the order is accepted (step 1a), and the entry records the verdict
   with the SHA. An unprobed claim may be written down only as what it
   is — an assumption, marked as one — never in the grammar of
   established fact.
7. **An order that changes no decision is not an order.** Every entry
   names the decision its result would settle — which model gets this
   class of work, at what cost. "It would be interesting to see how
   models do" is leaderboard content: a build cycle spent on it buys
   a number nobody acts on. When the user cannot name the decision,
   say so and park the idea rather than ordering it.

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

- **Evaluation axis (the rubric's source)** — what in THIS task should
  differentiate scores between executions: the user often has specific
  do's and don'ts in mind (e.g. "a minimal diff is what counts", "the
  public API must not be touched", "we reward a regression test") and
  those are what should be recorded in the entry, instead of leaving
  the differentiation to the guesses of the agent building the rubric.
  This is the task's **primary grading source**: the benchmark keeps
  no reference implementation, so the rubric (written by bench-build
  from these criteria, calibrated by the first real attempts) is
  derived from them — the more concrete
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
- **The decision this order informs (rule 7)** — what would you do
  differently depending on the outcome? The useful shape is a routing
  question: *"can we stop sending feature work in this repo to a
  sonnet-class model?"*, *"is the cheap model good enough for
  bugfixes here?"* Record it verbatim in the entry's **Decision**
  field. Two things follow from the answer, and both are worth asking
  for in the same breath:
  - **Work class** — the kind of work this task stands for
    (discovery-heavy / bugfix / localized refactor / greenfield
    component / …). One task is a hypothesis about one class, never a
    routing rule for a repo: a model that is bad at locating code in
    an unfamiliar tree may be fine at a scoped bugfix. The class is
    what lets bench-summary aggregate results into a **class × model**
    matrix instead of one row, and what shows which classes of your
    work are still unmeasured.
  - **What the work costs today** — roughly how often it comes up and
    what it currently costs (a human's afternoon, or a run of the
    expensive model). This is the baseline the measurement is read
    against, and it is what makes an order worth a build cycle:
    **frequency × current cost**, not how interesting the task is.
    Work that comes up twice a week earns a build; work that comes up
    twice a year does not, however elegant the task would be.
- **Prompt guidance level** — unless the description settles it
  explicitly, with the consequences stated alongside the options:
  - *product-level* — symptom/goal only, no files or symbols; measures
    locating the code + execution — harder, longer timeout;
  - *directional* — a named area/module; middle of the scale;
  - *surgical* — specific files/symbols; measures execution alone —
    easier, shorter timeout.

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

### 1a. Premise probe (every order, before acceptance)

An order rests on claims about the base repo — "the feature is absent",
"both pages load the same data", "this bug is observable here". These
are its **load-bearing premises**, and the interview cannot verify
them: they come from the user's memory of the repo, and that is exactly
what turns out wrong. A false premise does not fail cheaply — it fails
after a full bench-build authoring cycle, as a refusal, or worse as a
task that builds fine while its evaluation axis measures nothing.

So for every order, whatever its guidance level:

1. **Enumerate the load-bearing premises** as a short list of
   individually checkable claims — not one narrative sentence. A
   narrative premise fails all-or-nothing; an enumerated one fails only
   in the place that is actually wrong, and the rest of the order
   survives.
2. **Have them falsified by an independent subagent** against the base
   repo in `.repos/`. It receives the repo name, the task's intent and
   the premise list, and returns per premise: *confirmed* / *refuted* /
   *partly true*, each with the evidence that settles it (path + what
   is there) and the commit SHA it read.
3. When the guidance level is **surgical**, the same probe also returns
   the specific files/symbols the entry must name, with a short
   justification.

Do not read the base repo yourself in this session — the probe is this
skill's only permitted contact with `.repos/`, and it still is not
building (rule 1).

What the verdict obliges you to do:

- **confirmed** → record it in the entry's **Premises** field with the
  SHA. bench-build then knows the claim was checked, not assumed.
- **refuted** → the order as stated cannot be built. Take it back to
  the user with the evidence; the idea usually survives in a changed
  form, because the gap is elsewhere or smaller than they thought.
  Never record a refuted premise as fact, and never demote it to a
  "Notes" aside — it is the reason the order changes.
- **partly true** → the order is buildable but asymmetric. The
  asymmetry belongs in the entry, and from there in the rubric —
  not in the builder's surprise, and not in a judge that punishes
  solvers for the half that was never there.

One probe costs a single subagent. Skipping it costs an authoring
cycle, and the bill arrives after the work, not before it.

### 2. Batch acceptance

Present the orders collectively (a table: name, **class**, type, repo,
guidance, timeout, evaluation axis + a one-sentence description) and get
the user's acceptance. Only then write to the backlog.

**Order the batch by decision value, not by interest** — frequency ×
current cost of the work each order stands for (rule 7). Say which
orders you would build first and why, and name the classes the backlog
does **not** yet cover, because an uncovered class is the cheapest way
to widen what the instance can answer. A batch of five orders that all
measure the same class buys one hypothesis five times.

Present the probe's verdict (step 1a) alongside each order, and call
out every premise that came back **refuted** or **partly true**
explicitly — that is the point in the flow where the user can still
reshape the idea for free. An order whose premise was refuted is not
presented for acceptance at all; it goes back into the interview.

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
