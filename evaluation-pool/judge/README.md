# judge — rubryki LLM-as-judge

Asercja `judge/<nazwa>` to rubryka oceny jakościowej. Sędzia — stały,
mocny model (inny niż modele oceniane, skonfigurowany w
`bench.config.yaml`) — dostaje:

- `prompt.md` zadania,
- `patch.diff` (diff workspace vs punkt startowy),
- rubrykę,

i zwraca ustrukturyzowany JSON (format w rubryce). Wynik składowej
`judge` (0–1): przy rubryce z wagami kryteriów we frontmatterze YAML
(`weights: { <kryterium>: <waga> }`, suma = 1) total liczy **runner**
z `criteria[*].score` — model nie robi arytmetyki; rubryka bez
frontmattera to stary kontrakt (`total` z odpowiedzi sędziego).

Sędzia jest **główną miarą treści implementacji** — asercje skryptowe
(guardy wykonania) mierzą tylko "czy workspace dalej linter/build/testy
na zielono". Stąd trzy kontrakty każdej rubryki:

- **dobre/złe implementacje językiem zachowań** — kryteria i kotwice
  opisują, co dobra implementacja *robi*, a co robi zła; nigdy "plik X
  zawiera symbol Y" (konkretne ścieżki/symbole tylko, gdy utrwala je
  sam prompt),
- **klauzula anty-nitpickingowa (obowiązkowa)** — wybory pozostawione
  agentowi (układ plików, nazewnictwo, dekompozycja, wewnętrzne
  helpery) nigdy nie są karane; karane są wyłącznie naruszenia
  nazwanych kryteriów,
- **podział pracy z guardami** — sędzia czyta diff jako tekst i niczego
  nie uruchamia; żadnych kryteriów wymagających wykonania kodu
  ("testy przechodzą", "build zielony") — to mierzą guardy.

Zasady:

- zmiana rubryki = podbicie `version` w jej frontmatterze → nowa era
  porównywalności **zadań, które jej używają** (stempel jest per
  rubryka); zmiana modelu sędziego (`judge_model`) zamyka erę globalnie,
- rubryki kalibruje się skillem (na znanych diffach dobrych i złych),
  zmiany przez PR,
- szczegóły promptowania sędziego są świadomie odłożone (patrz DESIGN);
  wiążący jest format odpowiedzi.

Przykład: `default-rubric.md` (używana przez zadanie-demo jako
`judge/default-rubric`).
