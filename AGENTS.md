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
| 1 | **bench-wiring** | Od świeżego `bench-kit init` do zielonego `bench validate`: repo bazowe, modele, sędzia, sekrety, smoke run | raz, przy powstaniu instancji (i przy zmianach wiringu) |
| 2 | **bench-new-task** | Krótki wywiad → zlecenie zadania w backlogu (`tasks/backlog.md`); 5–10 zleceń w jednej sesji, bez budowania | cyklicznie, gdy pojawia się pomysł na zadanie |
| 3 | **bench-build** | Budowa zadań z oczekujących zleceń backlogu: subagent per zlecenie — pin + overlay + prompt + asercje + wagi, wszystko udowodnione na referencji; gotowe pliki + raport w drzewie roboczym, git po stronie użytkownika | gdy w backlogu czeka paczka zleceń |
| 4 | **bench-rubric** | Kalibracja rubryki LLM-as-judge na diffach o znanej jakości | razem z zadaniem używającym sędziego; przy dryfie werdyktów |
| 5 | **bench-refresh** | Odświeżenie przeterminowanego zadania: nowy pin, ponowne dowody, nowa era zadania | po warningu `expires` z `bench validate` |
| 6 | **bench-triage** | Diagnoza wyników runu: wina modelu / zadania / infrastruktury, z dowodami | po runie, gdy wynik zaskakuje |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu z dowodem i śladem** — rubryki i
  `bench.config.yaml` wychodzą wyłącznie przez PR; nowe zadania buduje
  bench-build jako pliki w drzewie roboczym z dowodami z referencji
  w raporcie (REPORT_TEMPLATE.md skilla) — **do gita wnosi je
  użytkownik**, skille nie commitują i nie pushują niczego.
- **Testuj na referencji, zanim zaproponujesz** — asercja czy overlay
  bez dowodu z `bench assert` nie zostaje oddana (raport/PR).
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
