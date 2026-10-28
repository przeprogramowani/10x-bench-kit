<!-- Procedure of the **bench-evaluate** skill — loaded from its SKILL.md when needed. -->

# bench-evaluate (wiring) — changing what the instance measures with, and publishing it

Readiness of an instance (machine, keys, base repos, the first model
and judge choice, a green `bench validate`) is **bench-status**. This
procedure covers what comes after: changing the wiring of an instance
that already has results, and publishing them. There is no smoke task:
the first real task built by bench-create-task is the first end-to-end proof
of the container path, and its first measurement is the first result.

## Hard rules

1. **Output via PR.** Wiring changes `bench.config.yaml` (which affects
   scoring: models, judge, rubric versions) — branch
   `bench-evaluate/<description>` + PR per [WIRING_PR_TEMPLATE.md](WIRING_PR_TEMPLATE.md);
   a human merges. Exception: an instance with no results yet — there
   a commit to master is acceptable with the user's explicit consent
   (`bench changes` says which case applies).
2. **You never touch secrets.** Variable NAMES and presence only
   (`bench doctor`; for repo secrets `gh secret list`) — never values.
3. **Do not touch `.bench-kit/`** (the tool's zone). Report runner gaps
   as an issue, do not work around them.
4. **Judge ≠ evaluated models.** Changing the judge, the evaluation path
   (`judge.mode`), `defaults.pass_threshold`, `resources.memory_mb` or a
   rubric version closes the comparability era of the tasks that use
   it. Preserved attempts survive — only evaluations are redone
   (re-evaluate, no new paid runs).
5. **Budget instead of a consent ritual.** `defaults.max_cost_usd` caps a
   whole matrix run; human consent is only needed to raise it.

## Changing models or the judge

The same guidance as bench-status step 3 (harness prefixes, one axis at
a time, judge from a different provider family, pricing for ids outside
OpenRouter's catalog). The difference here is that results exist: name
the era the change closes, list the evaluations that become stale
(`bench status` shows them after the change), and propose re-evaluating
the preserved attempts as part of the same PR's follow-up.

## Publication (optional, does not block measuring)

- **Remote instance repo** — needed to share results and publish the
  leaderboard, not to measure. If absent: the user creates it
  (`gh repo create <owner/name> --private`), you hook up origin and
  push master (fresh instance: the rule-1 exception, with explicit
  consent).
- **Workflows** — `readiness.yaml` (validate on every push; no secrets
  needed) and `leaderboard.yaml` (rebuilds the dashboard when a push
  touches `results/`; publishes to Cloudflare Pages when
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets exist,
  GitHub Pages when the plan allows — otherwise the dashboard is
  always available as the `leaderboard-site` artifact).

## The wiring PR

On a fresh instance without results the change may go straight to
master (rule 1). Otherwise: branch
`bench-evaluate/<description>`, description per
[WIRING_PR_TEMPLATE.md](WIRING_PR_TEMPLATE.md): decisions ("template defaults" is
also a decision) with justification, the environment checklist with
status, proofs (`validate` output), a "Comparability impact" section (the first
era: judge + rubric versions; what will re-version evaluations in the
future).

## Deferred decisions — they do not block wiring

The template ships defaults for environment policy; return to them only
when the first real task touches them (usually in bench-create-task), and
drive changes via PR like any config change:

- **Assertion dependency cache**: default `evaluation.deps_cache: true`
  (persistent `bench-deps-cache` volume). Turning it off — full
  hermeticity at the cost of time — is a deliberate decision per
  instance (`deps_cache: false`) or per invocation (`--no-deps-cache`).
- **Container resource limits**: the template sets
  `resources.memory_mb` (era stamp `memory_limit_mb` — changing it
  closes the era, so if you are going to raise it, do so before any
  results exist). Without a limit, agents verifying their work with a
  build die from the OOM killer with a bare SIGKILL, which looks like
  the model's fault.
- **Verification policy in prompts** (whether the agent should run the
  project to verify): set by the task author in `prompt.md` — the
  bench-create-task skill's contract, not wiring's.
- **VPS / scheduled runs**: a VPS is just a bigger operator machine
  with the same DX — defer until nightly matrix runs are actually
  wanted.
- **Toolchain in the agent's trial**: the base image is node + git +
  the three pinned harnesses (OpenCode, Claude Code, Codex CLI); any toolchain the assertions need is installed by
  the `check.yaml` commands themselves (the evaluation stage may use
  the network; only agent trials are offline). If the stack requires a
  toolchain already in the **agent's trial**, that is currently a
  runner gap — file an issue with specifics (rule 3), do not edit the
  base Dockerfile.

## Closing message

Three short checklists, then one ask:

1. **Confirmed** — facts with proof (`bench validate: 0 errors`,
   `bench changes`: the era this closes).
2. **Done in this session** — each file changed.
3. **Your steps** — numbered, only what is open: review/merge the PR,
   repo secrets for publication, provider credit, budget decisions.

End with the single ask (e.g. "merge the PR, then I'll re-evaluate the
12 preserved attempts under the new judge — no new paid runs").
