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

## Wzorzec: asercja zero zależności

Najstabilniejsza klasa asercji to taka, która **niczego nie instaluje** —
im mniej asercja instaluje, tym mniej mierzy pogodę na npmjs zamiast
pracy agenta. Testy leżą w katalogu asercji (`$ASSERTION_DIR`, montowany
:ro), importują czyste funkcje prosto z `/workspace` i biegną wbudowanym
`node --test`:

```yaml
# evaluation-pool/tests/<nazwa>/check.yaml
score: fraction
checks:
  - name: unit
    # node --test na plikach z katalogu asercji; testy importują moduły
    # z /workspace bezpośrednio (ESM), więc nie trzeba nic instalować.
    run: node --test "$ASSERTION_DIR"/*.test.mjs
```

```js
// evaluation-pool/tests/<nazwa>/validation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail } from "/workspace/src/lib/validation.js";

test("akceptuje poprawny e-mail", () => {
  assert.equal(isValidEmail("a@b.co"), true);
});
```

Instalacja bywa nieunikniona (TypeScript bez builda, testy przez runner
frameworka) — wtedy detekcję package managera rób po lockfile'u, jak
w `static/lint/check.yaml`.
