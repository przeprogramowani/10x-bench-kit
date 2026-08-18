---
name: bench-explain-results
description: >-
  Diagnozuje wyniki runu benchmarku: schodzi z report.json przez
  result.json do artefaktów próby (agent.log, patch.diff, checks.json,
  judge.json) i klasyfikuje przyczynę — wina modelu, wina zadania albo
  wina infrastruktury. Wyjście to komentarz lub issue z dowodami, nigdy
  zmiana scoringu. Użyj po runie, gdy wynik zaskakuje, model spadł
  między runami, próba padła, albo użytkownik pyta "czemu ten model
  dostał tyle / przeanalizuj run".
---

# bench-explain-results — czytanie wyników

Wynik próby to koniec łańcucha dowodów: report → result → artefakty.
Twoja praca to zejść po tym łańcuchu i **nazwać przyczynę** jedną
z trzech klas: *wina modelu* (leaderboard mówi prawdę), *wina zadania*
(asercja/overlay/prompt/rubryka karzą nie za to, co trzeba), *wina
infrastruktury* (kontener, timeout, adapter, sekrety). Diagnoza kończy
się komentarzem lub issue z delegacją naprawy — nigdy zmianą wyników.

## Twarde zasady

1. **Nigdy nie zmieniasz scoringu.** Żadnych edycji `result.json`,
   `report.json`, gałęzi `bench-data`, zadań, asercji, rubryk ani
   `bench.config.yaml`. Nawet gdy bug asercji jest oczywisty: diagnoza
   → issue → naprawa osobnym skillem (bench-build / bench-refresh-task /
   bench-rubric), nigdy edycją w ramach triage. Artefakty prób są
   read-only.
2. **Hipoteza → dowód komendą.** Podejrzenie wobec asercji lub sędziego
   weryfikujesz runnerem (`bench assert`, `bench judge`), nie "na oko".
   Diagnoza bez reprodukcji to spekulacja — oznacz ją jako taką.
3. **Klasyfikacja obowiązkowa.** Każda diagnoza kończy się jedną z
   trzech klas + dowodem. Gdy dowodów brak, napisz wprost, czego
   zabrakło (np. artefakty wygasły) — nie zgaduj klasy.
4. **Ery przed porównaniami.** "Model spadł między runami" najpierw
   sprawdź na krotce stamps (`template_version`, `task_hash`,
   `judge_model`, `rubric_version`) — różne ery to nie regresja modelu,
   tylko zmiana miary. Leaderboard ich nie miesza; ty też nie.
5. **Budżet zamiast rytuału zgody.** Re-judge i re-assert kosztują
   (wywołania sędziego, kontenery), ale pilnuje ich budżet instancji —
   po serii raportuj koszt faktyczny; zgody wymaga tylko seria wyraźnie
   większa niż zwykle albo podnoszenie budżetu.
6. **Materiały oceny linkuj, nie kopiuj.** W komentarzach/issue cytuj
   minimalne fragmenty potrzebne do dowodu i ścieżki w repo instancji;
   nie przeklejaj całych ukrytych testów ani rubryk.

## Gdzie są artefakty

- **Run lokalny**: `out/<run-id>/<zadanie>/<model>/trial-N/`.
- **Run w CI**: `gh run download <run-id> -R <repo-instancji>` —
  artefakty `results-<slug>` (per model×zadanie, ten sam layout co
  lokalnie) + `report`. Artefakty CI wygasają; historia samych raportów
  jest trwała na gałęzi `bench-data` (`runs/<run_id>.json`).
- **Pliki próby**: `trial.json` (metadane), `execution.json` (kod
  wyjścia agenta; 124 = timeout), `agent.log` (pełne wyjście OpenCode),
  `patch.diff` (praca agenta vs commit startowy), `metrics.json`
  (koszt/tokeny/czas; `"incomplete": true` = adapter nie znalazł
  danych), `container.log` (istnieje tylko przy awarii infrastruktury),
  `signal.json` (istnieje tylko gdy agent zginął od sygnału także po
  retry — nazwa sygnału, hint, limit pamięci, ogon logu; taka próba ma
  `resource_kill: true` w trial.json i jest wyłączona z oceny),
  `eval-plan.json`, `checks.json` (score per asercja nie-LLM-owa),
  `judge.json` (werdykty + surowa odpowiedź sędziego), `result.json`
  (scores, total, stemple er).

