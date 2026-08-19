---
name: bench-wiring
description: >-
  Przeprowadza świeżą instancję bench-kit od `bench-kit init` do zielonego
  `bench validate` i pierwszego runu. Ścieżka A (pierwszy czek, budżet:
  minuta): repo bazowe + pin + `bench validate`. Ścieżka B (domknięcie):
  modele, sędzia, sekrety, smoke run, PR. Użyj, gdy użytkownik ma świeżą
  instancję benchmarku do skonfigurowania, chce podłączyć repo bazowe lub
  modele, albo mówi "wiring / skonfiguruj benchmark / podłącz benchmark".
---

# bench-wiring — od init do pierwszego zielonego runu

Domykasz decyzje, których `bench-kit init` świadomie nie podejmuje:
repozytoria bazowe, modele, sędzia, sekrety. Praca dzieli się na dwie
ścieżki o różnym budżecie czasu:

- **Ścieżka A — pierwszy czek (budżet: minuta).** Dowód, że instancja
  w ogóle się spina: repo bazowe podłączone, pin realny, `bench validate`
  zielone. Zero dyskusji konfiguracyjnych — template ma sensowne
  defaults na wszystko poza `base_repos`.
- **Ścieżka B — domknięcie wiringu.** Modele, sędzia, sekrety, smoke
  run, PR. Wchodzisz w nią po zielonym pierwszym czeku — od razu, jeśli
  użytkownik chce, albo w osobnej sesji.

Zasada rozdziału: **decyzja, która ma dobry default w template, nie jest
rozmową w ścieżce A**. Każdy krok kończysz dowodem z runnera, nie
deklaracją.

## Twarde zasady

1. **Wyjście przez PR.** Wiring zmienia `bench.config.yaml` (wpływa na
   scoring: modele, sędzia, wersje rubryk) — gałąź `bench-wiring/<opis>`
   + PR wg [PR_TEMPLATE.md](PR_TEMPLATE.md), człowiek merguje. Wyjątek:
   pierwsza konfiguracja świeżej instancji, której master to jeszcze sam
   szkielet z template'u — wtedy commit na master jest dopuszczalny za
   wyraźną zgodą użytkownika (nie ma jeszcze żadnych wyników, które
   zmiana mogłaby unieważnić). Wyjątek obejmuje **także przepięcie
   zadania-demo** z placeholdera na realny pin: formalnie to zmiana
   `task_hash`, ale zadanie bez żadnych wyników nie ma ery do
   unieważnienia — nie rób z tego osobnego PR-a.
2. **Sekretów nie dotykasz.** Generujesz checklistę NAZW sekretów
   i weryfikujesz samą obecność (`gh secret list`, `[ -n "$VAR" ]`) —
   nigdy nie czytasz, nie wypisujesz ani nie zapisujesz wartości.
   Ustawianie wartości to zawsze krok użytkownika.
3. **Nie dotykaj `.bench-kit/`** (strefa narzędzia). Bazowego Dockerfile'a
   nie edytujesz; braki runnera zgłaszasz (issue), nie obchodzisz.
4. **Runner jest twoim narzędziem.** Każdy stan "gotowe" potwierdzasz
   komendą `bench` i jej wyjściem: konfigurację — `validate`, wykonanie —
   smoke runem. Nie oceniaj "na oko", że coś zadziała.
5. **Sędzia ≠ modele oceniane.** Twarda reguła (validate ją egzekwuje);
   sędzia to stały, mocny model — zmiana sędziego lub wersji rubryki
   (frontmatter `version` w rubryce) zamyka erę porównywalności zadań,
   które jej używają.
6. **Budżet zamiast rytuału zgody.** `defaults.max_cost_usd` jest już
   w template — runner przerywa run po przekroczeniu, więc nie pytasz
   o zgodę przed każdym uruchomieniem. Zgoda człowieka jest potrzebna
   tylko przy **podnoszeniu** budżetu. Po każdym runie raportuj koszt
   faktyczny (`metrics.json` / `report.json`), nie negocjuj szacunków.
