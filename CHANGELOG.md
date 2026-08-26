# Changelog

Konwencja: każdy release (tag) dostaje wpis oznaczony jako **neutralny**
albo **`[scoring-breaking]`**. Release `[scoring-breaking]` zamyka erę
porównywalności wyników — dashboard nie miesza wyników sprzed i po takim
release. Zmiany łamiące schemat `task.yaml` lub `bench.config.yaml` zawsze
są `[scoring-breaking]` i wymagają noty migracyjnej.

## 0.20.0 — 2026-08-26 (neutralny)

**Zasada neutralności kształtu — koniec ukrytych testów
behawioralnych.** Ukryte testy szyte pod zadanie (montowane
z `$ASSERTION_DIR`, importujące moduły po ścieżkach/symbolach z planu,
odkrywające pliki agenta grepem, wymuszające środowisko jsdom) okazały
się w praktyce flaky u korzenia: zadanie wielo-plikowe ma wiele
poprawnych implementacji, a taki test mierzy "czy zakodowano tak, jak
wyobraził sobie autor", nie pracę — kanarki środowiska i dynamiczna
detekcja to były łaty na ten problem, nie rozwiązanie. Nowa doktryna:

- **Asercje skryptowe = wyłącznie repo-natywne guardy wykonania**
  (lint/typecheck/build/suita własnymi komendami repo bazowego).
  Wiążący papierek lakmusowy: dwie poprawne implementacje muszą
  dostać identyczny wynik z każdej asercji skryptowej. Jeden zestaw
  guardów per repo, współdzielony przez zadania.
- **Sędzia główną miarą treści implementacji** (domyślnie waga
  0.7–0.9): rubryka opisuje dobre i złe implementacje językiem
  zachowań; obowiązkowa **klauzula anty-nitpickingowa** (wybory
  pozostawione agentowi — układ plików, nazewnictwo, dekompozycja —
  nigdy nie są karane) i podział pracy z guardami (żadnych kryteriów
  wymagających uruchomienia kodu). `default-rubric` → v4 z klauzulą.
- **Overlay bugfixowy**: dwie ścieżki obserwowalności — guard-observed
  (suita repo czerwona na seedzie, kontrdowody jak dotąd) albo
  judge-observed (symptom buga verbatim w kryteriach rubryki; dowód =
  podłoga pustego diffa). Zakaz dowodzenia obserwowalności ukrytym
  testem.
- Procedury zaktualizowane spójnie: TASK_AUTHORING (krok 4 przepisany,
  self-check "shape-neutrality review" zamiast przeglądu odporności),
  REPORT_TEMPLATE, bench-new-task (osie jako zachowania), bench-rubric
  (trzy kontrakty rubryki), bench-refresh-task, bench-explain-results
  (diagnoza suspect-harness), README-y puli (`tests/` przepisane jako
  guard suity repo).

Runner bez zmian — schematy `check.yaml`/`task.yaml` te same; zmiana
jest proceduralna w skillach i konwencjach puli. Neutralny: nie
unieważnia policzonych wyników; bump `default-rubric` do v4 dotyczy
tylko zadań używających tej rubryki (w template — zadanie-demo).

## 0.19.1 — 2026-08-26 (neutralny)

**Niezawodny release: skrypt + bramka CI na spójność wersji.** Przy
0.19.0 tag i CHANGELOG poszły bez bumpu `.bench-kit/VERSION` — a to
z tego pliku (nie z tagów) CLI czyta wersję template'u, więc
`bench-kit update` odpowiadał "Already on template 0.18.0" i tag
trzeba było przesuwać siłą. Poprawki:

- **`.github/scripts/release.mjs <wersja> "<opis>"`** — jedyna
  wspierana ścieżka wydania: waliduje (semver, najnowszy wpis
  CHANGELOG == wersja, tag nie istnieje, gałąź master), bumpuje
  `.bench-kit/VERSION`, commituje, taguje i pushuje atomowo. Żyje
  w `.github/` — instancje go nie dostają.
- **CI (job check)**: bramka `.bench-kit/VERSION == najnowszy wpis
  CHANGELOG` na każdym pushu i PR — łapie dokładnie klasę rozjazdu
  z 0.19.0.
- **AGENTS.md**: reguła release'u wymienia bump `.bench-kit/VERSION`
  wprost i każe wydawać skryptem.

## 0.19.0 — 2026-08-26 (neutralny)

**Koniec implementacji referencyjnych — zadania definiują kryteria
oceny, nie diffy wzorcowe.** Dotychczas bench-build wymagał od
subagenta zaimplementowania całego zadania (reference.diff + warianty
kalibracyjne) jako materiału dowodowego i kalibracyjnego — przy dużych
zleceniach (kilkanaście plików, >1000 linii) nieutrzymywalne i zbędne
przy LLM-as-judge. Nowa doktryna: oczekiwania wobec przyszłych prób
wyraża **rubryka zbudowana z kryteriów oceny** (osie ze zlecenia:
do's/don'ts, mapa kamieni milowych) plus asercje **udowodnione na
stanie startowym**. Runner bez zmian — `reference:` w task.yaml zawsze
opisywał stan startowy, a sędzia czyta diff jako tekst; zmiana jest
wyłącznie proceduralna w skillach:

- **bench-build / TASK_AUTHORING.md**: zasada „you never implement the
  task"; dowody tylko ze stanu startowego; nowe **reguły odporności
  ukrytych testów** (test wyłącznie przez powierzchnie utrwalone
  verbatim w prompcie/planie, dynamiczne odkrywanie nazw wybieranych
  przez agenta, obowiązkowy kanarek środowiskowy); smoke run pełni
  rolę **sondy wykonalności** z regułą kwarantanny (asercja, której
  żadna próba nie zazielenia = suspect-harness, diagnoza lub waga 0 —
  nigdy obciążenie modeli); subagent oddaje **digest kryteriów**
  (greppowalne sygnały per oś) zamiast diffów kalibracyjnych.
- **Overlay bez zmian koncepcyjnych**; kontrdowód dla overlayi
  dodających pliki to teraz **sonda odwrotności buga** — minimalny,
  jednorazowy diff odsiewający seed (rozmiar ograniczony overlayem),
  wklejany do raportu i kasowany.
- **bench-rubric**: rubryka wyprowadzana z osi zlecenia; kalibracja na
  **zbiorze syntetycznym** wg nowego przewodnika `CALIBRATION_SET.md`
  (kanoniczny zestaw: empty / hard-violation / partial-milestone /
  complete-but-sloppy / complete-and-good; wiążące reguły realizmu —
  prawdziwe ścieżki i kontekst z repo na pinie; jeden diff = jedno
  pytanie; realne patch.diff z runów zastępują syntetyki z czasem).
- **bench-refresh-task**: bez portowania rozwiązania referencyjnego;
  przegląd odporności ukrytych testów przy każdym odświeżeniu.
