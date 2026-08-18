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
5. **Równolegle to domyślny tryb.** Zlecenia z jednej paczki są
   niezależne: każdy subagent pisze wyłącznie do `tasks/<swoje-zadanie>/`
   i do własnych katalogów w `evaluation-pool/`, a `.repos/<nazwa>/`
   traktuje read-only — nie ma więc czego sobie nadpisywać i budowa
   w jednym drzewie roboczym jest bezpieczna. Izolowana kopia repo
   (worktree) nie jest wymagana; bywa wręcz szkodliwa, bo `.repos/`
   jest w `.gitignore` i w świeżym worktree klonów po prostu nie ma.
   Ogranicz się do 2–3 subagentów naraz — nie z obawy o pliki, tylko
   dlatego, że kontenery oceny konkurują o maszynę. Kolejne zlecenia
   puszczaj falami, gdy paczka jest większa. Sekwencyjnie buduj tylko
   wtedy, gdy dwa zlecenia realnie celują w te same pliki (np. wspólna
   nowa asercja w puli) — wtedy powiedz to subagentom wprost albo
   ustaw je jedno po drugim. Jeśli mimo wszystko użyjesz izolowanych
   kopii, po ukończeniu subagenta przenieś jego pliki (listę ma raport)
   do drzewa roboczego instancji — kopiowanie plików, nie operacje gita.
6. **Wspólne zasoby przygotuj raz, przed fan-outem.** Zrób
   `git fetch origin` w klonach `.repos/<nazwa>/` potrzebnych rep
   bazowych (brakujące sklonuj — konwencja z AGENTS.md) i zabroń
   subagentom fetchowania: równoległe fetche w jednym klonie ścigają
   się o locki gita. To samo dotyczy `evaluation-pool/`: **inwentarz
   puli robisz ty, przed fan-outem** (zasada 6a niżej) — subagent
   szukający reużycia na własną rękę widzi tylko stan sprzed startu
   sąsiada i dopisze drugą asercję o tym samym znaczeniu pod inną
   nazwą. Po fan-oucie klon jest dla subagentów read-only:
   czytają z niego, a gdy potrzebują stanu na pinie, robią
   `git worktree add` pod nazwą unikalną dla swojego zadania — nigdy
   checkoutu na wspólnym HEAD. Przekaż im to w prompcie razem
   z nazwami zadań budowanych równolegle obok nich.
