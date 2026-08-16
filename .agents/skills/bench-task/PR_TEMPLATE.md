# Szablon PR-a dla nowego zadania (bench-task)

Tytuł: `bench-task: <nazwa-zadania>`

```markdown
## Co zadanie mierzy

<typ: implementacja / naprawa / refaktor / dokumentacja; jedna intencja.
Repo bazowe, pin (SHA + dlaczego ten commit), poziom naprowadzenia
promptu (produktowy / kierunkowy / chirurgiczny — decyzja użytkownika
z wywiadu), timeout i uzasadnienie.>

## Dowody z referencji

<wklej wyniki komend — nie deklaracje:>

- stan startowy: `bench assert --task <nazwa>` → <wynik per asercja>
- czysta referencja (zadania z overlayem): `bench assert --task <nazwa>
  --no-overlay` → <wynik>
- wzorcowe rozwiązanie: `bench assert --task <nazwa> --patch <wzorzec>`
  → <wynik>
- pusty diff nie zalicza: <wynik miary pracy / werdykt sędziego>
- `bench validate --assert` → 0 errorów

## Asercje i wagi

<per asercja: reużyta z puli czy nowa, deklaracja reference (pass/fail)
i dlaczego; wagi z uzasadnieniem, co która składowa odróżnia.>

## Skutki dla porównywalności

<nowe zadanie = nowa era tego zadania (task_hash). Jeśli PR zmienia też
istniejące asercje w puli lub rubryki: które dotychczasowe wyniki
przestają być porównywalne.>

## Koszt samosprawdzenia

<koszt próbnego runu / wywołań sędziego (model, $), albo "brak — nie
odpalano modeli".>
```