- **bench-explain-results**: diagnoza asercji 0 przez sprawdzenie
  krzyżowe diffów prób zamiast odtwarzania reference.diff.
- **bench-new-task / BACKLOG_TEMPLATE**: oś oceny awansuje na
  **główne źródło gradingu** (dla dużych zadań z mapą faz dla
  partial credit).

Neutralny dla porównywalności: schematy i istniejące wyniki bez zmian;
zmienia się procedura budowy i kalibracji, nie definicje pomiaru.

## 0.18.0 — 2026-08-26 (neutralny)

**Archiwum workspace'u próby — `artifacts.workspace` w
`bench.config.yaml`** — dla wskazanych zadań każda próba zostawia
`workspace.tar.gz` (stan `/workspace` po pracy agenta, także po
timeoucie) obok `patch.diff` w katalogu próby; w CI archiwum jedzie
w istniejącym artefakcie `results-<slug>` joba próby. Cel:
obserwowalność — pobrać kod, który wyprodukował model, doinstalować
zależności, skonfigurować i uruchomić ręcznie, bez rekonstruowania
workspace'u z obrazu zadania i patch.diff.

Konfiguracja to mapa zadanie → opcje (`exclude`, default pomija
`node_modules`); wpis bez wartości = defaults. Ustawienie świadomie
żyje w `bench.config.yaml`, nie w `task.yaml`: nie jest częścią
definicji pomiaru, więc włączanie/wyłączanie nie zmienia `task_hash`
i nie zamyka ery porównywalności. Schemat configu rozszerzony
addytywnie (sekcja opcjonalna z defaults) — istniejące instancje
parsują się bez zmian; `bench validate` ostrzega o wpisach
wskazujących nieistniejące zadania. Zmiana `trial.sh` zmienia hash
obrazu bazowego w CI (jednorazowy rebuild + push do GHCR).

Decyzja o archiwum wchodzi też w cykl skilli: **bench-new-task** pyta
o nią w wywiadzie (pole opcjonalne z proponowanym defaultem — „tak"
dla zadań wartych ręcznego uruchomienia, „nie" gdy patch.diff mówi
wszystko; nowe pole `Workspace archive` w szablonie backlogu),
a **bench-build** — wyłącznie orkiestrator, nigdy subagenci (wspólny
plik a równoległość) — dopisuje wpis do `artifacts.workspace` po
przejściu zlecenia w `done` i raportuje to w sekcji „Next step".

## 0.17.1 — 2026-08-20 (neutralny)

Zmiana wyłącznie w skillu autorskim — bez wpływu na scoring, schematy
i runnera.

**bench-wiring: zakończenie jako checklista + jedno wezwanie do
działania** — luźna sekcja „Next step" ustępuje stałej strukturze
zamknięcia: potwierdzone fakty (każdy z dowodem od runnera), zmiany
wykonane w sesji (z plikiem), ponumerowane kroki użytkownika
w kolejności wykonania (modele w `bench.config.yaml` z podanymi
bieżącymi wartościami, zdalne repo, komendy `gh secret set`,
doładowanie konta providera przy płatnych modelach, decyzje czekające
na człowieka) i dokładnie jedno zdanie wezwania do działania.
Rekomendacja z alternatywami — jeśli jest — idzie nad checklisty, żeby
nie rozmywać finalnej prośby.

Dodatkowo w `AGENTS.md`: zasada „zmiana w skillach = release" — każda
pushowana zmiana strefy współdzielonej dostaje bump wersji wg SemVer
stosownie do wpływu, wpis w changelogu i tag.

## 0.17.0 — 2026-08-20 (neutralny)

Zmiana wyłącznie językowo-dokumentacyjna — bez wpływu na scoring,
schematy i runnera.

**Tłumaczenie na angielski** — wszystkie skille w `.agents/skills/`
(SKILL.md + szablony), README strefy skilli i główny README przechodzą
na angielski. Tłumaczenie idiomatyczne, nie 1:1 — workflow, kroki
i twarde zasady bez zmian merytorycznych. Ujednolicona terminologia:
order, guidance level (product-level / directional / surgical),
reference solution, task aging, precision ladder, model / task /
infrastructure fault. Placeholder-y w przykładach komend też po
angielsku (`wzorzec.diff` → `reference.diff`, `<nazwa>` → `<name>`).
Dodatkowo: sekcja Prerequisites w głównym README (użycie 10xCLI przez
npx) i drobne porządki w komentarzach `bench.config.yaml`
i zadania demo.

## 0.16.0 — 2026-08-20 (neutralny)

Zmiana wyłącznie w skillu autorskim — bez wpływu na scoring, schematy
i runnera.

**bench-wiring: podział na ścieżkę A (pierwszy czek) i ścieżkę B
(pierwszy run w CI)** — procedura rozjeżdża się na dwie części zamiast
jednej liniowej listy kroków. Ścieżka A ma budżet minuty i biegnie
lokalnie bez kontenerów: przeczytaj, co zrobił `bench-kit init`
(`instance.json`, `base_repos`, klon w `.repos/`, workflows),
uzupełnij **tylko** braki i zamknij temat zielonym `bench validate`.
Ścieżka B domyka pierwszy run: zdalne repo instancji, sekrety,
dispatch workflow `bench-run`, zielony run.

Dwie zasady rozdziału pracy stoją za tym podziałem: co zrobił init,
nie jest pracą wiringu (init odpalony z wnętrza repo produktowego sam
rejestruje repo bazowe, pinuje zadania-demo i klonuje), a co może
zrobić CI, nie jest pracą lokalnej maszyny (pierwszy run idzie przez
GH Actions z cache obrazów w GHCR). W konsekwencji brak silnika
kontenerów **nie blokuje** wiringu — lokalne kontenery są potrzebne
dopiero autorom zadań w `bench-build` (`bench assert`). Rozmowy
o modelach, sędzim i budżecie znikają z pierwszego czeku: co ma dobry
default w template, nie jest rozmową.

Dowodem wykonania jest teraz zielony run `bench-run` w CI, nie lokalny
smoke — PR_TEMPLATE wymaga linku do runu, a lokalny smoke jest
opcjonalny i jawnie oznaczony jako nietestujący sekretów repo. Wyjątek
z zasady 1 (commit na master świeżej instancji) dostał uzasadnienie:
`workflow_dispatch` wymaga workflowów na gałęzi domyślnej.

## 0.15.2 — 2026-08-18 (neutralny)

Zmiana wyłącznie w skillu autorskim — bez wpływu na scoring, schematy
i runnera.