## Procedura

### 1. Pytanie i zakres

Ustal, co diagnozujesz: pojedyncza próba / model×zadanie / cały run /
zmiana między runami. Przy porównaniach między runami — najpierw
zasada 4 (identyczne stamps, czy nie).

### 2. Z góry: report.json

- mediany total/koszt/czas per model×zadanie — co odstaje,
- **pass@1 vs pass@k**: rozjazd (np. 0.33 vs 1.0) = niestabilność,
  nie niemożność — wybierz do zejścia parę prób: zaliczoną i nie,
- total ≈ 0 nie ma jednej przyczyny — pusty diff (agent nie działał),
  destrukcyjne nadpisanie pliku i praca oceniona na 0 wyglądają
  w report.json identycznie. Nie wnioskuj z mediany; rozstrzygają
  artefakty (krok 4).

### 3. W dół: result.json próby

Która składowa ciągnie total w dół (`scores.static/tests/e2e/judge`;
`null` = waga 0, nieliczona). Porównaj z próbami, które przeszły —
różnica zwykle wskazuje jedną składową, nie wszystkie.

### 4. Artefakty: objaw → ścieżka

| Objaw | Gdzie patrzeć | Typowe rozstrzygnięcie |
|---|---|---|
| pusty/prawie pusty `patch.diff` | `agent.log` | model nie wywołuje narzędzi (np. literalny `<tool_code` wypisany jako tekst) → wina modelu; prompt niejasny → wina zadania |
| `execution.json` exit 124 | `agent.log` (czy był postęp) | kręcenie się w kółko → wina modelu; robił postęp, zabrakło czasu → timeout za krótki, wina zadania |
| `execution.json` exit 137 (lub inny 128+N) bez timeoutu | `signal.json`, ogon `agent.log` | agent zabity sygnałem — SIGKILL w trakcie instalacji/builda = wyczerpanie zasobów → wina infrastruktury (runner od 0.11.0 sam to klasyfikuje: retry, `resource_kill`, wyłączenie z oceny; brak `signal.json` = run sprzed tej wersji, klasyfikuj ręcznie) |
| istnieje `container.log` | `container.log`, `execution.json` | kontener padł przed agentem → wina infrastruktury |
| `trial.json` z `provider_error: true` | `agent.log` (5xx/429), `provider-error-attempt-1/` | przejściowa awaria providera; runner zrobił 1 retry — jeśli i on padł, wina infrastruktury (provider), nie modelu |
| `metrics.json` incomplete | `agent.log`, storage OpenCode | adapter/wersja OpenCode → wina infrastruktury |
| asercja 0 w `checks.json` | log asercji + `bench assert --task <t> --patch <wzorzec.diff>` | czerwona także na wzorcu → bug asercji, wina zadania; zielona na wzorcu → wina modelu |
| judge 0 w `judge.json` | surowa odpowiedź w `judge.json` | brak poprawnego JSON-a / zły format → kontrakt rubryki, wina zadania; poprawny werdykt z uzasadnieniem → czytaj kryteria |
| judge rozjeżdża się między próbami przy podobnych diffach | `bench judge --task <t> --patch <patch.diff próby>` ×3 | duży rozrzut → rubryka do kalibracji (bench-rubric), wina zadania |
| duży `patch.diff` poza zakresem | prompt.md + kryterium scope w werdykcie | prompt nie stawia granic → wina zadania; stawia → wina modelu |
| niepusty `patch.diff`, a judge 0 | nagłówki hunków (`@@ -1,N +1,M @@` na całym pliku) | destrukcyjne nadpisanie zamiast edycji przyrostowej → wina modelu (werdykt sędziego to potwierdzi w uzasadnieniach) |

