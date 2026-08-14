---
version: "3"
weights:
  correctness: 0.6
  scope: 0.25
  quality: 0.15
---

# Rubryka: default-rubric (v3)

Ogólna rubryka jakości zmiany — punkt wyjścia do kalibracji per firma.
v2 po pierwszej kalibracji (fix-auth-validation): kryteria ważone —
correctness dominuje, żeby częściowe wykonanie nie rozmywało się
w średniej; kotwice ograniczają uznaniowość. v3 dokłada kontrakt
zwięzłości odpowiedzi — u sędziów z rozumowaniem długie uzasadnienia
prowokują ucięcie JSON-a na limicie tokenów (na kalibracji: po tej
zmianie 12/12 poprawnych werdyktów, rozrzut 0.000).

Wersję rubryki deklaruje frontmatter (`version`) — stempel ery jest per
rubryka, więc kalibracja tej rubryki nie unieważnia wyników zadań,
które jej nie używają.

Wagi kryteriów deklaruje frontmatter — **total liczy runner**, sędzia
ocenia wyłącznie kryteria (arytmetyka modelu jest poza pętlą oceny).

## Kryteria

1. **correctness** (waga 0.6) — czy zmiana realizuje to, o co prosi
   `prompt.md`? Kotwice:
   - 1.0 — wszystkie żądane zmiany wykonane w całości i poprawnie,
   - 0.5 — wykonana część żądanych zmian (np. jeden z dwóch zgłoszonych
     problemów); naprawa częściowa nigdy nie dostaje więcej niż 0.5,
   - 0.0 — brak żądanych zmian albo zmiany niepoprawne.
2. **scope** (waga 0.25) — czy diff ogranicza się do tego, czego wymaga
   zadanie? Kotwice:
   - 1.0 — wyłącznie zmiany konieczne,
   - 0.5 — pojedyncza zmiana niewymagana przez zadanie (plik lub
     fragment, o który nikt nie prosił),
   - 0.0 — wiele niepowiązanych zmian / przebudowa poza zadaniem.
3. **quality** (waga 0.15) — zgodność z konwencjami otaczającego kodu
   (styl, nazewnictwo, idiomy); 0.5 przy odstępstwach kosmetycznych,
   0.0 przy łamaniu konwencji projektu.

## Format odpowiedzi sędziego (wymagany JSON)

```json
{
  "criteria": {
    "correctness": { "score": 0.0, "justification": "…" },
    "scope": { "score": 0.0, "justification": "…" },
    "quality": { "score": 0.0, "justification": "…" }
  }
}
```

Kontrakt zwięzłości (obowiązkowy):

- zacznij odpowiedź od `{` — bez markdownu, bez wstępu,
- każde `justification` to jedno zdanie ≤ 150 znaków, bez cudzysłowów
  i bez znaków nowej linii wewnątrz,
- każde `score` to pojedyncza liczba dziesiętna w [0, 1] (np. `0.5`) —
  nigdy wyrażenie arytmetyczne.

Odpowiedź bez poprawnego JSON-a = 0 dla składowej judge (twarda zasada —
sędzia ma zwracać strukturę, nie prozę).
