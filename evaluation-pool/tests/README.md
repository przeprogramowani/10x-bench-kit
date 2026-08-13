# tests — testy weryfikacyjne

Asercja `tests/<nazwa>/` to zestaw testów weryfikujących wykonanie
zadania — ukrytych przed agentem (nigdy nie ma ich w workspace podczas
próby; montowane dopiero na etapie oceny).

Konwencje:

- testy pisane pod repo bazowe i pinowany commit zadania,
- **muszą przechodzić na wersji referencyjnej** (rozwiązaniu wzorcowym) —
  sprawdza to `bench validate`,
- wynik = frakcja przechodzących testów (0–1),
- aktualizacja testów po odświeżeniu pinu zadania = nowa era zadania.