Reprodukcje z prawej kolumny wykonuj wg zasad 2 i 5 (dowód komendą,
koszty jawne) — z dwoma zastrzeżeniami, bo reprodukcja to najdroższa
czynność w całym skillu:

- **Wyczerpaj artefakty przed pierwszą reprodukcją.** Artefakty są już
  zapłacone; reprodukcja kosztuje kontener albo wywołania sędziego.
  Bardzo często pełna diagnoza jest w `patch.diff` i ogonie logu — np.
  sam kod wyjścia procesu plus ostatnie linie logu jednoznacznie
  wskazują wyczerpanie zasobów, bez uruchamiania czegokolwiek.
- **Grupuj reprodukcje.** Jeśli musisz odtworzyć asercję lub werdykt,
  zrób to dla wszystkich podejrzanych prób naraz, nie próba po próbie
  w miarę czytania: `bench assert --task <t> --patch <trial-1/patch.diff>
  --patch <trial-2/patch.diff> …` to jedno wejście do środowiska,
  N wyników; werdykty sędziego puszczaj równolegle w tle.

### 5. Klasyfikacja i delegacja

**Reguła stopu:** klasa przyczyny jest wyjściem skilla — gdy dowody
wystarczają do jej wskazania, kończysz. Dokładniejsza analiza wewnątrz
klasy należy do skilla naprawczego, który i tak zacznie od własnych
pomiarów. I **diagnozy powtarzalne kieruj do skilla źródłowego**: jeśli
ta sama klasa awarii wraca (wzorzec, nie incydent), wyjściem triage'u
jest poprawka procedury w skillu, który ją produkuje — inaczej płacisz
ten sam triage co run.

- **Wina modelu** — wynik zostaje, leaderboard mówi prawdę. W wyjściu
  opisz wzorzec zachowania (to cenniejsze niż liczba: "gubi tool
  calling", "nie trzyma zakresu").
- **Wina zadania** — issue w repo instancji + delegacja: asercja /
  overlay / prompt / timeout → bench-refresh-task (lub bench-new-task +
  bench-build dla nowego zadania), rubryka → bench-rubric. Zaznacz
  w issue, które
  wyniki bieżącej ery są skażone — era i tak zamknie się przy naprawie.
- **Wina infrastruktury** — issue w repo template'u (runner / workflow /
  obraz) z `container.log` / `execution.json`; wyniki dotkniętych prób
  oznacz jako nieinterpretowalne, run do powtórzenia po naprawie.

### 6. Wyjście

Komentarz (przy PR/runie) albo issue wg
[EXPLAIN_TEMPLATE.md](EXPLAIN_TEMPLATE.md): symptom → łańcuch dowodów →
klasa → rekomendacja → koszt triage. Scoringu nie zmieniasz (zasada 1);
jeśli naprawa jest pilna, uruchom właściwy skill osobno, po zgodzie
użytkownika.

### 7. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan jednym
zdaniem (co zdiagnozowane, gdzie issue), **jedna** rekomendacja
z jednozdaniowym uzasadnieniem, maksymalnie dwie alternatywy z ceną,
oraz — oddzielnie — to, co czeka na decyzję człowieka. Typowe przejścia
wg klasy:

- **wina zadania** → bench-refresh-task albo bench-new-task + bench-build —
  zależnie od tego, czy naprawa zachowuje intencję zadania;
- **wina rubryki** → bench-rubric;
- **wina infrastruktury** → run do powtórzenia po naprawie — wyniki
  dotkniętych prób są nieinterpretowalne;
- **wina modelu** → nic w benchmarku — to jest odpowiedź, nie problem
  do naprawy.

Nie proponuj kolejnego runu, dopóki poprzedni nie jest zinterpretowany:
jeśli w runie były próby zabite przez infrastrukturę, drugi run powtórzy
tę samą awarię i tę samą fakturę.
