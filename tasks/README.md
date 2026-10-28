# tasks — strefa firmy (definicje zadań)

Strefa nietykalna przy `bench-kit update`.

## Definicja zadania — katalog `tasks/<nazwa>/`

| Plik | Rola |
|---|---|
| `prompt.md` | **Jedyne** wejście, które widzi agent |
| `task.yaml` | repo bazowe + pinowany commit, timeout, dobór asercji z puli, wagi |

Schemat `task.yaml`: `.bench-kit/runner/src/schemas/task.ts`. Zadania
buduje skill **bench-create-task** z zmergowanych PR-ów — wzór
`task.yaml` w jego `BUILD.md`.

## Backlog zleceń — `tasks/backlog.md`

Dokument decyzji: skill **bench-create-task** dopisuje do niego zlecenia
zadań z kopania PR-ów (`MINING.md`: zmergowana zmiana z testami).
Krok budowy tego skilla (`BUILD.md`) zamienia oczekujące zlecenia
w zadania — statycznie, bez kontenerów i prób (subagent per zlecenie).
Status zlecenia to wyłącznie decyzja (`pending` / `dropped`). Etap
(ordered → building → ready → measuring → measured) wylicza
`bench backlog` z dysku, więc nikt go nie przepisuje, a budowa partii
nie produkuje edycji konfliktujących z równoległymi zmianami backlogu.
Runner ignoruje pliki w `tasks/` niebędące katalogami, więc backlog
nie wpływa na scoring. Skille wyłącznie edytują ten plik — gitem
zarządza użytkownik.

## Zasady

- Materiały oceny (testy, rubryki) NIGDY nie leżą w katalogu zadania —
  wyłącznie referencje `evaluation: [...]` do `evaluation-pool/`.
  Izolacja z konstrukcji, nie ze starannego wycinania.
- Zadania powstają skillami, ale skille nie dotykają gita. Nowe zadania
  bench-create-task zostawia jako pliki w drzewie roboczym z raportem
  budowy per zadanie — commit, PR czy odrzucenie to decyzja
  użytkownika. Poprawka rubryki zadania to edycja wg
  `RUBRIC_AUTHORING.md` w bench-create-task z bumpem `version` i re-oceną
  zachowanych prób — również przez PR.
- Zadanie wykopane z historii nie ma daty ważności: jego pin to rodzic
  zmiany i nigdy się nie przesuwa (późniejszy commit zawiera już
  rozwiązanie).
- Zmiana czegokolwiek w katalogu zadania zmienia jego `task_hash`,
  czyli zamyka erę porównywalności dla tego zadania.
