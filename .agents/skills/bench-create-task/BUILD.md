<!-- Procedure of the **bench-create-task** skill — loaded from its SKILL.md when needed. -->

# Build — tasks from the backlog's orders

You orchestrate task construction: you read `pending` orders from
`tasks/backlog.md`, fan them out to subagents, watch their stages
through `bench backlog` (derived from disk, never written — rule 4),
and run the **batch gate** at the end. The actual task authoring —
pin, overlay, prompt, assertions, the rubric, weights, self-check — is
done by a **subagent** following the procedure in
[TASK_AUTHORING.md](TASK_AUTHORING.md) (rubric:
[RUBRIC_AUTHORING.md](RUBRIC_AUTHORING.md)), one order per subagent.

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
interview (INTERVIEW.md) or PR mining (MINING.md), and stop —
do not invent tasks yourself.

## Hard rules

1. **The orchestrator does not author.** You do not pick pins, write
   prompts, or write assertions — subagents do that per
   TASK_AUTHORING.md. Your job: scoping, preparing shared resources,
   fan-out, watching stages (`bench backlog`), the aggregate report.
2. **The order is a contract.** A subagent builds what the backlog
   entry says — the design decisions were made when the order was written (INTERVIEW.md / MINING.md). Do
   not patch gaps in an entry with guesses: an incomplete order goes
   back to the user (or to the interview), not into the build.
3. **Zero git — files and reports, nothing more.** Neither you nor the
   subagents commit, branch, or push. The output of a batch is finished
   `tasks/<name>/` directories (+ new assertions in the pool) in the
   working tree, plus a per-task report **file** at
   `reports/<task-name>-build.md` per
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) with evidence from the
   starting state — what happens next (commit, PR, review, rejection) is
   solely the user's decision. Keep tasks from one batch separate:
   separate directories, separate reports, no merging.
4. **The disk is the source of truth, not the backlog's status
   lines.** You do not move statuses. An order's stage is derived by
   `bench backlog` from facts the procedure already produces: the
   subagent's `todo.md` (building), `task.yaml` + report (built), the
   report's filled `## Batch gate` section (ready), attempts and
   current-era evaluations (measuring / measured). A stage cannot
   drift, a dead session cannot leave an order stuck `in-progress`, and
   a batch does not rewrite N status lines that conflict with whoever
   else edited the backlog meanwhile. The only backlog edit you make is
   appending a dated line to an order's **Build log** when its subagent
   refused or its gate went red. That is history, not state, and it is
   a file edit, not a commit (rule 3).
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
   forbid subagents from fetching. A clone may be shallow (older or
   `--shallow` init), so if any order needs a commit outside the fetched tip (an old pin, a
   diff between pins), deepen the clone HERE — `git fetch --unshallow`
   or `git fetch origin <sha>` — never inside a subagent: parallel fetches in a single clone
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
     each agent's own scan. Rubrics (`judge/`) are outside this
     decision: each task writes its own `judge/<task>-rubric`, never
     shared, so there is nothing to deduplicate — `default-rubric` is
     a generic example, not a fallback for real tasks.
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
   - **Decide the repo's guard set and `prepare` once per base repo**
     (TASK_AUTHORING.md, "Which repo-level guards a task gets" and
     "`prepare`"). Typecheck and lint by default, and `prepare` when
     a frozen install costs more than about a minute. Write the
     decision into every prompt for that repo. A repo that already
     has tasks keeps its existing decision: changing `prepare` on a
     measured task opens a new era.

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
10. **A guard that cannot go red measures nothing.** Green on the
    starting state proves the harness works; it does not prove the
    guard discriminates. A task whose assertions are green before the
    agent starts and green whatever the agent does contributes **zero
    information at full weight** — the run pays for it and learns
    nothing. Every assertion therefore ships with a **counter-proof**:
    a concrete way it goes red for the right reason (step 5.3a).
    Where none exists, the honest move is weight 0 with a note, not a
    guard that always passes. Weights are per component type, so when
    only **one** guard of a type cannot go red (typecheck on a
    Svelte-only change: `astro check` does not type-check `.svelte`),
    leave that guard out of this task's `evaluation` and `reference`
    and say why in the build report — the other guards of the type keep
    their weight. A reused repo guard is **re-proven per task**: its
    counter-proof on one task says nothing about files of another kind.

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

Run `bench backlog` and take the orders at stage `ordered` (name + one
sentence from the entry). By default you build all of them; if the user
named a subset in the invocation, build those. Read its notes before
fanning out: an order flagged without a Decision is not built
(bench-create-task SKILL.md rule 1 / INTERVIEW.md rule 7), and a `building`
order whose todo.md has gone stale is a dead session. Tell the user about it; do not overwrite it with a
second subagent. Orders incomplete against the entry
schema (BACKLOG_TEMPLATE.md in bench-create-task) get set aside with a
list of gaps — for completion, not for building.

