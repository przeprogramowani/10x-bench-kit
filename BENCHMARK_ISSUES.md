# BENCHMARK_ISSUES — fundamentalne problemy projektu

Nie lista bugów, tylko problemy strukturalne, które ujawniają się przy
zadaniach średnich i dużych (18+ plików, godzinne próby) uruchamianych
na GitHub Actions. Materiał dowodowy: pierwszy pełny run per komórka na
bench-platforma-edu (2026-08-27, zadanie
`implement-dynamic-paragraph-complexity`, 3 modele × 2 próby, ~$40
łącznie, ~1h 15min wall-clock). Każdy punkt jest niezależny od wersji
kitu — to koszty samej architektury pomiaru, nie usterki implementacji.

## 1. Ekonomia nie skaluje się razem z ambicją zadań

Benchmark mierzy najlepiej wtedy, gdy zadanie jest realistycznie duże —
ale koszt pomiaru rośnie iloczynem, a nie sumą:

- Jedna komórka (model × zadanie średniej wielkości × 2 próby) to
  dziś **$9–17 za próby + ~$0.6 za sędziego + ~2h job-minut**.
  Claude Sonnet przekroczył budżet komórki ($17.43 przy limicie $10)
  w dwóch próbach — bez żadnej awarii, po prostu tyle kosztuje
  45 minut pracy frontier-modelu nad 18-plikową zmianą.
- Docelowa macierz (np. 10 zadań × 5 modeli × 3 próby) ekstrapoluje
  się na **$1000–2500 za JEDEN pełny pomiar**. To nie jest koszt
  jednorazowy: każda zmiana zadania, rubryki albo sędziego zamyka erę
  porównywalności i unieważnia komórki do ponownego opłacenia.
- Era jest poprawna metrologicznie i zabójcza ekonomicznie: **koszt
  ulepszania miary jest sprzężony z kosztem ponownego mierzenia
  wszystkiego**. Kalibracja rubryki po pierwszym runie (przepływ
  wprost zalecany przez bench-rubric) oznacza wyrzucenie wyników
  pierwszego runu. Iteracja nad jakością benchmarku jest przez to
  racjonowana budżetem, więc w praktyce się nie dzieje — patrz pkt 3.

## 2. GitHub Actions to niewłaściwy substrat dla godzinnych, płatnych jobów

Wszystkie mechanizmy odporności dobudowane w 0.21–0.23 (partials,
gałęzie `results/*`, retry na push, continue-on-error wokół oceny) to
kompensacja platformy, która nie daje żadnych gwarancji dla pracy, za
którą zapłacono u zewnętrznego dostawcy:

- **Runner jest ulotny, próba jest droga.** Ewikcja runnera, blokada
  billingowa organizacji albo sieciówka w 40. minucie próby przepala
  realne dolary u providera — GH Actions nie ma checkpoint/resume,
  a agent w kontenerze nie ma jak wznowić pracy od połowy.
- **Płacimy job-minuty za czekanie na API.** Większość czasu próby to
  oczekiwanie na odpowiedzi modelu; runner w tym czasie bije licznik.
  Joby zbiorcze (`--parallel`) łagodzą to, ale nie zmieniają natury:
  minuty CI są funkcją latencji providera, nie pracy do wykonania.
- **Artefakty nie są nośnikiem dla tej skali.** Workspace'y prób to
  gigabajty (upload 2 GB per komórka; zdarzył się artefakt 8 GB,
  którego nie dało się ściągnąć), retencja je kasuje, a pobranie do
  diagnozy trwa dłużej niż sama diagnoza. Trwałe jest tylko kilka KB
  result.json — cała reszta łańcucha dowodowego (agent.log,
  patch.diff) żyje na łasce retencji.
- **Limity twarde czekają tuż za rogiem**: 6h na job to zaledwie
  3–5 prób średniego zadania sekwencyjnie; concurrency runnerów
  ogranicza równoległość macierzy; GHCR, cache i sekrety mają własne
  tryby awarii, z których każdy kosztuje opłaconą próbę.

## 3. Jakość wyniku wisi na nieskalibrowanym sędzi z wagą 0.75

Dla zadań średnich i dużych guardy wykonania (lint, testy, build)
z konieczności mierzą tylko "czy workspace dalej zielony" — całą
merytorykę niesie LLM-as-judge. To stwarza trzy problemy naraz:

- **Sędzia nagradza zasięg, nie prawdę.** Qwen po timeout'cie z
  czerwonymi testami (tests = 0.0) dostał od sędziego 0.92, bo diff
  *wygląda* na kompletny — sędzia czyta tekst i niczego nie uruchamia.
  Wynik 0.765 dla nieukończonej, niedziałającej implementacji trafia
  na leaderboard obok 0.99 Sonneta.
