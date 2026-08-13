# judge — rubryki LLM-as-judge

Asercja `judge/<nazwa>` to rubryka oceny jakościowej. Sędzia — stały,
mocny model (inny niż modele oceniane, skonfigurowany w
`bench.config.yaml`) — dostaje:

- `prompt.md` zadania,
- `patch.diff` (diff workspace vs punkt startowy),
- rubrykę,

i zwraca ustrukturyzowany JSON (format w rubryce). Wynik składowej
`judge` = `total` z odpowiedzi sędziego (0–1).

Zasady:

- zmiana rubryki lub modelu sędziego = zmiana `rubric_version` /
  `judge_model` w stemplach → nowa era porównywalności,
- rubryki kalibruje się skillem (na znanych diffach dobrych i złych),
  zmiany przez PR,
- szczegóły promptowania sędziego są świadomie odłożone (patrz DESIGN);
  wiążący jest format odpowiedzi.

Przykład: `default-rubric.md` (używana przez zadanie-demo jako
`judge/default-rubric`).