### 2. Preparation

- `bench validate --offline` at the start: if the instance is red for
  reasons unrelated to the batch, report it to the user before building
  anything — subagents will not be able to tell their own red from the
  pre-existing one.
- Fresh `.repos/` clones for all base repos of the batch (rule 6).
- **Pin candidate per base repo** (interview orders only — a mined
  order's pin is the parent of its change, fixed by history; skip this
  step for an all-mined batch): pick a fresh commit that exists on the
  remote with proof of green CI (check statuses from the GitHub API, or
  the user's word when there is no `gh`) — the SHA + proof go into the
  subagent prompts. The candidate is
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
  dependencies) is needed by bugfix orders (overlay proofs), by mined
  orders (`Source: pr` — the two-direction proof of `tests/<task>-pr`)
  and by the gate — check `bench doctor` now if the batch has bugfix
  or mined orders, otherwise before step 5. Infrastructure is fixed
  once, by you — never by a subagent mid-task.

### 3. Fan-out

For each order, launch a subagent via your tool's mechanism. There is
no status to switch: the subagent's first action, `tasks/<name>/todo.md`,
is the claim `bench backlog` reads as `building`. Pass in its prompt:

- the full backlog entry for the order, verbatim;
- for a **mined order** (`Source: pr`): its own **Pin** from the entry,
  not the batch candidate, and the instruction to follow the "Mined
  orders" path of TASK_AUTHORING.md, which extracts the tests and
  reference with `mine-prs.mjs emit` and proves both directions. The
  clone must already be deep enough to contain the pin (rule 6);
- otherwise, the pin candidate for the order's base repo: SHA + proof of green CI
  (step 2) and the deviation rule — the candidate is the default, the
  subagent verifies that its order makes sense on that commit, and any
  deviation requires a justification in the report;
