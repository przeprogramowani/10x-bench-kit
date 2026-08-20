---
name: bench-build
description: >-
  Builds benchmark tasks from pending orders in the backlog
  (`tasks/backlog.md`): fans the orders out to subagents, and each
  subagent performs full task authoring (pin, overlay, prompt,
  assertions, weights, self-check against the reference) and leaves
  finished files in the working tree with an evidence report — no git.
  Use when the user wants to build tasks from the backlog or says
  "bench-build / build the tasks / process the backlog".
---

# bench-build — building tasks from the backlog

You orchestrate task construction: you read `pending` orders from
`tasks/backlog.md`, fan them out to subagents, and keep statuses
accurate. The actual task authoring — pin, overlay, prompt, assertions,
weights, self-check — is done by a **subagent** following the procedure
in [TASK_AUTHORING.md](TASK_AUTHORING.md), one order per subagent.

**Empty backlog**: if `tasks/backlog.md` does not exist or has no
`pending` entries, tell the user that orders are created first with the
**bench-new-task** skill (short interview → backlog entry), and stop —
do not invent tasks yourself.

## Hard rules

1. **The orchestrator does not author.** You do not pick pins, write
   prompts, or write assertions — subagents do that per
   TASK_AUTHORING.md. Your job: scoping, preparing shared resources,
   fan-out, statuses, the aggregate report.
2. **The order is a contract.** A subagent builds what the backlog
   entry says — the design decisions were made in bench-new-task. Do
   not patch gaps in an entry with guesses: an incomplete order goes
   back to the user (or to bench-new-task), not into the build.
3. **Zero git — files and reports, nothing more.** Neither you nor the
   subagents commit, branch, or push. The output of a batch is finished
   `tasks/<name>/` directories (+ new assertions in the pool) in the
   working tree, plus a per-task report per
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) with evidence from the
   reference — what happens next (commit, PR, review, rejection) is
   solely the user's decision. Keep tasks from one batch separate:
   separate directories, separate reports, no merging.
4. **Backlog statuses are the source of truth.** Before a subagent
   starts, the entry moves to `in-progress`; when it finishes, it moves
   to `done` or back to `pending` with a note explaining why. Backlog
   updates are file edits, not commits (rule 3).
5. **Parallel is the default mode.** Orders in one batch are
   independent: each subagent writes only to `tasks/<its-task>/` and
   its own directories in `evaluation-pool/`, and treats
   `.repos/<name>/` as read-only — so there is nothing to clobber and
   building in a single working tree is safe. An isolated repo copy
   (worktree) is not required; it can even be harmful, because
   `.repos/` is in `.gitignore` and a fresh worktree simply has no
   clones. Limit yourself to 2–3 subagents at a time — not out of
   concern for files, but because evaluation containers compete for the
   machine. Release further orders in waves when the batch is larger.
   Build sequentially only when two orders genuinely target the same
   files (e.g. a shared new assertion in the pool) — in that case tell
   the subagents explicitly or run them one after another. If you
   nevertheless use isolated copies, after a subagent finishes move its
   files (the report has the list) into the instance's working tree —
   copying files, not git operations.
6. **Prepare shared resources once, before the fan-out.** Run
   `git fetch origin` in the `.repos/<name>/` clones of the base repos
   the batch needs (clone missing ones — convention from AGENTS.md) and
   forbid subagents from fetching: parallel fetches in a single clone
   race for git locks. The same applies to `evaluation-pool/`: **you
   take the pool inventory, before the fan-out** (rule 6a below) — a
   subagent hunting for reuse on its own only sees the state from
   before its neighbor started and will add a second assertion with the
   same meaning under a different name. After the fan-out, the clone is
   read-only for subagents: they read from it, and when they need the
   state at the pin, they run `git worktree add` under a name unique to
   their task — never a checkout on the shared HEAD. Pass this on in
   their prompt along with the names of the tasks being built in
   parallel next to them.
6a. **Resolve the assertion pool before the fan-out.** Parallel
   subagents cannot see each other's work in progress, so without your
   decision two orders needing the same assertion will build it twice
   under different names — and a duplicate in the pool is permanent
   debt: it drifts apart at the first fix and breaks reuse for future
   tasks. Therefore, before starting:

   - **Inventory the pool**: list the existing `evaluation-pool/<type>/
     <name>/` entries with a one-sentence "what it checks" (the
     `check.yaml` header is enough). You put this list into every
     subagent's prompt — reuse should be a decision based on facts, not
     each agent's own scan.
   - **Cross-check it against the order notes**: backlog notes say
     which assertions an order needs. Spot pairs of orders targeting
     the same thing (e.g. two tasks both wanting "no `localStorage`
     read on the SSR path").
   - **Decide the coverage** and pass the decision in the prompts:
     *an existing assertion covers it* → name it and instruct reuse
     instead of creating; *a new one is needed, shared by two orders* →
     designate an **owner** that creates it, and release the second
     order only after it, with an instruction to reuse the finished
     name; *new and disjoint* → each builds its own, and you impose a
     name prefix (the task name) so names do not collide.

   If a duplicate only surfaces in the reports, do not merge it
   yourself (rule 1) — flag it to the user as debt to resolve.
7. **A budget instead of a consent ritual.** Costs are guarded by
   `defaults.max_cost_usd` in bench.config.yaml; after the build,
   collect costs from the subagent reports and give the total. User
   consent is required only for raising the budget.
8. **Do not touch `.bench-kit/`** or task directories outside the batch
   being built; the scope rules from TASK_AUTHORING.md bind the
   subagents, and their sum binds you.

## Procedure

### 1. Scope

Read `tasks/backlog.md` and list the `pending` orders (name + one
sentence). By default you build all of them; if the user named a subset
in the invocation, build those. Orders incomplete against the entry
schema (BACKLOG_TEMPLATE.md in bench-new-task) get set aside with a
list of gaps — for completion, not for building.

### 2. Preparation

- `bench validate --offline` at the start: if the instance is red for
  reasons unrelated to the batch, report it to the user before building
  anything — subagents will not be able to tell their own red from the
  pre-existing one.
- Fresh `.repos/` clones for all base repos of the batch (rule 6).
- **Pin candidate per base repo**: pick a fresh commit that exists on
  the remote with proof of green CI (check statuses from the GitHub
  API) — the SHA + proof go into the subagent prompts. The candidate is
  a default, not binding: a subagent only verifies that **its** order
  makes sense on it, and may deviate with a justification in the
  report. Without this step, every subagent separately walks the
  history and queries CI for the same thing.
- **Evaluation environment ready before the fan-out**: get to a state
  where a single container entry passes — e.g. `bench assert` on any
  existing green task of the instance. The `bench-base` image, runner
  dependencies, and docker availability are shared batch
  infrastructure: you fix it, once, here — not the first subagent that
  stumbles into it as part of its task.
- Inventory of `evaluation-pool/` + assertion coverage decision for the
  batch's orders (rule 6a): what to reuse, what is new and shared (with
  an owner), what is new and disjoint.
