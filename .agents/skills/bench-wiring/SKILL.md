---
name: bench-wiring
description: >-
  Przeprowadza świeżą instancję bench-kit od `bench-kit init` do zielonego
  `bench validate` i pierwszego runu w CI. Ścieżka A (pierwszy czek,
  budżet: minuta, lokalnie, bez kontenerów): uzupełnij braki po init +
  `bench validate`. Ścieżka B (pierwszy run): repo instancji na GitHubie,
  sekrety, dispatch workflow `bench-run`, zielony run. Użyj, gdy
  użytkownik ma świeżą instancję benchmarku do skonfigurowania, chce
  podłączyć repo bazowe lub modele, albo mówi "wiring / skonfiguruj
  benchmark / podłącz benchmark".
---

# bench-wiring — od init do pierwszego zielonego runu

Domykasz decyzje, których `bench-kit init` świadomie nie podejmuje.
Dwa podziały pracy wyznaczają całą procedurę:

- **Co zrobił init, nie jest pracą wiringu.** Init odpalony z wnętrza
  repo produktowego wykrywa je, rejestruje w `base_repos` (https zamiast
  SSH, gdy odpowiada), pinuje zadania-demo na HEAD i klonuje repo do
  `.repos/<nazwa>/`. Wiring to czyta i uzupełnia braki — nie powtarza.
- **Co może zrobić CI, nie jest pracą lokalnej maszyny.** Workflow
  `bench-run` sam waliduje, buduje obrazy (cache w GHCR), odpala próby,
  ocenia i agreguje. Pierwszy run dzieje się w GH Actions — lokalne
  kontenery są potrzebne dopiero autorom zadań (bench-build).

Stąd dwie ścieżki:

- **Ścieżka A — pierwszy czek (budżet: minuta, lokalnie).** Dowód, że
  instancja się spina: braki po init uzupełnione, `bench validate`
  zielone. Bez kontenerów, bez rozmów o defaults.
- **Ścieżka B — pierwszy run (w CI).** Repo instancji na GitHubie,
  sekrety, dispatch `bench-run`, zielony run. Przekaz dla użytkownika
  jest prosty: "zrób repozytorium (albo podepnij istniejące), odpal
  pierwszy workflow i poczekaj na zielone".

Zasada rozdziału decyzji: **co ma dobry default w template, nie jest
rozmową**. Każdy stan "gotowe" potwierdzasz dowodem z runnera —
lokalnie wyjściem `bench`, w CI zielonym runem workflow.

## Twarde zasady

1. **Wyjście przez PR.** Wiring zmienia `bench.config.yaml` (wpływa na
   scoring: modele, sędzia, wersje rubryk) — gałąź `bench-wiring/<opis>`
   + PR wg [PR_TEMPLATE.md](PR_TEMPLATE.md), człowiek merguje. Wyjątek:
   pierwsza konfiguracja świeżej instancji, której master to jeszcze sam
   szkielet z template'u — wtedy commit na master jest dopuszczalny za
   wyraźną zgodą użytkownika (nie ma jeszcze żadnych wyników, które
   zmiana mogłaby unieważnić); to ten wyjątek umożliwia pierwszy
   dispatch, bo `workflow_dispatch` wymaga workflowów na gałęzi
   domyślnej. Wyjątek obejmuje **także przepięcie zadania-demo**
   z placeholdera na realny pin: formalnie to zmiana `task_hash`, ale
   zadanie bez żadnych wyników nie ma ery do unieważnienia.
2. **Sekretów nie dotykasz.** Generujesz checklistę NAZW sekretów
   i weryfikujesz samą obecność (`gh secret list`, `[ -n "$VAR" ]`) —
   nigdy nie czytasz, nie wypisujesz ani nie zapisujesz wartości.
   Ustawianie wartości to zawsze krok użytkownika.
3. **Nie dotykaj `.bench-kit/`** (strefa narzędzia). Bazowego Dockerfile'a
   nie edytujesz; braki runnera zgłaszasz (issue), nie obchodzisz.
4. **Runner jest twoim narzędziem.** Konfigurację potwierdza
   `bench validate`, wykonanie — zielony run `bench-run` w CI (albo
   lokalny smoke, gdy użytkownik świadomie wybrał pracę lokalną).
   Nie oceniaj "na oko", że coś zadziała.
5. **Sędzia ≠ modele oceniane.** Twarda reguła (validate ją egzekwuje);
   sędzia to stały, mocny model — zmiana sędziego lub wersji rubryki
   (frontmatter `version` w rubryce) zamyka erę porównywalności zadań,
   które jej używają.
6. **Budżet zamiast rytuału zgody.** `defaults.max_cost_usd` jest już
   w template — runner przerywa run po przekroczeniu, więc nie pytasz
   o zgodę przed każdym uruchomieniem. Zgoda człowieka jest potrzebna
   tylko przy **podnoszeniu** budżetu. Po każdym runie raportuj koszt
   faktyczny (`report.json`), nie negocjuj szacunków.
