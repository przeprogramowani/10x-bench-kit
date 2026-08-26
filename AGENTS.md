# Instrukcje dla agentów — bench-kit

To repo to **template benchmarku agentów AI** (`10x bench-kit init`
materializuje z niego instancję firmy; ten plik wędruje razem
z template'em i obowiązuje w każdej instancji). Instancja trzyma
zadania (`tasks/`), materiały oceny (`evaluation-pool/`)
i konfigurację (`bench.config.yaml`). Liczeniem zajmuje się
deterministyczny runner (`.bench-kit/` — strefa narzędzia, nie
edytuj); wszystkim, co wymaga osądu, zajmują się skille. Zanim
zrobisz cokolwiek wpływającego na scoring, użyj właściwego skilla —
każdy ma procedurę, twarde zasady i szablon PR-a.

## Skille i kiedy którego użyć

Kolejność odpowiada cyklowi życia instancji:

| Kolejność | Skill | Przeznaczenie | Kiedy |
|---|---|---|---|
| 1 | **bench-wiring** | Od świeżego `bench-kit init` do zielonego `bench validate` i pierwszego runu w CI: braki po init, sekrety, dispatch `bench-run` | raz, przy powstaniu instancji (i przy zmianach wiringu) |
| 2 | **bench-new-task** | Krótki wywiad → zlecenie zadania w backlogu (`tasks/backlog.md`); 5–10 zleceń w jednej sesji, bez budowania | cyklicznie, gdy pojawia się pomysł na zadanie |
| 3 | **bench-build** | Budowa zadań z oczekujących zleceń backlogu: subagent per zlecenie — pin + overlay + prompt + asercje + wagi, wszystko udowodnione na stanie startowym (bez implementacji referencyjnej — oczekiwania wobec przyszłych prób wyraża rubryka i asercje); gotowe pliki + raport w drzewie roboczym, git po stronie użytkownika | gdy w backlogu czeka paczka zleceń |
| 4 | **bench-rubric** | Rubryka LLM-as-judge z kryteriów oceny zadania (osie ze zlecenia) + kalibracja na syntetycznym zbiorze o zaprojektowanej jakości i diffach z realnych runów | razem z zadaniem używającym sędziego; przy dryfie werdyktów |
| 5 | **bench-refresh-task** | Odświeżenie przeterminowanego zadania: nowy pin, ponowne dowody, nowa era zadania | po warningu `expires` z `bench validate` |
| 6 | **bench-explain-results** | Diagnoza wyników runu: wina modelu / zadania / infrastruktury, z dowodami | po runie, gdy wynik zaskakuje |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu z dowodem i śladem** — rubryki i
  `bench.config.yaml` wychodzą wyłącznie przez PR; nowe zadania buduje
  bench-build jako pliki w drzewie roboczym z dowodami ze stanu
  startowego w raporcie (REPORT_TEMPLATE.md skilla) — **do gita wnosi
  je użytkownik**, skille nie commitują i nie pushują niczego.
- **Udowodnij na stanie startowym, zanim zaproponujesz** — asercja czy
  overlay bez dowodu z `bench assert` nie zostaje oddana (raport/PR).
  Benchmark nie utrzymuje implementacji referencyjnych: kierunek
  "da się zaliczyć" chronią reguły odporności ukrytych testów
  (TASK_AUTHORING.md) i smoke run jako sonda wykonalności.
- **Świadomość er** — zmiany `task_hash`, rubryki lub sędziego zamykają
  erę porównywalności; raport/PR mówi to wprost.
- **Izolacja materiałów oceny** — nic z `evaluation-pool/` nie trafia
  do `tasks/` ani do workspace'u agenta.
- **Budżet zamiast rytuału zgody** — kosztów pilnuje
  `defaults.max_cost_usd` (runner przerywa run po przekroczeniu);
  koszt faktyczny raportuje się po fakcie, a zgody człowieka wymaga
  tylko podnoszenie budżetu.
- **Runner jest narzędziem** — stany "gotowe" potwierdza wyjście komend
  `bench` (`validate` / `assert` / `judge` / `run` / `evaluate`),
  nie deklaracja.
- **Zmiana w skillach = release** — każda pushowana zmiana w skillach
  (lub innej strefie współdzielonej template'u) dostaje bump wersji
  wg SemVer stosownie do wpływu (patch: doprecyzowanie w obrębie
  jednego skilla; minor: nowa struktura/procedura; major lub
  `[scoring-breaking]`: zmiana łamiąca schematy albo porównywalność
  wyników), wpis w `CHANGELOG.md` (neutralny / `[scoring-breaking]`),
  bump `.bench-kit/VERSION` (z tego pliku CLI czyta wersję template'u
  przy `bench-kit update` — nie z tagów), commit
  `chore(release): X.Y.Z — …` i tag `vX.Y.Z`. W repo template'u wydawaj
  **wyłącznie skryptem** `.github/scripts/release.mjs <wersja> "<opis>"`
  — robi walidację i wszystkie kroki atomowo; spójność
  VERSION↔CHANGELOG pilnuje też CI.

## Lokalne klony rep bazowych — `.repos/<nazwa>/`

Robocze klony rep bazowych żyją w `.repos/<nazwa>/` w korzeniu instancji
(katalog jest w `.gitignore` — nigdy nie trafia do repo instancji).
`10x bench-kit init` zwykle zostawia tam pierwszy klon wykrytego repo.

- **Zanim sklonujesz repo bazowe gdziekolwiek** (scratchpad, /tmp),
  sprawdź `.repos/<nazwa>` — jeśli jest, użyj go; jeśli nie, sklonuj
  właśnie tam (URL z `base_repos` w bench.config.yaml). W instancji
  z czasów przed tą konwencją dopisz najpierw `.repos/` do `.gitignore`.
- Klon może być nieświeży — przed decyzjami o pinie zrób
  `git fetch origin` i wybieraj commity **istniejące na remote**
  (runner robi własny płytki fetch z URL-a; lokalny stan nie wystarczy).
- Klon jest read-only wobec remote'a: eksperymentuj na lokalnych
  gałęziach/worktree, niczego nie pushuj (benchmark nigdy nie modyfikuje
  rep bazowych).

## Gdzie są skille

Katalog skilli zależy od narzędzia wybranego przy `bench-kit init`
(np. `.claude/skills/`, `.agents/skills/` — patrz `tool`
w `.bench-kit/instance.json`). Ten plik i skille są częścią strefy
współdzielonej: przy `bench-kit update` dostajesz propozycję diffu,
nie podmianę.
