---
name: bench-refresh
description: >-
  Odświeża przeterminowane zadanie benchmarku: nowy pinowany commit repo
  bazowego, ponowna weryfikacja overlaya, asercji i deklaracji reference
  na nowej referencji, aktualizacja expires — domknięte PR-em, który
  otwiera nową erę zadania. Użyj po warningu `expires` z bench validate,
  gdy repo bazowe odjechało od pina, albo gdy użytkownik mówi "odśwież
  zadanie / refresh taska / zadanie się przeterminowało".
---

# bench-refresh — starzenie zadań

Zadanie jest przypięte do commita sprzed miesięcy, a repo bazowe żyje.
Refresh to nie podmiana SHA: to ponowne przejście zasady **"testuj na
referencji, zanim zaproponujesz"** dla całego zadania na nowym pinie —
overlay, asercje, wzorcowe rozwiązanie, deklaracje `reference`. Zmiana
czegokolwiek w `tasks/<nazwa>/` zmienia `task_hash`, więc refresh
z definicji otwiera nową erę zadania — PR mówi to wprost. Jeśli zadanie
na nowym kodzie traci sens, mówisz to wprost i proponujesz wycofanie,
nie sztuczne ratowanie.

## Twarde zasady

1. **Wyjście wyłącznie przez PR.** Gałąź `bench-refresh/<nazwa>` + PR wg
   [PR_TEMPLATE.md](PR_TEMPLATE.md), człowiek merguje. Nigdy commit do
   mastera instancji.
2. **Refresh = nowa era zadania.** Każda zmiana katalogu zadania zmienia
   `task_hash`. PR ma sekcję "Skutki dla porównywalności": dotychczasowe
   wyniki zadania zostają widoczne jako historia, nowe nie są z nimi
   porównywalne. Nie ma refresha "neutralnego dla scoringu".
3. **Testuj na referencji od nowa.** Żadna asercja, deklaracja
   `reference` ani overlay nie przechodzi do PR-a "bo działały na starym
   pinie" — każdy dowód wykonujesz ponownie na nowym pinie przez
   `bench assert` / `bench judge` / `bench validate --assert`.
4. **Refresh zachowuje intencję.** Adaptujesz prompt/overlay/asercje do
   nowego kodu minimalnie; zmiana tego, CO zadanie mierzy, to nowe
   zadanie (skill bench-task), nie refresh.
5. **Nie zmieniaj in-place asercji współdzielonych.** Asercja z puli
   używana przez inne zadania zmienia ich scoring bez śladu w stemplach
   (`task_hash` obejmuje tylko katalog zadania). Jeśli asercja wymaga
   zmiany, a używa jej ktoś jeszcze: nowa wersja w puli (np.
   `tests/<nazwa>-v2`) + podmiana w `evaluation[]` tego zadania.
6. **Izolacja materiałów oceny.** Jak w bench-task: nic z
   `evaluation-pool/` nie trafia do `tasks/<nazwa>/`; wzorcowe
   rozwiązanie żyje w `evaluation-pool/judge/<zadanie>-calibration/`,
   nigdy w `tasks/`.
7. **Nie dotykaj `.bench-kit/`** ani cudzych zadań.
8. **Budżet zamiast rytuału zgody.** Kosztów pilnuje
   `defaults.max_cost_usd` w bench.config.yaml — nie pytaj o zgodę przed
   próbnym runem czy wywołaniem sędziego; po wykonaniu raportuj koszt
   faktyczny. Zgody wymaga tylko podnoszenie budżetu.

## Narzędzia runnera

Z korzenia instancji: `node --experimental-strip-types
.bench-kit/runner/src/index.ts <komenda>` (dalej: `bench <komenda>`).

- `bench validate` — warning `zadanie przeterminowane (expires: …)` to
  kanoniczny trigger tego skilla; po refreshu bramka z `--assert`.
- `bench assert <ref...> --task <nazwa> [--no-overlay] [--patch <plik>]`
  — dowody obserwowalności i wykonalności na nowym pinie.
- `bench judge --task <nazwa> --patch <plik>` — werdykt sędziego na
  zaktualizowanym wzorcu / pustym diffie.
- `bench run` + `bench evaluate` — opcjonalny smoke run (krok 7).

## Procedura

### 1. Rozpoznanie

Przeczytaj, zanim cokolwiek zmienisz:

- `bench validate` — który warning `expires` (albo powód refresha
  podany wprost),
- `tasks/<nazwa>/`: task.yaml (repo, pin, evaluation, reference, wagi,
  expires), prompt.md, overlay/,
- materiały powiązane: wzorcowe rozwiązanie i zbiór kalibracyjny
  w `evaluation-pool/judge/<zadanie>-calibration/` (będą potrzebne
  na nowym pinie),
- ostatnie wyniki zadania (report/bench-data) — po refreshu przestaną
  być porównywalne, warto wiedzieć, co zamykasz.

