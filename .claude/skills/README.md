# .claude/skills — strefa współdzielona (skille agentowe)

Wszystko, co wymaga osądu, robi rozmowa z agentem — nie CLI. Tu żyją
skille wspierające cykl życia instancji. Zestaw docelowy (koncepcja:
SKILLS_DESIGN w repo projektowym):

- **bench-task** *(dostępny)* — tworzy nowe zadanie: prompt + pin +
  overlay + asercje z deklaracjami `reference` + wagi, wszystko
  sprawdzone na referencji (`bench assert` / `bench judge` /
  `bench validate --assert`), wyjście przez PR.
- **bench-wiring** *(planowany)* — od świeżego `init` do zielonego
  `validate`: repo bazowe, modele, sekrety, obraz pod stack firmy.
- **bench-refresh** *(planowany)* — odświeżenie przeterminowanego
  zadania (nowy pin + asercje) → PR otwierający nową erę zadania.
- **bench-rubric** *(planowany)* — kalibracja rubryk LLM-as-judge na
  diffach o znanej jakości.

Kontrakt strefy przy `bench-kit update`: kit **proponuje diff** nowych
wersji skilli — firma decyduje, co przyjąć. Lokalne modyfikacje są
legalne i oczekiwane (customizacja per firma).
