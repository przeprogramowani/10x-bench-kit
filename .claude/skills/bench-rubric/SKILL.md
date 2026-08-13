---
name: bench-rubric
description: >-
  Kalibruje rubrykę LLM-as-judge benchmarku na diffach o znanej jakości:
  buduje zbiór kalibracyjny, mierzy rozdzielczość i stabilność sędziego,
  iteruje kryteria i domyka PR-em z podbiciem rubric_version. Użyj przy
  tworzeniu rubryki dla nowego zadania, gdy wyniki sędziego wyglądają
  losowo/dryfują, albo gdy użytkownik mówi "skalibruj rubrykę / sędziego".
---

# bench-rubric — kalibracja sędziego

Rubryka bez kalibracji to generator liczb, nie ocena. Kalibrujesz ją
empirycznie: sędzia dostaje diffy, których jakość **znasz z góry**,
a ty sprawdzasz, czy jego ranking i wartości zgadzają się z twoimi —
powtarzalnie. Narzędziem jest `bench judge --task <nazwa> --patch <plik>`
(z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts judge …`) — dokładnie ta sama ścieżka
oceny co w `bench evaluate`, więc wynik kalibracji przenosi się 1:1
na realne runy.

## Twarde zasady

1. **Wyjście przez PR.** Zmiana rubryki lub `rubric_version` nigdy nie
   idzie prosto do mastera instancji — gałąź + PR z wynikami kalibracji
   w opisie (dowód, nie deklaracja).
2. **Zmiana rubryki = nowa era.** Podbicie `rubric_version`
   w bench.config.yaml zamyka erę porównywalności WSZYSTKICH wyników
   (stempel globalny). PR musi to mówić wprost. Kalibracja świeżo
   utworzonej rubryki przed jej pierwszym użyciem ery nie zamyka —
   dlatego kalibruj Z zadaniem (PR bench-task), nie po nim.
3. **Zbiór kalibracyjny to materiał oceny.** Żyje w
   `evaluation-pool/judge/<zadanie>-calibration/`, nigdy w `tasks/`
   (przeciekłby do workspace'u agenta). Kolejne iteracje rubryki mierzą
   się na TYM SAMYM zbiorze — inaczej porównujesz rubryki na różnych
   danych.
4. **Koszty jawne.** Kalibracja to dziesiątki wywołań sędziego — przed
   pomiarem podaj szacunek (diffy × powtórzenia × ~koszt wywołania),
   po pomiarze koszt faktyczny.
5. **Format odpowiedzi jest kontraktem.** Rubryka musi zawierać blok
   ```json z polami `criteria` i liczbowym `total` (sprawdza to
   `bench validate`); odpowiedź sędziego bez poprawnego JSON-a = 0.

## Procedura

### 1. Zbiór kalibracyjny

3–5 diffów o znanej jakości per zadanie, każdy z oczekiwanym przedziałem
wyniku. Kanoniczny zestaw:

| Diff | Skąd | Oczekiwanie |
|---|---|---|
| wzorcowe rozwiązanie | autor zadania (bench-task, krok 5) | wysoki (≈1) |
| rozwiązanie częściowe | wzorzec z wyciętą częścią naprawy | środek, wyraźnie < wzorca |
| poza zakresem | wzorzec + zmiany, o które nikt nie prosił | niżej niż wzorzec (kara za scope) |
| pusty diff | `: > pusty.diff` | ≈0 |
| realne diffy z runów | `patch.diff` z artefaktów prób | wg twojej oceny ręcznej |

Diffy muszą się **aplikować na stan startowy zadania** (repo@pin +
overlay). Zapisz zbiór w `evaluation-pool/judge/<zadanie>-calibration/`
wraz z `expected.md` (oczekiwania + uzasadnienie).

### 2. Pomiar rozdzielczości

Każdy diff oceń sędzią **co najmniej 3×** (`bench judge` w pętli).
Raportuj per diff: min / max / medianę oraz per kryterium, i sprawdź:

- **Ranking**: mediany układają się zgodnie z oczekiwaniem
  (wzorzec > częściowe > poza-zakresem ≥ … > pusty)?
- **Separacja**: przedziały sąsiednich diffów się nie przecinają?
  (max gorszego < min lepszego — inaczej sędzia ich nie odróżnia)
- **Stabilność**: rozrzut per diff ≤ ~0.1? Większy = kryteria zbyt
  uznaniowe.
- **Próg**: diffy "zaliczające" są nad `pass_threshold`
  z bench.config.yaml, niezaliczające pod nim?

### 3. Iteracja kryteriów

Gdzie sędzia myli dobre ze złym — doprecyzuj rubrykę, nie oczekiwania:
dopisz do kryterium, co konkretnie znaczy 1.0 a co 0.5 (kotwice), nazwij
kary (np. "zmiany niewymagane przez zadanie obniżają scope o…"), dodaj
kryterium, jeśli dwa aspekty się zlewają. Po każdej zmianie — pełny
pomiar z kroku 2 od nowa, na tym samym zbiorze. Zatrzymaj się, gdy
ranking + separacja + stabilność są osiągnięte; nie tuninguj dalej
(przeuczenie rubryki pod zbiór to też błąd).

### 4. PR

- nowa/zmieniona rubryka w `evaluation-pool/judge/`,
- zbiór kalibracyjny + `expected.md` + surowe wyniki pomiaru
  (`results.json`) w `…/<zadanie>-calibration/`,
- podbicie `rubric_version` **tylko jeśli** zmieniła się rubryka już
  użyta w policzonych wynikach (zasada 2),
- w opisie PR-a: tabela median z kroku 2, wnioski, koszt kalibracji.
