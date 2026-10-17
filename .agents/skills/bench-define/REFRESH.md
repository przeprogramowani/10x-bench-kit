<!-- Procedure of the **bench-define** skill — loaded from its SKILL.md when needed. -->

# Refresh — task aging

The task is pinned to a months-old commit while the base repo keeps
moving. A refresh is not a SHA swap: it is a full re-pass of the
**"prove on the starting state before you propose"** principle for the
entire task on the new pin — overlay, assertions,
`reference` declarations. Changing anything in `tasks/<name>/` changes
the `task_hash`, so a refresh by definition opens a new era for the
task — the PR says so explicitly. If the task no longer makes sense on
the new code, say so plainly and propose retiring it rather than
rescuing it artificially. A task mined from history is the exception
to "new pin": its pin cannot move (see "Mined task" below).

## Hard rules

1. **Zero git — files plus a refresh report; the PR is the user's.**
   You leave the changed task files in the working tree and write the
   refresh report to `reports/<name>-refresh.md` per
   [REFRESH_PR_TEMPLATE.md](REFRESH_PR_TEMPLATE.md) — you do not
   branch, commit or push. At handover `bench changes` marks the task's
   group as era-closing (PR); the **user** opens the PR (branch
   `bench-refresh/<name>`) with the report as its description, and a
   human merges. Never to the instance's master directly.
2. **Refresh = a new era for the task.** Any change to the task
   directory changes the `task_hash`. The PR has a "Comparability
   impact" section: existing results for the task remain visible as
   history; new results are not comparable with them. There is no such
   thing as a "scoring-neutral" refresh.
3. **Prove on the starting state from scratch.** No assertion,
   `reference` declaration, or overlay makes it into the PR "because it
   worked on the old pin" — re-run every proof on the new pin via
   `bench assert` / `bench validate --assert`. The shape-neutrality
   rule from bench-define's TASK_AUTHORING.md applies unchanged —
   scripted assertions run only the repo's own commands, and a refresh
   is a fresh chance for the repo to have renamed those commands or
   moved its toolchain.
4. **A refresh preserves intent.** Adapt the prompt/overlay/assertions
   to the new code minimally; changing WHAT the task measures is a new
   task (ordered via INTERVIEW.md or MINING.md, built via BUILD.md), not a
   refresh.
5. **Never modify shared assertions in place.** A pooled assertion used
   by other tasks changes their scoring without a trace in the stamps
   (`task_hash` covers only the task directory). If an assertion needs
   changing and someone else uses it: create a new version in the pool
   (e.g. `tests/<name>-v2`) and swap it in this task's `evaluation[]`.
6. **Isolation of evaluation materials.** As in bench-define: nothing
   from `evaluation-pool/` goes into `tasks/<name>/`; the task's
   rubric and any calibration set (bench-measure's JUDGE_DIAGNOSTICS.md,
   from preserved attempts) live under `evaluation-pool/judge/`, never in `tasks/`.
7. **Do not touch `.bench-kit/`** or other people's tasks.
8. **Budget instead of a consent ritual.** Costs are guarded by
   `defaults.max_cost_usd` in bench.config.yaml — do not ask for
   permission before a trial run or a judge call; report the actual
   cost afterwards. Only raising the budget requires consent.

## Runner tools