- Check whether any two orders target the same files — if not (the
  default case), build in parallel, in waves of 2–3 (rule 5). An order
  waiting on a shared assertion goes in the wave after its owner.

### 3. Fan-out

For each order: switch the status to `in-progress` (a backlog edit),
launch a subagent via your tool's mechanism, and pass in its prompt:

- the full backlog entry for the order, verbatim;
- the pin candidate for the order's base repo: SHA + proof of green CI
  (step 2) and the deviation rule — the candidate is the default, the
  subagent verifies that its order makes sense on that commit, and any
  deviation requires a justification in the report;
- an instruction to read and follow
  `.agents/skills/bench-build/TASK_AUTHORING.md` (path per the
  instance's skills directory) — that is its procedure, with the hard
  rules and the report template;
- the instance root and a reminder: zero git, no fetching in
  `.repos/` (the clone is read-only; own state only via
  `git worktree add` under a unique name), do not touch the backlog,
  work only within its own scope;
- the names of the tasks being built in parallel next to it — so it
  knows whose files not to touch and where someone else's red in
  `bench validate` may come from, which it must not "fix";
- the `evaluation-pool/` inventory and your assertion decision
  (rule 6a): what to reuse under a specific name, what to build as new
  and under which name prefix. State explicitly that the pool may
  change underneath it while it works (a neighbor adds its
  directories), so re-scanning the pool mid-work settles nothing — your
  decision is binding, and any divergence from it must be reported;
- a reminder about the progress view: the subagent's first action is
  creating `tasks/<name>/todo.md` (step 0 of the procedure), updated
  immediately after each step — this file is how you and the user watch
  work in progress, so it must be written as it happens, not
  backfilled just before the report;
- the final report format: REPORT_TEMPLATE.md (file list, evidence from
  the reference, cost) + problems.

**Match the subagent's power to the order's profile** (the Type field
of the entry): launch documentation/conceptual tasks with reduced
reasoning effort — the full evidence procedure applies to them just the
same, but they do not need the power of an implementation task with
tests. Do not downgrade the model blindly: the quality of `prompt.md`
matters in every profile. Implementation orders get full power.

A subagent may end with a refusal plus a reason (e.g. the order is
infeasible on the current repo, the bug is unobservable) — that is a
valid outcome, not an orchestration failure. A deferred smoke test (no
secrets in the session, step 6.4 of TASK_AUTHORING) is not a failure
either — noted in the report, it moves to the batch gate (the "Next
step" section).

### 4. Collecting results and statuses

While the subagents work, watch their progress in their
`tasks/<name>/todo.md` files — each keeps its own up to date (step 0 of
TASK_AUTHORING.md), and that is where you look first when one gets
stuck or the user asks about batch status. You watch, you do not edit
(rule 1); when handing off its work, the subagent deletes its own
todo.md — if the file remains after its report, remind it to clean up
or flag it to the user as a leftover to remove (a working file would
enter `task_hash`).

After each subagent: (in the default mode its files are already in the
instance tree; only with isolated copies move them — rule 5), update
the entry to `done` or restore `pending` with a note on
refusal/failure. Do not fix a subagent's work yourself — a failed order
goes back into the queue with a diagnosis, not with your patch.

### 5. Next step

End your summary response with a **Next step** section: batch status
(how many tasks are ready in the working tree — with file lists and
per-task reports, how many orders went back to `pending`, total costs),
**one** recommendation with a one-sentence justification, at most two
alternatives with a price, and — separately — what awaits a human
decision. The fate of the built files — commit, PR, review, rejection —
is ALWAYS the user's decision; the reports give them the evidence for
it. Typical transitions:

- **A task with a judge component** → **bench-rubric, BEFORE the first
  run** — calibrating a fresh rubric before its first use does not
  close an era; after computed results it does.
- **Orders went back to `pending`** → complete the entries
  (bench-new-task) or re-run bench-build on the subset.
- **Reports note a deferred smoke test (no secrets in the session)** →
  after the user accepts the files, one trial
  `bench run --smoke` on all of the batch's new tasks at once, in an
  environment with keys (the user's session or CI) — before the full
  run, as the batch gate.
- **Tasks ready and accepted by the user** → full run.
