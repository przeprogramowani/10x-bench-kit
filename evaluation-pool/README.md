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
| `static/` | lint / typecheck / build na workspace po próbie | 0–1 |
| `tests/` | testy weryfikacyjne (ukryte przed agentem) | 0–1 (frakcja przechodzących) |
| `e2e/` | scenariusze Playwright | 0–1 |
| `judge/` | rubryki LLM-as-judge | 0–1 (JSON sędziego) |

Konwencje szczegółowe — w README każdego typu. Pula jest wypełniana
skillem podczas customizacji instancji, ale zmiany przechodzą przez PR:
zmiana asercji używanej przez zadanie zmienia wynik oceny, więc podlega
tym samym zasadom er co zmiana zadania.
