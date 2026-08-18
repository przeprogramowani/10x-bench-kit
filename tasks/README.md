# tasks — strefa firmy (definicje zadań)

Strefa nietykalna przy `bench-kit update`.

## Definicja zadania — katalog `tasks/<nazwa>/`

| Plik | Rola |
|---|---|
| `prompt.md` | **Jedyne** wejście, które widzi agent |
| `task.yaml` | repo bazowe + pinowany commit, timeout, dobór asercji z puli, wagi |
| `overlay/` | opcjonalne pliki nakładane na repo bazowe (np. seed buga) |

Schemat `task.yaml`: `.bench-kit/runner/src/schemas/task.ts`. Przykład
wszystkich pól: `demo-hello-bench/task.yaml`.

## Backlog zleceń — `tasks/backlog.md`

Stanowy dokument koordynacji: skill **bench-new-task** dopisuje do
niego zlecenia zadań po krótkim wywiadzie, skill **bench-build**
zamienia oczekujące zlecenia w prawdziwe zadania (subagent per
zlecenie). Runner ignoruje pliki w `tasks/` niebędące katalogami,
więc backlog nie wpływa na scoring. Skille wyłącznie edytują ten
plik — gitem zarządza użytkownik.

## Zasady

- Materiały oceny (testy, rubryki) NIGDY nie leżą w katalogu zadania —
  wyłącznie referencje `evaluation: [...]` do `evaluation-pool/`.
  Izolacja z konstrukcji, nie ze starannego wycinania.
- Zadania powstają i są odświeżane skillami, ale skille nie dotykają
  gita. Nowe zadania bench-build zostawia jako pliki w drzewie
  roboczym z raportem dowodów z referencji per zadanie — commit, PR
  czy odrzucenie to decyzja użytkownika. Odświeżenia (bench-refresh-task)
  i rubryki (bench-rubric) przechodzą przez PR.
- Zadanie ma datę ważności (`expires`) — repo bazowe ewoluuje, a zadanie
  jest przypięte do commita sprzed miesięcy. Odświeżenie (nowy pin,
  aktualizacja asercji) otwiera nową erę dla tego zadania.
- Zmiana czegokolwiek w katalogu zadania zmienia jego `task_hash`,
  czyli zamyka erę porównywalności dla tego zadania.
