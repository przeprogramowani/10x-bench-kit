---
name: bench-build
description: >-
  Buduje zadania benchmarku z oczekujących zleceń w backlogu
  (`tasks/backlog.md`): rozdziela zlecenia na subagentów, a każdy subagent
  wykonuje pełne autorstwo zadania (pin, overlay, prompt, asercje, wagi,
  samosprawdzenie na referencji) i wychodzi PR-em. Użyj, gdy użytkownik
  chce zbudować zadania z backlogu albo mówi "bench-build / zbuduj
  zadania / przerób backlog".
---

# bench-build — budowa zadań z backlogu

Orkiestrujesz budowę zadań: czytasz zlecenia `pending`
z `tasks/backlog.md`, rozdzielasz je na subagentów i pilnujesz statusów.
Właściwe autorstwo zadania — pin, overlay, prompt, asercje, wagi,
samosprawdzenie, PR — wykonuje **subagent** wg procedury
[TASK_AUTHORING.md](TASK_AUTHORING.md), po jednym zleceniu na
subagenta.

**Pusty backlog**: jeśli `tasks/backlog.md` nie istnieje albo nie ma
wpisów `pending`, poinformuj użytkownika, że zlecenia tworzy się
najpierw skillem **bench-new-task** (krótki wywiad → wpis w backlogu),
i zakończ — nie wymyślaj zadań sam.

## Twarde zasady

1. **Orkiestrator nie autoruje.** Ty nie wybierasz pinów, nie piszesz
   promptów ani asercji — to robią subagenci wg TASK_AUTHORING.md.
   Twoja praca: zakres, przygotowanie wspólnych zasobów, fan-out,
   statusy, zbiorczy raport.
2. **Zlecenie jest kontraktem.** Subagent buduje to, co mówi wpis
   backlogu — decyzje projektowe zapadły w bench-new-task. Luk we
   wpisie nie łatasz domysłami: niekompletne zlecenie wraca do
   użytkownika (albo do bench-new-task), nie do budowy.
3. **Jedno zlecenie = jedna gałąź + jeden PR.** Zadania z jednej paczki
   nie zlewają się w zbiorczy PR — każde ma własne dowody z referencji
   i własną erę.
4. **Statusy w backlogu są prawdą.** Przed startem subagenta wpis
   przechodzi na `in-progress`, po zakończeniu na `done (PR #N)` albo
   wraca na `pending` z notatką o przyczynie. Backlog nie wpływa na
   scoring — jego aktualizacje commituj prosto na master. Backlogu nie
   commituj do gałęzi zadań.
5. **Równolegle tylko w izolacji.** Subagenci budują równolegle
   wyłącznie, gdy mechanizm subagentów twojego narzędzia daje każdemu
   izolowaną kopię repo (np. osobny git worktree) — dwóch agentów
   w jednym drzewie roboczym nadpisuje sobie nawzajem gałęzie i pliki.
   Bez izolacji buduj sekwencyjnie. Przy równoległości ogranicz się do
   2–3 subagentów naraz (kontenery oceny konkurują o maszynę).
6. **Wspólne zasoby przygotuj raz, przed fan-outem.** Zrób
   `git fetch origin` w klonach `.repos/<nazwa>/` potrzebnych rep
   bazowych (brakujące sklonuj — konwencja z AGENTS.md) i zabroń
   subagentom fetchowania: równoległe fetche w jednym klonie ścigają
   się o locki gita.
7. **Budżet zamiast rytuału zgody.** Kosztów pilnuje
   `defaults.max_cost_usd` w bench.config.yaml; po budowie zbierz
   koszty z raportów subagentów i podaj sumę. Zgody użytkownika wymaga
   tylko podnoszenie budżetu.
8. **Nie dotykaj `.bench-kit/`** ani katalogów zadań spoza budowanej
   paczki; zasady zakresu z TASK_AUTHORING.md obowiązują subagentów,
   a ciebie ich suma.

## Procedura

### 1. Zakres

Wczytaj `tasks/backlog.md`, wypisz zlecenia `pending` (nazwa + jedno
zdanie). Domyślnie budujesz wszystkie; jeśli użytkownik wskazał
podzbiór w wywołaniu, buduj wskazane. Zlecenia niekompletne wobec
schematu wpisu (BACKLOG_TEMPLATE.md w bench-new-task) odłóż z listą
braków — do uzupełnienia, nie do budowy.

### 2. Przygotowanie

- `bench validate --offline` na starcie: jeśli instancja jest czerwona
  z powodów niezwiązanych z paczką, zgłoś to użytkownikowi zanim
  cokolwiek zbudujesz — subagenci nie będą w stanie odróżnić swojej
  czerwieni od zastanej.
- Świeże klony `.repos/` dla wszystkich rep bazowych paczki (zasada 6).
- Ustal tryb: równolegle (izolacja dostępna, 2–3 naraz) czy
  sekwencyjnie.

### 3. Fan-out

Dla każdego zlecenia: przestaw status na `in-progress` (commit na
master), uruchom subagenta mechanizmem twojego narzędzia i przekaż mu
w prompcie:

- pełny wpis zlecenia z backlogu, verbatim;
- polecenie przeczytania i wykonania
  `.agents/skills/bench-build/TASK_AUTHORING.md` (ścieżka wg katalogu
  skilli instancji) — to jest jego procedura, z twardymi zasadami
  i szablonem PR-a;
- korzeń instancji i przypomnienie: nie fetchować w `.repos/`,
  nie dotykać backlogu, pracować tylko w swoim zakresie;
- format raportu końcowego: nazwa zadania, gałąź, URL PR-a, skrót
  dowodów z referencji (wyniki komend), koszt, problemy.

Subagent może zakończyć odmową z powodem (np. zlecenie niewykonalne na
aktualnym repo, bug nieobserwowalny) — to poprawny wynik, nie porażka
orkiestracji.

### 4. Zbiór wyników i statusy

Po każdym subagencie zaktualizuj wpis: `done (PR #N)` przy otwartym
PR-rze, powrót na `pending` z notatką przy odmowie/błędzie. Commit
backlogu na master. Nie poprawiaj sam pracy subagenta w jego gałęzi —
nieudane zlecenie wraca do kolejki z diagnozą.

### 5. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan paczki
(ile PR-ów otwartych, ile zleceń wróciło do `pending`, suma kosztów),
**jedna** rekomendacja z jednozdaniowym uzasadnieniem, maksymalnie dwie
alternatywy z ceną, oraz — oddzielnie — to, co czeka na decyzję
człowieka (merge PR-ów to zawsze człowiek). Typowe przejścia:

- **Zadanie ze składową sędziego** → **bench-rubric na gałęzi tego
  zadania, PRZED mergem** — kalibracja świeżej rubryki przed pierwszym
  użyciem nie zamyka ery; po policzonych wynikach zamyka.
- **Zlecenia wróciły do `pending`** → uzupełnić wpisy (bench-new-task)
  albo ponowny bench-build na podzbiorze.
- **Backlog pusty, PR-y otwarte** → merge + pełny run.