7. **Świadomość er.** Wiring definiuje pierwszą erę instancji (sędzia +
   wersje rubryk). PR mówi to wprost; późniejsze zmiany tych pól
   unieważniają porównywalność dotychczasowych wyników.

## Narzędzia runnera

Z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

- `bench doctor` — deterministyczna checklista środowiska (silnik
  kontenerów, node, zależności runnera, obecność kluczy, remote,
  workflows, klonowalność repo bazowych): tabela OK/BRAK z instrukcją
  naprawy. To twój krok 1 — nie sprawdzaj tych rzeczy ręcznie i nie
  powtarzaj potem ręcznie tego, co doctor już potwierdził.
- `bench validate` — pełna bramka: schematy, spójność evaluation[] z pulą,
  wagi, sędzia ≠ oceniane, klonowalność repo bazowych + istnienie pinów.
  Faza sieciowa to sekundy na repo (ls-remote + płytki fetch pinów).
  `--offline` pomija sieć (iteracja nad błędami schematu), `--assert`
  dodatkowo weryfikuje deklaracje `reference` zadań na stanie startowym
  (wymaga kontenerów — to koszt minut, nie sekund; w wiringu potrzebne
  tylko, gdy istniejące zadania mają `reference`).
- `bench run --smoke --tasks demo-hello-bench --models <tani-model>`
  + `bench evaluate --run <dir>` — smoke run (ścieżka B); `--smoke`
  = 1 próba na pierwszym modelu z listy.

## Ścieżka A — pierwszy czek (budżet: minuta)

Cel: zielone `bench validate` na realnym repo bazowym. Wszystkie kroki
poza decyzją o repo są deterministyczne i trwają sekundy.

### A1. Rozpoznanie + budowa obrazu w tle

Uruchom `bench doctor` i przeczytaj co już jest:

- `.bench-kit/instance.json` — wersja template'u; init odpalony z wnętrza
  repo produktowego zostawia tu kandydata na pierwsze repo bazowe i pin.
- `bench.config.yaml` — czy `base_repos` to jeszcze placeholder
  (`demo-app` / `example-org`); defaults (modele, sędzia, budżet,
  `resources.memory_mb`) zostawiasz jak są.
- `.github/workflows/` — czy są `bench-run.yaml` i `leaderboard.yaml`;
  jeśli nie (starszy init), skopiuj je z `.bench-kit/workflows/`.

Jedyny wielominutowy koszt lokalnego wiringu to jednorazowa budowa
obrazu bazowego (apt + instalacja OpenCode). Nie płać go sekwencyjnie —
gdy doctor potwierdzi silnik kontenerów, odpal budowę **w tle** już
teraz, żeby zdążyła przed ewentualnym smoke runem:

```
V=$(cat .bench-kit/docker/opencode.version)
docker build -q --build-arg OPENCODE_VERSION=$V -t bench-base:$V .bench-kit/docker &
```

(Runner przy `bench run` zbuduje obraz sam — trafi wtedy w ciepły cache
warstw i przejdzie w ~1 s. Przed smoke runem poczekaj na proces w tle.)

### A2. Repozytoria bazowe

Jedyna decyzja użytkownika w ścieżce A. Dla każdego repo, na którym
mają powstawać zadania — wpis w `base_repos` (`name` + `url`);
placeholder `demo-app` usuń albo podmień. URL zawsze `https://…`
(zastane `git@…` przepisz — workflow wspiera tylko https + token):

- **Publiczne** → klonuje się bez sekretów, zero dodatkowego wiringu.
- **Prywatne** → jeden sekret `BASE_REPO_TOKEN` na instancję:
  fine-grained PAT z dostępem wyłącznie contents:read do wszystkich
  prywatnych repo bazowych. Wystarczy obecność w env — runner sam wpina
  token w fetch/ls-remote; do checklisty (zasada 2) trafia tylko nazwa.

Benchmark nigdy nie modyfikuje repo bazowych — jeśli użytkownik
proponuje zapis do nich, to nieporozumienie do wyprostowania.