From the instance root: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <command>` (hereafter: `bench <command>`;
one-time prerequisite: `npm ci --prefix .bench-kit/runner`). There is no
`bench` executable in PATH — the shorthand is benchmark internals. You
run these commands yourself; never hand the user a `bench …` command to
execute. The user's surface is the config, environment variables, and
git.

- `bench validate` — the warning `zadanie przeterminowane (expires: …)`
  is the canonical trigger for this procedure; after the refresh, gate with
  `--assert`.
- `bench assert <ref...> --task <name> [--no-overlay] [--patch <file>]...`
  — observability and feasibility proofs on the new pin; repeating
  `--patch` = the full set of diffs in a single container entry.
- `bench judge --task <name> --patch <file>` — judge verdict on the
  empty diff (the rubric's floor on the new pin).
- `bench attempt` + `bench evaluate` — optional smoke run (step 7).

## Mined task (`Source: pr`)

A task mined from history (MINING.md) cannot take a new pin. Its pin
is the parent of the mined change, and every later commit of the
default branch already contains the solution: a "fresh" pin would
hand the agent a finished task. Its refresh is therefore a re-proof on
the **same pin**, not a move:

1. **Regenerate the reference.** `node <skills>/bench-define/mine-prs.mjs
   --repo .repos/<name> emit <reference-sha> --out <scratch>` — the SHA
   is the order's Reference and the build report's; the clone must
   contain it (deepen once, as in step 2).
2. **Re-prove both directions on the same pin** in one container
   entry: `bench assert tests/<task>-pr --task <task> --patch
   <empty.diff> --patch <scratch>/reference.diff` → the empty diff
   scores 0, the reference 1, and the red log still shows the change's
   own assertions failing (TASK_AUTHORING.md, "Mined orders"). The
   task's other guards go through `bench validate --assert` as in
   step 7.
3. **Renew `expires`** (step 6). That is a task.yaml change, so it is
   still a new era for the task (rule 2).
4. **If the pin no longer builds** — the toolchain drifted under it
   (dependencies no longer installable, a runtime the image no longer
   provides) — the task cannot be refreshed. Retire it (the directory
   removed in the working tree, the era section in the refresh report)
   and mine a newer change of the same class (MINING.md) to replace it.

Steps 2–5 below (new pin, sense verdict, overlay, porting) do not
apply to a mined task; the self-check (step 7, where a smoke attempt
failing `tests/<task>-pr` is a model result, not suspect-harness —
the reference diff proved solvability) and the report (step 8) do.

## Procedure

### 1. Reconnaissance

Read before changing anything:

- `bench validate` — which `expires` warning fired (or the explicitly
  stated reason for the refresh),
- `tasks/<name>/`: task.yaml (repo, pin, evaluation, reference,
  weights, expires), prompt.md, overlay/,
- related materials: the task's rubric
  `evaluation-pool/judge/<task>-rubric.md` — its judge-facing context
  names mechanisms of the old pin; a calibration set in
  `evaluation-pool/judge/<task>-calibration/`, if JUDGE_DIAGNOSTICS.md
  built one, holds old-era attempt diffs,
- the task's most recent results (results/<task>/ in the repo) — after the
  refresh they stop being comparable; it is worth knowing what you are
  closing out.

### 2. New pin

Propose a fresh, stable commit of the base repo (ideally the latest
green on CI), full SHA. Work in the local clone `.repos/<name>/`
(the AGENTS.md convention; if missing, clone there) — after
`git fetch origin`, because the new pin must exist on the remote.
The clone from `bench-kit init` is shallow by default, so the old pin
may simply not be in it (`fatal: bad object <sha>`, an empty
`git log <old>..<new>`) — deepen it once, before the diff:
`git fetch --unshallow` (or `git fetch origin <old-pin>` for that one
commit). Review what happened in the task's area:

```
git log --oneline <old-pin>..<new-pin> -- <task paths>
git diff <old-pin>..<new-pin> -- <task paths>
```

**Start with this task-area diff — before running any gate.** It is
the cheapest possible information and it determines which step-3
scenario you are in: "sense unchanged" (proofs should pass without
adaptation), "sense after adaptation" (you know upfront what to
adapt), or "no longer makes sense" (you finish after one command
instead of a full cycle). It is the input to step 3. Verify that the
project builds on the new pin and that the files the task concerns
still exist.

If the old pin is still the base repo's HEAD, the refresh reduces to
renewing `expires` — you still run the proofs from steps 4–5 (to
confirm nothing has rotted), and the PR states explicitly that this is
still a new era (any task.yaml change changes the `task_hash`), even
with an identical pin and assertions.

### 3. Does the task still make sense

Three possible outcomes — name which one applies:

- **Sense unchanged** — the task's area untouched between pins; carry on.
- **Sense after adaptation** — files/names/architecture have drifted,
  but the task's intent stands; adapt minimally (rule 4).
- **No longer makes sense** — the overlay-seeded bug was fixed in the
  repo, the module was removed or rewritten, the functionality already
  exists. Say so plainly and propose retiring the task (the directory
  removed in the working tree, an era section in the refresh report —
  the user's PR carries both) — a task rescued by force measures
  noise, not agent work.

### 4. Overlay on the new pin

**Adapt the material before running the gates, not after they go red.**
If the area diff (step 2) shows a file has drifted, then the overlay
and the rubric's repo-specific context need porting — do it right away, in one
sitting in the repo, instead of discovering each one via another red
pass through the container.

Overlay files **overwrite** repo files at trial start. On the new pin,
the old overlay may overwrite a newer version of a file — i.e. revert
repo changes and measure the wrong thing. Check the diff of every
overlay file against its counterpart on the new pin: the overlay must
differ from the new pin's file **solely by the bug seed**. If the repo
file has drifted — port the bug seed onto its new version.

Then redo the observability proof from scratch, as in bench-define
(TASK_AUTHORING.md, step 2):

- guard-observed seed: on the starting state (new pin + overlay) the
  repo-native guard is red — `bench assert <ref> --task <name>` →
  exit 1 — with the counter-proof: overlay modifying existing files →
  `--no-overlay` green; overlay adding files → a **bug-inverse probe**
  green (`--patch <probe.diff>` — a minimal disposable diff un-doing
  the seed and nothing else; pasted into the refresh report, not kept
  in the instance),
- judge-observed seed: re-check that the bug's symptom is still
  described accurately in the rubric's criteria against the new pin's
  code, and that the empty-diff floor holds (self-check point 2).

### 5. Assertions and calibration material

- **Full "prove on the starting state" table** for all of the task's
  assertions: guards behave as declared on the new pin (green, or red
  for a guard-observed bug seed); counter-proofs per step 4.
  `reference` declarations in task.yaml stay, or change deliberately
  (with justification in the PR). Re-run the shape-neutrality review
  (rule 3) — the repo's own commands and toolchain are exactly what
  drifts between pins.
- **Shared assertions**: changes only via a new version in the pool
  (rule 5).
- **Judge**: re-read the rubric against the new pin. The context it
  gives the judge (mechanisms, surfaces, asymmetries — see bench-define's
  RUBRIC_AUTHORING.md) may have drifted: a wording update that keeps
  every criterion's meaning is part of the refresh (say so in the PR);
  a change of criteria, anchors or weights is a rubric change — a
  `version` bump, a new era for the task, named explicitly in the PR.
  A calibration set from preserved attempts, if one exists, belongs to
  the old pin's era: note it, do not port it — the new era's first
  measurement recalibrates.

### 6. New `expires` date

Set it deliberately, with the same horizon as before (typically a few
months). The date is a promise that "the pin is representative until
then", not a formality.

### 7. Self-check

Entering the evaluation container costs minutes — collect the **full
set of proofs in a single entry**: `bench assert --task <name>` covers
all assertions at once, and repeated `--patch` entries (bug-inverse
probe, empty diff) ride along in the same entry; if you still need
multiple entries, launch the calls in parallel in the background and
collect the results together. In order, each must pass:

1. `bench validate --assert` — green, no `expires` warning.
2. An empty diff does not pass: `bench judge --patch <empty.diff>`
   scores low; for a guard-observed bug seed, the red guard at the
   start is additional evidence.
3. Trial `bench attempt --smoke` + `evaluate` on one cheap model (the
   instance budget guards costs — rule 8). As in bench-define, the
   smoke run doubles as the solvability probe on the new pin: an
   assertion no attempt greens is suspect-harness — diagnose it before
   the PR, do not ship it.

### 8. Refresh report and handover

Write `reports/<name>-refresh.md` per
[REFRESH_PR_TEMPLATE.md](REFRESH_PR_TEMPLATE.md) — it is the PR
description the user will open with: old → new pin with what happened
between them (for a mined task: same pin, re-proven); adaptations with
justification; the full set of proofs from the new starting state; a
"this opens a new era for this task" section; the self-check cost. Put
the previous results (step 1) next to the new ones as a **point of
reference**: identical numbers on the new pin are the strongest signal
that the refresh broke nothing, and they shorten the PR review.

Then run `bench changes` and paste its plan: the task's group comes
marked as closing an era (PR), with its `git add` / `git commit`
lines. The user creates the branch (`bench-refresh/<name>`), commits,
and opens the PR with the report as its description (rule 1).

### 9. Next step

End your summary response with a **Next step** section: the instance
state in one sentence, **one** recommendation with a one-sentence
justification, at most two alternatives with their cost, and —
separately — whatever awaits a human decision. Typical transition:
task on the new pin, files and report in the working tree → the user
opens the PR from the `bench changes` plan → **merge**; if the rubric
needed more than a wording update — the era note in the PR and
re-evaluation of preserved attempts are the follow-up.
