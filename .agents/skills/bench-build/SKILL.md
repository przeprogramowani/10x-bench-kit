---
name: bench-build
description: >-
  Builds benchmark tasks from pending orders in the backlog
  (`tasks/backlog.md`): fans the orders out to subagents — each does
  the authoring as text work (pin, overlay, prompt, assertions,
  weights), containers only where its own files need proof — then
  proves the whole batch once at the batch gate (`bench validate
  --assert` + smoke) and leaves finished files in the working tree
  with an evidence report — no git.
  Use when the user wants to build tasks from the backlog or says
  "bench-build / build the tasks / process the backlog".
---

# bench-build — building tasks from the backlog

You orchestrate task construction: you read `pending` orders from
`tasks/backlog.md`, fan them out to subagents, keep statuses accurate,
and run the **batch gate** at the end. The actual task authoring —
pin, overlay, prompt, assertions, weights, self-check — is done by a
**subagent** following the procedure in
[TASK_AUTHORING.md](TASK_AUTHORING.md), one order per subagent.

Authoring is text work. After 0.20.0 the scripted assertions are
repo-native execution guards shared by every task on a base repo, so
"is the starting state green" is a fact about **repo@pin**, not about
each task — proving it once per batch is enough. A subagent enters a
container only when its own files need proof (an overlay it seeded, a
guard it created); everything else is proven once, by you, at the gate.
That is what keeps a batch fast: no per-task `bench validate --assert`,
no per-task smoke, no waves throttled by container contention.

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
   working tree, plus a per-task report **file** at
   `reports/<task-name>-build.md` per
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) with evidence from the
   starting state — what happens next (commit, PR, review, rejection) is
   solely the user's decision. Keep tasks from one batch separate:
   separate directories, separate reports, no merging.
4. **Backlog statuses are the source of truth.** Before a subagent
   starts, the entry moves to `in-progress`; when it returns, to
   `built` (files + report present) or back to `pending` with a note
   explaining why; `done` only after the batch gate (step 5). Backlog
   updates are file edits, not commits (rule 3).
5. **Parallel is the default mode — the whole batch at once.** Orders
   in one batch are independent: each subagent writes only to
   `tasks/<its-task>/` and its own directories in `evaluation-pool/`,
   and treats `.repos/<name>/` as read-only — so there is nothing to
   clobber and building in a single working tree is safe. An isolated
   repo copy (worktree) is not required; it can even be harmful,
   because `.repos/` is in `.gitignore` and a fresh worktree simply
   has no clones. Subagents do text work (rule 9), so containers no
   longer throttle the fan-out — launch every order of the batch
   together. Build sequentially only when two orders genuinely target
   the same files (e.g. a shared new assertion in the pool) — in that
   case tell the subagents explicitly or run them one after another.
   If you nevertheless use isolated copies, after a subagent finishes
   move its files (the report has the list) into the instance's
   working tree — copying files, not git operations.
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
     the same thing — for execution guards this is the norm: two tasks
     on the same base repo share ONE guard set (its lint/build/suite),
     they do not each get their own.
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
9. **Containers are a batch resource, not a per-task ritual.** A
   subagent may enter a container only to prove **its own** files:
   an overlay it seeded (bugfix orders — the red/green counter-proof)
   or a guard it created. Reused guards on the batch's pin, the full
   `bench validate --assert`, and the smoke attempt are proven once
   for the whole batch at the **batch gate** (step 5), by you. Pass
   this policy in every subagent prompt; a subagent running
   `bench validate --assert` or `bench attempt` on its own is spending
   the batch's container time on something you will prove anyway.

## Runner tools

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter: `bench <command>`;
one-time prerequisite: `npm ci --prefix .bench-kit/runner`). There is
no `bench` executable in PATH — the shorthand names the runner
entrypoint, which is benchmark internals. **You run it; never hand the
user a `bench …` command to execute.** When execution needs an
environment you lack (API keys, containers), the user-facing options
are: providing keys to this session (the benchmark runs locally on
the operator machine) — phrased that way, not as runner commands.

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
- Inventory of `evaluation-pool/` + assertion coverage decision for the
  batch's orders (rule 6a): what to reuse, what is new and shared (with
  an owner), what is new and disjoint.
- Check whether any two orders target the same files — if not (the
  default case), build the whole batch in parallel (rule 5). An order
  waiting on a shared assertion starts after its owner finishes.
