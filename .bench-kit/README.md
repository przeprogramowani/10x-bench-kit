# .bench-kit — strefa narzędzia (runtime)

**Nie edytuj plików w tej strefie.** Przy `10x bench-kit update` cały
katalog jest podmieniany atomowo na wersję z nowszego tagu template'u —
lokalne zmiany przepadną bez ostrzeżenia. Wszystko, co firmowe, żyje w
`tasks/`, `evaluation-pool/`, `bench.config.yaml`, `results/`,
`attempts/` i `.agents/skills/`.

Zawartość:

- `VERSION` — wersja template'u, z którego pochodzi ta strefa; stemplowana
  w każdym `result.json`.
- `SCORING_VERSION` — wersja scoringu (podbijana tylko przy release'ach
  scoring-breaking); klucz ery porównywalności.
- `ATTEMPT_FORMAT.md` — kontrakt ZACHOWANEJ PRÓBY (format katalogu
  `attempts/<zadanie>/<model>/trial-N/`): jedyny punkt styku między
  wykonaniem a oceną, wersjonowany.
- `runner/` — CLI `bench` (`attempt` / `evaluate` / `validate` /
  `report` / `leaderboard` / `assert` / `judge` / `calibrate` /
  `doctor`); schematy kontraktów w `runner/src/schemas/`.
- `docker/` — bazowy Dockerfile obrazu próby, pinowana wersja OpenCode
  (`opencode.version`), adapter metryk (lokalne opencode.db → koszt
  i tokeny), skrypty cyklu próby i oceny.
- `workflows/` — workflows GitHub Actions instancji (GHA = zwykłe CI/CD,
  NIE wykonanie prób): `readiness` (spójność instancji on push),
  `leaderboard` (statyczny build dashboardu z `results/` po commicie
  wyników). `bench-kit init`/`update` kopiuje je do `.github/workflows/`
  (update usuwa też wycofane bench-run/bench-cell z czasów wykonania
  w CI).
- `bootstrap/` — logika instancji (`init`/`update`/`repair`) wykonywana
  przez `10x bench-kit` z klonu template'u: żądanie JSON na stdin,
  odpowiedź JSON w ostatniej linii stdout. Zasada podziału: kit zna
  siebie (układ plików, strefy, manifest), CLI zna maszynę użytkownika
  (sieć, profil narzędzia). Dzięki temu `update` wykonuje migrację
  z NOWEJ wersji kitu. Testy: `.github/tests/` (strefa template-only).
