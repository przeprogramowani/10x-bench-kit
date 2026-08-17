---
name: bench-task
description: >-
  Tworzy nowe zadanie benchmarku agentów AI w instancji bench-kit: prompt,
  pinowany commit, opcjonalny overlay (seed buga), asercje z evaluation-pool
  z deklaracjami reference i wagi — wszystko sprawdzone na wersji
  referencyjnej, zanim trafi do PR-a. Użyj, gdy użytkownik chce dodać
  zadanie do benchmarku, przerobić pomysł na zadanie mierzalne albo mówi
  "nowe zadanie / task do bencha".
---

# bench-task — autorstwo zadania benchmarku

Tworzysz katalog `tasks/<nazwa>/` w instancji benchmarku. Zadanie ma być
mierzalne, nieprzechodzalne pustym diffem i sprawdzone na referencji przed
zaproponowaniem. Naczelna zasada: **niczego nie proponujesz, czego sam nie
uruchomiłeś na wersji referencyjnej** — do tego służą `bench assert`,
`bench judge` i `bench validate --assert` (patrz "Narzędzia" niżej).

## Twarde zasady

1. **Wyjście wyłącznie przez PR.** Nigdy nie commituj do mastera instancji
   niczego, co wpływa na scoring (zadania, asercje, rubryki,
   `bench.config.yaml`). Gałąź + PR wg [PR_TEMPLATE.md](PR_TEMPLATE.md).
2. **Izolacja materiałów oceny.** Nic z `evaluation-pool/` nie może być
   skopiowane ani zreferowane w `tasks/<nazwa>/` (jedyny wyjątek: wpisy
   `evaluation: [...]` w task.yaml). `prompt.md` nie może zdradzać, jak
   zadanie będzie oceniane, ani cytować ukrytych testów.
3. **Testuj na referencji, zanim zaproponujesz.** Każda asercja przed
   wejściem do PR-a musi być uruchomiona przez `bench assert` i zachować
   się zgodnie z intencją — na stanie startowym ORAZ na wzorcowym
   rozwiązaniu. Deklarujesz to w `reference` w task.yaml.
4. **Runner jest twoim narzędziem.** Nie reimplementuj jego logiki, nie
   oceniaj "na oko" — wołaj komendy `bench` i czytaj ich wyjścia. Jeśli
   czegoś brakuje runnerowi, zgłoś to (issue), nie obchodź.
5. **Pracuj wyłącznie w swoim zakresie**: `tasks/<nazwa>/` tworzonego
   zadania + nowe asercje w `evaluation-pool/`. Niczego poza tym nie
   edytuj — w szczególności `.bench-kit/` (strefa narzędzia) i katalogów
   innych zadań. Stan reszty repo to sprawa użytkownika: jeśli w drzewie
   roboczym są niezacommitowane zmiany w plikach spoza twojego zakresu
   (także skasowane pliki innych zadań), **zostaw je bez zmian** — nie
   przywracaj, nie revertuj, nie diagnozuj i nie komentuj; po prostu nie
   włączaj ich do swojej gałęzi/commita (dodawaj pliki po ścieżkach,
   nigdy `git add -A`/`git add .`).
6. **Budżet zamiast rytuału zgody.** Kosztów pilnuje
   `defaults.max_cost_usd` w bench.config.yaml (runner przerywa run po
   przekroczeniu) — nie pytaj o zgodę przed każdym próbnym runem czy
   wywołaniem sędziego; po wykonaniu zraportuj koszt faktyczny
   (z `metrics.json` / usage sędziego). Zgody użytkownika wymaga tylko
   podnoszenie budżetu.
7. **Świadomość er.** Każda zmiana `tasks/<nazwa>/` zmienia `task_hash`
   tego zadania (nowa era). PR musi to mówić wprost — sekcja "Skutki dla
   porównywalności" w szablonie.

## Narzędzia runnera

Uruchamiane z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

- `bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]...`
  — asercje nie-LLM-owe na stanie startowym zadania (repo@pin + overlay);
  `--no-overlay` = czysta referencja, `--patch` = z nałożonym diffem.
  `--patch` można podać **wielokrotnie** — komplet diffów (wzorzec,
  warianty, pusty) ocenia jedno wejście do kontenera; `--json` daje wynik
  strukturalny na stdout zamiast tabelki do parsowania.
  Exit 0 gdy wszystkie score 1, exit 1 gdy nie — sprawdzasz oba kierunki.
  Uwaga: kod wyjścia czytaj z `$?` bezpośrednio po komendzie, **bez
  potoku** — `bench assert … | tail` podmienia `$?` na kod `tail`.
  Przy długim wyjściu bezpieczniej czytać linie `score` z wyjścia niż
  polegać na kodzie.
