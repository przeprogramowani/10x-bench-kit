# evaluation-pool — strefa firmy (pula ocen)

Strefa nietykalna przy `bench-kit update`. Trzyma WSZYSTKIE materiały
oceny — zadania tylko się do nich odwołują (`evaluation: [...]`
w `task.yaml`).

**Zasada izolacji:** nic z tej puli nigdy nie trafia do workspace'u
agenta. Asercje montuje dopiero `bench evaluate`, w kontenerze próby,
po zakończeniu pracy agenta. Izolacja wynika z konstrukcji (osobne repo,
osobny etap), nie ze starannego wycinania plików.

## Konwencje

Asercja = katalog `<typ>/<nazwa>/`, referencja z task.yaml to
`<typ>/<nazwa>`:

| Typ | Rola | Wynik |
|---|---|---|
| `static/` | guard wykonania: lint / typecheck / build repo-natywnymi komendami | 0–1 |
| `tests/` | guard wykonania: własna suita testów repo bazowego | 0–1 (frakcja przechodzących) |
| `e2e/` | scenariusze Playwright (zachowanie widoczne dla użytkownika) | 0–1 |
| `judge/` | rubryki LLM-as-judge — główna miara treści implementacji | 0–1 (JSON sędziego) |

**Zasada neutralności kształtu (wiążąca):** asercje skryptowe
(`static/`, `tests/`, `e2e/`) uruchamiają wyłącznie repo-natywne
komendy i nie zakładają NICZEGO o kształcie implementacji agenta —
żadnych oczekiwanych ścieżek, symboli, odkrywania plików grepem ani
dogrywanych testów. Papierek lakmusowy: dwie poprawne implementacje
muszą dostać identyczny wynik z każdej asercji skryptowej. Wszystko,
co dotyczy treści implementacji (kompletność, architektura, zakres,
realne testy nowego zachowania), ocenia sędzia (`judge/`) w języku
naturalnym — code review bez nitpickingu. Ukryte testy behawioralne
szyte pod zadanie to konwencja wycofana.

Konwencje szczegółowe — w README każdego typu. Pula jest wypełniana
skillem podczas customizacji instancji, ale zmiany przechodzą przez PR:
zmiana asercji używanej przez zadanie zmienia wynik oceny, więc podlega
tym samym zasadom er co zmiana zadania.
