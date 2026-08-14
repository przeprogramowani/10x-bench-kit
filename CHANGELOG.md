# Changelog

Konwencja: każdy release (tag) dostaje wpis oznaczony jako **neutralny**
albo **`[scoring-breaking]`**. Release `[scoring-breaking]` zamyka erę
porównywalności wyników — dashboard nie miesza wyników sprzed i po takim
release. Zmiany łamiące schemat `task.yaml` lub `bench.config.yaml` zawsze
są `[scoring-breaking]` i wymagają noty migracyjnej.

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
