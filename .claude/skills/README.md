# .claude/skills — strefa współdzielona (skille agentowe)

Wszystko, co wymaga osądu, robi rozmowa z agentem — nie CLI. Tu żyją
skille wspierające cykl życia instancji. Kształt i zestaw skilli jest
świadomie odłożony (patrz DESIGN); nazwy robocze:

- **bench-init** — customizacja świeżej instancji: obraz pod stack firmy,
  wypełnienie `evaluation-pool/`, kalibracja rubryk, pierwsze zadania.
- **tworzenie zadań** — meta-tooling: dobór asercji z puli on-demand,
  szkic `prompt.md` + `task.yaml`; zawsze przez PR i ludzkie review.
- **odświeżanie zadań** — nowy pinowany commit + aktualizacja asercji dla
  starzejących się zadań; domknięcie PR-em otwiera nową erę zadania.
- **strojenie rubryk** — kalibracja rubryk LLM-as-judge.

Kontrakt strefy przy `bench-kit update`: kit **proponuje diff** nowych
wersji skilli — firma decyduje, co przyjąć. Lokalne modyfikacje są
legalne i oczekiwane (customizacja per firma).
