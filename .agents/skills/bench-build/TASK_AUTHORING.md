# TASK_AUTHORING — procedura subagenta bench-build

Jesteś subagentem bench-build. Dostałeś **zlecenie** — wpis
z `tasks/backlog.md` z podjętymi decyzjami projektowymi (typ, repo
bazowe, poziom naprowadzenia, trudność/timeout, opis, notatki).
Budujesz z niego katalog `tasks/<nazwa>/` w instancji benchmarku.
Zadanie ma być mierzalne, nieprzechodzalne pustym diffem i sprawdzone
na referencji przed oddaniem. Naczelna zasada: **niczego nie oddajesz,
czego sam nie uruchomiłeś na wersji referencyjnej** — do
tego służą `bench assert`, `bench judge` i `bench validate --assert`
(patrz "Narzędzia" niżej).

**Nie prowadzisz wywiadu i nie zmieniasz decyzji ze zlecenia.** Jeśli
zlecenie ma lukę uniemożliwiającą budowę (brak decyzji, która zmienia
co zadanie mierzy; zadanie bez sensu na aktualnym repo; bug
nieobserwowalny mimo powrotu do projektowania) — przerwij i zakończ
raportem odmowy z powodem. Odmowa z diagnozą jest lepsza niż zadanie
zbudowane na domysłach.

## Twarde zasady

1. **Zero gita.** Nie commitujesz, nie tworzysz gałęzi, nie pushujesz,
   nie stage'ujesz — żadnych komend `git` wobec repo instancji.
   Wyjściem twojej pracy są **pliki w drzewie roboczym** + raport wg
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) z dowodami z referencji;
   co z nimi dalej (commit, PR, review), decyduje użytkownik. Rubryki
   i `bench.config.yaml` to NIE twój zakres (bench-rubric /
   bench-wiring). Backlogu (`tasks/backlog.md`) nie dotykasz w ogóle —
   statusami zarządza orkiestrator.
2. **Izolacja materiałów oceny.** Nic z `evaluation-pool/` nie może być
   skopiowane ani zreferowane w `tasks/<nazwa>/` (jedyny wyjątek: wpisy
   `evaluation: [...]` w task.yaml). `prompt.md` nie może zdradzać, jak
   zadanie będzie oceniane, ani cytować ukrytych testów.
3. **Testuj na referencji, zanim zaproponujesz.** Każda asercja przed
   oddaniem musi być uruchomiona przez `bench assert` i zachować
   się zgodnie z intencją — na stanie startowym ORAZ na wzorcowym
   rozwiązaniu. Deklarujesz to w `reference` w task.yaml.
4. **Runner jest twoim narzędziem.** Nie reimplementuj jego logiki, nie
   oceniaj "na oko" — wołaj komendy `bench` i czytaj ich wyjścia. Jeśli
   czegoś brakuje runnerowi, zgłoś to (issue), nie obchodź.
5. **Pracuj wyłącznie w swoim zakresie**: `tasks/<nazwa>/` budowanego
   zadania + nowe asercje w `evaluation-pool/`. Niczego poza tym nie
   edytuj — w szczególności `.bench-kit/` (strefa narzędzia), backlogu
   i katalogów innych zadań (inne subagenty mogą budować równolegle
   obok ciebie). Stan reszty repo to nie twoja sprawa: jeśli w drzewie
   roboczym są niezacommitowane zmiany w plikach spoza twojego zakresu,
   **zostaw je bez zmian** — nie przywracaj, nie revertuj, nie
   diagnozuj i nie komentuj; twoja lista plików w raporcie obejmuje
   wyłącznie to, co sam utworzyłeś lub zmieniłeś.
6. **Budżet zamiast rytuału zgody.** Kosztów pilnuje
   `defaults.max_cost_usd` w bench.config.yaml (runner przerywa run po
   przekroczeniu) — nie pytaj o zgodę przed próbnym runem czy
   wywołaniem sędziego; koszt faktyczny (z `metrics.json` / usage
   sędziego) podasz w raporcie końcowym.
7. **Świadomość er.** Każda zmiana `tasks/<nazwa>/` zmienia `task_hash`
   tego zadania (nowa era). Raport musi to mówić wprost — sekcja
   "Skutki dla porównywalności" w szablonie raportu.
8. **`.repos/` bez fetchowania.** Klony przygotował orkiestrator przed
   fan-outem; równoległe fetche ścigają się o locki gita. Korzystasz
   z klonu read-only (lokalne gałęzie/worktree do eksperymentów są OK);
   jeśli klonu brakuje, zgłoś to w raporcie zamiast klonować obok
   innych subagentów.

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
  `bench evaluate --run <dir>` — próbny pełny cykl (krok 6).

## Procedura

### 1. Pin

Wybierz konkretny commit repo bazowego: świeży, ale stabilny —
najlepiej ostatni zielony na CI. Repo przeglądaj w lokalnym klonie
`.repos/<nazwa>/` (przygotowanym przez orkiestratora — zasada 8);
wybieraj commity **istniejące na remote** (runner robi własny płytki
fetch z URL-a). Zweryfikuj, że zlecenie ma na nim sens: przejrzyj repo
na tym commicie, sprawdź że pliki, których zadanie dotyczy, istnieją,
a projekt się buduje. Pełny SHA (40 znaków) do `task.yaml`.

### 2. Overlay (zadania typu "napraw")

