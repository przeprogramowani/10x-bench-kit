---
name: bench-rubric
description: >-
  Kalibruje rubrykę LLM-as-judge benchmarku na diffach o znanej jakości:
  buduje zbiór kalibracyjny, mierzy rozdzielczość i stabilność sędziego,
  iteruje kryteria i domyka PR-em z podbiciem wersji rubryki. Użyj przy
  tworzeniu rubryki dla nowego zadania, gdy wyniki sędziego wyglądają
  losowo/dryfują, albo gdy użytkownik mówi "skalibruj rubrykę / sędziego".
---

# bench-rubric — kalibracja sędziego

Rubryka bez kalibracji to generator liczb, nie ocena. Kalibrujesz ją
empirycznie: sędzia dostaje diffy, których jakość **znasz z góry**,
a ty sprawdzasz, czy jego ranking i wartości zgadzają się z twoimi —
powtarzalnie. Narzędziem jest `bench calibrate --task <nazwa> --set
<katalog-zbioru>` (z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts calibrate …`) — ta sama ścieżka oceny co
w `bench evaluate`, więc wynik kalibracji przenosi się 1:1 na realne
runy. Runner robi arytmetykę (powtórzenia, min/med/max, rozrzut,
dopisanie rundy do `results.json`); twoim wkładem jest osąd: projekt
zbioru, ocena rankingu i separacji, decyzja o iteracji. Do pojedynczego
werdyktu ad hoc (np. porównanie sędziów) zostaje `bench judge --task
<nazwa> --patch <plik> [--model …]`.

## Twarde zasady

1. **Wyjście przez PR.** Zmiana rubryki lub jej wersji nigdy nie
   idzie prosto do mastera instancji — gałąź + PR z wynikami kalibracji
   w opisie (dowód, nie deklaracja).
2. **Zmiana rubryki = nowa era zadań, które jej używają.** Wersję
   deklaruje frontmatter rubryki (`version`); stempel ery jest per
   rubryka, więc podbicie unieważnia porównywalność wyłącznie zadań
   z tą rubryką w `evaluation[]` — PR wymienia je wprost. Kalibracja
   świeżo utworzonej rubryki przed jej pierwszym użyciem ery nie
   zamyka — dlatego kalibruj Z zadaniem (PR bench-task), nie po nim.
   (Globalne `judge.rubric_version` w configu to kontrakt legacy dla
   rubryk bez frontmattera — migruj je przy pierwszej kalibracji.)
3. **Zbiór kalibracyjny to materiał oceny.** Żyje w
   `evaluation-pool/judge/<zadanie>-calibration/`, nigdy w `tasks/`
   (przeciekłby do workspace'u agenta). Kolejne iteracje rubryki mierzą
   się na TYM SAMYM zbiorze — inaczej porównujesz rubryki na różnych
   danych.
4. **Budżet zamiast rytuału zgody.** Kalibracja to dziesiątki wywołań
   sędziego, ale koszty pilnuje budżet instancji, nie negocjacja
   szacunków — po pomiarze raportuj koszt faktyczny (`bench calibrate`
   wypisuje go z usage sędziego). Zgody użytkownika wymaga dopiero
   pomiar wyraźnie większy niż zwykle (np. porównanie kilku sędziów
   na dużym zbiorze).
5. **Format odpowiedzi jest kontraktem.** Nowe rubryki deklarują wagi
   kryteriów we frontmatterze YAML (`weights:`, suma = 1) — total liczy
   runner z `criteria[*].score`, więc blok ```json zawiera tylko
   `criteria` o kluczach zgodnych z wagami (sprawdza to `bench
   validate`). Nie proś sędziego o arytmetykę — to źródło błędów klasy
   "wyrażenie zamiast liczby". Rubryka bez frontmattera to kontrakt
   legacy (`criteria` + liczbowy `total` od modelu); odpowiedź bez
   poprawnego JSON-a = 0. Rubryka wymaga też **kontraktu zwięzłości**
   (wzór w template'owej default-rubric): zacznij od `{`, uzasadnienie
   jedno zdanie ≤ 150 znaków bez cudzysłowów i nowych linii, score jako
   pojedyncza liczba — u sędziów z rozumowaniem rozwlekłe uzasadnienia
   ucinają JSON na limicie tokenów dokładnie na diffach ze środka skali.

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

```
bench calibrate --task <zadanie> --set evaluation-pool/judge/<zadanie>-calibration \
  [--repeats 3] [--label <nazwa-rundy>]
```

Komenda ocenia każdy diff `--repeats` razy (co najmniej 3), wypisuje
tabelę min/med/max + rozrzut per diff i mediany per kryterium, i dopisuje
rundę do `results.json` zbioru. Na tej tabeli sprawdź:

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
  (`results.json` z rundami `bench calibrate`) w `…/<zadanie>-calibration/`,
- podbicie `version` we frontmatterze rubryki **tylko jeśli** zmieniła
  się rubryka już użyta w policzonych wynikach (zasada 2),
- w opisie PR-a: tabela median z kroku 2, wnioski, koszt kalibracji.
