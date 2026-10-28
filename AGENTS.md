# Instrukcje dla agentów — bench-kit

To repo to **template benchmarku agentów AI** (`10x bench-kit init`
materializuje z niego instancję firmy; ten plik wędruje razem
z template'em i obowiązuje w każdej instancji). Instancja trzyma
zadania (`tasks/`), materiały oceny (`evaluation-pool/`)
i konfigurację (`bench.config.yaml`). Liczeniem zajmuje się
deterministyczny runner (`.bench-kit/` — strefa narzędzia, nie
edytuj); wszystkim, co wymaga osądu, zajmują się trzy skille:
create task → evaluate → analysis. Zanim
zrobisz cokolwiek wpływającego na scoring, użyj właściwego skilla —
każdy ma procedurę i twarde zasady, a tam, gdzie jego wynik ma
utrwaloną formę, także jej szablon (raport budowy, opis PR-a, diagnoza).

## Trzy koncepty, trzy skille

Cały cykl instancji to trzy skille. Każdy ładuje swoje szczegółowe
procedury (pliki obok SKILL.md) dopiero, gdy są potrzebne:

| Koncept | Skill | Przeznaczenie | Procedury |
|---|---|---|---|
| **status** — czy instancja jest gotowa | **bench-status** | Punkt wejścia: maszyna, klucze, repo bazowe, modele i sędzia, zielony `bench validate`, rozgrzanie obrazu bazowego w tle; gdy wszystko zielone — brief instancji (co testujemy, na jakich modelach, sędzia, budżet, wyniki); jeden kolejny krok. Bez zadania-demo — pierwszym dowodem toru kontenerów jest pierwsze prawdziwe zadanie | `SKILL.md` |
| **create task** — co mierzymy | **bench-create-task** | Zadania z prawdziwej pracy firmy, w krótkiej rozmowie. Użytkownik wskazuje PR/commit → skill go znajduje i potwierdza; nie wskazuje nic → tani subagent (klasa Sonnet/Flash) przegląda ostatni kwartał historii i proponuje 3–5 kandydatów (bugfix, feature, refaktor), użytkownik wybiera wszystkie, część albo coś innego. Zmergowana zmiana z testami staje się zadaniem. Pin to rodzic zmiany, testy zmiany to ukryty guard fail-to-pass, a kod zmiany to referencja, której agent nie widzi. Zlecenia trafiają do `tasks/backlog.md` z decyzją i klasą; budowa jest statyczna (pliki zadania, rubryka, raport `reports/<zadanie>-build.md`, zielony `bench validate`) — bez kontenerów, sędziego i prób | `MINING.md` + `mine-prs.mjs`, `BUILD.md` + `RUBRIC_AUTHORING.md` (subagent per zlecenie), `BACKLOG_TEMPLATE.md`, `REPORT_TEMPLATE.md` |
| **evaluate** — uruchamiamy i oceniamy modele | **bench-evaluate** | Dowód nowych zadań na pinie (`bench validate --assert`) przed pierwszą próbą, bieg macierzy modele × zadania × próby z projekcją kosztu, zachowane próby z top-upem, ocena `bench evaluate` (guardy + sędzia API na diffie), przekazanie z planem commitów; nowy model mierzony na tych samych zadaniach co obecny | `SKILL.md` |
| **analysis** — co z tego wynika | **bench-analysis** | Analiza wyników wspierana przez agenta, w rozmowie, kończona decyzją routingu: który model (i które CLI) dostaje którą klasę pracy, za ile za akceptowalny wynik, z jaką pewnością. Wszystko liczy `summarize.mjs` + `analytics.mjs`: pass rate z przedziałem, pass^k, klasa × model po ZADANIACH, porównania parowe (test znaków), rozdzielczość zbioru zadań, horyzont czasowy | `EXPLAIN.md` (diagnoza zaskakującego wyniku z zachowanej próby) |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu z dowodem i śladem** — rubryki i
  `bench.config.yaml` wychodzą wyłącznie przez PR; nowe zadania buduje
  bench-create-task jako pliki w drzewie roboczym z raportem-plikiem
  `reports/<zadanie>-build.md`
  (REPORT_TEMPLATE.md skilla; raport wyłącznie w wiadomości czatu =
  raport nieistniejący) — **do gita wnosi
  je użytkownik**, skille nie commitują i nie pushują niczego.
- **Budowa statyczna, dowód na biegu** — bench-create-task kończy na
  plikach i zielonym `bench validate`: bez `bench assert`, sędziego,
  prób, pustych diffów i wariantów. Zanim bench-evaluate zapłaci za
  pierwszą próbę nowego zadania, dowodzi go na pinie jednym
  `bench validate --assert --tasks <nowe>` (guardy repo zielone,
  `tests/<zadanie>-pr` czerwony); zadanie czerwone tam nie wchodzi do
  macierzy. Wykonalność i rozdzielczość rubryki mierzy sam bieg.
  Benchmark nie pisze implementacji referencyjnych: referencją jest
  zmergowany commit (SHA w zleceniu i w raporcie budowy), nigdy
  przechowywany w instancji.
- **Zaliczenie to bramka, nie próg sumy** — próba zalicza, gdy każdy
  guard z wagą > 0 jest na 1 ORAZ sędzia sam przekracza
  `pass_threshold`. Czerwonego guarda nie da się nadrobić hojnym
  werdyktem. `total` zostaje miarą jakości, a decyzja jest w polu
  `passed` (`pass_reason` mówi, co zawiodło).
- **Jeden sędzia** — oceną jest `bench evaluate`: guardy w kontenerze
  i sędzia API na diffie (`judge.mode: api`). Ścieżka oceny jest
  częścią ery, więc wynik oceniony inaczej `bench status` pokazuje jako
  nieświeży ("ścieżka oceny X→Y").
- **Świadomość er** — zmiany `task_hash`, rubryki, sędziego, ścieżki
  oceny (`judge.mode`) lub progu zaliczenia (`defaults.pass_threshold`)
  zamykają erę porównywalności; raport/PR mówi to wprost.
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
  (`bench evaluate`), nie nowy bieg. Wyniki żyją w
  `results/` w repo — commituje je użytkownik, historię wersjonuje git.
- **Bieg nie blokuje, tracker to dysk** — `bench attempt` zajmuje numer
  próby markerem `running.json` przed startem kontenera, więc kilka
  procesów (per model, w tle, na drugiej maszynie) dogania tę samą
  macierz bez kolizji; stan (zachowane / w toku / ocenione) czyta
  `bench status`, ocena bierze to, co skończone.
- **Runner jest narzędziem** — stany "gotowe" potwierdza wyjście komend
  `bench` (`validate` / `assert` / `judge` / `attempt` / `evaluate`),
  nie deklaracja.
- **Stan się wyprowadza, nie zapisuje** — postęp zlecenia (ordered →
  building → ready → measuring → measured) czyta
  `bench backlog` z faktów na dysku (todo.md, task.yaml, próby, oceny
  w bieżącej erze). W backlogu żyją wyłącznie
  decyzje (`pending` / `dropped`) i dziennik budowy, więc żaden skill
  nie przepisuje linii statusu. Świeżość oceny to cała era oceny
  (zadanie + sędzia + ścieżka oceny + wersje rubryk + scoring z progiem
  zaliczenia), nie sam `task_hash`:
  bump rubryki `bench status` pokazuje jako pracę do re-oceny.
- **Przegląd intencji, nie linii** — zanim użytkownik dostanie pliki do
  commita, skill uruchamia `bench changes` i przekazuje jego plan. Plan
  dzieli drzewo robocze wg wpływu na scoring: koordynacja / nowe zadanie
  / dane / zamknięcie ery (PR) / zablokowane. Do każdej grupy daje
  gotowe `git add` + `git commit`. Edycja rubryki bez bumpu `version`
  przy istniejących wynikach i plik roboczy w katalogu zadania blokują
  plan, a ich naprawa należy do skilla, nie do użytkownika.
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

- **Klon ma domyślnie pełną historię**: kopanie PR-ów (domyślne źródło
  zadań) jej potrzebuje, a klon z lokalnej kopii roboczej to hardlinki —
  sekundy. `10x bench-kit init --shallow` zostawia sam HEAD (tak też
  wyglądają klony z init sprzed kitu 0.34.0).
- **Gdy klon jest płytki, a potrzebujesz historii** (diff między pinami, worktree na starym
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