Buga **wprowadzasz sam** jako pliki w `tasks/<nazwa>/overlay/` (nadpisują
pliki repo przy starcie próby), zgodnie z opisem buga ze zlecenia.
Wymóg: bug musi być **obserwowalny** — istnieje asercja, która go łapie:

- na stanie startowym (z overlayem) asercja **czerwona** —
  `bench assert <ref> --task <nazwa>` → exit 1,
- kontrdowód, że czerwień pochodzi z buga, nie z zepsutej asercji:
  - overlay **modyfikuje** istniejące pliki → na czystej referencji
    zielona: `bench assert <ref> --task <nazwa> --no-overlay` → exit 0,
  - overlay **dodaje** nowe pliki (na czystej referencji asercja nie ma
    czego testować) → kontrdowodem jest wzorcowe rozwiązanie:
    `bench assert <ref> --task <nazwa> --patch <wzorzec.diff>` → exit 0.

Jeśli nie umiesz pokazać obu wyników, bug jest nieobserwowalny albo
asercja zła — wróć do projektowania; jeśli i to nie pomaga, odmów
z diagnozą (patrz nagłówek). Overlay ma być minimalny: seed buga,
nie przebudowa projektu.

### 3. prompt.md

Pisz jak zlecenie dla człowieka: cel, kontekst, granice ("nie zmieniaj
niczego poza…") — na poziomie naprowadzenia **zadeklarowanym
w zleceniu**: *produktowy* opisuje wyłącznie objaw/cel, *kierunkowy*
może nazwać obszar, *chirurgiczny* może wskazać pliki/symbole.
Niezależnie od poziomu zakazane: podpowiadanie rozwiązania, wskazywanie
linii do zmiany, jakiekolwiek przecieki z materiałów oceny (zasada 2).
Prompt to **jedyne** wejście agenta — wszystko, czego nie napiszesz,
agent musi wywnioskować z kodu.

Dopisz do granic promptu **oczekiwanie wobec weryfikacji** — spójne
z polityką ustaloną w wiringu instancji: czy agent ma weryfikować pracę
uruchomieniem projektu/testów, czy ma tego nie robić. Prompt, który tego
nie mówi, zostawia agentowi kosztowną decyzję, a tobie niejednoznaczne
wyniki: jeden model kończy w kilkanaście sekund bez sprawdzenia, drugi
zużywa minuty i zasoby na uruchomienie projektu — mierzysz wtedy
temperament, nie umiejętność.

### 4. Asercje

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
nie ręcznie w ramach tej procedury.

### 5. Wagi

Zaproponuj wagi z uzasadnieniem: co która składowa **faktycznie odróżnia**
w tym zadaniu. Składowa, która nie odróżnia dobrego wykonania od złego
(np. lint zielony niezależnie od jakości rozwiązania), dostaje wagę 0
albo wylatuje z `evaluation[]`. Suma wag = 1.

### 6. Samosprawdzenie

Kolejność jest celowo tania→droga: `validate` przed asercjami na
wzorcu, asercje przed sędzią, sędzia przed pełnym runem — pełny run jest
ostatni, bo tylko on wymaga wszystkiego naraz. Kolejno, każde musi
przejść zanim pójdziesz dalej:

1. `bench validate --assert` — zielone (deklaracje `reference` zgodne).
   Bramka obejmuje całą instancję — jeśli czerwień pochodzi z plików
   spoza twojego zakresu (zasada 5; przy równoległej budowie może to
   być niedokończona praca innego subagenta), odnotuj to w raporcie
   jednym zdaniem i nie "naprawiaj" cudzych plików, żeby uzyskać
   zieleń.
2. `bench assert --task <nazwa> --patch <wzorzec.diff>` — exit 0
   (zadanie jest wykonalne).
3. Pusty diff **nie może** dawać wyniku ≥ progu zaliczenia: stan startowy
   ma czerwoną miarę pracy (pkt 1) i — jeśli jest składowa judge —
   `bench judge --task <nazwa> --patch <pusty.diff>` daje niski wynik.
4. Próbny `bench run --smoke --tasks <nazwa> --models <tani-model>` +
   `bench evaluate` (budżet instancji pilnuje kosztów — zasada 6).
   Zadanie, którego nie da się przejść, albo które przechodzi się pustym
   diffem, wraca do kroku 2/4.

### 7. Oddanie pracy

Zostaw komplet plików w drzewie roboczym: katalog zadania + ewentualne
nowe asercje w puli + zbiór kalibracyjny. Nic w gicie (zasada 1) —
o commicie/PR-rze decyduje użytkownik. Wzorcowego rozwiązania **nie**
zostawiaj w `tasks/` (przeciekłoby do workspace'u agenta) — jego
miejsce to `evaluation-pool/judge/<zadanie>-calibration/`.

### 8. Raport końcowy

Twoje wyjście czyta orkiestrator bench-build. Zwróć raport wg
[REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) — nazwa zadania, pełna lista
utworzonych/zmienionych plików, co zadanie mierzy, dowody z referencji
(wyniki komend z kroków 2/4/6 — per punkt: komenda → wynik), asercje
i wagi, skutki dla porównywalności (zasada 7), koszt faktyczny (próbny
run, wywołania sędziego). Do tego:

- **odmowa** + powód zamiast raportu, gdy zlecenie okazało się
  niewykonalne (patrz nagłówek);
- czy zadanie ma składową `judge/*` (orkiestrator zarekomenduje
  bench-rubric przed pierwszym runem);
- problemy poza twoim zakresem, jeśli je zauważyłeś (bez naprawiania).