**bench-explain-results: pytanie o źródło wyników na start** — nowy
krok 1 procedury pyta interaktywnie, czy diagnoza idzie z runu
lokalnego (`out/<run-id>/`), czy z CI; przy CI skill sam pobiera
artefakty (`gh run download`), a brak podanego id oznacza ostatni run
workflow `bench-run`. Gdy użytkownik wskazał źródło już w prośbie
(ścieżka, id, link, „ostatni run"), skill nie pyta, tylko potwierdza
wybór. Krok rozstrzyga też dwa przypadki brzegowe: wygasłe artefakty
(zostaje sam `bench-data/runs/<id>.json` → diagnoza kończy się na
poziomie raportu) i padnięty job `aggregate` (brak `report.json`, próby
czytane bez porównania z medianami). Pozostałe kroki przenumerowane
(1–7 → 2–8).

## 0.15.1 — 2026-08-18 (neutralny)

Zmiana wyłącznie w skillu autorskim — bez wpływu na scoring, schematy
i runnera.

**bench-wiring: jawne kroki dodania sekretów do zdalnego repo** —
checklista sekretów (krok 4) przy brakach wypisuje użytkownikowi gotową
komendę `gh secret set <NAZWA> --repo <owner/repo-instancji>` (lub
ścieżkę w UI) z jawnym rozróżnieniem, że sekret obecny tylko lokalnie
w env nie wystarczy workflowowi `bench-run`. PR_TEMPLATE analogicznie
wymaga komendy przy statusie „DO USTAWIENIA".

## 0.15.0 — 2026-08-18 (neutralny)

Zmiany wyłącznie w skillach autorskich — bez wpływu na scoring, schematy
i runnera. Rename przed szerszą adopcją instancji — bez aliasów wstecz.

**Rename skilli** — `bench-triage` → **`bench-explain-results`**
i `bench-refresh` → **`bench-refresh-task`**: katalogi, frontmatter
`name`, konwencja gałęzi (`bench-refresh-task/<nazwa>`), szablon
`TRIAGE_TEMPLATE.md` → `EXPLAIN_TEMPLATE.md` oraz wszystkie odwołania
krzyżowe (AGENTS.md, README stref, skille, komentarze runnera).
Historyczne wpisy changeloga zachowują stare nazwy.

**README strefy skilli zaktualizowane do stanu faktycznego** —
bench-refresh-task oznaczony jako dostępny (był „planowany"),
dopisany brakujący wpis bench-explain-results.

## 0.14.5 — 2026-08-18 (neutralny)

Zmiany wyłącznie w skillach autorskich — bez wpływu na scoring, schematy
i runnera.

**Smoke run warunkowy, bramka paczki zamiast rytuału** — krok 6.4
TASK_AUTHORING (próbny `bench run --smoke` + `bench evaluate`) wykonuje
się tylko, gdy sesja ma klucze API; bez sekretów subagent odnotowuje
odroczenie w raporcie i oddaje pracę, a jeden smoke wszystkich nowych
zadań paczki wykonuje się po przyjęciu plików, w środowisku z kluczami
(sekcja „Następny krok" bench-build). Bramki 6.1–6.3 (validate, wzorzec,
pusty diff) pozostają bezwarunkowe.

**Moc subagenta wg profilu zlecenia** — orkiestrator przy fan-oucie
obniża reasoning effort dla zleceń dokumentacyjnych/koncepcyjnych
(pełna procedura dowodowa bez zmian); zlecenia implementacyjne dostają
pełną moc.

## 0.14.4 — 2026-08-18 (neutralny)

Zmiany wyłącznie w skillach autorskich — bez wpływu na scoring, schematy
i runnera.

**Pin-kandydat od orkiestratora** — bench-build wyznacza przed
fan-outem pin-kandydata per repo bazowe (SHA + dowód zielonego CI)
i przekazuje go w promptach; subagent (TASK_AUTHORING) weryfikuje
tylko sens swojego zlecenia na kandydacie i może odstąpić
z uzasadnieniem w raporcie, zamiast przeglądać historię i CI od zera.

**Bramka środowiska oceny przed fan-outem** — orkiestrator doprowadza
środowisko (obraz `bench-base`, zależności runnera, docker) do stanu,
w którym `bench assert` na istniejącym zielonym zadaniu przechodzi,
zanim wystartują subagenci; awarie infrastrukturalne u subagenta to
odmowa z diagnozą w raporcie, nie samodzielna naprawa strefy wspólnej.

## 0.14.3 — 2026-08-18 (neutralny)

Zmiany wyłącznie w skillach autorskich — bez wpływu na scoring, schematy
i runnera.

**Oś oceny w zleceniu zadania** — wywiad bench-new-task pyta zawsze
o główną oś kalibracji rubryki (do's and dont's różnicujące oceny
w danym zadaniu); nowe pole **Oś oceny** we wpisie backlogu, a
bench-build (TASK_AUTHORING) traktuje je jako wiążące przy doborze
wariantów kalibracyjnych i przekazuje do bench-rubric.

**Chirurgiczne prompty przez subagenta** — przy poziomie naprowadzenia
*chirurgicznym* analizę repo bazowego z `.repos/` (ustalenie
plików/symboli do wpisu) bench-new-task wykonuje niezależnym
subagentem zamiast czytać repo w sesji wywiadu.

## 0.14.2 — 2026-08-17 (neutralny)

Refactor DX — artefakt dashboardu bajt w bajt bez zmian (poza źródłem).

**Frontend leaderboardu jako osobne pliki** — HTML/CSS/JS dashboardu
przeniesione z template literala w `leaderboard.ts` do
`runner/assets/leaderboard/` (`template.html`, `style.css`, `app.js`);
komenda skleja je w samowystarczalny `index.html` przez placeholdery.
Normalne podświetlanie i lintowanie frontendu, `app.js` testowalny
bezpośrednio w node. Tytuł strony jest teraz escapowany. Zero nowych
zależności; działa i z `src` (strip-types), i z `dist`.

## 0.14.1 — 2026-08-17 (neutralny)

Fix UI dashboardu — bez wpływu na scoring i schematy.

**Etykiety modeli bez kolizji** — na wykresie jakość vs koszt etykiety
punktów są rozmieszczane z detekcją kolizji (pozycje naprzemiennie
nad/pod punktem, łącznik przy odsunięciu); na trendzie median etykiety
końcówek serii są rozsuwane pionowo, a długie nazwy przycinane
z wielokropkiem (pełna nazwa w tooltipie). Przy okazji generowanie SVG
przepisane deklaratywnie (`el`/`chart`/`hGridLine`).

## 0.14.0 — 2026-08-17 (neutralny)

Benchmark stateless w obrębie ery scoringu + porządki na dashboardzie.
Scoring, stemple i schematy bez zmian — zmienia się tylko to, KTÓRE
komórki biegną i CO pokazuje dashboard.

**Skip-logic w `bench matrix`** — nowe flagi `--history <dir>`
(katalog raportów z gałęzi bench-data) i `--force`. Komórka
(model × zadanie), która w bieżącej — prospektywnej — erze ma już
w historii >= żądanej liczby prób, wypada z macierzy: dispatch
bench-run bez parametrów dogania tylko braki (nowe modele, zadania,
ery), zamiast palić budżet na re-runy. Prospektywny klucz ery liczy
się PRZED próbami z tych samych źródeł co stemple `bench evaluate`
(wspólny moduł `lib/era.ts` — jedno źródło prawdy dla evaluate,
report, leaderboard i matrix). Więcej prób niż w historii (top-up,
np. 3 → 5) = pełny re-run komórki od zera — próby między runami nie
są scalane. Workflow bench-run: nowy input `force`, job `plan`
pobiera gałąź bench-data (gdy istnieje), pusta macierz po
odfiltrowaniu pomija joby prób zamiast wywracać run.

**Dashboard tylko dla istniejących zadań** — `bench leaderboard`
dostał opcjonalny `--root <instancja>`: zadania nieobecne w `tasks/`
znikają z UI (historia zostaje na bench-data). Workflow leaderboard
przekazuje `--root` z workspace'u.

**Ranking przekrojowy modeli** — nad listą zadań zbiorcza tabela:
średnia nieważona median po bieżących erach zadań, śr. pass@1,
zaliczone zadania, pokrycie (X/Y zadań) i koszt pełnego przebiegu.
Przekrój idzie przez ery różnych zadań, więc UI opisuje go jako
orientację, nie pomiar.

## 0.13.0 — 2026-08-17 (neutralny)

Przyspieszenie runów CI ~3×: równoległe próby + obrazy przez GHCR.
Scoring, schematy i stemple ery bez zmian — kontener próby, limity
zasobów i punkt startowy patch.diff identyczne jak dotąd.

**Job per próba** — `bench matrix` emituje macierz model × zadanie ×
próba (flaga `--trials`, slug z sufiksem `--tN`), a `bench run` dostaje
`--trial-index n`: dokładnie jedna próba o numerze n (wyklucza się
z `--trials`/`--smoke`). Próby tej samej pary biegną równolegle w GH
Actions i składają się w komplet w `aggregate` — wall-clock runu spada
z trials × próba do ~1 × najdłuższa próba, przy tym samym koszcie
minut (billing per job-minuta). Lokalny `bench run` bez flagi działa
jak dotąd (sekwencyjnie). Uwaga: `defaults.max_cost_usd` odcina koszt
per wywołanie `bench run`, więc w CI działa teraz per próba, nie per
job z trzema próbami.

**Obrazy przez GHCR** — workflow loguje się do ghcr.io (GITHUB_TOKEN,
`permissions: packages: write`) i ciągnie obraz bazowy oraz obrazy
zadań po tagach-hashach treści (`.bench-kit/docker/**`, per zadanie
dodatkowo `tasks/<nazwa>/**`); zastępuje to docker save/load tar przez
actions/cache. Chybienie pull nie wywraca joba: runner buduje jak
dotąd, a job wypycha zbudowany obraz (push idempotentny,
continue-on-error). Nowa flaga `BENCH_REUSE_TASK_IMAGE=1` każe
runnerowi pominąć fetch + build obrazu zadania i czytać start-sha
z obrazu — kosztowny `task.prepare` (instalacja/build repo bazowego)
płacony raz per zmiana zadania, nie raz per job.

## 0.12.0 — 2026-08-17 (neutralny)

Przebudowa workflow autorstwa zadań: skill bench-task rozdzielony na
**bench-new-task** i **bench-build**; scoring i kontrakt asercji bez
zmian.

**bench-new-task** — krótki wywiad (jeden blok pytań na paczkę
pomysłów) kończy się zleceniem w stanowym backlogu `tasks/backlog.md`
zamiast pełną budową zadania: w jednej sesji można zdefiniować 5–10
zleceń bez czekania na piny, kontenery i samosprawdzenia. Backlog nie
wpływa na scoring (runner czyta w `tasks/` wyłącznie katalogi). Format
wpisu i cykl statusów (`pending` → `in-progress` → `done` /
`dropped`): BACKLOG_TEMPLATE.md w skillu.

**bench-build** — zamienia oczekujące zlecenia backlogu w zadania:
rozdziela je na subagentów (równolegle tylko przy izolowanych kopiach
repo, inaczej sekwencyjnie; wspólny fetch `.repos/` raz, przed
fan-outem), a każdy subagent wykonuje pełne dotychczasowe autorstwo —
pin, overlay, prompt, asercje, wagi, samosprawdzenie na referencji —
wg TASK_AUTHORING.md (dawna procedura bench-task, kroki po wywiadzie).
Orkiestrator pilnuje statusów w backlogu i raportuje zbiorczo; przy
pustym backlogu odsyła do bench-new-task.

**Zmiana zasady wyjścia dla nowych zadań: skille nie dotykają gita.**
bench-new-task i bench-build (wraz z subagentami) nie commitują, nie
tworzą gałęzi i nie pushują niczego — backlog to edytowany plik,
a zbudowane zadanie zostaje jako **pliki w drzewie roboczym** + raport
per zadanie z dowodami z referencji (REPORT_TEMPLATE.md w skillu,
dawny PR_TEMPLATE.md). Co dalej — commit, PR, review, odrzucenie —
decyduje wyłącznie użytkownik, na podstawie raportów. Rubryki
(bench-rubric), wiring i odświeżenia zadań (bench-refresh) dalej
wychodzą przez PR — zasada nadrzędna w AGENTS.md przeredagowana
z "zmiany scoringu wyłącznie przez PR" na "zmiany scoringu z dowodem
i śladem".

## 0.11.0 — 2026-08-17 (neutralny)

Warstwa narzędzia z OPTIMIZATION.md (N1–N3) — cięcie kosztu cyklu
autorstwa zadań; scoring i kontrakt asercji bez zmian.

**N1 — ciepłe środowisko oceny.** Kontenery oceny (`assert`,
`validate --assert`, `evaluate`) dostają trwały wolumen
`bench-deps-cache` z cache'ami menedżerów pakietów (npm/yarn/pnpm/
pip/uv/Playwright/XDG) — asercje dalej same instalują zależności,
ale instalacje trafiają w ciepły cache zamiast w zimną sieć.
Wyłączenie: `evaluation.deps_cache: false` w bench.config.yaml albo
`--no-deps-cache` per wywołanie. Kontenery próby agenta celowo cache'u
nie dostają. Drugi kierunek: opcjonalne pole `prepare` w task.yaml —
komenda bash zapiekana w obraz zadania na etapie `prepare` `bench run`
(raz na obraz, z siecią); jej artefakty są commitowane i start-sha
obrazu aktualizowany, więc nie zaśmiecają patch.diff. Agent też dostaje
przygotowany stan — jawna decyzja projektowa autora zadania.

**N2 — praca wsadowa i równoległość.** `bench assert` przyjmuje
`--patch` wielokrotnie: komplet diffów (wzorzec + warianty + pusty)
ocenia JEDNO wejście do kontenera — evaluate.mjs aplikuje każdy patch
na stan startowy, uruchamia komplet asercji i resetuje workspace
między patchami (katalogi zależności zostają, więc instalacja płaci
się raz na wsad); wynik per patch w `checks-batch.json`, patch
nieaplikowalny raportowany jako `patch_error`, nie wywrotka wsadu.
`bench calibrate` dostał `--parallel` (default 3) — werdykty rundy
lecą pulą o ograniczonej równoległości zamiast sekwencyjnie.

**N3 — wyjście maszynowe.** `--json` w `bench assert` (wyniki per
asercja / per patch) i `bench calibrate` (podsumowanie rundy: min/med/
max/rozrzut per diff, mediany kryteriów, koszt); postęp idzie wtedy na
stderr, stdout należy do struktury. `bench judge` wypisywał JSON już
wcześniej. Koniec parsowania tabelek w pętli „zmierz → porównaj →
zdecyduj" i klasy pomyłek „kod wyjścia zjedzony przez potok".

**N1 w CI — cache między runami GH Actions.** Wolumen
`bench-deps-cache` żyje tylko przez czas joba, a obraz bazowy budował
się od zera w każdym jobie macierzy. Workflow `bench-run` dostał:
(1) `actions/cache` na katalogu zależności ocen — runner wspiera
env `BENCH_DEPS_CACHE_DIR` (bind-mount katalogu hosta zamiast
nazwanego wolumenu), klucz per run z restore-keys po prefiksie, więc
cache akumuluje się między runami; (2) `docker save`/`load` obrazu
bazowego z kluczem `hashFiles('.bench-kit/docker/**')` — przy
trafieniu `BENCH_REUSE_BASE_IMAGE=1` każe runnerowi pominąć rebuild
(apt + `npm install -g opencode` raz per zmiana definicji obrazu,
nie raz per job). Świeżość gwarantuje klucz cache'u; lokalnie obu
env nie ustawiaj. Instancje dostają nowy workflow przy
`bench-kit update`.

**OOM (wada pomiaru z OOM.md) — warstwy 1–3.** Próby zabijane przez
OOM killer maszyny silnika wpływały do median jako wynik modelu, karząc
dokładnie te modele, które weryfikują swoją pracę. Zaadresowane:

- *Warstwa 1 (sygnał):* `bench doctor` sprawdza pamięć maszyny silnika
  kontenerów — WARN poniżej 4 GiB, BRAK gdy nie mieści skonfigurowanego
  limitu.
- *Warstwa 2 (jawny limit, stempel ery):* `resources.memory_mb` /
  `resources.pids_limit` w bench.config.yaml, nadpisanie per zadanie
  polem `memory_mb` w task.yaml. Limit obowiązuje w kontenerze próby
  ORAZ kontenerach oceny (`--memory` = `--memory-swap`, bez swapu),
  jest zapisywany w trial.json i stemplowany w result.json jako
  `stamps.memory_limit_mb` — zmiana pułapu zasobów zmienia miarę, więc
  nie może wyglądać jak poprawa modelu.
- *Warstwa 3 (klasyfikacja):* kody wyjścia 128+N bez timeoutu dostają
  mechanikę znaną z awarii providera — retry 1× (archiwum
  `signal-kill-attempt-1/`), a powtórka oznacza próbę jako
  nieinterpretowalną (`resource_kill` + `infra_failure` w trial.json →
  `bench evaluate` ją pomija, nie wlicza zera do median), zapisuje
  diagnostykę do `signal.json` (sygnał, hint, limit, ogon agent.log)
  i kończy run głośnym ostrzeżeniem oraz kodem 1. Kontener oceny przy
  kodzie sygnałowym nazywa sygnał i limit w komunikacie błędu.
- *Warstwa 4* to pole `prepare` (patrz N1): środowisko zapieczone
  w obraz usuwa główne źródło szczytu pamięci w próbie.

Nowy wiersz w tabeli objawów bench-triage (exit 137 / `signal.json`);
bench-wiring prowadzi przez ustawienie limitów. Rozstrzygnięcia
z OOM.md rozdz. 6 zapisane w dokumencie: kontener próby musi mieć sieć
(API providera), „offline" dotyczy materiału zadania.

Schematy: nowe pola `evaluation.deps_cache`, `resources.*` (config),
`prepare`, `memory_mb` (task.yaml) i `stamps.memory_limit_mb`
(result.json) są opcjonalne z defaultami — istniejące instancje
i wyniki przechodzą bez migracji. Skille bench-task / bench-rubric /
bench-refresh / bench-triage / bench-wiring odwołują się do nowych
możliwości.

## 0.10.1 — 2026-08-17 (neutralny)

Naprawa bootstrapu na macOS: CLI klonuje template do `mkdtemp(tmpdir())`,
a tam `/var/folders` jest symlinkiem do `/private/var` — Node rozwiązuje
symlinki w ścieżce entry (`import.meta.url`), więc guard „uruchomiony
jako skrypt" nie trafiał w surowe `argv[1]` i `main()` cicho nie
startował (pusty stdout → `bootstrap_failed: no parsable response`
w CLI). Guard porównuje teraz realpath obu stron; regresja pokryta
testem spawnu przez symlinkowaną ścieżkę.

## 0.10.0 — 2026-08-17 (neutralny)

Logika instancji przeniesiona z 10x-cli do kitu: nowy katalog
`.bench-kit/bootstrap/` (kontrakt v1) wykonuje `init`/`update`/`repair`
— żądanie JSON na stdin, odpowiedź JSON w ostatniej linii stdout.
Zasada podziału: **kit zna siebie, CLI zna maszynę użytkownika** —
CLI zostaje przy klonie template'u, wykryciu repo bazowego i profilu
narzędzia; strefy plików, manifest, rejestracja repo, pinowanie
zadań-demo i `git init` żyją w kicie. Najważniejszy skutek: `update`
wykonuje bootstrap z NOWEJ wersji kitu, więc template zmieniający układ
przywozi ze sobą własną migrację.

Przy okazji domknięty przeciek plików template-only: `.github/`
(self-test template'u), `benchkit.png` i `docs/` nigdy nie trafiają do
instancji — broni tego test w kicie (`.github/tests/`), nie w CLI.

Wymaga 10x-cli z obsługą kontraktu bootstrapu (starsze CLI init/update
nadal działa po staremu na starszych tagach). Zmiany nie dotykają
runnera ani scoringu istniejących zadań.

## 0.9.0 — 2026-08-16 (neutralny)

Konwencja lokalnych klonów rep bazowych: `.repos/<nazwa>/` w korzeniu
instancji (gitignorowane). `10x bench-kit init` (CLI ≥ wersji z tym
wsparciem) klonuje tam wykryte repo produktowe od razu przy tworzeniu
instancji, a skille bench-task / bench-refresh / bench-wiring używają
tego klonu zamiast klonować za każdym razem do scratchpada. Zasady
w AGENTS.md: sprawdź `.repos/` zanim sklonujesz gdziekolwiek, `git fetch
origin` przed wyborem pina (pin musi istnieć na remote), zero pushy.

Bench-task: wywiad jest teraz jawnie interaktywny (AskUserQuestion /
request_user_input) i pyta o **poziom naprowadzenia promptu**
(produktowy / kierunkowy / chirurgiczny) — decyzję, ile prompt zdradza
o miejscu zmiany, podejmuje użytkownik, nie agent; krok prompt.md
i szablon PR-a respektują wybrany poziom.

Zmiany nie dotykają runnera ani scoringu istniejących zadań.

## 0.8.0 — 2026-08-15 `[scoring-breaking]`

Wdrożenie safe defaults z przejścia pełnego cyklu instancji jako
konsument template'u 0.7.0 (IDEAS.md) — cięcie ręcznej roboty
i najdroższych błędów narzędzia. `SCORING_VERSION` 1 → 2.

- **Sędzia: koniec zerowania środka skali** (najdroższy znaleziony błąd):
  `judge.max_tokens` w bench.config.yaml (default 8192 zamiast stałych
  2048 — u sędziów z rozumowaniem reasoning liczy się do budżetu i limit
  ucinał JSON w połowie, systematycznie zerując diffy sporne
  i częściowe); dla OpenRouter `reasoning: { exclude: true }` +
  `usage: { include: true }`; **retry 1×** przy niepoprawnym JSON-ie
  (pierwsze podejście zostaje w judge.json — audyt nie cierpi); zapis
  `finish_reason` i `usage` w werdykcie ("model nagadał prozy" vs
  "ucięło na limicie" widać bez sondy do API).
- **Kontrakt zwięzłości w default-rubric (v3)**: zacznij od `{`,
  uzasadnienie jedno zdanie ≤ 150 znaków bez cudzysłowów i nowych linii,
  score jako pojedyncza liczba — na kalibracji 12/12 poprawnych
  werdyktów, rozrzut 0.000; ta wiedza jest uniwersalna, więc siedzi
  w template, nie w każdej firmie osobno.
- **Wersja rubryki per rubryka**: frontmatter `version` w rubryce;
  stempel `stamps.rubric_version` to `<rubryka>@<wersja>[+…]` liczone
  z rubryk faktycznie użytych przez zadanie ("none" bez składowej
  judge) — kalibracja rubryki otwiera nową erę tylko zadaniom, które
  jej używają, zamiast unieważniać całą instancję. `judge.rubric_version`
  w configu zostaje jako opcjonalny fallback legacy; `validate` zgłasza
  brak wersji (error) i legacy fallback (warning) — rozjazd configu
  z rubryką (0.7.0: config "1" vs rubryka v2) przestaje być możliwy.
- **`bench calibrate`** — pomiar rozdzielczości rubryki na zbiorze
  kalibracyjnym (`--task`, `--set`, `--repeats`, `--label`): min/med/max
  + rozrzut per diff, mediany per kryterium, koszt sędziego z usage,
  runda dopisywana do results.json zbioru; zastępuje bashową pętlę
  pisaną od nowa w każdej instancji. Skill bench-rubric zostaje przy
  osądzie (projekt zbioru, decyzja o iteracji).
- **`bench doctor`** — deterministyczna checklista środowiska (silnik
  kontenerów, node, zależności runnera, obecność kluczy — nigdy
  wartości, remote, workflows, klonowalność base_repos): tabela OK/BRAK
  z jednym zdaniem "co zrobić"; skill bench-wiring woła komendę zamiast
  odtwarzać prozę.
- **`bench run --smoke`** — 1 próba na pierwszym modelu z listy;
  sprawdzenie rur po wiringu bez dobierania flag.
- **Budżet zamiast rytuału zgody**: `defaults.max_cost_usd`
  w bench.config.yaml — `bench run` przerywa po przekroczeniu sumy
  kosztów prób; zgoda człowieka potrzebna przy podnoszeniu budżetu,
  nie przed każdym runem. Skille (task/rubric/wiring/refresh/triage,
  AGENTS.md) raportują koszt faktyczny zamiast negocjować szacunki.
- **Koszt sędziego widoczny**: `result.json.judge_cost_usd` (osobno od
  kosztu modelu), `report.json.total_judge_cost_usd` + kolumna
  `median_judge_cost_usd` — przy tanich modelach sędzia bywa
  porównywalną pozycją i "koszt na leaderboardzie" mylił.
- **`provider_error` + retry próby**: agent exit != 0 z 5xx/429
  w agent.log dostaje `provider_error: true` w trial.json i jeden retry
  (artefakty pierwszego podejścia w `provider-error-attempt-1/`) —
  awaria providera przestaje się wliczać do median jako pusta próba.
- **`static/lint` z detekcją package managera** po lockfile'u
  (pnpm/yarn/bun/npm) — realne monorepo nie traci składowej static
  z winy stacku; w README puli tests wzorzec **asercji zero
  zależności** (`node --test` z `$ASSERTION_DIR`).
- **Skille**: wyjątek "pierwsza konfiguracja bez PR-a" w bench-wiring
  jawnie obejmuje przepięcie zadania-demo; bench-wiring preferuje https
  dla publicznych repo (SSH wymusza klucz tam, gdzie https nie wymaga
  nic); bench-task ostrzega przed czytaniem `$?` po potoku; bench-triage
  zna `provider_error`.
- Release jest `[scoring-breaking]` (SCORING_VERSION → 2): zmienia się
  zachowanie sędziego (budżet tokenów, retry) i format stempla
  `rubric_version` — wyniki po adopcji otworzą nowe ery. Wsteczna
  zgodność schematów zachowana: stare result.json/report.json parsują
  się bez zmian (`judge_cost_usd` opcjonalne, legacy rubric_version
  spada na config).

## 0.7.0 — 2026-08-14 `[scoring-breaking]`

- **Stempel `scoring_version`** (fix
  [#1](https://github.com/przeprogramowani/10x-bench-kit/issues/1)):
  nowy plik `.bench-kit/SCORING_VERSION` (start: `1`), podbijany
  WYŁĄCZNIE przy release'ach `[scoring-breaking]`. `result.json`
  dostaje `stamps.scoring_version`; klucz ery w `bench report`
  i `bench leaderboard` używa `scoring_version` zamiast
  `template_version` — neutralne release'y template'u przestają
  rozdzielać ery na dashboardzie. `template_version` zostaje
  w stemplach jako informacja; meta ery na dashboardzie pokazuje
  "scoring vN" (era może obejmować wiele wersji template'u).
- **Wsteczna zgodność**: `scoring_version` jest opcjonalne w schemacie —
  wyniki i raporty sprzed tej wersji parsują się bez zmian, a ich klucz
  ery spada na `template_version`, więc historyczne ery się nie
  przetasowują. Zweryfikowane na realnej historii bench-data instancji
  referencyjnej + syntetycznych raportach (dwa neutralne bumpy przy tym
  samym scoringu → jedna era).
- Release jest `[scoring-breaking]`, bo zmienia grupowanie er: pierwszy
  run po adopcji otworzy nowe ery (klucz "1" zamiast wersji template'u)
  dla wszystkich zadań. Kolejne neutralne release'y już er nie ruszą —
  po to ta zmiana.

## 0.6.0 — 2026-08-14 (neutralne)

- **Skille `bench-refresh` i `bench-triage`** — komplet zestawu
  z SKILLS_DESIGN. `bench-refresh`: odświeżenie przeterminowanego
  zadania (nowy pin → werdykt sensowności → overlay i asercje ponownie
  na referencji → `expires` → PR = nowa era zadania; wycofanie zamiast
  sztucznego ratowania; zakaz zmian in-place asercji współdzielonych).
  `bench-triage`: diagnoza wyników runu (report → result → artefakty,
  tabela objaw→ścieżka), klasyfikacja wina modelu / zadania /
  infrastruktury, wyjście komentarz/issue — nigdy zmiana scoringu.
  Oba przetestowane odbiorczo na instancji referencyjnej (issue #8,
  PR #9).
- **`AGENTS.md`** w korzeniu template'u — instrukcje dla agentów
  pracujących w instancji: kolejność skilli (wiring → task → rubric →
  refresh → triage), przeznaczenie high-level, zasady nadrzędne.
  Wędruje z template'em do instancji; przy `update` synchronizowany
  jako propozycja diffu (strefa współdzielona, wsparcie w 10x-cli od
  PR #33).

Neutralne dla scoringu: żadnych zmian w runnerze, schematach ani
rubrykach.

## 0.5.0 — 2026-08-14 (neutralne)

- **Skille przeniesione do `.agents/skills/`** — mainstreamowa,
  tool-agnostyczna konwencja (jeden katalog czytany przez różne narzędzia
  agentowe). Bez symlinka kompatybilności: `10x bench-kit init`/`update`
  (od 10x-cli v1.14.0+) auto-wykrywają źródło skilli w template
  i materializują je w instancji pod ścieżką narzędzia wybranego przy
  `init` (`.claude/skills/` dla Claude Code itd., wybór w `instance.json`).
  Istniejące instancje: `update` zsynchronizuje skille pod dotychczasową
  ścieżką (domyślny profil claude-code) — nic do zrobienia ręcznie.
- Leaderboard: tabela i wykres jakość-vs-koszt bieżącej ery pokazują
  **najświeższy wynik per model** (unia modeli ze wszystkich runów ery),
  nie tylko wiersze ostatniego runu — rytuał "dispatch tylko z nowym
  modelem" nie chowa już starszych modeli; wiersze spoza najnowszego runu
  dostają stempel runu, z którego pochodzą. Zmiana czysto prezentacyjna
  (report.json bez zmian).

## 0.4.2 — 2026-08-14 (neutralne)

- Fix workflow `leaderboard`: przygotowanie gałęzi `bench-data` padało
  na drugim runie (`FETCH_HEAD` jest per-worktree — fetch w głównym
  worktree nie jest widoczny w `data/`); teraz jawny ref
  `refs/remotes/origin/bench-data`. Pierwszy run przechodził, bo szedł
  ścieżką orphan.

## 0.4.1 — 2026-08-14 (neutralne)

- Workflow `leaderboard`: opcjonalny deploy na **Cloudflare Pages** —
  aktywuje się, gdy instancja ma sekrety `CLOUDFLARE_API_TOKEN`
  (uprawnienie Cloudflare Pages: Edit) i `CLOUDFLARE_ACCOUNT_ID`;
  nazwa projektu z repo variable `CLOUDFLARE_PAGES_PROJECT` (default:
  nazwa repo), projekt tworzony automatycznie przy pierwszym deployu.
  Publikacja działa niezależnie od widoczności repo GitHuba — domyka
  lukę z 0.4.0 (GH Pages niedostępne dla prywatnych repo na darmowym
  planie). Bez sekretów krok jest pomijany; GH Pages i artefakt
  `leaderboard-site` bez zmian.

## 0.4.0 — 2026-08-14 (neutralne)

Leaderboard — pierwsza wersja z publikacją dashboardu. Zmiana neutralna
dla scoringu: nie dotyka wykonania prób, oceny ani schematów wyników.

- Nowa komenda `bench leaderboard --history <dir> [--out <dir>]
  [--title <s>]`: buduje statyczny dashboard z historii report.json
  (jeden plik = jeden run). Ery nigdy nie są mieszane — bieżącą erą
  zadania jest ta z najnowszym runem, starsze zostają widoczne jako
  historia. Widoki: tabela median (wynik + pass@1/pass@k + koszt/czas),
  jakość vs koszt (oś log), trend median między runami w obrębie ery.
  Samowystarczalny HTML (dane wbudowane, zero zależności sieciowych),
  tryb jasny i ciemny; obok ląduje data.json ze sklejoną historią.
- Realny workflow `leaderboard.yaml`: trwała historia raportów na
  gałęzi `bench-data` (`runs/<run_id>.json` — artefakty CI wygasają,
  gałąź nie), trigger po udanym bench-run + `workflow_dispatch`
  z backfillem z jeszcze żywych artefaktów, deploy na GitHub Pages.
  Pages wymaga repo publicznego albo płatnego planu — gdy niedostępne,
  deploy jest pomijany z warningiem, a dashboard zawsze zostaje
  artefaktem `leaderboard-site`.
- Nowy schemat `report.ts` (zod) — kontrakt report.json spisany jawnie
  (dotąd tylko implicit w `bench report`).

## 0.3.0 — 2026-08-13 `[scoring-breaking]`

`[scoring-breaking]` przez zmianę kontraktu sędziego i rubryki domyślnej:
adopcja rubryki z wagami we frontmatterze zmienia sposób liczenia
składowej judge (total liczy runner, nie model) — wyniki liczone starą
i nową ścieżką nie są porównywalne. Instancja, która zostaje przy
rubrykach bez frontmattera, zachowuje stary kontrakt (zmiana wstecznie
zgodna technicznie, era zamyka się przy adopcji rubryki).

- Total sędziego liczony przez runner: rubryka może deklarować wagi
  kryteriów we frontmatterze YAML (`weights:`, suma = 1) — wtedy
  `parseVerdict` liczy total z `criteria[*].score` (clamp do [0,1],
  brak kryterium = 0 z powodem), a arytmetyka modelu jest poza pętlą
  oceny (lekcja z kalibracji: "policz dokładnie" prowokowało wyrażenie
  zamiast liczby = niepoprawny JSON = 0). Nowe pole `total_source`
  (`runner`/`model`) w werdyktach (judge.json) rozróżnia tryby w audycie.
- `bench validate` dla rubryk z frontmatterem: wagi sumują się do 1,
  kryteria bloku formatu odpowiedzi pokrywają się z kluczami wag.
- `default-rubric` podbita do skalibrowanej v2 (correctness 0.6 /
  scope 0.25 / quality 0.15 + kotwice, z kalibracji na
  fix-auth-validation) z frontmatterem; format odpowiedzi bez `total`.
- Skill `bench-wiring` — od świeżego init do pierwszego zielonego runu:
  rozpoznanie stanu → repo bazowe → modele i sędzia → checklista
  sekretów (nazwy i obecność, nigdy wartości) → validate → smoke run
  (koszty jawne) → PR. Komplet skilli pierwszej fali poza odłożonymi
  bench-refresh/bench-triage.

Schemat `task.yaml` rozszerzony wstecznie zgodnie (nowe pole
opcjonalne) — `task_hash` zmienia się dopiero, gdy zadanie zadeklaruje
`reference`, co otwiera nową erę tylko tego zadania.

Enablery skilli (SKILLS_DESIGN): zasada "testuj na referencji, zanim
zaproponujesz" dostała tanie wejścia w runnerze.

- `bench assert` — pojedyncze asercje nie-LLM-owe z puli na referencji,
  bez pełnego cyklu próby: stan startowy (repo@pin + overlay + commit
  startowy) budowany na hoście i montowany do kontenera oceny (ten sam
  `evaluate.mjs`, wynik tożsamy z `bench evaluate`). Tryby `--task`
  (domyślnie wszystkie asercje nie-LLM-owe zadania, `--no-overlay` dla
  czystej referencji) albo `--repo`/`--commit` (+ `--overlay`);
  `--patch` nakłada diff (np. wzorcowe rozwiązanie). Exit 0 = wszystkie
  score 1, exit 1 = którakolwiek niżej — skill sprawdza oba kierunki.
- `bench judge` — pojedyncze wywołanie sędziego na zadanym diffie
  (`--task` + `--patch`, opcjonalnie `--rubric`, `--model` do porównań
  sędziów przy kalibracji); werdykty JSON na stdout, ta sama ścieżka
  co w `evaluate`. Fundament `bench-rubric`.
- `task.yaml`: opcjonalne pole `reference` — deklaracja oczekiwanego
  zachowania asercji nie-LLM-owych na stanie startowym (`pass` = guard,
  musi przechodzić na starcie; `fail` = miara pracy, ma nie przechodzić,
  inaczej zadanie przechodzi się pustym diffem).
- `bench validate`: spójność deklaracji `reference` (klucze ⊆
  `evaluation[]`, tylko nie-LLM-owe; ważona asercja bez deklaracji →
  warning) oraz nowa flaga `--assert` — weryfikacja referencyjna:
  zadeklarowane asercje biegną na stanie startowym, rozjazd z deklaracją
  = error. Domyka odłożoną część kontraktu `validate`; z deklaracją
  `static/lint: pass` obie lekcje pierwszego runu (brak `npm ci`,
  zastane błędy lintu referencji) zostałyby złapane przed CI.
- Refaktor wewnętrzny: wspólne `lib/containers.ts` (silnik, obraz
  bazowy) i `lib/reference.ts` (stan startowy, asercje na workspace)
  używane przez run / evaluate / assert / validate.

## 0.2.0 — 2026-08-13

Neutralny formalnie (0.1.0 nie liczyło jeszcze żadnych wyników — to
pierwsza wersja zdolna do scoringu, więc otwiera pierwszą realną erę
porównywalności).

- `bench validate` zaimplementowane: parsowanie schematami
  (bench.config.yaml, task.yaml), spójność referencji `evaluation[]`
  z evaluation-pool (rubryki judge muszą zawierać parsowalny format
  odpowiedzi), spójność wag z doborem asercji, sędzia ≠ modele oceniane,
  klonowalność repo bazowych i istnienie pinów (`--offline` pomija sieć),
  warning po `expires`.
- Asercja `static/lint` w evaluation-pool (używana przez zadanie-demo).
- `bench run` zaimplementowane: budowa obrazu bazowego + obrazów zadań
  (repo@pin + overlay + commit startowy zapieczone w obraz — próby bez
  sieci), próby w jednorazowych kontenerach (docker/podman) ze świeżym
  `XDG_DATA_HOME`, `opencode run` pod twardym timeoutem, artefakty per
  próba: `agent.log`, `patch.diff`, `metrics.json`, `execution.json`,
  `trial.json`. Sekrety wyłącznie przez env, nigdy w obrazie.
- Adapter metryk OpenCode (`adapter.mjs`): czyta SQLite
  (`opencode.db`), sumuje koszt/tokeny po sesjach, `duration_s` = czas
  sesji agenta; brak danych → `"incomplete": true`.
- Pin OpenCode podbity 0.6.4 → 1.18.3 (format storage SQLite, na którym
  opiera się adapter).
- `bench evaluate` zaimplementowane: asercje nie-LLM-owe (static → tests
  → e2e) w świeżym kontenerze z obrazu zadania — patch.diff nakładany na
  /workspace, asercje montowane :ro dopiero teraz; kontrakt `check.yaml`
  (schemat `schemas/check.ts`: score binary|fraction + lista komend,
  ASSERTION_DIR w env). LLM-as-judge host-side (anthropic/openrouter),
  brak poprawnego JSON-a = 0, surowa odpowiedź w judge.json. Wyjście:
  result.json ze stemplami er (template_version, task_hash = SHA-256
  katalogu zadania, judge_model, rubric_version).
- `bench validate` sprawdza też check.yaml asercji nie-LLM-owych.
- `bench report` zaimplementowane: mediana per (model × zadanie) dla
  total/kosztu/czasu, pass@k (estymator kombinatoryczny; próg "pass"
  w nowym opcjonalnym `defaults.pass_threshold`, domyślnie 0.7), koszt
  runu (na razie suma prób — `cost_scope: "trials"`), grupowanie w ery
  po krotce stamps → `report.json` dla dashboardu.
- Realny workflow `bench-run.yaml`: job `plan` (validate jako bramka +
  `bench matrix`), macierz per model × zadanie (próby sekwencyjnie
  w jobie — obraz zadania budowany raz), `run` + `evaluate` per job,
  `aggregate` scala artefakty i robi `report`. Leaderboard nadal jako
  artefakty CI (dashboard świadomie odłożony).
- Nowa komenda `bench matrix` — helper CI wypisujący macierz jobów.
- `10x bench-kit init` kopiuje `.bench-kit/workflows/` do
  `.github/workflows/` (zmiana po stronie 10x-cli, PR #30).

## 0.1.0 — 2026-08-13

Neutralny — pierwsza wersja, brak wcześniejszej ery.

- Szkielet trzech stref: `.bench-kit/`, `.claude/skills/`, strefa firmy
  (`tasks/`, `evaluation-pool/`, `bench.config.yaml`).
- Schematy kontraktów (zod): `task.yaml`, `bench.config.yaml`, `result.json`.
- Runner jako stuby komend (`run`, `evaluate`, `validate`, `report`) —
  implementacja w kolejnych wersjach.
- Zadanie-demo `tasks/demo-hello-bench/` (smoke test struktury).
