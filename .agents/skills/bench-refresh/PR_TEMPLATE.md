# Szablon PR-a odświeżenia zadania (bench-refresh)

Tytuł: `bench-refresh: <nazwa-zadania>`

```markdown
## Powód odświeżenia

<warning `expires` z bench validate (data) albo powód wprost — np. repo
bazowe odjechało od pina w obszarze zadania.>

## Zmiana pina

- stary: `<SHA>` (z <data/kontekst>)
- nowy: `<SHA>` (dlaczego ten commit — np. ostatni zielony na CI)
- co zaszło między pinami w obszarze zadania: <podsumowanie
  `git log stary..nowy -- <ścieżki>`; "nic" też jest odpowiedzią>

## Werdykt sensowności i adaptacje

<sens bez zmian / sens po adaptacji / brak sensu (wtedy PR wycofuje
zadanie). Per adaptacja (prompt/overlay/asercje/wzorzec): co i dlaczego;
intencja zadania bez zmian. Asercje współdzielone: nowa wersja w puli,
nie edycja in-place.>

## Dowody z nowej referencji

<wklej wyniki komend — nie deklaracje:>

- stan startowy: `bench assert --task <nazwa>` → <wynik per asercja>
- kontrdowód overlaya: `--no-overlay` / wzorzec → <wynik>
- wzorcowe rozwiązanie: `bench assert --task <nazwa> --patch <wzorzec>`
  → <wynik>; judge na wzorcu → <wynik>
- pusty diff nie zalicza: <wynik>
- `bench validate --assert` → 0 errorów, bez warningu expires

## Skutki dla porównywalności

<to otwiera nową erę tego zadania (nowy task_hash) — dotychczasowe
wyniki zostają w historii, nowe nie są z nimi porównywalne. Los zbioru
kalibracyjnego sędziego: przeniesiony i przeliczony / dotyczy starej
ery, rekalibracja przy najbliższym dryfie.>

## Nowa data expires

<data + horyzont>

## Koszt samosprawdzenia

<koszt próbnego runu / wywołań sędziego (model, $), albo "brak — nie
odpalano modeli".>
```
