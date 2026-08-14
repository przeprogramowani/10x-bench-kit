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
| 2 | **bench-task** | Nowe zadanie: prompt + pin + overlay + asercje + wagi, wszystko udowodnione na referencji | cyklicznie, gdy powstaje zadanie |
| 3 | **bench-rubric** | Kalibracja rubryki LLM-as-judge na diffach o znanej jakości | razem z zadaniem używającym sędziego; przy dryfie werdyktów |
| 4 | **bench-refresh** | Odświeżenie przeterminowanego zadania: nowy pin, ponowne dowody, nowa era zadania | po warningu `expires` z `bench validate` |
| 5 | **bench-triage** | Diagnoza wyników runu: wina modelu / zadania / infrastruktury, z dowodami | po runie, gdy wynik zaskakuje |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu wyłącznie przez PR** — zadania, asercje, rubryki
  i `bench.config.yaml` nigdy prosto na master.
- **Testuj na referencji, zanim zaproponujesz** — asercja czy overlay
  bez dowodu z `bench assert` nie wchodzi do PR-a.
- **Świadomość er** — zmiany `task_hash`, rubryki lub sędziego zamykają
  erę porównywalności; PR mówi to wprost, przed mergem.
- **Izolacja materiałów oceny** — nic z `evaluation-pool/` nie trafia
  do `tasks/` ani do workspace'u agenta.
- **Budżet zamiast rytuału zgody** — kosztów pilnuje
  `defaults.max_cost_usd` (runner przerywa run po przekroczeniu);
  koszt faktyczny raportuje się po fakcie, a zgody człowieka wymaga
  tylko podnoszenie budżetu.
- **Runner jest narzędziem** — stany "gotowe" potwierdza wyjście komend
  `bench` (`validate` / `assert` / `judge` / `run` / `evaluate`),
  nie deklaracja.

## Gdzie są skille

Katalog skilli zależy od narzędzia wybranego przy `bench-kit init`
(np. `.claude/skills/`, `.agents/skills/` — patrz `tool`
w `.bench-kit/instance.json`). Ten plik i skille są częścią strefy
współdzielonej: przy `bench-kit update` dostajesz propozycję diffu,
nie podmianę.
