# .bench-kit — strefa narzędzia (runtime)

**Nie edytuj plików w tej strefie.** Przy `10x bench-kit update` cały
katalog jest podmieniany atomowo na wersję z nowszego tagu template'u —
lokalne zmiany przepadną bez ostrzeżenia. Wszystko, co firmowe, żyje w
`tasks/`, `evaluation-pool/`, `bench.config.yaml` i `.agents/skills/`.

Zawartość:

- `VERSION` — wersja template'u, z którego pochodzi ta strefa; stemplowana
  w każdym `result.json`.
- `runner/` — CLI `bench` (`run` / `evaluate` / `validate` / `report` /
  `matrix`); schematy kontraktów w `runner/src/schemas/`.
- `docker/` — bazowy Dockerfile obrazu próby, pinowana wersja OpenCode
  (`opencode.version`), adapter metryk, skrypty cyklu próby i oceny.
- `workflows/` — workflows GitHub Actions (run benchmarku, leaderboard).
  `bench-kit init`/`update` kopiuje je do `.github/workflows/`.
