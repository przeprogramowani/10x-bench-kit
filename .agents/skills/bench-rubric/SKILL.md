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

"Aplikuje się" nie znaczy "działa" — nie mierz materiału, którego nie
sprawdziłeś. Checklista wejściowa, **przed pierwszym pomiarem**:

- [ ] Zbiór pochodzi z bench-task (wytworzony przy zadaniu, gdy kontekst
      repo był świeży) — jeśli go nie ma, wytwórz komplet za jednym
      posiedzeniem w repo, nie diff po diffie.
- [ ] Każdy diff aplikuje się na stan startowy zadania.
- [ ] Każdy diff **kompiluje się / uruchamia** — to bramka o szczebel
      tańsza niż sędzia i wyłapuje materiał martwy (sędzia czyta diff,
      nie buduje projektu — nie wykryje diffu, który się nie kompiluje,
      a jedna taka pozycja marnuje całą rundę werdyktów).
- [ ] Każdy diff ma zmierzony wynik na **składowych nie-LLM-owych**
      zadania — jednym wejściem do kontenera: `bench assert --task <t>
      --patch a.diff --patch b.diff …`. To nie jest praca podwójna: te
      liczby i tak są potrzebne do realnego wyniku końcowego wariantu,
      a przy okazji weryfikują, że diff robi to, co deklaruje
      `expected.md`.
- [ ] Dopiero teraz pierwszy `calibrate`.

### 2. Pomiar rozdzielczości

```
bench calibrate --task <zadanie> --set evaluation-pool/judge/<zadanie>-calibration \
  [--repeats 3] [--label <nazwa-rundy>]
```

Komenda ocenia każdy diff `--repeats` razy, wypisuje tabelę min/med/max
+ rozrzut per diff i mediany per kryterium, i dopisuje rundę do
`results.json` zbioru.

Stosuj **drabinę precyzji**: rundy diagnostyczne z minimalną liczbą
powtórzeń (`--repeats 2`) — szukasz błędu rankingu i rażącego rozrzutu,
do tego nie potrzeba precyzji; pełna liczba powtórzeń (`--repeats 5`)
należy do rundy potwierdzającej, **raz**, na końcu, po ostatniej zmianie
rubryki. Nie odwrotnie — różnica to kilkanaście wywołań modelu na
iterację. Wywołania w ramach rundy są od siebie niezależne — runner
puszcza je równolegle (`--parallel`, default 3; zejdź do 1 przy ostrych
rate limitach providera). `--json` daje podsumowanie rundy strukturalnie,
bez parsowania tabelki.

Na tabeli z pomiaru sprawdź:

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
kryterium, jeśli dwa aspekty się zlewają.

Zanim cokolwiek zmierzysz, przeczytaj rubrykę pod kątem dwóch wzorców
awarii, które powtarzają się niezależnie od dziedziny i które naprawia
się samym czytaniem (minuta zamiast straconej rundy pomiaru):

1. **Kryterium bez dna dla przypadku degeneracyjnego.** Diff, który nic
   nie robi, dostaje punkty za kryteria "negatywne" (nie zepsuł, nie
   wyszedł poza zakres). Każde kryterium tego typu potrzebuje jawnej
   klauzuli: przy braku pracy do oceny — zero.
2. **Kotwice liczące zdarzenia zamiast ważyć skutek.** "Jedna zmiana
   ponad potrzebę" to kotwica licząca; sędzia zastosuje ją dosłownie
   i ukarze trzy nieszkodliwe drobiazgi surowiej niż jedną ryzykowną
   przebudowę. Kotwice mają opisywać **skutek**, nie liczbę.

Po zmianie rubryki mierzysz **cały zbiór** (inaczej porównujesz rubryki
na różnych danych) — ale rundę diagnostyczną możesz zawęzić do diffów,
których zmiana dotyczy, o ile runda potwierdzająca obejmie komplet.
Zatrzymaj się, gdy ranking + separacja + stabilność są osiągnięte; nie
tuninguj dalej (przeuczenie rubryki pod zbiór to też błąd).

### 4. PR

- nowa/zmieniona rubryka w `evaluation-pool/judge/`,
- zbiór kalibracyjny + `expected.md` + surowe wyniki pomiaru
  (`results.json` z rundami `bench calibrate`) w `…/<zadanie>-calibration/`,
- podbicie `version` we frontmatterze rubryki **tylko jeśli** zmieniła
  się rubryka już użyta w policzonych wynikach (zasada 2),
- w opisie PR-a: tabela median z kroku 2, wnioski, koszt kalibracji.

### 5. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan instancji
jednym zdaniem, **jedna** rekomendacja z jednozdaniowym uzasadnieniem,
maksymalnie dwie alternatywy z ceną, oraz — oddzielnie — to, co czeka na
decyzję człowieka. Typowe przejście: rubryka skalibrowana, PR
zaktualizowany → **merge + pełny run na 2+ modelach** — kalibracja
przewiduje wyniki, run je weryfikuje.