Przepnij zadanie-demo na realny pin (SHA istniejący na remote) i zadbaj
o lokalny klon roboczy w `.repos/<nazwa>/` (konwencja z AGENTS.md; init
zwykle zostawia tam klon wykrytego repo — brakujące sklonuj sam).
Z niego korzystają potem bench-build i bench-refresh-task.

### A3. Bramka: validate

`bench validate` (pełne, z siecią — to sekundy). Błędy schematu
iteruj na `--offline`. `--assert` tylko, gdy zadania mają deklaracje
`reference` — świeża instancja ich nie ma.

**Zielone validate kończy pierwszy czek.** Powiedz to użytkownikowi
wprost: instancja się spina, defaults template'u (modele, sędzia,
budżet, limity zasobów) obowiązują, a domknięcie wiringu (ścieżka B)
może nastąpić teraz albo później. Czego w ścieżce A **nie** robisz:
nie dyskutujesz modeli, sędziego ani budżetu, nie budujesz checklisty
sekretów ponad wynik doctora, nie mierzysz zimnych cykli oceny, nie
odpalasz GH Actions.

## Ścieżka B — domknięcie wiringu

### B1. Modele i sędzia

Tylko jeśli defaults z template'u nie wystarczą — inaczej odnotuj
w PR "defaults template'u" i idź dalej:

- **Modele oceniane** (`defaults.models`): identyfikatory w formacie
  OpenCode `<provider>/<model>`. Prowadź w stronę najprostszego wiringu
  kluczy: wszystkie modele przez jednego providera-agregatora
  (np. `openrouter/…`) = jeden sekret na całą instancję.
- **Sędzia** (`judge.model`): providery wspierane host-side to
  `anthropic/…` i `openrouter/…`. Mocny, stabilny model, INNY niż
  oceniane (zasada 5) — sędziego nie zmienia się przy dodawaniu modeli.
- **Wersje rubryk**: deklaruje je frontmatter `version` każdej rubryki
  w `evaluation-pool/judge/` (kalibracja rubryk to skill bench-rubric,
  nie ten); `judge.rubric_version` w configu to tylko fallback dla
  rubryk legacy bez frontmattera.
- **`judge.max_tokens`** (default 8192), **`defaults.trials`** (3),
  **`defaults.timeout_s`**, **`defaults.max_cost_usd`** — nie ruszaj
  bez powodu; za niski limit tokenów ucina JSON werdyktu sędziego
  (judge = 0 z winy narzędzia), za krótki timeout mierzy szybkość,
  nie jakość. Podniesienie budżetu wymaga zgody człowieka (zasada 6).

### B2. Sekrety — checklista

Doctor sprawdził już obecność kluczy w lokalnym env. Tu domykasz drugą
połowę: sekrety w **zdalnym repo instancji** (tam pracują workflows).
Zbuduj listę nazw z decyzji A2/B1 i zweryfikuj `gh secret list`:

| Sekret | Po co |
|---|---|
| klucz(e) providerów ocenianych modeli (np. `OPENROUTER_API_KEY`) | próby agenta |
| klucz providera sędziego (często ten sam) | `bench evaluate` |
| `BASE_REPO_TOKEN` (gdy jest choć jedno prywatne repo bazowe) | klonowanie przy `validate`/`run` |

Braki wypisujesz użytkownikowi jako jego konkretne kroki — dla każdego
brakującego sekretu dokładna nazwa i gotowa komenda:

```
gh secret set OPENROUTER_API_KEY --repo <owner/repo-instancji>
gh secret set BASE_REPO_TOKEN --repo <owner/repo-instancji>
```

(albo ścieżka w UI: Settings → Secrets and variables → Actions).
Sekret obecny tylko lokalnie ≠ obecny w repo — workflow `bench-run`
bez sekretu w repo padnie, nawet gdy lokalny smoke przeszedł; wypisz
oba miejsca jawnie. Checklista trafia do opisu PR-a.

### B3. Smoke run