7. **Świadomość er.** Wiring definiuje pierwszą erę instancji (sędzia +
   wersje rubryk). PR mówi to wprost; późniejsze zmiany tych pól
   unieważniają porównywalność dotychczasowych wyników.

## Narzędzia

Z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

- `bench doctor` — deterministyczna checklista środowiska: tabela
  OK/BRAK z instrukcją naprawy. Nie sprawdzaj tych rzeczy ręcznie i nie
  powtarzaj potem tego, co doctor już potwierdził. Uwaga na exit code:
  BRAK **silnika kontenerów nie blokuje wiringu** — pierwszy run biegnie
  w CI, a lokalne kontenery są potrzebne dopiero przy `bench assert`
  (bench-build). Blokujące dla ścieżki A są braki configu i runnera.
- `bench validate` — pełna bramka: schematy, spójność evaluation[] z pulą,
  wagi, sędzia ≠ oceniane, klonowalność repo bazowych + istnienie pinów.
  Faza sieciowa to sekundy na repo. `--offline` pomija sieć (iteracja
  nad błędami schematu), `--assert` wymaga kontenerów — w wiringu
  potrzebne tylko, gdy istniejące zadania mają deklaracje `reference`.
- **Workflow `bench-run`** (`workflow_dispatch` w GH Actions) — pełny
  cykl bez pracy lokalnej: bramka validate, budowa obrazów z cache
  w GHCR, próby równolegle, ocena, `report.json` jako artefakt.
  Parametry: `models`, `tasks`, `trials` (puste = defaults z configu).

## Ścieżka A — pierwszy czek (budżet: minuta, lokalnie)

Cel: zielone `bench validate`. Bez kontenerów, bez sieci poza
ls-remote/fetch, bez decyzji ponad te, których init nie podjął.

### A1. Przeczytaj, co zrobił init

`bench doctor` plus trzy pliki:

- `.bench-kit/instance.json` — wersja template'u i `detectedBaseRepo`:
  init odpalony z wnętrza repo produktowego już zarejestrował repo
  w `base_repos`, zapinował zadania-demo na jego HEAD i sklonował
  robocze `.repos/<nazwa>/`.
- `bench.config.yaml` — czy `base_repos` ma realny wpis, czy placeholder
  (`demo-app` / `example-org`). Defaults (modele, sędzia, budżet,
  `resources.memory_mb`) zostawiasz jak są.
- `.github/workflows/` — czy są `bench-run.yaml` i `leaderboard.yaml`;
  jeśli nie (starszy init), skopiuj je z `.bench-kit/workflows/`.

### A2. Uzupełnij braki po init — tylko braki

Norma: init zrobił wszystko i ten krok jest pusty. Wyjątki:

- **Init standalone** (odpalony poza repo produktowym — config ma
  placeholder): wpisz `base_repos` (`name` + `url`, zawsze `https://…`;
  publiczne bez sekretów, prywatne → jeden `BASE_REPO_TOKEN` na
  instancję: fine-grained PAT contents:read), przepnij zadanie-demo na
  realny SHA istniejący na remote, sklonuj klon roboczy do
  `.repos/<nazwa>/`.
- **Dodatkowe repo bazowe** ponad wykryte: dopisz wpis + klon jw.
  Zadania-demo nie przepinasz — jest już zapinowane.

Benchmark nigdy nie modyfikuje repo bazowych — jeśli użytkownik
proponuje zapis do nich, to nieporozumienie do wyprostowania.

### A3. Bramka: validate

`bench validate` (pełne, z siecią — to sekundy). Błędy schematu iteruj
na `--offline`. **Zielone validate kończy pierwszy czek** — powiedz to
użytkownikowi wprost: instancja się spina, defaults obowiązują,
pierwszy run to ścieżka B. Czego w ścieżce A nie robisz: nie
dyskutujesz modeli/sędziego/budżetu, nie budujesz obrazów, nie
odpalasz nic w kontenerach, nie mierzysz zimnych cykli.

## Ścieżka B — pierwszy run (w CI)

Przekaz dla użytkownika: "zrób repozytorium albo podepnij istniejące,
odpal workflow i poczekaj na zielone". Twoja praca to domknięcie
warunków, żeby to zdanie było prawdą.

### B1. Zdalne repo instancji

`bench doctor` pokazał, czy origin istnieje. Jeśli nie — użytkownik
tworzy repo (np. `gh repo create <owner/nazwa> --private`), a ty
podpinasz i wypychasz master (świeża instancja: wyjątek z zasady 1,
za wyraźną zgodą):

```
git remote add origin https://github.com/<owner/repo-instancji>.git
git push -u origin master
```

### B2. Sekrety w repo instancji

