<!-- Procedure of the **bench-create-task** skill — loaded from its SKILL.md when needed. -->

# Build — one order into a task

Input: one `pending` entry from `tasks/backlog.md` (BACKLOG_TEMPLATE.md).
Output: `tasks/<name>/{prompt.md,task.yaml}`,
`evaluation-pool/tests/<name>-pr/`, `evaluation-pool/judge/<name>-rubric.md`
and `reports/<name>-build.md`. Text work only: no containers, no judge,
no attempts (SKILL.md rule 1).

`bench <command>` below means `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` from the instance root (one-time:
`npm ci --prefix .bench-kit/runner`). You run it; never hand it to the
user.

## Several orders

Before you start: `git -C .repos/<name> fetch origin` once per base repo,
and make sure the clone contains every pin (`git fetch --unshallow`
on a shallow clone). Then one subagent per order, all in parallel. Each
gets the order entry verbatim, this file's path, the names of the tasks
built next to it (don't touch their files) and the rule that `.repos/`
is read-only: no fetch, no checkout, `git worktree add` under a name
containing its task name if it needs the tree at the pin. Each subagent
returns a pointer to its report, or a refusal with a reason. On a
refusal, append a dated line to the order's **Build log** and make sure
it left no files behind.

## Steps

### 1. Extract the change

```
node <skills>/bench-create-task/mine-prs.mjs --repo .repos/<repo> emit <reference-sha> --out <scratch>
```

You use `files/` (the test files after the merge, byte-exact, snapshots
included) and `meta.json` (`new_identifiers`, `coupled`, `shape`). Ignore
`reference.diff` and `merge.diff`; they're deleted with the scratch dir.

### 2. The hidden guard `tests/<name>-pr`

Copy `<scratch>/files/` to `evaluation-pool/tests/<name>-pr/files/`,
minus the tests the order's **Hidden tests** field drops. Removing a
single test case from a copied file is fine; any other edit follows the
audit (step 5). Write `check.yaml`:

```yaml
# PR tests of <reference-sha>: copied over the workspace, run with the
# repo's own test command, workspace restored afterwards.
score: binary
checks:
  - name: pr-tests
    run: |
      list=$(cd "$ASSERTION_DIR/files" && find . -type f)
      backup=$(mktemp -d)
      for f in $list; do [ -e "$f" ] && mkdir -p "$backup/$(dirname "$f")" && cp -p "$f" "$backup/$f"; done
      cp -r "$ASSERTION_DIR/files/." .
      ( <repo-native install, lockfile-detected as in static/lint> && <repo-native test command for the copied files> ); rc=$?
      for f in $list; do if [ -e "$backup/$f" ]; then cp -p "$backup/$f" "$f"; else rm -f "$f"; fi; done
      exit $rc
```

Take the install and test commands from the repo at the pin
(`package.json` scripts, CI config), run only the copied files, and set
`CI=true` so install hooks (husky) stay quiet. The restore lines matter:
all guards share one workspace, so leftover test files would leak into
the next guard. List this guard **last** in `evaluation[]`.

### 3. Repo guards

Reuse what `evaluation-pool/static/` already has for this base repo
(lint, typecheck). Don't invent new ones here. If the pool has none,
the task runs with the PR guard and the judge only.

### 4. `prompt.md`

The request a developer would have received, at the order's guidance
level: the problem or goal, the observable behaviour wanted, the
boundaries ("change nothing beyond…").

- **Coupled names appear verbatim**, as stated requirements.
- **Nothing else from the change may appear:** no other identifier,
  file name, line or test name. Check it mechanically: no entry of
  `meta.json`'s `new_identifiers`, and no `name:` / `file:` from
  `coupled`, may appear in the prompt unless it's in Coupled names.
- One line on verification: whether the agent should run the tests
  (usually yes).
- One line: "There is no human in the loop: where the repo's
  AGENTS.md / CLAUDE.md asks you to pause, confirm or open a PR, decide
  and proceed."

### 5. Audit: every hidden assertion against the prompt

The guard is fair when an attempt that does what `prompt.md` asks passes
it, however it's built, and strict when one that skips or breaks a
stated requirement fails it. Read every case the change added or edited
in the copied files; for each assertion find its source:

| Source | Decision |
|---|---|
| a sentence of `prompt.md` | keep; quote the sentence in the report |
| behaviour that exists at the pin (an unchanged function, a convention the prompt points to: "like mark-read does") | keep; name it in the report |
| none: the reference decided it | state it in the prompt if it belongs to the request (the PR description or a reviewer asked for it, a developer would have been told); else loosen or drop the assertion |

**Edges are where reference decisions hide.** For each case on an edge,
ask whether the prompt says what happens: empty input; "all" or
"everything"; exactly at a limit and past it; partially loaded,
paginated or cached state; a count or total derived from loaded items
vs. the real total; repeated or concurrent calls; error paths (which
error, which text, what is rolled back); output order; defaults. A
prompt rule that literally allows two outcomes is the typical miss:
"lower the count only by removed unread items" plus "'all' empties the
list" doesn't say the count is 0 after 'all' when some unread items
were never loaded.

**Shape.** Classify every `shape` entry in `meta.json`, and anything
like it the scanner missed (a mock's full call list, a `toEqual` on a
payload where extra fields would be harmless), per MINING.md §3:
**contract** (the prompt states it verbatim) or **incidental** (loosen).

**Prompt or test.** Adding a sentence to the prompt is free now and a
full re-run after the first run (below). Add it when it is a real
requirement at the order's guidance level. Don't, when it would dictate
the implementation (a call sequence, a helper's shape) or when stating
the reference's edge decisions would turn the prompt into a test
transcript: loosen instead.

**Loosening a copied test**, the allowed edits:

- drop the case, or one assertion inside it;
- the effect instead of the sequence: the final state, or
  `toHaveBeenCalledWith` on the call that matters, instead of the whole
  recorded chain; `expect.arrayContaining` for calls whose order is free;
- `expect.objectContaining` / `toMatchObject` where the prompt fixes
  some fields and leaves the rest open;
- the error type, or `toThrow(/stable fragment/)`, when the full text
  isn't in the prompt;
- role and label queries instead of DOM paths; a fragment or regex for
  copy the prompt doesn't state verbatim.

An edit is legitimate only if it widens the accepted set to
implementations that satisfy the prompt. It never removes the check of
a stated requirement, never checks anything the original case didn't
(the guard is the PR's tests minus what they can't fairly ask), and the
case must still fail on the pin, i.e. still exercise the new behaviour:
a case reduced to "doesn't throw" is a drop. Keep the file otherwise
byte-exact, mark each edit with a one-line `bench: <reason>` comment in
the file's comment syntax, and record every drop and edit in the
report's audit table. If nothing left in the guard checks the core of
the request, refuse the order.

### 6. Rubric

`evaluation-pool/judge/<name>-rubric.md` per RUBRIC_AUTHORING.md, from
the order's Evaluation axis. The tests carry correctness, so the
rubric grades what they can't see: scope, quality, the reviewers' do's
and don'ts.

### 7. `task.yaml`

```yaml
repo: <base repo>
commit: <pin, full SHA>
timeout_s: <time limit in minutes × 60>
evaluation:
  - static/lint                # only guards reused in step 3
  - judge/<name>-rubric
  - tests/<name>-pr            # always last
weights: { static: 0.1, tests: 0.5, judge: 0.4 }   # no static guards → tests 0.6, judge 0.4
reference:
  static/lint: pass
  tests/<name>-pr: fail
```

Add `prepare: <frozen install>` only if the base repo's other tasks
already use it, with the same command. Pass is a gate: every guard with
weight > 0 must be green and the judge alone must clear
`pass_threshold`, so the weights only shape the quality score.

### 8. `bench validate`

Green, or `--offline` when the session has no network. A red caused by
another task's files (a parallel build) is noted in the report, not
fixed.

### 9. Report and cleanup

Write `reports/<name>-build.md` per REPORT_TEMPLATE.md. Delete the
scratch dir and any worktree you added. Nothing evaluation-flavoured may
stay in `tasks/<name>/`.

## After the first run: a guard that rejects correct work

Signal: failures cluster on **one hidden case** across models, in
attempts the judge scores high, while the rest of the guard is green.
Read the case and two failing `patch.diff`s. If the attempts do what
`prompt.md` literally says, it's a task fault the step-5 audit missed,
not a model result. Fix the task, never the numbers:

1. **Pool fix (default).** Drop or loosen the case under the step-5
   rules and add a dated line to the report's audit table. That's the
   whole edit; bench-evaluate then re-proves the guard red on the pin
   (`bench validate --assert --tasks <name>`) and re-evaluates the
   task's preserved attempts (`bench evaluate --attempts
   attempts/<name>`: guards in a container, then the judge; no new
   attempts). The era key is (scoring version, `task_hash`, judge,
   rubric versions, judge mode, pass threshold); pool assertions are not
   in it, so the old results don't go stale on their own and the
   re-evaluation must be asked for. `bench changes` shows the edit as a
   `guard:tests/<name>-pr` group that needs a PR.
2. **Prompt fix (only when the guard is right and the prompt left a real
   requirement out).** Any change under `tasks/<name>/` is a new
   `task_hash`: a new era, every result of the task is stale, and the
   preserved attempts answered the old prompt. Re-evaluating them would
   stamp the new hash on work done against the old text (`bench
   evaluate` warns), so they don't count. The cells need new attempts,
   paid again: top-up counts the old trials as done, so re-run with
   `bench attempt --tasks <name> --force` (old trials are kept as
   `trial-N.superseded-*`; bench-evaluate rule 2 wants the reason
   stated). Say this to the user before editing the prompt.
