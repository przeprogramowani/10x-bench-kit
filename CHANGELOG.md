# Changelog

Konwencja: każdy release (tag) dostaje wpis oznaczony jako **neutralny**
albo **`[scoring-breaking]`**. Release `[scoring-breaking]` zamyka erę
porównywalności wyników — dashboard nie miesza wyników sprzed i po takim
release. Zmiany łamiące schemat `task.yaml` lub `bench.config.yaml` zawsze
są `[scoring-breaking]` i wymagają noty migracyjnej.

## 0.2.0 — 2026-08-13

Neutralny formalnie (0.1.0 nie liczyło jeszcze żadnych wyników — to
pierwsza wersja zdolna do scoringu, więc otwiera pierwszą realną erę
porównywalności).

- `bench validate` zaimplementowane: parsowanie schematami
  (bench.config.yaml, task.yaml), spójność referencji `evaluation[]`
  z evaluation-pool (rubryki judge muszą zawierać parsowalny format
  odpowiedzi), spójność wag z doborem asercji, sędzia ≠ modele oceniane,
  klonowalność repo bazowych i istnienie pinów (`--offline` pomija sieć),
  warning po `expires`.
- Asercja `static/lint` w evaluation-pool (używana przez zadanie-demo).
- `bench run` zaimplementowane: budowa obrazu bazowego + obrazów zadań
  (repo@pin + overlay + commit startowy zapieczone w obraz — próby bez
  sieci), próby w jednorazowych kontenerach (docker/podman) ze świeżym
  `XDG_DATA_HOME`, `opencode run` pod twardym timeoutem, artefakty per
  próba: `agent.log`, `patch.diff`, `metrics.json`, `execution.json`,
  `trial.json`. Sekrety wyłącznie przez env, nigdy w obrazie.
- Adapter metryk OpenCode (`adapter.mjs`): czyta SQLite
  (`opencode.db`), sumuje koszt/tokeny po sesjach, `duration_s` = czas
  sesji agenta; brak danych → `"incomplete": true`.
- Pin OpenCode podbity 0.6.4 → 1.18.3 (format storage SQLite, na którym
  opiera się adapter).
- `bench evaluate` zaimplementowane: asercje nie-LLM-owe (static → tests
  → e2e) w świeżym kontenerze z obrazu zadania — patch.diff nakładany na
  /workspace, asercje montowane :ro dopiero teraz; kontrakt `check.yaml`
  (schemat `schemas/check.ts`: score binary|fraction + lista komend,
  ASSERTION_DIR w env). LLM-as-judge host-side (anthropic/openrouter),
  brak poprawnego JSON-a = 0, surowa odpowiedź w judge.json. Wyjście:
  result.json ze stemplami er (template_version, task_hash = SHA-256
  katalogu zadania, judge_model, rubric_version).
- `bench validate` sprawdza też check.yaml asercji nie-LLM-owych.
- `bench report` zaimplementowane: mediana per (model × zadanie) dla
  total/kosztu/czasu, pass@k (estymator kombinatoryczny; próg "pass"
  w nowym opcjonalnym `defaults.pass_threshold`, domyślnie 0.7), koszt
  runu (na razie suma prób — `cost_scope: "trials"`), grupowanie w ery
  po krotce stamps → `report.json` dla dashboardu.
- Realny workflow `bench-run.yaml`: job `plan` (validate jako bramka +
  `bench matrix`), macierz per model × zadanie (próby sekwencyjnie
  w jobie — obraz zadania budowany raz), `run` + `evaluate` per job,
  `aggregate` scala artefakty i robi `report`. Leaderboard nadal jako
  artefakty CI (dashboard świadomie odłożony).
- Nowa komenda `bench matrix` — helper CI wypisujący macierz jobów.
- `10x bench-kit init` kopiuje `.bench-kit/workflows/` do
  `.github/workflows/` (zmiana po stronie 10x-cli, PR #30).

## 0.1.0 — 2026-08-13

Neutralny — pierwsza wersja, brak wcześniejszej ery.

- Szkielet trzech stref: `.bench-kit/`, `.claude/skills/`, strefa firmy
  (`tasks/`, `evaluation-pool/`, `bench.config.yaml`).
- Schematy kontraktów (zod): `task.yaml`, `bench.config.yaml`, `result.json`.
- Runner jako stuby komend (`run`, `evaluate`, `validate`, `report`) —
  implementacja w kolejnych wersjach.
- Zadanie-demo `tasks/demo-hello-bench/` (smoke test struktury).
