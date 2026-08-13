# Adapter metryk (OpenCode)

Adapter to **jedyny szew** między harnessem a resztą kitu. Abstrakcja na
kolejne harnessy (Claude Code itd.) powstanie przy drugim adapterze —
nie wcześniej.

## Kontrakt

Po zakończeniu `opencode run` (lub timeoucie) adapter czyta storage
OpenCode ze świeżego `XDG_DATA_HOME` próby i zapisuje `metrics.json`:

```json
{
  "cost_usd": 0.42,
  "tokens": { "input": 123456, "output": 7890 },
  "duration_s": 314.2
}
```

Zasady:

- adapter działa wyłącznie na danych z bieżącej próby (pusty
  `XDG_DATA_HOME` na starcie gwarantuje, że nie ma czego pomylić),
- `duration_s` to czas sesji agenta, nie czas życia kontenera,
- brak danych (np. crash agenta) → adapter zapisuje metryki częściowe
  z polem `"incomplete": true`, nigdy nie wymyśla wartości,
- format jest wejściem dla `result.json` (patrz
  `runner/src/schemas/result.ts`).

Implementacja adaptera dojdzie wraz z `bench run`.
