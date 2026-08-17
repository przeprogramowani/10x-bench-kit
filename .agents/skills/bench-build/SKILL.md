---
name: bench-build
description: >-
  Buduje zadania benchmarku z oczekujących zleceń w backlogu
  (`tasks/backlog.md`): rozdziela zlecenia na subagentów, a każdy subagent
  wykonuje pełne autorstwo zadania (pin, overlay, prompt, asercje, wagi,
  samosprawdzenie na referencji) i zostawia gotowe pliki w drzewie
  roboczym z raportem dowodów — bez gita. Użyj, gdy użytkownik
  chce zbudować zadania z backlogu albo mówi "bench-build / zbuduj
  zadania / przerób backlog".
---

# bench-build — budowa zadań z backlogu

Orkiestrujesz budowę zadań: czytasz zlecenia `pending`
z `tasks/backlog.md`, rozdzielasz je na subagentów i pilnujesz statusów.
Właściwe autorstwo zadania — pin, overlay, prompt, asercje, wagi,
samosprawdzenie — wykonuje **subagent** wg procedury
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
3. **Zero gita — pliki i raporty, nic więcej.** Ani ty, ani subagenci
   nie commitujecie, nie tworzycie gałęzi, nie pushujecie. Wynik paczki
   to gotowe katalogi `tasks/<nazwa>/` (+ nowe asercje w puli) w drzewie
   roboczym oraz raport per zadanie wg
   [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) z dowodami z referencji —
   co z tym dalej (commit, PR, review, odrzucenie), decyduje wyłącznie
   użytkownik. Zadania z jednej paczki trzymaj rozdzielne: osobne
   katalogi, osobne raporty, żadnego zlewania.
4. **Statusy w backlogu są prawdą.** Przed startem subagenta wpis
   przechodzi na `in-progress`, po zakończeniu na `done` albo wraca na
   `pending` z notatką o przyczynie. Backlog to edycja pliku, nie
   commit (zasada 3).
5. **Równolegle tylko w izolacji.** Subagenci budują równolegle
   wyłącznie, gdy mechanizm subagentów twojego narzędzia daje każdemu
   izolowaną kopię repo (np. osobny git worktree) — dwóch agentów
   w jednym drzewie roboczym nadpisuje sobie nawzajem pliki. Bez
   izolacji buduj sekwencyjnie. Przy równoległości ogranicz się do
   2–3 subagentów naraz (kontenery oceny konkurują o maszynę),
   a po ukończeniu subagenta przenieś jego pliki (listę ma raport)
   z izolowanej kopii do drzewa roboczego instancji — kopiowanie
   plików, nie operacje gita.
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

Dla każdego zlecenia: przestaw status na `in-progress` (edycja
backlogu), uruchom subagenta mechanizmem twojego narzędzia i przekaż mu
w prompcie:

- pełny wpis zlecenia z backlogu, verbatim;
- polecenie przeczytania i wykonania
  `.agents/skills/bench-build/TASK_AUTHORING.md` (ścieżka wg katalogu
  skilli instancji) — to jest jego procedura, z twardymi zasadami
  i szablonem raportu;
- korzeń instancji i przypomnienie: zero gita, nie fetchować
  w `.repos/`, nie dotykać backlogu, pracować tylko w swoim zakresie;
- format raportu końcowego: REPORT_TEMPLATE.md (lista plików, dowody
  z referencji, koszt) + problemy.

Subagent może zakończyć odmową z powodem (np. zlecenie niewykonalne na
aktualnym repo, bug nieobserwowalny) — to poprawny wynik, nie porażka
orkiestracji.

### 4. Zbiór wyników i statusy

Po każdym subagencie: w trybie izolowanym przenieś jego pliki do
drzewa instancji (zasada 5), zaktualizuj wpis na `done` albo przywróć
`pending` z notatką przy odmowie/błędzie. Nie poprawiaj sam pracy
subagenta — nieudane zlecenie wraca do kolejki z diagnozą, nie z twoją
łatką.

### 5. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: stan paczki
(ile zadań gotowych w drzewie roboczym — z listą plików i raportami
per zadanie, ile zleceń wróciło do `pending`, suma kosztów), **jedna**
rekomendacja z jednozdaniowym uzasadnieniem, maksymalnie dwie
alternatywy z ceną, oraz — oddzielnie — to, co czeka na decyzję
człowieka. Los zbudowanych plików — commit, PR, review, odrzucenie —
to ZAWSZE decyzja użytkownika; raporty dostarczają mu do niej dowody.
Typowe przejścia:

- **Zadanie ze składową sędziego** → **bench-rubric, PRZED pierwszym
  runem** — kalibracja świeżej rubryki przed pierwszym użyciem nie
  zamyka ery; po policzonych wynikach zamyka.
- **Zlecenia wróciły do `pending`** → uzupełnić wpisy (bench-new-task)
  albo ponowny bench-build na podzbiorze.
- **Zadania gotowe i przyjęte przez użytkownika** → pełny run.