- `bench judge --task <nazwa> --patch <plik> [--rubric judge/<r>]` —
  pojedynczy werdykt sędziego na diffie (kalibracja: patrz skill
  bench-rubric).
- `bench validate --assert` — pełna bramka + weryfikacja deklaracji
  `reference` na stanie startowym.
- `bench run --tasks <nazwa> --models <tani-model> --trials 1` +
  `bench evaluate --run <dir>` — próbny pełny cykl (krok 7).

## Procedura

### 1. Wywiad

Decyzje projektowe zadania należą do użytkownika — przeprowadź
interaktywny wywiad mechanizmem pytań twojego narzędzia
(AskUserQuestion / request_user_input; gdy brak — zwykłe pytania
w rozmowie) i zapisz sobie odpowiedzi, zanim napiszesz cokolwiek.
Nie zgaduj i nie przyjmuj po cichu domyślnych: źle dobrany poziom
naprowadzenia czy timeout zmienia, **co** zadanie mierzy.

Zadaj **komplet pytań w jednym bloku**, nie sekwencyjnie. Poziom
naprowadzenia, trudność, timeout i składowe oceny są od siebie zależne —
użytkownik odpowiada na nie lepiej, widząc je razem, a ty oszczędzasz
rundy dopytywania.

**Jeśli wywołanie zawiera już opis zadania**, nie zaczynaj wywiadu od
zera: wyprowadź z opisu propozycje odpowiedzi na poniższe punkty
i przedstaw je z oznaczeniem, co jest wywnioskowane z opisu, a czego
w nim nie ma. Pytania zadawaj **tylko** o luki i niejednoznaczności;
o poziom naprowadzenia promptu pytaj zawsze, chyba że opis rozstrzyga
go wprost (użytkownik opisujący zadanie mówi zwykle *co* jest do
zrobienia, nie *ile prompt ma zdradzać* — a to zmienia, co zadanie
mierzy). Wnioski z opisu to propozycje, nie decyzje — bramka
akceptacji na końcu kroku obowiązuje bez zmian.

- **Co zadanie mierzy**: implementacja funkcji / naprawa buga / refaktor /
  dokumentacja. Jedno zadanie = jedna intencja.
- **Repo bazowe** (musi być w `base_repos` w bench.config.yaml — jeśli
  nie jest, to najpierw wiring, nie to zadanie).
