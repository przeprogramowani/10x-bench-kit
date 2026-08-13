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

## 0.1.0 — 2026-08-13

Neutralny — pierwsza wersja, brak wcześniejszej ery.

- Szkielet trzech stref: `.bench-kit/`, `.claude/skills/`, strefa firmy
  (`tasks/`, `evaluation-pool/`, `bench.config.yaml`).
- Schematy kontraktów (zod): `task.yaml`, `bench.config.yaml`, `result.json`.
- Runner jako stuby komend (`run`, `evaluate`, `validate`, `report`) —
  implementacja w kolejnych wersjach.
- Zadanie-demo `tasks/demo-hello-bench/` (smoke test struktury).