Doctor sprawdził lokalny env; workflows pracują na sekretach **repo** —
to osobne miejsce. Lista nazw wynika z configu (i ewentualnych decyzji
B3): klucz providera modeli ocenianych, klucz providera sędziego
(często ten sam), `BASE_REPO_TOKEN` przy prywatnych repo bazowych.
Weryfikacja: `gh secret list --repo <owner/repo-instancji>`. Braki
wypisujesz jako gotowe komendy użytkownika:

```
gh secret set OPENROUTER_API_KEY --repo <owner/repo-instancji>
gh secret set BASE_REPO_TOKEN --repo <owner/repo-instancji>
```

(albo ścieżka w UI: Settings → Secrets and variables → Actions).

### B3. Modele i sędzia — tylko gdy defaults nie wystarczą

Inaczej odnotuj "defaults template'u" i idź dalej:

- **Modele oceniane** (`defaults.models`): format OpenCode
  `<provider>/<model>`; prowadź w stronę jednego providera-agregatora
  (np. `openrouter/…`) = jeden sekret na instancję.
- **Sędzia** (`judge.model`): host-side wspierane `anthropic/…`
  i `openrouter/…`; mocny, stabilny, INNY niż oceniane (zasada 5).
- **`judge.max_tokens`** (8192), **`defaults.trials`** (3),
  **`defaults.timeout_s`**, **`defaults.max_cost_usd`** — nie ruszaj
  bez powodu; za niski limit tokenów ucina JSON werdyktu sędziego,
  za krótki timeout mierzy szybkość, nie jakość. Podniesienie budżetu
  wymaga zgody człowieka (zasada 6).

### B4. Smoke: dispatch i zielony run

`workflow_dispatch` workflow `bench-run` z parametrami smoke'a:
`models=<najtańszy oceniany>`, `tasks=demo-hello-bench`, `trials=1`.
Workflow sam przejdzie validate, zbuduje obrazy i oceni próbę —
czekasz na zielony run, pobierasz artefakt `report` i czytasz
z `report.json` total, koszt, czas. To jest dowód wiringu end-to-end:
sekrety, klonowalność, obrazy i sędzia przetestowane tam, gdzie będą
pracować. Nieudany run = wracasz do kroku, którego dotyczy przyczyna,
z logami joba w ręku.

Wariant lokalny (opcjonalny, gdy użytkownik świadomie chce iterować
bez CI): jednorazowa budowa obrazu bazowego trwa 2–4 min — odpal ją
w tle zawczasu, potem `bench run --smoke --tasks demo-hello-bench
--models <tani>` + `bench evaluate --run <dir>`. Lokalny smoke nie
testuje sekretów repo — zielony run w CI i tak pozostaje bramką.

### B5. PR "wiring instancji"

Dla świeżej instancji wiring wszedł na master (zasada 1) — PR-a nie
ma, ale podsumowanie o tej samej treści zostaw w opisie pierwszego
runu / README instancji. Dla **zmian** istniejącego wiringu: gałąź
`bench-wiring/<opis>`, opis wg [PR_TEMPLATE.md](PR_TEMPLATE.md):
decyzje ("defaults template'u" to też decyzja) z uzasadnieniem,
checklista sekretów ze statusem, dowody (wyjście `validate`, link do
zielonego runu `bench-run` z totalem i kosztem), sekcja "Skutki dla
porównywalności" (pierwsza era: sędzia + wersje rubryk; co ją
w przyszłości zamknie).

## Decyzje odroczone — nie blokują wiringu

Template ma defaults na politykę środowiska; wracaj do nich dopiero,
gdy pierwsze realne zadanie ich dotknie (zwykle w bench-build), a zmiany
prowadź PR-em jak każdą zmianę configu:

- **Cache zależności asercji**: default `evaluation.deps_cache: true`
  (trwały wolumen `bench-deps-cache`; w CI actions/cache). Wyłączenie —
  pełna hermetyczność kosztem czasu — to świadoma decyzja per instancja
  (`deps_cache: false`) albo per wywołanie (`--no-deps-cache`).
- **Limity zasobów kontenerów**: template ustawia `resources.memory_mb`
  (stempel ery `memory_limit_mb` — zmiana zamyka erę, więc jeśli
  podnosić, to zanim pojawią się wyniki). Bez limitu agenci
  weryfikujący swoją pracę buildem giną od OOM killera z gołym
  SIGKILL-em, co wygląda jak wina modelu.
- **Polityka weryfikacji w promptach** (czy agent ma uruchamiać projekt
  dla weryfikacji): ustala ją autor zadań w `prompt.md` — kontrakt
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
człowieka (utworzenie repo, ustawienie sekretów, merge PR-a). Po
ścieżce A naturalna rekomendacja to ścieżka B; po zielonym runie —
**bench-new-task** (zlecenia do backlogu), potem **bench-build**,
bo instancja bez zadań nic nie mierzy.
