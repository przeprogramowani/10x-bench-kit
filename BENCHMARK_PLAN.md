# BENCHMARK_PLAN — pivot: local-first, wykonanie oddzielone od oceny

Odpowiedź na [BENCHMARK_ISSUES.md](BENCHMARK_ISSUES.md). Trzy decyzje
kierunkowe podjęte, reszta to konsekwencje i pytania otwarte. Wzorzec
odniesienia: `~/dev/10x-bench` (próby jako katalogi w repo, ocena jako
skill agenta z narzędziami, wyniki trzymane w projekcie).

Decyzja nadrzędna: **benchmark pracuje lokalnie** (maszyna operatora
lub VPS — z perspektywy kitu to to samo: długo żyjący host z podmanem).
GitHub Actions przestaje być substratem wykonania; zostaje zwykłym
CI/CD — readiness kitu on change mastera. To adresuje pkt 2 i 4
BENCHMARK_ISSUES u źródła zamiast kompensować w YAML-u.

Poza zakresem (świadomie): czas obiegu pojedynczej próby — to cecha
zadania, nie architektury; regulujemy go doborem rozmiaru zadań, nie
mechanizmem. Human-in-the-loop przy wynikach przestaje istnieć jako
problem, bo znika ścieżka PR-ów z wynikami.

---

## Filar 1 — Wykonanie i ocena to dwa niezależne procesy

Dziś `bench run` = próby + ocena w jednym przebiegu; awaria lub zmiana
czegokolwiek w ocenie unieważnia opłacone próby. Rozdzielamy:

- **Wykonanie (`bench attempt` / dzisiejsze próby)**: agent w
  izolowanym kontenerze (podman, jak dziś), produkt próby jest trwały
  i samowystarczalny: workspace po pracy agenta, `patch.diff`,
  `agent.log`, metadane (model, task_hash, timing, tokeny, koszt).
  Próba raz opłacona nigdy nie jest wyrzucana.
- **Ocena (`bench evaluate` / rate-attempt)**: bierze zachowaną próbę
  jako wejście i produkuje `result.json`. Uruchamialna wielokrotnie,
  na dowolnej wersji rubryki/sędziego, bez ponownego płacenia za
  wykonanie. Nowa rubryka = re-ocena zachowanych prób (~$0.6/próba),
  nie nowa era za $1000+ (rozbraja pkt 1 i błędne koło kalibracji
  z pkt 3 BENCHMARK_ISSUES).
- Kontrakt między nimi to **format zachowanej próby na dysku** —
  wersjonowany, udokumentowany, jedyny punkt styku. Wykonanie nie wie
  nic o rubrykach; ocena nie wie nic o kontenerach agenta (może mieć
  własny kontener do build/testów).

**Do dyskusji — gdzie żyją zachowane próby:**

| Opcja | Za | Przeciw |
|---|---|---|
| Katalog w repo instancji (wzorzec 10x-bench: `attempts/<task>/<model>/trial-N/`) | zero infry, diff-owalne, wszystko w jednym miejscu | workspace'y średnich zadań to GB — repo puchnie |
| Repo + git LFS / osobne repo `bench-attempts` | nadal git, historia, ale główne repo czyste | LFS ma koszty i tarcie |
| Dysk lokalny/VPS + manifest w repo (hash, ścieżka, metadane) | GB nie dotykają gita; manifest wystarcza do skip-logic i leaderboardu | próby nie są replikowane — backup to osobna odpowiedzialność |
| Object storage (S3/R2) + manifest w repo | trwałość, wieloosobowość | pierwsza zewnętrzna infra w projekcie |

Robocza propozycja na start: dysk + manifest w repo, z `patch.diff`
i metadanymi commitowanymi zawsze (KB), workspace'em trzymanym poza
gitem. Decyzję o storage można podjąć później — manifest izoluje resztę
systemu od tej decyzji.

## Filar 2 — DX: benchmark jako narzędzie lokalne, GHA jako zwykłe CI

- **Ścieżka główna**: operator na własnej maszynie (lub VPS) uruchamia
  próby i oceny z CLI. Podman już tam jest (`bench doctor` już dziś
  liczy pamięć maszyny) — znika cała warstwa: dispatch, gałęzie
  `results/*`, PR-y z wynikami, retry na push, continue-on-error,
  artefakty 2–8 GB, limit 6h, minuty bite za czekanie na API.
- **Priorytety DX** (to jest teraz produkt, nie CI):
  - jedna komenda od zera do próby (`bench attempt <task> <model>`),
    jedna do oceny (`bench evaluate <ścieżka-próby>` — patrz Filar 3);
  - wznawialność tania z natury: przerwana próba zostawia workspace,
    re-run to nowa próba, ale diagnoza to `ls` + `cat agent.log`
    zamiast pobierania artefaktu;
  - równoległość jak dziś (`parallel`), ale bez sufitu runnera;
  - projekcja kosztu przed startem i sufit na cały bieg macierzy
    (nie per wywołanie) — pkt 5 BENCHMARK_ISSUES;
  - koszt/tokeny czytane z wiarygodnego źródła lokalnego (wzorzec
    10x-bench: `opencode.db` per katalog roboczy), nie z łańcucha
    adapter↔OpenRouter — naprawia kolumny tokenów.
