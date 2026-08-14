# .agents/skills — strefa współdzielona (skille agentowe)

Wszystko, co wymaga osądu, robi rozmowa z agentem — nie CLI. Tu żyją
skille wspierające cykl życia instancji. Zestaw docelowy (koncepcja:
SKILLS_DESIGN w repo projektowym):

- **bench-task** *(dostępny)* — tworzy nowe zadanie: prompt + pin +
  overlay + asercje z deklaracjami `reference` + wagi, wszystko
  sprawdzone na referencji (`bench assert` / `bench judge` /
  `bench validate --assert`), wyjście przez PR.
- **bench-wiring** *(dostępny)* — od świeżego `init` do zielonego
  `validate`: repo bazowe, modele, sekrety, obraz pod stack firmy.
- **bench-refresh** *(planowany)* — odświeżenie przeterminowanego
  zadania (nowy pin + asercje) → PR otwierający nową erę zadania.
- **bench-rubric** *(dostępny)* — kalibracja rubryk LLM-as-judge:
  zbiór kalibracyjny z diffów o znanej jakości, pomiar rozdzielczości
  i stabilności sędziego (`bench calibrate`), iteracja kryteriów, PR
  z podbiciem wersji rubryki (frontmatter `version`).

W template skille żyją pod tool-agnostycznym `.agents/skills/`;
`10x bench-kit init` materializuje je w instancji pod ścieżką wybranego
narzędzia agentowego (`.claude/skills/` dla Claude Code, `.agents/skills/`
dla Codex itd. — wybór zapisany w `instance.json`).

Kontrakt strefy przy `bench-kit update`: kit **proponuje diff** nowych
wersji skilli — firma decyduje, co przyjąć. Lokalne modyfikacje są
legalne i oczekiwane (customizacja per firma).
