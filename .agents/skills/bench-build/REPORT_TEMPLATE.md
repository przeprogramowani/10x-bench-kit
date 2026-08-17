# Szablon raportu zadania (bench-build)

Zadanie zostaje jako **pliki w drzewie roboczym** — subagent nie robi
nic w gicie. Raport przejmuje rolę opisu zmiany: to on niesie dowody
i to z niego użytkownik zbuduje ewentualny komunikat commita czy opis
PR-a, gdy zdecyduje, co dalej. Sekcje poniżej są obowiązkowe — wklejaj
wyniki komend, nie deklaracje.

```markdown
# <nazwa-zadania>

## Pliki

<pełna lista utworzonych/zmienionych ścieżek: tasks/<nazwa>/…, nowe
asercje w evaluation-pool/…, zbiór kalibracyjny
w evaluation-pool/judge/<zadanie>-calibration/…>

## Co zadanie mierzy

<typ: implementacja / naprawa / refaktor / dokumentacja; jedna intencja.
Repo bazowe, pin (SHA + dlaczego ten commit), poziom naprowadzenia
promptu (produktowy / kierunkowy / chirurgiczny — decyzja użytkownika
ze zlecenia w backlogu), timeout i uzasadnienie.>

## Dowody z referencji

- stan startowy: `bench assert --task <nazwa>` → <wynik per asercja>
- czysta referencja (zadania z overlayem): `bench assert --task <nazwa>
  --no-overlay` → <wynik>
- wzorcowe rozwiązanie: `bench assert --task <nazwa> --patch <wzorzec>`
  → <wynik>
- pusty diff nie zalicza: <wynik miary pracy / werdykt sędziego>
- `bench validate --assert` → 0 errorów

## Asercje i wagi

<per asercja: reużyta z puli czy nowa, deklaracja reference (pass/fail)
i dlaczego; wagi z uzasadnieniem, co która składowa odróżnia. Jeśli
odszedłeś od rozstrzygnięcia asercji, które dał orkiestrator (reużycie
zamiast nowej lub odwrotnie) — powiedz to wprost, żeby mógł domknąć
ewentualny duplikat w puli.>

## Skutki dla porównywalności

<nowe zadanie = nowa era tego zadania (task_hash). Jeśli zmiany
obejmują też istniejące asercje w puli lub rubryki: które dotychczasowe
wyniki przestają być porównywalne.>

## Koszt samosprawdzenia

<koszt próbnego runu / wywołań sędziego (model, $), albo "brak — nie
odpalano modeli".>
```
