# Rubryka: default-rubric

Ogólna rubryka jakości zmiany — punkt wyjścia do kalibracji per firma.

## Kryteria (każde 0–1)

1. **correctness** — czy zmiana realizuje dokładnie to, o co prosi
   `prompt.md`? Nic mniej (braki), nic więcej (zmiany poza zakresem).
2. **scope** — czy diff dotyka wyłącznie plików, których wymaga zadanie?
3. **quality** — czy zmiana jest zgodna z konwencjami otaczającego kodu
   (styl, nazewnictwo, idiomy)?

## Format odpowiedzi sędziego (wymagany JSON)

```json
{
  "criteria": {
    "correctness": { "score": 0.0, "justification": "…" },
    "scope": { "score": 0.0, "justification": "…" },
    "quality": { "score": 0.0, "justification": "…" }
  },
  "total": 0.0
}
```

`total` = średnia ważona kryteriów; w tej rubryce wagi równe.
Odpowiedź bez poprawnego JSON-a = 0 dla składowej judge (twarda zasada —
sędzia ma zwracać strukturę, nie prozę).
