# Instance wiring PR template (bench-wiring)

Title: `bench-wiring: <description, e.g. "astro-starter + models via OpenRouter">`

```markdown
## Decisions

<base repos (public/private, access method), evaluated models, judge +
rubric versions, max_cost_usd budget — every decision with a
one-sentence justification.>

## Secrets checklist

<names, never values; presence status from `gh secret list` / env; for
a "TO BE SET" status add the ready-to-run command to add it to the
remote instance repo, e.g. `gh secret set <NAME> --repo <owner/repo>`:>

- [ ] `OPENROUTER_API_KEY` — agent trials + judge — <present in repo / TO BE SET>
- [ ] `BASE_REPO_TOKEN` — cloning private base repos (fine-grained PAT, contents:read) — <status / "not needed — all base repos public">

## Proofs

<command outputs, not claims:>

- `bench validate` → <0 errors / list>
- `bench validate --assert` (if tasks have reference declarations) → <result>
- green `bench-run` in GH Actions: <link> — `<model>` × `<task>` → total <x>, cost $<y>, duration <z> s
- local smoke (optional, does not test repo secrets): <result / "not run">

## Comparability impact

<the instance's first era: judge <model> + rubric versions
(frontmatter). What will close it in the future: changing the judge,
rubrics, or task definitions. If the PR changes existing wiring: which
existing results stop being comparable.>

## Wiring cost

<cost of the smoke run / judge calls (model, $), or "none — no models
were run".>
```
