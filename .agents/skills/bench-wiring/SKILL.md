---
name: bench-wiring
description: >-
  Przeprowadza świeżą instancję bench-kit od `bench-kit init` do zielonego
  `bench validate` i pierwszego runu: repozytoria bazowe, modele i sędzia,
  checklista sekretów, workflows, smoke run. Użyj, gdy użytkownik ma świeżą
  instancję benchmarku do skonfigurowania, chce podłączyć repo bazowe lub
  modele, albo mówi "wiring / skonfiguruj benchmark / podłącz benchmark".
---

# bench-wiring — od init do pierwszego zielonego runu

Domykasz decyzje, których `bench-kit init` świadomie nie podejmuje:
repozytoria bazowe, modele, sędzia, sekrety, workflows. To rozmowa, nie
kreator — zbierasz decyzje użytkownika i domykasz je w plikach instancji,
a każdy krok kończysz dowodem z runnera, nie deklaracją. Bramka końcowa:
`bench validate` zielone, opcjonalnie smoke run zadania-demo.

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
6. **Budżet zamiast rytuału zgody.** Ustaw `defaults.max_cost_usd`
   w `bench.config.yaml` z użytkownikiem raz — runner przerywa run po
   przekroczeniu, więc nie pytasz o zgodę przed każdym uruchomieniem.
   Zgoda człowieka jest potrzebna tylko przy **podnoszeniu** budżetu.
   Po każdym runie raportuj koszt faktyczny (`metrics.json` /
   `report.json`), nie negocjuj szacunków.
7. **Świadomość er.** Wiring definiuje pierwszą erę instancji (sędzia +
   wersje rubryk). PR mówi to wprost; późniejsze zmiany tych pól
   unieważniają porównywalność dotychczasowych wyników.

## Narzędzia runnera

Z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

- `bench doctor` — deterministyczna checklista środowiska (silnik
  kontenerów, node, zależności runnera, obecność kluczy, remote,
  workflows, klonowalność repo bazowych): tabela OK/BRAK z instrukcją
  naprawy. To twój krok 1 — nie sprawdzaj tych rzeczy ręcznie.
- `bench validate` — pełna bramka: schematy, spójność evaluation[] z pulą,
  wagi, sędzia ≠ oceniane, klonowalność repo bazowych + istnienie pinów.
  `--offline` pomija sieć (iteracja), `--assert` dodatkowo weryfikuje
  deklaracje `reference` zadań na stanie startowym (wymaga kontenerów).
- `bench run --smoke --tasks demo-hello-bench --models <tani-model>`
  + `bench evaluate --run <dir>` — smoke run (krok 7); `--smoke` = 1 próba
  na pierwszym modelu z listy.

## Procedura

### 1. Rozpoznanie stanu

Zanim o cokolwiek zapytasz, uruchom `bench doctor` (deterministyczna
część rozpoznania — tabela OK/BRAK zamiast ręcznego sprawdzania)
i przeczytaj co już jest:

- `.bench-kit/instance.json` — wersja template'u; init odpalony z wnętrza
  repo produktowego zostawia tu kandydata na pierwsze repo bazowe i pin.
- `bench.config.yaml` — czy `base_repos` to jeszcze placeholder
  (`demo-app` / `example-org`), co jest w `defaults.models` i `judge`.
- `.github/workflows/` — czy są `bench-run.yaml` i `leaderboard.yaml`;
  jeśli nie (starszy init), skopiuj je z `.bench-kit/workflows/`.
- `bench validate --offline` — co już się nie spina.

### 2. Repozytoria bazowe

Dla każdego repo, na którym mają powstawać zadania:

- **Publiczne** → URL `https://…` — klonuje się bez sekretów, zero
  dodatkowego wiringu. Jeśli zastałeś URL `git@…`, sprawdź
  `git ls-remote https://…` — gdy działa, przepisz na https i pomiń
  całą sekcję sekretów dla tego repo (SSH wymusza klucz w kontenerze/CI
  tam, gdzie https nie wymaga nic).