6a. **Pulę asercji rozstrzygasz przed fan-outem.** Równoległe
   subagenty nie widzą swojej pracy w toku, więc bez twojej decyzji
   dwa zlecenia potrzebujące tej samej asercji zbudują ją dwa razy pod
   różnymi nazwami — a duplikat w puli jest trwałym długiem: rozjeżdża
   się przy pierwszej poprawce i psuje reużycie kolejnym zadaniom.
   Dlatego przed startem:

   - **Zinwentaryzuj pulę**: wypisz istniejące `evaluation-pool/<typ>/
     <nazwa>/` z jednozdaniowym "co sprawdza" (wystarczy nagłówek
     `check.yaml`). Tę listę wkładasz każdemu subagentowi do promptu —
     reużycie ma być decyzją na podstawie faktów, nie własnego skanu.
   - **Zestaw ją z notatkami zleceń**: notatki z backlogu mówią, jakich
     asercji zlecenie potrzebuje. Wyłap pary zleceń celujące w to samo
     (np. dwa zadania chcące "brak odczytu `localStorage` na ścieżce
     SSR").
   - **Rozstrzygnij pokrycie** i przekaż decyzję w promptach:
     *pokrywa istniejąca asercja* → nazwij ją i każ reużyć zamiast
     tworzyć; *potrzebna nowa, wspólna dla dwóch zleceń* → wskaż
     **właściciela**, który ją tworzy, a drugie zlecenie puść dopiero
     po nim, z poleceniem reużycia gotowej nazwy; *nowe i rozłączne* →
     każdy buduje swoje, a ty narzucasz prefiks nazwy (nazwa zadania),
     żeby nazwy nie kolidowały.

   Jeśli duplikat wyjdzie dopiero z raportów, nie scalaj go sam
   (zasada 1) — odnotuj go użytkownikowi jako dług do rozstrzygnięcia.
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
- **Pin-kandydat per repo bazowe**: wskaż świeży commit istniejący na
  remote z dowodem zielonego CI (status checków z GitHub API) — SHA
  + dowód trafią do promptów subagentów. Kandydat jest domyślny, nie
  wiążący: subagent weryfikuje tylko, że **jego** zlecenie ma na nim
  sens, i może odstąpić z uzasadnieniem w raporcie. Bez tego kroku
  każdy subagent osobno przegląda historię i odpytuje CI o to samo.
- **Środowisko oceny gotowe przed fan-outem**: doprowadź do stanu,
  w którym jedno wejście do kontenera przechodzi — np. `bench assert`
  na dowolnym istniejącym zielonym zadaniu instancji. Obraz
  `bench-base`, zależności runnera i dostępność dockera to
  infrastruktura wspólna paczki: naprawiasz ją ty, raz, tutaj — a nie
  pierwszy subagent, który się na nią natknie, w ramach swojego
  zadania.
- Inwentarz `evaluation-pool/` + rozstrzygnięcie pokrycia asercji dla
  zleceń paczki (zasada 6a): co reużyć, co nowe i wspólne (z właścicielem),
  co nowe i rozłączne.
- Sprawdź, czy któreś dwa zlecenia celują w te same pliki — jeśli nie
  (przypadek domyślny), buduj równolegle, falami po 2–3 (zasada 5).
  Zlecenie czekające na wspólną asercję idzie w fali po jej właścicielu.

### 3. Fan-out

Dla każdego zlecenia: przestaw status na `in-progress` (edycja
backlogu), uruchom subagenta mechanizmem twojego narzędzia i przekaż mu
w prompcie:

- pełny wpis zlecenia z backlogu, verbatim;
- pin-kandydat dla repo bazowego zlecenia: SHA + dowód zielonego CI
  (krok 2) i zasada odstępstwa — kandydat jest domyślny, subagent
  weryfikuje sens swojego zlecenia na tym commicie, a odstąpienie
  wymaga uzasadnienia w raporcie;
- polecenie przeczytania i wykonania
  `.agents/skills/bench-build/TASK_AUTHORING.md` (ścieżka wg katalogu
  skilli instancji) — to jest jego procedura, z twardymi zasadami
  i szablonem raportu;
- korzeń instancji i przypomnienie: zero gita, nie fetchować
  w `.repos/` (klon jest read-only; własny stan tylko przez
  `git worktree add` pod unikalną nazwą), nie dotykać backlogu,
  pracować tylko w swoim zakresie;
- nazwy zadań budowanych równolegle obok niego — żeby wiedział, czyich
  plików nie ruszać i skąd może brać się cudza czerwień w
  `bench validate`, którego nie wolno mu "naprawiać";
- inwentarz `evaluation-pool/` i twoje rozstrzygnięcie asercji
  (zasada 6a): co ma reużyć pod konkretną nazwą, co ma zbudować jako
  nowe i pod jakim prefiksem nazwy. Dopisz wprost, że pula może się
  zmieniać pod nim w trakcie (sąsiad dopisuje swoje katalogi), więc
  ponowny skan puli w trakcie pracy niczego nie rozstrzyga — wiąże go
  twoje rozstrzygnięcie, a rozbieżność z nim zgłasza w raporcie;
- przypomnienie o podglądzie postępu: pierwszą czynnością subagenta
  jest utworzenie `tasks/<nazwa>/todo.md` (krok 0 procedury),
  aktualizowanego bezpośrednio po każdym kroku — przez ten plik ty
  i użytkownik podglądacie pracę w toku, więc ma być pisany na
  bieżąco, nie uzupełniany wstecz przed raportem;
- format raportu końcowego: REPORT_TEMPLATE.md (lista plików, dowody
  z referencji, koszt) + problemy.

**Moc subagenta dobierz do profilu zlecenia** (pole Typ z wpisu):
zadania dokumentacyjne/koncepcyjne uruchamiaj z obniżonym reasoning
effort — pełna procedura dowodowa obowiązuje je tak samo, ale nie
wymagają mocy zadania implementacyjnego z testami. Modelu nie obniżaj
w ciemno: jakość `prompt.md` waży w każdym profilu. Zlecenia
implementacyjne dostają pełną moc.

Subagent może zakończyć odmową z powodem (np. zlecenie niewykonalne na
aktualnym repo, bug nieobserwowalny) — to poprawny wynik, nie porażka
orkiestracji. Odroczony smoke (brak sekretów w sesji, krok 6.4
TASK_AUTHORING) także nie jest porażką — odnotowany w raporcie
przechodzi do bramki paczki (sekcja „Następny krok").

### 4. Zbiór wyników i statusy

W trakcie pracy subagentów postęp podglądasz w ich plikach
`tasks/<nazwa>/todo.md` — każdy prowadzi swój na bieżąco (krok 0
TASK_AUTHORING.md) i to tam patrzysz najpierw, gdy któryś utknie albo
użytkownik pyta o stan paczki. Podglądasz, nie edytujesz (zasada 1);
przy oddaniu pracy subagent sam usuwa swój todo.md — jeśli po jego
raporcie plik został, przypomnij mu o sprzątnięciu albo odnotuj to
użytkownikowi jako resztkę do usunięcia (plik roboczy wszedłby
w `task_hash`).

Po każdym subagencie: (w trybie domyślnym jego pliki są już w drzewie
instancji; tylko przy izolowanych kopiach przenieś je — zasada 5),
zaktualizuj wpis na `done` albo przywróć
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
- **Raporty odnotowują odroczony smoke (brak sekretów w sesji)** →
  po przyjęciu plików przez użytkownika jeden próbny
  `bench run --smoke` na wszystkich nowych zadaniach paczki naraz,
  w środowisku z kluczami (sesja użytkownika albo CI) — przed pełnym
  runem, jako bramka paczki.
- **Zadania gotowe i przyjęte przez użytkownika** → pełny run.
