# Changelog

Konwencja: każdy release (tag) dostaje wpis oznaczony jako **neutralny**
albo **`[scoring-breaking]`**. Release `[scoring-breaking]` zamyka erę
porównywalności wyników — dashboard nie miesza wyników sprzed i po takim
release. Zmiany łamiące schemat `task.yaml` lub `bench.config.yaml` zawsze
są `[scoring-breaking]` i wymagają noty migracyjnej.

## Niewydane

Neutralny (dotychczas).

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

## 0.1.0 — 2026-08-13

Neutralny — pierwsza wersja, brak wcześniejszej ery.

- Szkielet trzech stref: `.bench-kit/`, `.claude/skills/`, strefa firmy
  (`tasks/`, `evaluation-pool/`, `bench.config.yaml`).
- Schematy kontraktów (zod): `task.yaml`, `bench.config.yaml`, `result.json`.
- Runner jako stuby komend (`run`, `evaluate`, `validate`, `report`) —
  implementacja w kolejnych wersjach.
- Zadanie-demo `tasks/demo-hello-bench/` (smoke test struktury).
