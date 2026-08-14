---
name: bench-triage
description: >-
  Diagnozuje wyniki runu benchmarku: schodzi z report.json przez
  result.json do artefaktów próby (agent.log, patch.diff, checks.json,
  judge.json) i klasyfikuje przyczynę — wina modelu, wina zadania albo
  wina infrastruktury. Wyjście to komentarz lub issue z dowodami, nigdy
  zmiana scoringu. Użyj po runie, gdy wynik zaskakuje, model spadł
  między runami, próba padła, albo użytkownik pyta "czemu ten model
  dostał tyle / przeanalizuj run".
---

# bench-triage — czytanie wyników

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
   → issue → naprawa osobnym skillem (bench-task / bench-refresh /
   bench-rubric) przez PR. Artefakty prób są read-only.
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
| istnieje `container.log` | `container.log`, `execution.json` | kontener padł przed agentem → wina infrastruktury |
| `trial.json` z `provider_error: true` | `agent.log` (5xx/429), `provider-error-attempt-1/` | przejściowa awaria providera; runner zrobił 1 retry — jeśli i on padł, wina infrastruktury (provider), nie modelu |
| `metrics.json` incomplete | `agent.log`, storage OpenCode | adapter/wersja OpenCode → wina infrastruktury |
| asercja 0 w `checks.json` | log asercji + `bench assert --task <t> --patch <wzorzec.diff>` | czerwona także na wzorcu → bug asercji, wina zadania; zielona na wzorcu → wina modelu |
| judge 0 w `judge.json` | surowa odpowiedź w `judge.json` | brak poprawnego JSON-a / zły format → kontrakt rubryki, wina zadania; poprawny werdykt z uzasadnieniem → czytaj kryteria |
| judge rozjeżdża się między próbami przy podobnych diffach | `bench judge --task <t> --patch <patch.diff próby>` ×3 | duży rozrzut → rubryka do kalibracji (bench-rubric), wina zadania |
| duży `patch.diff` poza zakresem | prompt.md + kryterium scope w werdykcie | prompt nie stawia granic → wina zadania; stawia → wina modelu |
| niepusty `patch.diff`, a judge 0 | nagłówki hunków (`@@ -1,N +1,M @@` na całym pliku) | destrukcyjne nadpisanie zamiast edycji przyrostowej → wina modelu (werdykt sędziego to potwierdzi w uzasadnieniach) |

Reprodukcje z prawej kolumny wykonuj wg zasad 2 i 5 (dowód komendą,
koszty jawne).

### 5. Klasyfikacja i delegacja

- **Wina modelu** — wynik zostaje, leaderboard mówi prawdę. W wyjściu
  opisz wzorzec zachowania (to cenniejsze niż liczba: "gubi tool
  calling", "nie trzyma zakresu").
- **Wina zadania** — issue w repo instancji + delegacja: asercja /
  overlay / prompt / timeout → bench-refresh (lub bench-task dla
  nowego zadania), rubryka → bench-rubric. Zaznacz w issue, które
  wyniki bieżącej ery są skażone — era i tak zamknie się przy naprawie.
- **Wina infrastruktury** — issue w repo template'u (runner / workflow /
  obraz) z `container.log` / `execution.json`; wyniki dotkniętych prób
  oznacz jako nieinterpretowalne, run do powtórzenia po naprawie.

### 6. Wyjście

Komentarz (przy PR/runie) albo issue wg
[TRIAGE_TEMPLATE.md](TRIAGE_TEMPLATE.md): symptom → łańcuch dowodów →
klasa → rekomendacja → koszt triage. Scoringu nie zmieniasz (zasada 1);
jeśli naprawa jest pilna, uruchom właściwy skill osobno, po zgodzie
użytkownika.
