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
included) and `meta.json` (`new_identifiers`, `coupled`). Ignore
`reference.diff` and `merge.diff`; they're deleted with the scratch dir.

### 2. The hidden guard `tests/<name>-pr`

Copy `<scratch>/files/` to `evaluation-pool/tests/<name>-pr/files/`,
minus the tests the order's **Hidden tests** field drops. Removing a
single test case from a copied file is fine. Write `check.yaml`:

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

### 5. Rubric

`evaluation-pool/judge/<name>-rubric.md` per RUBRIC_AUTHORING.md, from
the order's Evaluation axis. The tests carry correctness, so the
rubric grades what they can't see: scope, quality, the reviewers' do's
and don'ts.

### 6. `task.yaml`

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

### 7. `bench validate`

Green, or `--offline` when the session has no network. A red caused by
another task's files (a parallel build) is noted in the report, not
fixed.

### 8. Report and cleanup

Write `reports/<name>-build.md` per REPORT_TEMPLATE.md. Delete the
scratch dir and any worktree you added. Nothing evaluation-flavoured may
stay in `tasks/<name>/`.