- **Brak rozdzielczości u góry skali.** Werdykty 0.93 / 0.97 / 0.99
  dla różnych jakościowo implementacji to szum, nie ranking — a przy
  wadze 0.75 ten szum JEST wynikiem. Rubryka jest jawnie oznaczona
  jako nieskalibrowana, bo kalibracja kosztuje (pkt 1) i wymaga
  diffów z realnych runów, których przed pierwszym runem nie ma —
  błędne koło wpisane w proces.
- **n=2 nie jest statystyką.** Mediana z dwóch prób to średnia
  arytmetyczna, pass@k przy k=n jest zdegenerowane, a wariancja
  agent+sędzia jest większa niż różnice między sąsiednimi modelami
  w tabeli. Leaderboard sugeruje precyzję, której pomiar nie ma —
  a więcej prób to znowu pkt 1.

## 4. Czas obiegu zabija iterację

- Pętla zwrotna autora zadania: dispatch → ~1h prób → ~10 min oceny →
  (człowiek merguje PR) → leaderboard. **Jedna obserwacja na godziny**,
  przy błędzie konfiguracji (uprawnienia Actions, budżet) —
  odkrywanym po fakcie — jedna na dzień kalendarzowy.
- Timeout 3600 s dla dużych zadań sprzęga szybkość z jakością: model
  wolniejszy, ale poprawny, kończy jako "timeout, tests 0.0"
  nieodróżnialny od modelu, który kręcił się w kółko (Qwen: 9.5M
  tokenów wejścia i zero domkniętych faz). Podniesienie timeoutu
  podnosi koszty i czas obiegu — kolejne sprzężenie, nie suwak.
- Human-in-the-loop na ścieżce danych (merge PR-ów z wynikami) jest
  świadomym wyborem, ale dokłada opóźnienie i stan pośredni:
  skip-logic nie widzi niezmergowanych wyników, więc świeżość
  leaderboardu i poprawność planowania zależą od dyscypliny ownera.

## 5. Pomiar stoi na ruchomym gruncie

- **Zadanie żyje na żywym repo produktowym**: pin się starzeje
  (`expires`), plan zmiany w repo bywa realizowany przez zespół,
  a odświeżenie pinu to nowa era (pkt 1). Utrzymanie N zadań to stały
  podatek proporcjonalny do N — benchmark z definicji goni własny
  substrat pomiaru.
- **Metryki zależą od łańcucha stron trzecich**: adapter ↔ OpenCode ↔
  OpenRouter ↔ provider. Dowód z runu: Sonnet raportuje 418 tokenów
  wejścia przy $9.33 kosztu (niedoszacowanie o rzędy wielkości —
  cache-read nie wchodzi do licznika), więc kolumny tokenów na
  leaderboardzie są dziś niewiarygodne. Każdy element łańcucha
  wersjonuje się osobno i psuje niezależnie.
- **Budżet jest per wywołanie, nie per prawda o koszcie**: limit
  `max_cost_usd` działa w obrębie jednego `bench run`, a realny koszt
  pomiaru (suma komórek + sędzia + minuty CI) nigdzie nie ma sufitu.

## Co z tym zrobić (kierunki, nie taski)

1. **Odseparować wykonanie od CI**: GH Actions jako orkiestrator
   i księgowy, próby na infrastrukturze zaprojektowanej pod
   długie, wznawialne joby (self-hosted runner / sandbox chmurowy
   z checkpointem). Dopóki to nie nastąpi, każda warstwa odporności
   w YAML-u to leczenie objawów.
2. **Rozbić duże zadania na fazy z bramkami** (checkpoint po każdej
   fazie planu): krótsze próby, tańsze re-runy, timeout przestaje
   zlewać szybkość z jakością, a sędzia ocenia domknięte etapy
   zamiast zgadywać zasięg z jednego diffa.
3. **Sprząc sędziego z guardami zamiast z wagą**: czerwone testy /
   timeout powinny CAPować werdykt (jak klauzule dominujące rubryki),
   nie rozmywać się w średniej ważonej. Kalibracja rubryki przed
   pierwszym płatnym runem musi być bramką w procesie, nie zaleceniem.
4. **Uczciwie komunikować niepewność**: przy n≤3 leaderboard powinien
   pokazywać przedziały/próby, nie ranking z trzema miejscami po
   przecinku; różnice poniżej wariancji sędziego to remis.
5. **Budżetować pomiar, nie wywołanie**: sufit kosztu na run całej
   macierzy (komórki + sędzia), wymiarowany z historii median, oraz
   projekcja kosztu PRZED dispatch'em jako standardowy krok planu.

Stan na 2026-08-27, kit 0.23.1. Dowody: runy 33043537556 (Sonnet,
budżet $17.43/$10), 33043538683 (GLM), 33043539690 (Qwen, 2× timeout,
9.5M tokenów wejścia) w bench-platforma-edu; rubryka
`dynamic-paragraph-complexity` v1 (nieskalibrowana, waga judge 0.75).
