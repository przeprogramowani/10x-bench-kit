# Diagnosis template (bench-explain-results)

Title (issue/comment): `triage: <model> × <task> — <symptom in 3-5 words>`

```markdown
## Symptom

<what was surprising: run, model, task, numbers from the aggregate (bench report over results/)
(median, pass@1/pass@k) + the era stamps the diagnosis applies to.>

## Chain of evidence

<from the aggregate downward — per attempt: which component drags the score
down (result.json), what the artifact showed (quote from agent.log /
checks.json / judge.json / execution.json), reproduction results from
commands (bench assert / bench judge) with the exact invocation.>

## Classification

<model fault / task fault / infrastructure fault — one class per
diagnosed cause (there may be several causes). If the evidence is
insufficient: "unresolved" + what was missing.>

## Recommendation

<model fault → the result stands, with the behavior pattern described;
task fault → what to fix and with which skill (bench-refresh-task /
bench-build / bench-rubric), which results of the era are tainted;
infrastructure fault → an issue in the template repo, which trials are
uninterpretable, whether to repeat the run.>

## Triage cost

<cost of reproduction (judge calls / containers, $), or "none — only
reading artifacts".>
```