Budżet `defaults.max_cost_usd` obowiązuje (zasada 6) — nie pytasz
o zgodę na pojedynczy run. Obraz bazowy z A1 powinien być już gotowy
(poczekaj na proces w tle, jeśli jeszcze trwa). Lokalnie:

```
bench run --smoke --tasks demo-hello-bench --models <najtańszy oceniany>
bench evaluate --run <katalog runu>
```

Czytasz `result.json`: total, koszt, czas — te liczby idą do PR-a.
Nieudany smoke = wracasz do kroku, którego dotyczy przyczyna,
z artefaktami w ręku.

Test end-to-end w CI (`workflow_dispatch` workflow `bench-run` —
jedyne miejsce, gdzie sekrety repo faktycznie pracują) to krok **po
merge PR-a**, nie bramka wiringu: wymaga zmergowanego configu
i ustawionych sekretów. Zostaw go w PR jako "następny krok po merge".

### B4. PR "wiring instancji"

Gałąź `bench-wiring/<opis>`, opis wg [PR_TEMPLATE.md](PR_TEMPLATE.md):
decyzje (repo, modele, sędzia — "defaults template'u" to też decyzja)
z uzasadnieniem, checklista sekretów ze statusem obecności, dowody
(wyjście `validate`, wynik smoke runu z kosztem), sekcja "Skutki dla
porównywalności" (pierwsza era: sędzia + wersje rubryk; co ją
w przyszłości zamknie).

## Decyzje odroczone — nie blokują wiringu

Template ma defaults na politykę środowiska; wracaj do nich dopiero,
gdy pierwsze realne zadanie ich dotknie (zwykle w bench-build), a zmiany
prowadź PR-em jak każdą zmianę configu:

- **Cache zależności asercji**: default `evaluation.deps_cache: true`
  (trwały wolumen `bench-deps-cache`; asercje dalej same instalują
  zależności, ale trafiają w ciepły cache). Wyłączenie — pełna
  hermetyczność kosztem czasu — to świadoma decyzja per instancja
  (`deps_cache: false`) albo per wywołanie (`--no-deps-cache`).
- **Limity zasobów kontenerów**: template ustawia `resources.memory_mb`
  (stempel ery `memory_limit_mb` — zmiana zamyka erę, więc jeśli
  podnosić, to zanim pojawią się wyniki). `bench doctor` porównuje
  limit z pamięcią maszyny silnika. Bez limitu agenci weryfikujący
  swoją pracę buildem giną od OOM killera z gołym SIGKILL-em, co
  wygląda jak wina modelu.
- **Polityka weryfikacji w promptach** (czy agent ma uruchamiać projekt
  dla weryfikacji): ustala ją autor zadań w `prompt.md` — to kontrakt
  skilla bench-build, nie wiringu.
- **Koszt zimnego cyklu oceny** (ile trwa `bench assert` na realnym
  zadaniu): mierzy go bench-build przy pierwszym realnym zadaniu —
  wiring nie ma jeszcze zadania, na którym pomiar byłby miarodajny.
- **Toolchain w próbie agenta**: bazowy obraz to node + git + pinowany
  OpenCode; toolchain potrzebny asercjom instalują same komendy
  `check.yaml` (etap oceny może używać sieci, offline są tylko próby
  agenta). Jeśli stack wymaga toolchainu już w **próbie agenta**, to
  dziś jest to brak runnera — zgłoś issue z konkretem (zasada 3),
  nie edytuj bazowego Dockerfile'a.

## Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan instancji
jednym zdaniem (co skonfigurowane, co czeka na przegląd), **jedna**
rekomendacja z jednozdaniowym uzasadnieniem, maksymalnie dwie
alternatywy z ceną, oraz — oddzielnie — to, co czeka na decyzję
człowieka (merge PR-a, ustawienie sekretów). Po ścieżce A naturalna
rekomendacja to domknięcie ścieżki B; po ścieżce B — **bench-new-task**
(zlecenia do backlogu), potem **bench-build**, bo instancja bez zadań
nic nie mierzy.
