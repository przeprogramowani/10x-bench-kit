# Szablon PR-a dla wiringu instancji (bench-wiring)

Tytuł: `bench-wiring: <opis, np. "astro-starter + modele przez OpenRouter">`

```markdown
## Decyzje

<repozytoria bazowe (publiczne/prywatne, forma dostępu), modele oceniane,
sędzia + wersje rubryk, budżet max_cost_usd — każda decyzja z jednym
zdaniem uzasadnienia.>

## Checklista sekretów

<nazwy, nigdy wartości; status obecności z `gh secret list` / env:>

- [ ] `OPENROUTER_API_KEY` — próby agenta + sędzia — <obecny w repo / DO USTAWIENIA>
- [ ] `BASE_REPO_TOKEN` — klonowanie prywatnych repo bazowych (fine-grained PAT, contents:read) — <status / "zbędny — same repo publiczne">

## Dowody

<wyjścia komend, nie deklaracje:>

- `bench validate` → <0 errorów / lista>
- `bench validate --assert` (jeśli zadania mają reference) → <wynik>
- smoke run: `<model>` × `<zadanie>` → total <x>, koszt $<y>, czas <z> s
- dispatch w GH Actions: <link do runu / "nie odpalano">

## Skutki dla porównywalności

<pierwsza era instancji: sędzia <model> + wersje rubryk (frontmatter). Co ją
w przyszłości zamknie: zmiana sędziego, rubryk, definicji zadań. Jeśli
PR zmienia istniejący wiring: które dotychczasowe wyniki przestają być
porównywalne.>

## Koszt wiringu

<koszt smoke runu / wywołań sędziego (model, $), albo "brak — nie
odpalano modeli".>
```
