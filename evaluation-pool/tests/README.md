# tests — guard wykonania: suita repo bazowego

Asercja `tests/<nazwa>/` uruchamia **własną suitę testów repo
bazowego** na workspace po próbie — tym samym runnerem i tą samą
komendą, której używa samo repo (`pnpm run test` itp.). Wynik =
frakcja przechodzących testów (0–1) albo 0/1, wg mapowania
w `check.yaml`. Wyjątkiem jest guard PR-a `tests/<zadanie>-pr`
(niżej): należy do jednego zadania i jest binarny.

## Wycofane: ukryte testy behawioralne

Wcześniejsza konwencja — testy szyte pod zadanie, montowane
z `$ASSERTION_DIR`, importujące moduły po ścieżkach i symbolach,
odkrywające pliki agenta grepem, wymuszające środowisko testowe —
jest **wycofana**. Zadanie wielo-plikowe ma wiele poprawnych
implementacji, a taki test mierzył "czy zakodowano tak, jak wyobraził
sobie autor", nie pracę; do tego każdy wymagał kanarków środowiska,
detekcji routingu jsdom i innych łat na ten sam problem u korzenia.
To, co taki test próbował mierzyć, wyraża dziś rubryka sędziego
(`evaluation-pool/judge/`) językiem naturalnym — opisem dobrych
i złych implementacji.

## Wyjątek: testy PR-a (`tests/<zadanie>-pr`)

Zadanie wykopane z historii (bench-create-task → MINING.md) niesie testy
zmiany, z której powstało. Guard jest **per zadanie** (nie
współdzielony) i **binarny** (`score: binary`). Pliki testów w wersji
po merge'u leżą w `files/`, a `check.yaml` kopiuje je na workspace
(zmiany agenta w tych samych plikach przegrywają, jak w SWE-bench),
uruchamia repo-natywną komendę testów dla tych plików i **przywraca
workspace do stanu zastanego**: robi kopię nadpisywanych plików,
po teście je odtwarza, usuwa pliki, których wcześniej nie było,
i kończy kodem wyjścia testów. Asercje zadania biegną w jednym
workspace'ie bez resetu, więc pozostawione testy PR-a zobaczyłby
następny guard (np. suita repo); z tego samego powodu
`tests/<zadanie>-pr` stoi **ostatni** w `evaluation[]`. Warunki
dopuszczenia: testy dotykają wyłącznie interfejsu istniejącego na pinie albo nazw
podanych dosłownie w prompcie. Czerwień na pinie sprawdza
`bench validate --assert` w bench-evaluate przed pierwszą próbą.
Wzorzec: bench-create-task → BUILD.md, krok 2.

## Konwencje

- wyłącznie komendy zdefiniowane przez repo bazowe; detekcja package
  managera po lockfile'u (wzorzec: `static/lint/check.yaml`),
- zero założeń o kształcie implementacji agenta — zasada neutralności
  kształtu (README puli): żadnych ścieżek, symboli, grepowania po
  workspace, dogrywanych plików testowych (jedyny wyjątek: testy PR-a
  `tests/<zadanie>-pr`, wyżej),
- nie karz za zastane problemy repo bazowego: czerwone testy na stanie
  startowym → mapowanie względem stanu startowego albo — dla zadania
  seedującego buga, którego suita repo dowodnie łapie — deklaracja
  `reference: fail` w task.yaml,
- jeden zestaw guardów per repo bazowe, współdzielony przez wszystkie
  zadania na tym repo (poza guardem PR-a, który należy do jednego
  zadania).