- **Prywatne** → dostęp wyłącznie read-only: deploy key (URL `git@…`)
  albo fine-grained token (URL `https://…`, tylko contents:read).
  Nazwa sekretu do checklisty (zasada 2), np. `BASE_REPO_<NAZWA>_KEY`.

Wpisy w `base_repos` (`name` + `url`); placeholder `demo-app` usuń albo
podmień. Benchmark nigdy nie modyfikuje repo bazowych — jeśli użytkownik
proponuje zapis do nich, to nieporozumienie do wyprostowania.

### 3. Modele i sędzia

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
- **`judge.max_tokens`**: budżet odpowiedzi sędziego (default 8192) —
  nie obniżaj; u sędziów z rozumowaniem reasoning liczy się do budżetu
  i za niski limit ucina JSON werdyktu (judge = 0 z winy narzędzia).
- **`defaults.trials`** (domyślnie 3) i **`defaults.timeout_s`** — nie
  ruszaj bez powodu; za krótki timeout mierzy szybkość, nie jakość.
- **`defaults.max_cost_usd`**: budżet kosztu prób jednego runu — ustal
  z użytkownikiem raz (zasada 6).

### 4. Sekrety — checklista

Zbuduj listę nazw z decyzji z kroków 2–3 i zweryfikuj obecność:

| Sekret | Po co | Gdzie |
|---|---|---|
| klucz(e) providerów ocenianych modeli (np. `OPENROUTER_API_KEY`) | próby agenta | repo instancji (Actions) + env lokalnie do smoke |
| klucz providera sędziego (często ten sam co wyżej) | `bench evaluate` | jw. |
| deploy key / token per prywatne repo bazowe | klonowanie przy `run` | jw. |

Weryfikacja: `gh secret list` w repo instancji oraz `[ -n "$…" ]`
lokalnie — obecność, nigdy wartości (zasada 2). Checklista trafia do
opisu PR-a; braki wypisujesz użytkownikowi jako jego kroki.

### 5. Obraz pod stack

Bazowy obraz to node + git + pinowany OpenCode. Toolchain potrzebny
**asercjom** (np. zależności projektu, przeglądarki Playwright) instalują
same komendy `check.yaml` — etap oceny może używać sieci, offline są
tylko próby agenta (lekcja założycielska: asercja, która nie instaluje
swoich zależności, jest czerwona z niewinności agenta). Jeśli stack
wymaga toolchainu już w **próbie agenta** (nie w ocenie), to dziś jest
to brak runnera — zgłoś issue z konkretem (zasada 3), nie edytuj
bazowego Dockerfile'a i nie obiecuj obrazu pochodnego, którego runner
nie zbuduje.

### 6. Bramka: validate

Kolejno, aż zielone:

1. `bench validate --offline` — schematy i spójność bez sieci.
2. `bench validate` — dodatkowo klonowalność repo bazowych i istnienie
   pinów (dla prywatnych repo wymaga skonfigurowanego dostępu — to
   pierwszy realny test sekretów z kroku 4).
3. Jeśli zadania mają deklaracje `reference`: `bench validate --assert`.

### 7. Smoke run

Budżet `defaults.max_cost_usd` jest już ustawiony (krok 3) — nie pytasz
o zgodę na pojedynczy run (zasada 6). Lokalnie:

```
bench run --smoke --tasks demo-hello-bench --models <najtańszy oceniany>
bench evaluate --run <katalog runu>
```

Czytasz `result.json`: total, koszt, czas. Potem właściwy test wiringu
end-to-end: `workflow_dispatch` workflow `bench-run` w GH Actions (to
jedyne miejsce, gdzie sekrety repo faktycznie pracują). Nieudany smoke
= wracasz do kroku, którego dotyczy przyczyna, z artefaktami w ręku.

### 8. PR "wiring instancji"

Gałąź `bench-wiring/<opis>`, opis wg [PR_TEMPLATE.md](PR_TEMPLATE.md):
decyzje (repo, modele, sędzia) z uzasadnieniem, checklista sekretów ze
statusem obecności, dowody (wyjście `validate`, wynik smoke runu
z kosztem), sekcja "Skutki dla porównywalności" (pierwsza era: sędzia +
wersje rubryk; co ją w przyszłości zamknie).