- **GHA zostaje wyłącznie jako readiness**: on change mastera lint,
  testy runnera, walidacja schematów task.yaml/rubryk, smoke-test
  `demo-hello-bench` na tanim modelu. Zwykły workflow CI/CD — żadnych
  płatnych macierzy, żadnych wyników.
- Leaderboard budowany z manifestu/`result.json` w repo — publikacja
  (Pages/strona) może zostać na GHA, bo to już statyczny build.

**Do dyskusji:** czy VPS to od razu cel (cron nocnych biegów macierzy),
czy najpierw czysto ręczna maszyna operatora i VPS jako naturalne
rozszerzenie, skoro DX jest ten sam.

## Filar 3 — Sędzia jako agent z narzędziami: skill `rate-attempt`

Wzorzec z 10x-bench (`10x-score-attempts`), uogólniony:

- Dedykowany skill **`rate-attempt <ścieżka-próby>`** uruchamiany
  lokalnie przez opencode. Agent-sędzia (zawsze LLM, model stały jak
  dziś) dostaje zestaw **narzędzi**, nie tylko diff do przeczytania:
  - prompt rubryki — słowny opis zlecanego review (kryteria,
    pułapki, ground truth);
  - workspace zachowanej próby, w którym MOŻE uruchamiać: build,
    testy, lint, serwer aplikacji — i sprawdzać zachowanie
    "produktowo" (czy funkcja istnieje, czy strona odpowiada), nie
    tylko czy tekst diffa wygląda kompletnie;
  - wyniki guardów z wykonania (exit codes, logi) jako fakty, nie
    sugestie.
- To wprost naprawia case Qwena z pkt 3 BENCHMARK_ISSUES: sędzia,
  który sam odpala czerwone testy, nie da 0.92 za "diff wygląda na
  kompletny". Otwarta decyzja z poprzedniej dyskusji — czy guardy
  dodatkowo CAPują werdykt (bramka), czy ufamy sędziemu-z-narzędziami
  — do rozstrzygnięcia po pierwszych kalibracjach, które teraz są
  tanie (Filar 1).
- **Wynik trzymamy w projekcie**: `results/<task>/<model>/trial-N/`
  (`result.json` + werdykt sędziego z uzasadnieniem), commitowane
  wprost — koniec PR-ów na bench-data jako ścieżki danych. Agregacja
  i leaderboard czytają katalog `results/`.
- Batch jak w 10x-bench: `rate-attempt` na pojedynczej próbie,
  wyżej cienka pętla/subagenci per próba dla całego modelu.
- Ocena jest deterministycznie powtarzalna co do procedury (skill +
  wersja rubryki + model sędziego = stempel ery oceny), a era oceny
  jest ODKLEJONA od ery wykonania: zmiana rubryki wersjonuje wyniki,
  nie unieważnia prób.

**Do dyskusji:** ile z dzisiejszego runnera oceny (kontener oceny,
schematy result.json) przeżywa, a ile zastępuje skill — intuicja:
schematy i agregacja zostają, orkiestracja kontenerowa oceny odchodzi
na rzecz agenta z narzędziami.

---

## Kolejność (fazy, nie taski)

Bez kompatybilności wstecznej — stara ścieżka CI idzie do kosza od
razu, nie utrzymujemy dwóch torów.

1. **Demontaż CI wykonania** — usunięcie dispatchy, gałęzi
   `results/*`, PR-owej ścieżki danych i warstw odporności z 0.21–0.23;
   GHA zredukowane do readiness. Czyści pole i zdejmuje balast
   utrzymaniowy przed budową nowego.
2. **Kontrakt zachowanej próby** — format katalogu próby + manifest.
   Wszystko inne od tego zależy.
3. **`bench attempt` lokalnie** — wykonanie produkujące zachowane
   próby, koszt z lokalnego źródła prawdy, sufit kosztu na bieg.
4. **Skill `rate-attempt`** — sędzia z narzędziami na zachowanej
   próbie, wyniki do `results/` w repo. Tu dzieje się kalibracja
   rubryk — po raz pierwszy tania, na przechowanych próbach z fazy 3.
5. **Leaderboard i niepewność** — agregacja z `results/`, prezentacja
   przedziałów przy małym n (osobna dyskusja, niezablokowana przez
   1–4).

## Pytania otwarte (zebrane)

- Storage workspace'ów prób: dysk+manifest vs LFS vs object storage.
- Guardy jako CAP werdyktu vs zaufanie sędziemu-z-narzędziami.
- VPS: od kiedy i czy z harmonogramem (cron), czy tylko jako
  "większa maszyna operatora".
- Czy kontener oceny zostaje (hermetyczny build/test dla sędziego),
  czy sędzia pracuje na hoście jak w 10x-bench.

Stan na 2026-08-27, kit 0.23.1.
