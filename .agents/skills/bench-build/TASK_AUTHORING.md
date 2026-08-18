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
8. **`.repos/` jest read-only i współdzielony.** Klony przygotował
   orkiestrator przed fan-outem; nie fetchujesz i nie klonujesz —
   równoległe fetche ścigają się o locki gita. Obok ciebie budują
   równolegle inne subagenty na tym samym klonie, więc nie ruszasz
   stanu współdzielonego: żadnego checkoutu na wspólnym HEAD ani
   operacji na wspólnym indeksie. Gdy potrzebujesz drzewa na pinie,
   zrób `git worktree add` pod nazwą zawierającą nazwę twojego zadania
   i pracuj wyłącznie tam; sporadyczny `index.lock` po prostu ponów.
   Jeśli klonu brakuje, zgłoś to w raporcie zamiast klonować obok
   innych subagentów.
9. **Postęp raportujesz na bieżąco w `tasks/<nazwa>/todo.md`.** To
   jedyny kanał podglądu twojej pracy w toku — orkiestrator
   i użytkownik czytają go, zanim wrócisz z raportem. Tworzysz go jako
   pierwszą czynność (krok 0 procedury), aktualizujesz bezpośrednio po
   każdym kroku (nie zbiorczo na końcu), a przy oddaniu pracy usuwasz:
   `task_hash` liczy się ze **wszystkich** plików katalogu zadania,
   więc pozostawiony plik roboczy wszedłby na stałe w tożsamość ery.

## Narzędzia runnera

Uruchamiane z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

Środowisko oceny (obraz `bench-base`, zależności runnera, docker)
przygotował i sprawdził orkiestrator przed twoim startem. Jeśli mimo
to komenda `bench` pada z powodów infrastrukturalnych (build obrazu,
sieć/TLS, docker), zgłoś to w raporcie i odmów, zamiast naprawiać
środowisko — to strefa wspólna paczki, a twoja naprawa wyścigałaby
się z sąsiadami budującymi równolegle.

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

### 0. Plan pracy — todo.md

Zanim cokolwiek zbudujesz, utwórz `tasks/<nazwa>/todo.md` (razem
z katalogiem zadania, jeśli jeszcze nie istnieje): checklista kroków
tej procedury, którą będziesz odhaczać w trakcie pracy:

```markdown
# <nazwa> — postęp budowy
- [ ] 1. Pin
- [ ] 2. Overlay (zadania typu "napraw")
- [ ] 3. prompt.md
- [ ] 4. Asercje (+ diffy kalibracyjne)
- [ ] 5. Wagi
- [ ] 6. Samosprawdzenie
- [ ] 7. Oddanie pracy
```

Aktualizuj go **bezpośrednio po każdym kroku** (zasada 9): odhaczenie
plus jedno-dwa zdania konkretu — wybrany SHA, nazwy zbudowanych
asercji, wynik `bench assert`. W krokach długich (asercje,
samosprawdzenie) dopisuj także w trakcie, po każdej domkniętej
bramce, a problemy i decyzje notuj w momencie ich podjęcia. Ten plik
czyta na żywo orkiestrator i użytkownik — ma opisywać stan faktyczny,
nie plan; wpis wsteczny uzupełniony tuż przed raportem mija się
z celem.

Przy oddaniu pracy (krok 7) todo.md **usuwasz** — także przy odmowie
(wtedy usuń również katalog zadania, jeśli nic poza todo.md w nim nie
powstało). Wszystko, co ma przetrwać, należy do raportu końcowego.

### 1. Pin

