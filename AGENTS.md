# Instrukcje dla agentów — bench-kit

To repo to **template benchmarku agentów AI** (`10x bench-kit init`
materializuje z niego instancję firmy; ten plik wędruje razem
z template'em i obowiązuje w każdej instancji). Instancja trzyma
zadania (`tasks/`), materiały oceny (`evaluation-pool/`)
i konfigurację (`bench.config.yaml`). Liczeniem zajmuje się
deterministyczny runner (`.bench-kit/` — strefa narzędzia, nie
edytuj); wszystkim, co wymaga osądu, zajmują się trzy skille:
define → measure → decide. Zanim
zrobisz cokolwiek wpływającego na scoring, użyj właściwego skilla —
każdy ma procedurę i twarde zasady, a tam, gdzie jego wynik ma
utrwaloną formę, także jej szablon (raport budowy, opis PR-a, diagnoza).

## Trzy koncepty, trzy skille

Cały cykl instancji to trzy skille. Każdy ładuje swoje szczegółowe
procedury (pliki obok SKILL.md) dopiero, gdy są potrzebne:

| Koncept | Skill | Przeznaczenie | Procedury |
|---|---|---|---|
| **status** — czy instancja jest gotowa | **bench-status** | Punkt wejścia: maszyna, klucze, repo bazowe, modele i sędzia, zielony `bench validate`, rozgrzanie obrazu bazowego w tle, jeden kolejny krok. Bez zadania-demo — pierwszym dowodem toru kontenerów jest pierwsze prawdziwe zadanie | `SKILL.md` |
| **define** — co mierzymy | **bench-define** | Zadania z prawdziwej pracy firmy. Domyślne źródło to **kopanie PR-ów**: zmergowana zmiana z testami staje się zadaniem. Pin to rodzic zmiany, testy zmiany to ukryty guard fail-to-pass, a kod zmiany to dowód wykonalności, którego agent nie widzi. Zlecenia trafiają do `tasks/backlog.md` z decyzją, klasą i dzisiejszym kosztem pracy; budowa daje pliki zadań i raport `reports/<zadanie>-build.md` | `MINING.md` + `mine-prs.mjs`, `INTERVIEW.md` (praca bez historii), `REFRESH.md` (przeterminowane zadanie), `BUILD.md` → `TASK_AUTHORING.md` + `RUBRIC_AUTHORING.md` (subagent per zlecenie), `BACKLOG_TEMPLATE.md`, `REPORT_TEMPLATE.md` |
| **measure** — uruchamiamy modele | **bench-measure** | Zmiany wiringu na instancji z wynikami i publikacja, bieg macierzy modele × zadania × próby z projekcją kosztu, zachowane próby z top-upem, ocena (sędzia z narzędziami per próba), przekazanie z planem commitów; nowy model mierzony na tych samych zadaniach co obecny | `WIRING.md`, `RATE_ATTEMPT.md` (subagent per próba), `JUDGE_DIAGNOSTICS.md` (stabilność sędziego) |
| **decide** — co z tego wynika | **bench-decide** | Decyzja routingu: który model (i które CLI) dostaje którą klasę pracy, za ile za akceptowalny wynik, z jaką pewnością. Wszystko liczy `summarize.mjs` + `analytics.mjs`: pass rate z przedziałem, pass^k, klasa × model po ZADANIACH, porównania parowe (test znaków), rozdzielczość zbioru zadań, horyzont czasowy | `EXPLAIN.md` (diagnoza zaskakującego wyniku z zachowanej próby) |

## Zasady nadrzędne (obowiązują zawsze, szczegóły w skillach)

- **Zmiany scoringu z dowodem i śladem** — rubryki i
  `bench.config.yaml` wychodzą wyłącznie przez PR; nowe zadania buduje
  bench-define jako pliki w drzewie roboczym z dowodami ze stanu
  startowego w raporcie-pliku `reports/<zadanie>-build.md`
  (REPORT_TEMPLATE.md skilla; raport wyłącznie w wiadomości czatu =
  raport nieistniejący) — **do gita wnosi
  je użytkownik**, skille nie commitują i nie pushują niczego.
- **Udowodnij na stanie startowym, zanim zaproponujesz** — asercja czy
  overlay bez dowodu z `bench assert` nie zostaje oddana (raport/PR);
  dowód dla tego, co wspólne dla paczki (guardy reużyte na pinie,
  `bench validate --assert`, smoke), składa raz orkiestrator
  bench-define na bramce partii — nie każdy subagent osobno.
  Benchmark nie PISZE implementacji referencyjnych: kierunek
  "da się zaliczyć" chroni zasada neutralności kształtu asercji
  (TASK_AUTHORING.md — skrypty to wyłącznie repo-natywne guardy
  wykonania; treść implementacji ocenia rubryka sędziego opisem
  dobrych i złych implementacji) i smoke run jako sonda wykonalności.
  Wyjątek bez kosztu utrzymania: zadanie wykopane z historii
  (MINING.md) ma referencję z gita, czyli samą zmianę. Jej testy
  dowodzi się w obie strony (czerwone na pinie, zielone z
  `--patch reference.diff`). Referencją jest zmergowany commit (SHA
  w zleceniu i w raporcie budowy); jego diff odtwarza się w razie
  potrzeby przez `mine-prs.mjs emit` i nigdy nie jest przechowywany
  w instancji.
- **Zaliczenie to bramka, nie próg sumy** — próba zalicza, gdy każdy
  guard z wagą > 0 jest na 1 ORAZ sędzia sam przekracza
  `pass_threshold`. Czerwonego guarda nie da się nadrobić hojnym
  werdyktem. `total` zostaje miarą jakości, a decyzja jest w polu
  `passed` (`pass_reason` mówi, co zawiodło).
- **Werdykt ma autora** — werdykt z pliku wchodzi tylko z deklaracją
  (`--judge-mode agent --judge-model <id>` albo `--judge-mode human`).
  Ścieżka oceny (`judge_mode`: api / agent / human) jest częścią ery,
  więc werdykty sędziego API, sędziego z narzędziami i człowieka nigdy
  nie mieszają się w jednej tabeli. Ścieżkę instancji wybiera
  `judge.mode` w `bench.config.yaml` (`agent` domyślnie, albo `api`);
  wynik oceniony inną ścieżką `bench status` pokazuje jako nieświeży
  ("ścieżka oceny X→Y"), a masowe `bench evaluate` (sędzia API) pomija
  wyniki ocenione przez agenta albo człowieka, chyba że dostanie
  `--overwrite-judged`.
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
- **Stan się wyprowadza, nie zapisuje** — postęp zlecenia (ordered →
  building → built → ready → measuring → measured) czyta
  `bench backlog` z faktów na dysku (todo.md, task.yaml, bramka partii
  w raporcie, próby, oceny w bieżącej erze). W backlogu żyją wyłącznie
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