- an instruction to read and follow
  `<skills>/bench-create-task/TASK_AUTHORING.md` — `<skills>` is the
  instance's skill root from `.bench-kit/instance.json` (e.g.
  `.claude/skills`), spelled out in the prompt — that is its procedure, with the hard
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
  state, shape-neutrality checklist, rubric section, cost, full-run
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
valid outcome, not an orchestration failure.

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
instance tree; only with isolated copies move them — rule 5),
`bench backlog` shows the order as `built` (task.yaml + report present,
gate pending). On a refusal, make sure the subagent removed its partial
`tasks/<name>/` (TASK_AUTHORING.md step 0) so the order reads `ordered`
again, and append the reason to its **Build log**. **The report file
is part of the deliverable**: confirm that
`reports/<task-name>-build.md` exists in the working tree and that its
evidence sections carry **pasted command output** for everything the
subagent owns — a `bench assert` result behind every overlay
counter-proof and every guard it created, a `bench judge` empty-diff
verdict behind the rubric, `bench validate --offline` green. A report
that arrived only in the subagent's message, or whose
evidence sections are declarations without output, is a missing
report: send the subagent back to persist it (or, if it cannot, have
its files removed and log the reason in the order's Build log) — "runner output confirms states, not declarations"
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
   back to its subagent with the pasted output (a dated Build log line
   on the order), the rest of the batch proceeds.
3. Smoke, **provided the session has provider API keys**:
   `bench attempt --smoke --tasks <all batch tasks> --models
   <cheap-model>`, then for each smoke attempt it produced
   `bench evaluate --attempt <attempts/<task>/<model>/trial-N>
   --no-write-results` (one `--attempt` per smoke attempt; a bare
   `bench evaluate` would take every preserved attempt). The smoke
   attempt is a regular preserved attempt and counts as trial 1 of its
   cell in the later matrix, so its cost is not wasted. This is the
   **solvability probe** (no reference implementation is written; only
   a mined order brings one, from history): an assertion that no smoke
   attempt greens is suspect-harness — back to the subagent for
   diagnosis, or weight 0 with a note, never a charge against models.
   **Exception:** a mined order's `tests/<task>-pr` is not
   suspect-harness when the smoke attempt fails it — its solvability
   proof is the reference diff green in the build report
   (TASK_AUTHORING.md, "Mined orders"), so a failed smoke there is a
   model result. Without keys: note "smoke deferred — no secrets in the
   session" and hand it to the Next step; points 1–2 remain
   unconditional.
   **Read the smoke's judge verdict per criterion, not just the total.**
   The judge call is already paid for, and the smoke diff is the only
   real wrong-but-competent attempt the batch will see before the
   matrix (bench-evaluate's JUDGE_DIAGNOSTICS.md calibrates on real attempts and fabricates no
   synthetic ones, so there is no other source). With
   `--no-write-results` nothing is written as a verdict; the `judge:`
   lines of that evaluate output carry it. Read each criterion's score and justification against the diff, and
   ask the one question the total hides: **does a diff that fails the
   task's decisive axis still land near `pass_threshold`?** If it does,
   the rubric is not gating — fix it now, while no results exist and
   the edit is free, rather than after a paid matrix has been scored
   with it. A rubric fix at this point costs one judge call per
   preserved attempt and no re-run.
3a. **Discrimination counter-proof** (rule 10) — the other direction
   of point 3. Point 3 proves an assertion *can* go green; this proves
   it can go **red for the right reason**. For every assertion of
   every task in the batch, record one of:
   - **red on the starting state** — already proven by point 2 for
     bugfix-style tasks whose overlay seeds the defect: the assertion
     is red before, green after. The same holds for a mined order's
     `tests/<task>-pr`: declared `fail` at the pin and proven red there
     (and green with the reference diff) in the build report. Nothing
     more to do.
   - **red on a deliberate break** — for tasks green at the start
     (feature work: the repo's own lint / types / suite), show the
     assertion failing on a plausible wrong implementation. One
     container, one throwaway edit that a solver might realistically
     produce, the failing output pasted into the report.
   - **cannot go red** — say so plainly and set the component's weight
     to **0** with a one-line note. A guard the prompt itself instructs
     the agent to run, over checks the repo already keeps green, tends
     to land here: every model complies, every score is 1.00, and the
     weight silently moves to the judge anyway. Better to move it
     deliberately.

   A batch where *every* task lands in the third case is a signal about
   the batch, not about the guards: flag it in the Next step, because
   those tasks will be decided entirely by the judge.
4. Append a `## Batch gate` section (REPORT_TEMPLATE.md) with the
   pasted outputs of 2–3a to **each** task report of the batch — the
   report must carry the proof, not your chat message.
5. Nothing to flip: the filled `## Batch gate` section is the fact
   `bench backlog` reads, so every order that passed now shows as
   `ready`. Run it once and check that the batch reads the way you
   think it does.

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
per-task reports, how many orders are back at `ordered`, total
costs, and the `bench backlog` stages of the batch),
**one** recommendation with a one-sentence justification, at most two
alternatives with a price, and — separately — what awaits a human
decision. The fate of the built files — commit, PR, review, rejection —
is ALWAYS the user's decision; the reports give them the evidence for
it. **Hand that decision over in its reviewable form: run
`bench changes` and paste its plan.** It groups the working tree by
intent, one group per new task with its rubric, new guards and report,
the backlog separately, and anything that touched an existing guard or
rubric marked as closing an era. Each group comes with the `git add` /
`git commit` lines the user can take as they are. The user reviews
intent per group instead of a flat list of paths. A blocked group (a
leftover `todo.md`, a rubric edited without a version bump while results
use it) is yours to fix before handing over. Typical transitions:

- **A task with a judge component** → straight to **bench-evaluate**;
  the rubric is calibrated by the first real attempts (the report names
  the criterion to spot-check first). A rubric fix after that run
  re-evaluates preserved attempts, never re-runs them. bench-evaluate's
  JUDGE_DIAGNOSTICS.md is not a step here — it is a diagnostic for judge stability / judge
  comparison once attempts exist.
- **Orders are back at `ordered`** (refused, gate red) → complete the
  entries (MINING.md / INTERVIEW.md) or re-run BUILD.md on the subset.
- **The batch gate deferred its smoke (no secrets in the session)** →
  after the user accepts the files, one `bench attempt --smoke` on all
  of the batch's new tasks at once, in a session with keys — you run
  it once the user provides them (never ask the user to run `bench`
  themselves) — before the full run, evaluated per smoke attempt with
  `bench evaluate --attempt <dir> --no-write-results` as in step 5.3.
  The smoke run doubles as the **solvability probe**: an assertion
  that no smoke attempt greens is suspect-harness — flag it for
  diagnosis instead of letting it count against models — except a
  mined order's `tests/<task>-pr`, whose solvability the reference
  diff already proved (a failed smoke there is a model result).
- **A report's full-run cost projection exceeds `max_cost_usd`** →
  surface it here, before anything runs: the recommendation is
  a single-model run (or the smoke gate alone) first, with the
  budget raise listed under "awaits a human decision" — a full matrix
  that truncates mid-run wastes the spend and yields a partial,
  misleading leaderboard.
- **Tasks ready and accepted by the user** → full run via **bench-evaluate**.