Orkiestrator podał ci w prompcie **pin-kandydata** (SHA + dowód
zielonego CI) dla repo bazowego — nie powtarzaj jego pracy: nie
przeglądasz historii i nie odpytujesz CI od zera. Twoja część to
weryfikacja, że **twoje zlecenie** ma na tym commicie sens: przejrzyj
repo na tym commicie (klon `.repos/<nazwa>/`, stan na pinie przez
worktree — zasada 8), sprawdź, że pliki, których zadanie dotyczy,
istnieją, a projekt się buduje. Pasuje → pełny SHA (40 znaków) do
`task.yaml`. Nie pasuje (np. obszar zadania świeżo przebudowany) →
wybierz inny commit i **uzasadnij odstępstwo w raporcie**.

Gdy kandydata w prompcie nie ma, wybierz sam: świeży, ale stabilny —
najlepiej ostatni zielony na CI. Zawsze wybieraj commity **istniejące
na remote** (runner robi własny płytki fetch z URL-a).

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

Asercje są wspólne dla wielu zadań, więc **reużycie rozstrzyga
orkiestrator przed twoim startem**: masz w prompcie inwentarz puli
i decyzję — co reużyć pod konkretną nazwą, co zbudować jako nowe i pod
jakim prefiksem nazwy. Trzymaj się jej. Ponowny skan `evaluation-pool/`
w trakcie pracy niczego nie rozstrzyga: obok ciebie budują inne
subagenty i pula zmienia się pod tobą, a asercja, której jeszcze nie
widzisz, może już powstawać. Jeśli w trakcie okaże się, że decyzja nie
pasuje (asercja wskazana do reużycia nie mierzy tego, czego trzeba;
potrzebujesz asercji spoza rozstrzygnięcia) — zbuduj własną pod swoim
prefiksem i **zgłoś rozbieżność w raporcie**, żeby orkiestrator mógł
domknąć ewentualny duplikat; nie scalaj i nie edytuj cudzych asercji.
Nowe twórz **w puli** (katalog
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
  przewidujesz dla kalibracji rubryki. Jeśli wpis zlecenia ma pole
  **Oś oceny**, to ono jest wiążące: warianty mają rozciągać skalę
  wzdłuż tej osi (np. oś "minimalny diff" → wariant poprawny, ale
  rozlazły), a zadeklarowane do's and dont's trafiają do materiału
  dla rubryki. Bez osi w zleceniu dobierz warianty sam (zwykle:
  naprawa częściowa / objawowa, poprawna naprawa z nadmiarowym
  zakresem, poprawna naprawa nieidiomatyczna). Kontekst repo masz otwarty raz — to moment, w którym
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
nie ręcznie w ramach tej procedury; pole **Oś oceny** ze zlecenia
przekaż tam jako punkt wyjścia kryteriów.

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
   `bench evaluate` (budżet instancji pilnuje kosztów — zasada 6) —
   **o ile sesja ma klucze API dostawców**. Gdy kluczy nie ma, nie
   obchodź tego i nie traktuj jak porażki: odnotuj w raporcie „smoke
   odroczony — brak sekretów w sesji" i oddaj pracę; próbny run
   wszystkich nowych zadań paczki wykona się tam, gdzie sekrety są,
   po przyjęciu plików przez użytkownika (bramka paczki
   u orkiestratora, nie rytuał per zadanie). Punkty 1–3 pozostają
   bezwarunkowe.
   Zadanie, którego nie da się przejść, albo które przechodzi się pustym
   diffem, wraca do kroku 2/4.

### 7. Oddanie pracy

Zostaw komplet plików w drzewie roboczym: katalog zadania + ewentualne
nowe asercje w puli + zbiór kalibracyjny. Nic w gicie (zasada 1) —
o commicie/PR-rze decyduje użytkownik. Wzorcowego rozwiązania **nie**
zostawiaj w `tasks/` (przeciekłoby do workspace'u agenta) — jego
miejsce to `evaluation-pool/judge/<zadanie>-calibration/`. Na koniec
usuń `tasks/<nazwa>/todo.md` (zasada 9) — plik postępu to kanał
podglądu na czas budowy, nie część zadania; pozostawiony wszedłby
w `task_hash`.

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
