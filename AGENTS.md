# Instrukcje dla agentów — bench-kit

To repo to **template benchmarku agentów AI** (`10x bench-kit init`
materializuje z niego instancję firmy; ten plik wędruje razem
z template'em i obowiązuje w każdej instancji). Instancja trzyma
zadania (`tasks/`), materiały oceny (`evaluation-pool/`)
i konfigurację (`bench.config.yaml`). Liczeniem zajmuje się
deterministyczny runner (`.bench-kit/` — strefa narzędzia, nie
edytuj); wszystkim, co wymaga osądu, zajmują się skille. Zanim
zrobisz cokolwiek wpływającego na scoring, użyj właściwego skilla —
każdy ma procedurę, twarde zasady i szablon PR-a.

## Skille i kiedy którego użyć

Kolejność odpowiada cyklowi życia instancji:

| Kolejność | Skill | Przeznaczenie | Kiedy |
|---|---|---|---|
| 1 | **bench-wiring** | Od świeżego `bench-kit init` do zielonego `bench validate` i pierwszej zmierzonej próby LOKALNIE: braki po init, silnik kontenerów, klucze API w env, smoke `bench attempt` + `bench evaluate`, commit wyników; opcjonalnie ścieżka publikacji (readiness + leaderboard w GHA) | raz, przy powstaniu instancji (i przy zmianach wiringu) |
| 2 | **bench-new-task** | Krótki wywiad → zlecenie zadania w backlogu (`tasks/backlog.md`); 5–10 zleceń w jednej sesji, bez budowania. Zlecenie nazywa **decyzję**, którą wynik rozstrzygnie, **klasę pracy** i jej **dzisiejszy koszt** (reguła 7); backlog porządkuje wartość decyzyjna, nie atrakcyjność zadania | cyklicznie, gdy pojawia się pomysł na zadanie |
| 3 | **bench-build** | Budowa zadań z oczekujących zleceń backlogu: subagent per zlecenie — pin + overlay + prompt + asercje + **rubryka zadania** (RUBRIC_AUTHORING.md: osie zlecenia → kryteria z kotwicami, reguły kciuka junior/senior/lead, checklista wad do wykrycia czytaniem, podłoga pustego diffu z `bench judge`) + wagi jako praca tekstowa (kontener tylko dla własnych dowodów: overlay, nowy guard), potem JEDNA bramka partii u orkiestratora (`bench validate --assert` + smoke + **kontrdowód dyskryminacji**: każda asercja ma zapisane, jak idzie na czerwono — inaczej waga 0, reguła 10) dowodzi stan startowy całej paczki; bez implementacji referencyjnej i bez zbioru kalibracyjnego — rubrykę kalibruje pierwszy realny bieg; gotowe pliki + raport-plik `reports/<zadanie>-build.md` w drzewie roboczym, git po stronie użytkownika | gdy w backlogu czeka paczka zleceń |
| 4 | **bench-rubric** | Cienkie proxy nad `bench calibrate`: stabilność sędziego API na rubryce zadania albo porównanie dwóch modeli sędziego — zbiór to REALNE zachowane próby (+ pusty diff), nic syntetycznego, żadnych edycji rubryk (wynik "rubryka źle rankuje" wraca jako edycja wg RUBRIC_AUTHORING.md + bump `version` + re-ocena zachowanych prób) | diagnostyka, nie krok cyklu: gdy werdykty na podobnych diffach są niestabilne albo przy wyborze/zmianie modelu sędziego; wymaga prób w `attempts/` |
| 5 | **bench-measure** | Bieg macierzy na tej maszynie: zakres modele × zadania × próby, projekcja kosztu vs budżet, `bench attempt` w tle (top-up zachowanych prób; wiele procesów naraz bez kolizji — marker próby w toku), `bench status` jako tracker, próby rozdzielane asymetrycznie (dużo tam, gdzie kosztują grosze; dowód istnienia i wyjście tam, gdzie kosztują dolary), ocena tego, co gotowe (rate-attempt / sędzia API), tabela wyników + ścieżki `results/` do commita, dalej bench-summary | „zmierz model X / uruchom benchmark" — każdy pomiar po wiringu |
| 6 | **rate-attempt** | Sędzia jako agent Z NARZĘDZIAMI: ocena zachowanej próby (`attempts/<zadanie>/<model>/trial-N/`) — guardy jako fakty, praca na jednorazowej kopii workspace'u W KONTENERZE (`bench shell --attempt`: build/testy/uruchomienie — cudzy kod nigdy na hoście), werdykt składany przez `bench evaluate --verdict` do `results/` | wołany z bench-measure per próba; przy re-ocenie zachowanych prób nową rubryką |
| 7 | **bench-refresh-task** | Odświeżenie przeterminowanego zadania: nowy pin, ponowne dowody, nowa era zadania | po warningu `expires` z `bench validate` |
| 8 | **bench-explain-results** | Diagnoza wyników: wina modelu / zadania / infrastruktury, z dowodami z zachowanych prób | po biegu, gdy wynik zaskakuje |
| 9 | **bench-summary** | Migawka decyzyjna nad `results/`: ekonomia liczona deterministycznie przez `summarize.mjs` (pass-rate z przedziałem, **koszt jednego akceptowalnego wyniku** = koszt próby ÷ pass-rate, koszt przeglądu diffu), samowystarczalna strona HTML z werdyktem + krótka narracja; remisy raportowane jako remisy (wybór po cenie), cele niezmierzone jako niezmierzone, nigdy jako zero; żadnych zmian w scoringu | po pomiarze / gdy trzeba wybrać model do klasy pracy („podsumuj wyniki", „czego używamy") |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu z dowodem i śladem** — rubryki i
  `bench.config.yaml` wychodzą wyłącznie przez PR; nowe zadania buduje
  bench-build jako pliki w drzewie roboczym z dowodami ze stanu
  startowego w raporcie-pliku `reports/<zadanie>-build.md`
  (REPORT_TEMPLATE.md skilla; raport wyłącznie w wiadomości czatu =
  raport nieistniejący) — **do gita wnosi
  je użytkownik**, skille nie commitują i nie pushują niczego.
- **Udowodnij na stanie startowym, zanim zaproponujesz** — asercja czy
  overlay bez dowodu z `bench assert` nie zostaje oddana (raport/PR);
  dowód dla tego, co wspólne dla paczki (guardy reużyte na pinie,
  `bench validate --assert`, smoke), składa raz orkiestrator
  bench-build na bramce partii — nie każdy subagent osobno.
  Benchmark nie utrzymuje implementacji referencyjnych: kierunek
  "da się zaliczyć" chroni zasada neutralności kształtu asercji
  (TASK_AUTHORING.md — skrypty to wyłącznie repo-natywne guardy
  wykonania; treść implementacji ocenia rubryka sędziego opisem
  dobrych i złych implementacji) i smoke run jako sonda wykonalności.
- **Świadomość er** — zmiany `task_hash`, rubryki lub sędziego zamykają
  erę porównywalności; raport/PR mówi to wprost.
- **Izolacja materiałów oceny** — nic z `evaluation-pool/` nie trafia
  do `tasks/` ani do workspace'u agenta.
- **Budżet zamiast rytuału zgody** — kosztów pilnuje
  `defaults.max_cost_usd`: sufit na CAŁY bieg macierzy (`bench attempt`
  robi projekcję z historii results/ przed startem i przerywa zlecanie
  po przekroczeniu); koszt faktyczny raportuje się po fakcie, a zgody
  człowieka wymaga tylko podnoszenie budżetu.
- **Próba opłacona jest święta** — zachowane próby (`attempts/`,
  kontrakt .bench-kit/ATTEMPT_FORMAT.md) są nienaruszalne i nigdy nie
  są wyrzucane; zmiana rubryki/sędziego to RE-OCENA zachowanych prób
  (`bench evaluate` / rate-attempt), nie nowy bieg. Wyniki żyją w
  `results/` w repo — commituje je użytkownik, historię wersjonuje git.
- **Bieg nie blokuje, tracker to dysk** — `bench attempt` zajmuje numer
  próby markerem `running.json` przed startem kontenera, więc kilka
  procesów (per model, w tle, na drugiej maszynie) dogania tę samą
  macierz bez kolizji; stan (zachowane / w toku / ocenione) czyta
  `bench status`, ocena bierze to, co skończone. Ocena z narzędziami
  biegnie tam, gdzie leży `workspace/`, i zawsze w kontenerze
  (`bench shell`).
- **Runner jest narzędziem** — stany "gotowe" potwierdza wyjście komend
  `bench` (`validate` / `assert` / `judge` / `attempt` / `evaluate`),
  nie deklaracja.
- **Zmiana w skillach = release** — każda pushowana zmiana w skillach
  (lub innej strefie współdzielonej template'u) dostaje bump wersji
  wg SemVer stosownie do wpływu (patch: doprecyzowanie w obrębie
  jednego skilla; minor: nowa struktura/procedura; major lub
  `[scoring-breaking]`: zmiana łamiąca schematy albo porównywalność
  wyników), wpis w `CHANGELOG.md` (neutralny / `[scoring-breaking]`),
  bump `.bench-kit/VERSION` (z tego pliku CLI czyta wersję template'u
  przy `bench-kit update` — nie z tagów), commit
  `chore(release): X.Y.Z — …` i tag `vX.Y.Z`. W repo template'u wydawaj
  **wyłącznie skryptem** `.github/scripts/release.mjs <wersja> "<opis>"`
  — robi walidację i wszystkie kroki atomowo; spójność
  VERSION↔CHANGELOG pilnuje też CI.

## Lokalne klony rep bazowych — `.repos/<nazwa>/`

Robocze klony rep bazowych żyją w `.repos/<nazwa>/` w korzeniu instancji
(katalog jest w `.gitignore` — nigdy nie trafia do repo instancji).
`10x bench-kit init` zwykle zostawia tam pierwszy klon wykrytego repo.

- **Klon jest domyślnie płytki** (`--depth 1`, sam HEAD): instancja
  startuje z pinem na HEAD, a skille autorskie czytają drzewo plików,
  nie historię. `10x bench-kit init --deep` klonuje z pełną historią od
  razu.
- **Gdy potrzebujesz historii** (diff między pinami, worktree na starym
  pinie), dobierz ją na miejscu: `git fetch --unshallow` albo
  `git fetch --deepen=<n>`, a dla jednego commita
  `git fetch origin <sha>`. Objaw brakującej historii to
  `fatal: bad object <sha>` / puste `git log <old>..<new>` — to nie
  zepsuty klon, tylko płytki.
- **Zanim sklonujesz repo bazowe gdziekolwiek** (scratchpad, /tmp),
  sprawdź `.repos/<nazwa>` — jeśli jest, użyj go; jeśli nie, sklonuj
  właśnie tam (URL z `base_repos` w bench.config.yaml; `--depth 1`, gdy
  nie potrzebujesz historii). W instancji z czasów przed tą konwencją
  dopisz najpierw `.repos/` do `.gitignore`.
- Klon może być nieświeży — przed decyzjami o pinie zrób
  `git fetch origin` i wybieraj commity **istniejące na remote**
  (runner robi własny płytki fetch z URL-a; lokalny stan nie wystarczy).
- Klon jest read-only wobec remote'a: eksperymentuj na lokalnych
  gałęziach/worktree, niczego nie pushuj (benchmark nigdy nie modyfikuje
  rep bazowych).

## Gdzie są skille

Katalog skilli zależy od narzędzia wybranego przy `bench-kit init`
(np. `.claude/skills/`, `.agents/skills/` — patrz `tool`
w `.bench-kit/instance.json`). Ten plik i skille są częścią strefy
współdzielonej: przy `bench-kit update` dostajesz propozycję diffu,
nie podmianę.