- **Poziom naprowadzenia promptu** — ile prompt zdradza o miejscu
  zmiany; zadaj to jako osobne pytanie z konsekwencjami wprost:
  - *produktowy* — sam objaw/cel ("stopka pokazuje 2025 zamiast
    bieżącego roku"), zero plików i symboli; mierzy lokalizację
    w kodzie + wykonanie — trudniejsze, dłuższy timeout;
  - *kierunkowy* — nazwany obszar/moduł ("stopka we wspólnym
    layoucie"); środek skali;
  - *chirurgiczny* — konkretne pliki/symbole ("`Footer.astro`");
    mierzy samo wykonanie — łatwiejsze, krótszy timeout.
- **Poziom trudności** i **budżet czasowy próby** (`timeout_s` — typowo
  300–900 s; za krótki timeout mierzy szybkość, nie jakość; spójny
  z poziomem naprowadzenia).
- **Nazwa zadania**: kebab-case, mówiąca co jest do zrobienia
  (np. `fix-cart-total-rounding`), nie jak (`edit-cart-ts`).

Na koniec streść decyzje w 2–3 zdaniach ("zadanie X, poziom
naprowadzenia Y, timeout Z, bo…") i dopiero po akceptacji użytkownika
przechodź do kroku 2.

### 2. Pin

Zaproponuj konkretny commit repo bazowego: świeży, ale stabilny —
najlepiej ostatni zielony na CI. Repo przeglądaj w lokalnym klonie
`.repos/<nazwa>/` (konwencja z AGENTS.md — jeśli klonu nie ma, sklonuj
właśnie tam; przed wyborem pina `git fetch origin`, bo pin musi istnieć
na remote). Zweryfikuj, że zadanie ma na nim sens: przejrzyj repo na tym
commicie, sprawdź że pliki, których zadanie dotyczy, istnieją, a projekt
się buduje. Pełny SHA (40 znaków) do `task.yaml`.

### 3. Overlay (zadania typu "napraw")

Buga **wprowadzasz sam** jako pliki w `tasks/<nazwa>/overlay/` (nadpisują
pliki repo przy starcie próby). Wymóg: bug musi być **obserwowalny** —
istnieje asercja, która go łapie:

- na stanie startowym (z overlayem) asercja **czerwona** —
  `bench assert <ref> --task <nazwa>` → exit 1,
- kontrdowód, że czerwień pochodzi z buga, nie z zepsutej asercji:
  - overlay **modyfikuje** istniejące pliki → na czystej referencji
    zielona: `bench assert <ref> --task <nazwa> --no-overlay` → exit 0,
  - overlay **dodaje** nowe pliki (na czystej referencji asercja nie ma
    czego testować) → kontrdowodem jest wzorcowe rozwiązanie:
    `bench assert <ref> --task <nazwa> --patch <wzorzec.diff>` → exit 0.

Jeśli nie umiesz pokazać obu wyników, bug jest nieobserwowalny albo
asercja zła — wróć do projektowania, nie idź dalej. Overlay ma być
minimalny: seed buga, nie przebudowa projektu.

### 4. prompt.md

Pisz jak zlecenie dla człowieka: cel, kontekst, granice ("nie zmieniaj
niczego poza…") — na poziomie naprowadzenia wybranym w wywiadzie:
*produktowy* opisuje wyłącznie objaw/cel, *kierunkowy* może nazwać
obszar, *chirurgiczny* może wskazać pliki/symbole. Niezależnie od
poziomu zakazane: podpowiadanie rozwiązania, wskazywanie linii do
zmiany, jakiekolwiek przecieki z materiałów oceny (zasada 2). Prompt
to **jedyne** wejście agenta — wszystko, czego nie napiszesz, agent musi
wywnioskować z kodu.

Dopisz do granic promptu **oczekiwanie wobec weryfikacji** — spójne
z polityką ustaloną w wiringu instancji: czy agent ma weryfikować pracę
uruchomieniem projektu/testów, czy ma tego nie robić. Prompt, który tego
nie mówi, zostawia agentowi kosztowną decyzję, a tobie niejednoznaczne
wyniki: jeden model kończy w kilkanaście sekund bez sprawdzenia, drugi
zużywa minuty i zasoby na uruchomienie projektu — mierzysz wtedy
temperament, nie umiejętność.

### 5. Asercje

Najpierw przejrzyj `evaluation-pool/` pod **reużycie** — asercje są
wspólne dla wielu zadań. Brakujące twórz **w puli** (katalog
`evaluation-pool/<typ>/<nazwa>/check.yaml`), nigdy w katalogu zadania.
Ukryte pliki testów trzymaj w katalogu asercji (w kontenerze oceny są
pod `$ASSERTION_DIR`).

Wejście do kontenera oceny odtwarza środowisko od zera i kosztuje minuty
— pracuj więc drabiną bramek, od najtańszej do najdroższej:

- **Prototypuj asercję poza kontenerem**, w lokalnym klonie
  `.repos/<nazwa>/`, aż działa. Pętla lokalna jest o rząd wielkości
  szybsza niż kontenerowa; do kontenera wchodzisz z gotową asercją,
  nie z hipotezą.
- **Wytwórz od razu komplet diffów**: wzorzec + warianty, które
  przewidujesz dla kalibracji rubryki (zwykle: naprawa częściowa /
  objawowa, poprawna naprawa z nadmiarowym zakresem, poprawna naprawa
  nieidiomatyczna). Kontekst repo masz otwarty raz — to moment, w którym
  warianty kosztują minuty zamiast osobnej sesji. Zapisz je od razu
  w `evaluation-pool/judge/<zadanie>-calibration/`.
- **Każdy diff przepuść przez tanie bramki**, zanim cokolwiek zmierzysz:
  aplikuje się na stan startowy → kompiluje się → przechodzi (lub nie)
  asercję zgodnie z twoim zamiarem. Diff, który wygląda dobrze i nie
  działa, jest gorszy niż jego brak.
- **Jedno wejście do kontenera na komplet materiału**, nie wywołanie per
  artefakt: `bench assert --task <nazwa> --patch wzorzec.diff --patch
  wariant-a.diff --patch pusty.diff` ocenia cały zbiór w jednym wejściu
  (pusty plik diffa = stan startowy). Jeśli mimo wszystko musisz wejść
  kilka razy, puść wywołania równolegle w tle i zbierz wyniki razem
  (pamiętając: brak wyjścia z komendy w tle to "jeszcze trwa" ALBO
  "padło bez słowa" — rozstrzygnij, zanim zbudujesz na tym wniosek).

Każda asercja przechodzi zasadę "testuj na referencji" (zasada 3):

| Stan | Oczekiwanie | Komenda |
|---|---|---|
| startowy (z overlayem) | miara pracy czerwona, guardy zielone | `bench assert --task <nazwa>` |
| wzorcowe rozwiązanie | wszystko zielone | `bench assert --task <nazwa> --patch <wzorzec.diff>` |

Wzorcowe rozwiązanie przygotuj sam (diff względem stanu startowego)
i zachowaj razem z wariantami kalibracyjnymi (patrz drabina bramek
wyżej) — bench-rubric zaczyna od tego zbioru zamiast od ponownego
wchodzenia w repo. Wyniki
zapisz w `reference` w task.yaml: guardy (lint/build) → `pass`, miary
pracy (ukryte testy) → `fail`. Pamiętaj o lekcji założycielskiej: asercja
musi sama instalować swoje zależności (etap oceny może używać sieci)
i nie może karać agenta za zastane problemy repo bazowego.

Dla składowej `judge/*`: rubrykę twórz/kalibruj skillem **bench-rubric**,
nie ręcznie w ramach tego skilla.

### 6. Wagi

Zaproponuj wagi z uzasadnieniem: co która składowa **faktycznie odróżnia**
w tym zadaniu. Składowa, która nie odróżnia dobrego wykonania od złego
(np. lint zielony niezależnie od jakości rozwiązania), dostaje wagę 0
albo wylatuje z `evaluation[]`. Suma wag = 1.

### 7. Samosprawdzenie

Kolejność jest celowo tania→droga: `validate` przed asercjami na
wzorcu, asercje przed sędzią, sędzia przed pełnym runem — pełny run jest
ostatni, bo tylko on wymaga wszystkiego naraz. Kolejno, każde musi
przejść zanim pójdziesz dalej:

1. `bench validate --assert` — zielone (deklaracje `reference` zgodne).
   Bramka obejmuje całą instancję — jeśli czerwień pochodzi z plików
   spoza twojego zakresu (zasada 5), zgłoś to użytkownikowi jednym
   zdaniem i czekaj na jego decyzję; nie "naprawiaj" cudzych plików,
   żeby uzyskać zieleń.
2. `bench assert --task <nazwa> --patch <wzorzec.diff>` — exit 0
   (zadanie jest wykonalne).
3. Pusty diff **nie może** dawać wyniku ≥ progu zaliczenia: stan startowy
   ma czerwoną miarę pracy (pkt 1) i — jeśli jest składowa judge —
   `bench judge --task <nazwa> --patch <pusty.diff>` daje niski wynik.
4. Próbny `bench run --smoke --tasks <nazwa> --models <tani-model>` +
   `bench evaluate` (budżet instancji pilnuje kosztów — zasada 6).
   Zadanie, którego nie da się przejść, albo które przechodzi się pustym
   diffem, wraca do kroku 3/5.

### 8. PR

Gałąź `bench-task/<nazwa>`, commit z katalogiem zadania + ewentualnymi
nowymi asercjami w puli. Opis PR-a wg [PR_TEMPLATE.md](PR_TEMPLATE.md) —
obowiązkowo sekcje: co zadanie mierzy, dowody z referencji (wyniki komend
z kroków 3/5/7), skutki dla porównywalności (zasada 7), koszt
samosprawdzenia. Wzorcowego rozwiązania **nie** commituj do `tasks/`
(przeciekłoby do workspace'u agenta) — jeśli ma zostać w repo, jego
miejsce to `evaluation-pool/judge/<zadanie>-calibration/`.

### 9. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan instancji
jednym zdaniem (co w PR, co niedokończone), **jedna** rekomendacja
z jednozdaniowym uzasadnieniem, maksymalnie dwie alternatywy z ceną,
oraz — oddzielnie — to, co czeka na decyzję człowieka (merge PR-a to
zawsze człowiek). Typowe przejścia:

- **Zadanie ze składową sędziego** → **bench-rubric na tej samej
  gałęzi, PRZED mergem** — kalibracja świeżej rubryki przed pierwszym
  użyciem nie zamyka ery; kalibracja po policzonych wynikach zamyka ją
  i unieważnia je.
- **Zadanie bez składowej sędziego** → merge + pełny run; przy jednym
  zadaniu w instancji — kolejne bench-task, bo ranking na jednym
  zadaniu to szum.
