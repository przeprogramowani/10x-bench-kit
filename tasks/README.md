# tasks — strefa firmy (definicje zadań)

Strefa nietykalna przy `bench-kit update`.

## Definicja zadania — katalog `tasks/<nazwa>/`

| Plik | Rola |
|---|---|
| `prompt.md` | **Jedyne** wejście, które widzi agent |
| `task.yaml` | repo bazowe + pinowany commit, timeout, dobór asercji z puli, wagi |
| `overlay/` | opcjonalne pliki nakładane na repo bazowe (np. seed buga) |

Schemat `task.yaml`: `.bench-kit/runner/src/schemas/task.ts`. Zadania
buduje skill **bench-create-task** (kopanie PR-ów albo wywiad) — opis pól
w jego `TASK_AUTHORING.md`.

## Backlog zleceń — `tasks/backlog.md`

Dokument decyzji: skill **bench-create-task** dopisuje do niego zlecenia
zadań — domyślnie z kopania PR-ów (`MINING.md`: zmergowana zmiana
z testami), a dla pracy bez historii z krótkiego wywiadu
(`INTERVIEW.md`). Krok budowy tego skilla (`BUILD.md`) zamienia
oczekujące zlecenia w prawdziwe zadania (subagent per zlecenie).
Status zlecenia to wyłącznie decyzja (`pending` / `dropped`). Etap
(ordered → building → built → ready → measuring → measured) wylicza
`bench backlog` z dysku, więc nikt go nie przepisuje, a budowa partii
nie produkuje edycji konfliktujących z równoległymi zmianami backlogu.
Runner ignoruje pliki w `tasks/` niebędące katalogami, więc backlog
nie wpływa na scoring. Skille wyłącznie edytują ten plik — gitem
zarządza użytkownik.

## Zasady

- Materiały oceny (testy, rubryki) NIGDY nie leżą w katalogu zadania —
  wyłącznie referencje `evaluation: [...]` do `evaluation-pool/`.
  Izolacja z konstrukcji, nie ze starannego wycinania.
- Zadania powstają i są odświeżane skillami, ale skille nie dotykają
  gita. Nowe zadania bench-create-task zostawia jako pliki w drzewie
  roboczym z raportem dowodów ze stanu startowego per zadanie — commit, PR
  czy odrzucenie to decyzja użytkownika. Odświeżenie (bench-create-task →
  `REFRESH.md`) też zostawia pliki i raport odświeżenia
  (`reports/<zadanie>-refresh.md`); `bench changes` oznacza tę grupę
  jako zamykającą erę (PR), a PR otwiera **użytkownik** wg
  `REFRESH_PR_TEMPLATE.md`. Poprawka rubryki zadania to edycja wg
  `RUBRIC_AUTHORING.md` w bench-create-task z bumpem `version` i re-oceną
  zachowanych prób — również przez PR.
- Zadanie ma datę ważności (`expires`) — repo bazowe ewoluuje, a zadanie
  jest przypięte do commita sprzed miesięcy. Odświeżenie (nowy pin,
  aktualizacja asercji) otwiera nową erę dla tego zadania. Zadanie
  wykopane z historii zachowuje pin (późniejszy commit zawiera już
  rozwiązanie): odświeżenie dowodzi go ponownie i odnawia `expires`.
- Zmiana czegokolwiek w katalogu zadania zmienia jego `task_hash`,
  czyli zamyka erę porównywalności dla tego zadania.