### 2. Nowy pin

Zaproponuj świeży, stabilny commit repo bazowego (najlepiej ostatni
zielony na CI), pełny SHA. Pracuj na lokalnym klonie `.repos/<nazwa>/`
(konwencja z AGENTS.md; brak → sklonuj tam) — po `git fetch origin`,
bo nowy pin musi istnieć na remote. Obejrzyj, co zaszło w obszarze
zadania:

```
git log --oneline <stary-pin>..<nowy-pin> -- <ścieżki zadania>
```

To wejście do kroku 3. Zweryfikuj, że projekt na nowym pinie się
buduje, a pliki, których zadanie dotyczy, istnieją.

Jeśli stary pin to nadal HEAD repo bazowego, refresh sprowadza się do
odnowienia `expires` — dowody z kroków 4–5 i tak wykonujesz (potwierdzasz,
że nic nie zgniło), a PR wprost mówi, że to wciąż nowa era (każda zmiana
task.yaml zmienia `task_hash`), mimo identycznego pina i asercji.

### 3. Czy zadanie nadal ma sens

Trzy możliwe wyjścia — nazwij, które zachodzi:

- **Sens bez zmian** — obszar zadania nietknięty między pinami; dalej.
- **Sens po adaptacji** — pliki/nazwy/architektura odjechały, ale
  intencja zadania stoi; adaptujesz minimalnie (zasada 4).
- **Brak sensu** — bug z overlaya naprawiony w repo, moduł usunięty
  lub przepisany, funkcjonalność już istnieje. Powiedz to wprost
  i zaproponuj wycofanie zadania (PR usuwający katalog, z sekcją er) —
  zadanie ratowane na siłę mierzy szum, nie pracę agenta.

### 4. Overlay na nowym pinie

Pliki overlay **nadpisują** pliki repo przy starcie próby. Na nowym
pinie stary overlay może nadpisywać świeższą wersję pliku — czyli
cofać zmiany repo i mierzyć nie to, co trzeba. Sprawdź diff każdego
pliku overlaya względem jego odpowiednika na nowym pinie: overlay ma
się różnić od nowej referencji **wyłącznie seedem buga**. Jeśli plik
w repo odjechał — przenieś seed buga na jego nową wersję.

Potem dowód obserwowalności od nowa, jak w bench-task:

- stan startowy (nowy pin + overlay): miara pracy czerwona —
  `bench assert <ref> --task <nazwa>` → exit 1,
- kontrdowód: overlay modyfikujący istniejące pliki → `--no-overlay`
  zielone; overlay dodający pliki → wzorzec zielony (`--patch`).

### 5. Asercje i wzorzec

- **Wzorcowe rozwiązanie**: stary `wzorzec.diff` może się nie
  aplikować na nowy stan startowy — zaktualizuj go i zapisz obok
  zbioru kalibracyjnego.
- **Pełna tabela "testuj na referencji"** dla wszystkich asercji
  zadania: stan startowy → miary pracy czerwone, guardy zielone;
  wzorzec → wszystko zielone. Deklaracje `reference` w task.yaml
  zostają albo zmieniają się świadomie (z uzasadnieniem w PR).
- **Asercje współdzielone**: zmiany tylko przez nową wersję w puli
  (zasada 5).
- **Sędzia**: zbiór kalibracyjny aplikował się na stary pin. Jeśli
  diffy kalibracyjne da się przenieść — przenieś i przelicz
  (`bench judge`); jeśli nie — odnotuj w PR, że zbiór dotyczy starej
  ery, a rekalibracja (skill bench-rubric) jest do zrobienia przy
  najbliższym dryfie. Rubryki nie zmieniasz w ramach refresha.

### 6. Nowa data `expires`

Ustaw świadomie, tym samym horyzontem co poprzednio (typowo kilka
miesięcy). Data to obietnica "do tego czasu pin jest reprezentatywny",
nie formalność.

### 7. Samosprawdzenie

Kolejno, każde musi przejść:

1. `bench validate --assert` — zielone, bez warningu `expires`.
2. Wzorzec: `bench assert --task <nazwa> --patch <wzorzec.diff>` →
   exit 0; przy składowej judge — `bench judge` na wzorcu wysoki.
3. Pusty diff nie zalicza: miara pracy czerwona na starcie; przy
   składowej judge — `bench judge --patch <pusty.diff>` niski.
4. Próbny `bench run --smoke` + `evaluate` na jednym tanim modelu
   (budżet instancji pilnuje kosztów — zasada 8).

### 8. PR

Gałąź `bench-refresh/<nazwa>`, opis wg [PR_TEMPLATE.md](PR_TEMPLATE.md):
stary → nowy pin z tym, co zaszło między nimi; adaptacje z uzasadnieniem;
komplet dowodów z nowej referencji; sekcja "to otwiera nową erę tego
zadania"; koszt samosprawdzenia.