- Container readiness (engine up, `bench-base` image, runner
  dependencies) is needed by bugfix orders (overlay proofs) and by
  the gate — check `bench doctor` now if the batch has bugfix orders,
  otherwise before step 5. Infrastructure is fixed once, by you —
  never by a subagent mid-task.

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
- the container policy (rule 9): `bench assert` only for the overlay
  it seeds or a guard it creates; no `bench validate --assert`, no
  `bench attempt` — the batch gate covers those, and its output will
  be appended to the subagent's report by you;
- a reminder about the progress view: the subagent's first action is
  creating `tasks/<name>/todo.md` (step 0 of the procedure), updated
  immediately after each step — this file is how you and the user watch
  work in progress, so it must be written as it happens, not
  backfilled just before the report;
- the final report format: REPORT_TEMPLATE.md, written as a **file** to
  `reports/<task-name>-build.md` (file list, evidence from the starting
  state, shape-neutrality checklist, criteria digest, cost, full-run
  cost projection) — the subagent's closing message is a pointer to that
  file + problems, never the report's only copy.

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
instance tree; only with isolated copies move them — rule 5), mark the
entry `built` (an interim status: files and report present, gate
pending) or restore `pending` with a note on refusal/failure. **The
report file is part of the deliverable**: confirm that
`reports/<task-name>-build.md` exists in the working tree and that its
evidence sections carry **pasted command output** for everything the
subagent owns — a `bench assert` result behind every overlay
counter-proof and every guard it created, `bench validate --offline`
green. A report that arrived only in the subagent's message, or whose
evidence sections are declarations without output, is a missing
report: send the subagent back to persist it (or restore `pending`
with that note) — "runner output confirms states, not declarations"
applies to the build itself, not just to runs. Do not fix a subagent's
work yourself — a failed order goes back into the queue with a
diagnosis, not with your patch.

### 5. Batch gate

One pass, for the whole batch, once every subagent has returned. This
is where the starting state of every new task is proven — the step the
subagents deliberately skipped (rule 9).

1. `bench doctor` if you have not already (engine, image, deps).
2. `bench validate --assert` — verifies **every** `reference`
   declaration of the batch's tasks (and the instance) on the starting
   state in containers. Red on a task of the batch → that order goes
   back to its subagent with the pasted output (status `pending` with
   the note), the rest of the batch proceeds.
3. Smoke, **provided the session has provider API keys**:
   `bench attempt --smoke --tasks <all batch tasks> --models
   <cheap-model>` then `bench evaluate --no-write-results` on the
   produced attempts. This is the **solvability probe** (there is no
   reference implementation): an assertion that no smoke attempt
   greens is suspect-harness — back to the subagent for diagnosis, or
   weight 0 with a note, never a charge against models. Without keys:
   note "smoke deferred — no secrets in the session" and hand it to the
   Next step; points 1–2 remain unconditional.
4. Append a `## Batch gate` section (REPORT_TEMPLATE.md) with the
   pasted outputs of 2–3 to **each** task report of the batch — the
   report must carry the proof, not your chat message.
5. Only now: `built` → `done` for every order that passed.

The gate costs one `validate --assert` pass and one smoke attempt per
task — the same container time a single subagent used to spend on
itself, paid once instead of N times.

**Workspace preservation needs no configuration.** Every trial keeps
its full post-agent workspace on disk as part of the preserved-attempt
contract (`attempts/<task>/<model>/trial-N/workspace/`,
`.bench-kit/ATTEMPT_FORMAT.md`) — there is nothing to switch on per
task. Legacy orders carrying a `Workspace archive` decision are simply
satisfied by that default; do not edit the config for them.

### 6. Next step

End your summary response with a **Next step** section: batch status
(how many tasks are ready in the working tree — with file lists and
per-task reports, how many orders went back to `pending`, total
costs),
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
- **The batch gate deferred its smoke (no secrets in the session)** →
  after the user accepts the files, one `bench attempt --smoke` on all
  of the batch's new tasks at once, in a session with keys — you run
  it once the user provides them (never ask the user to run `bench`
  themselves) — before the full run. The smoke run doubles as the
  **solvability probe**: an assertion that no smoke attempt greens is
  suspect-harness — flag it for diagnosis instead of letting it count
  against models.
- **A report's full-run cost projection exceeds `max_cost_usd`** →
  surface it here, before anything runs: the recommendation is
  a single-model run (or the smoke gate alone) first, with the
  budget raise listed under "awaits a human decision" — a full matrix
  that truncates mid-run wastes the spend and yields a partial,
  misleading leaderboard.
- **Tasks ready and accepted by the user** → full run via **bench-measure**.
