# Instance wiring PR template (bench-measure (preflight))

Title: `bench-measure (preflight): <description, e.g. "astro-starter + models via OpenRouter">`

```markdown
## Decisions

<base repos (public/private, access method), evaluated models, judge +
rubric versions, max_cost_usd budget (ceiling for a WHOLE matrix run) —
every decision with a one-sentence justification.>

## Environment checklist

<names, never values; presence status from `bench doctor` / `[ -n … ]`;
for a "TO BE SET" status add the ready-to-run user step, e.g.
`export <NAME>=…` in the shell profile of the operator machine / VPS:>

- [ ] `OPENROUTER_API_KEY` — agent trials + judge (operator env) — <present / TO BE SET>
- [ ] `BASE_REPO_TOKEN` — cloning private base repos (fine-grained PAT, contents:read; operator env) — <status / "not needed — all base repos public">
- [ ] publication secrets (optional, repo secrets): `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — <status / "not used — dashboard as artifact">

## Proofs

<command outputs, not claims:>

- `bench validate` → <0 errors / list>
- `bench validate --assert` (if tasks have reference declarations) → <result>
- `bench status` after the change → <evaluations now stale, or "none — no results yet">
- readiness workflow green on the instance repo (if publication is
  wired): <link / "no remote yet">

## Comparability impact

<the instance's first era: judge <model> + rubric versions
(frontmatter). What will re-version evaluations in the future: changing
the judge, rubrics, or task definitions — preserved attempts survive,
evaluations are redone. If the PR changes existing wiring: which
existing results stop being comparable.>

## Wiring cost

<cost of re-evaluations triggered by the change (judge model, $), or
"none — no models were run".>
```
