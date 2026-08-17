# Szablon backlogu zleceń — `tasks/backlog.md`

Backlog to stanowy dokument koordynacji między bench-new-task (dopisuje
zlecenia) a bench-build (buduje z nich zadania). Runner go ignoruje
(w `tasks/` czyta wyłącznie katalogi zadań), więc nie wpływa na
scoring. Skille wyłącznie edytują ten plik w drzewie roboczym — gitem
(commit, push) zarządza użytkownik.

Cykl statusów wpisu:

`pending` → `in-progress` (bench-build wystartował subagenta) →
`done` (komplet plików zadania gotowy w drzewie roboczym) albo z powrotem
`pending` z notatką, gdy budowa się nie powiodła. Zlecenia porzucone oznaczaj
`dropped` z jednozdaniowym powodem — nie kasuj wpisów, historia decyzji
zostaje.

Szablon dokumentu:

```markdown
# Backlog zleceń zadań

Zlecenia tworzy skill **bench-new-task**, buduje je skill
**bench-build**. Statusy: pending / in-progress / done / dropped.
Skille tylko edytują ten plik — gitem zarządza użytkownik.

## <nazwa-zadania>

- **Status**: pending
- **Dodano**: <RRRR-MM-DD>
- **Typ**: <implementacja / naprawa buga / refaktor / dokumentacja>
- **Repo bazowe**: <nazwa z base_repos w bench.config.yaml>
- **Poziom naprowadzenia**: <produktowy / kierunkowy / chirurgiczny>
- **Trudność / timeout**: <łatwe|średnie|trudne> / <timeout_s> s
- **Oś oceny**: <co różnicuje oceny w tym zadaniu — do's and dont's
  od użytkownika (np. "premiuj minimalny diff", "nie wolno zmieniać
  API publicznego"); bench-build kalibruje pod to rubrykę i warianty.
  Gdy użytkownik świadomie nie wskazał osi: "do uznania bench-build".>
- **Opis**: <2–6 zdań: co jest do zrobienia, objaw/cel, granice
  ("nie zmieniaj niczego poza…"). Dla zadań typu "napraw": jaki bug
  ma zostać zasiany overlayem i po czym poznać, że jest naprawiony.>
- **Notatki**: <opcjonalnie: pomysły na asercje/składowe oceny, czy
  przewidywana jest składowa judge, oczekiwanie wobec weryfikacji
  w promptcie, inne ustalenia z wywiadu>
```

Zasady wpisów:

- Nazwa wpisu = docelowa nazwa katalogu `tasks/<nazwa>/` (kebab-case,
  mówi CO jest do zrobienia). Bez kolizji z istniejącymi zadaniami
  i innymi wpisami.
- Wpis musi być samowystarczalny: subagent bench-build nie ma dostępu
  do rozmowy, w której zlecenie powstało.
- Pola **Opis** i **Notatki** to decyzje projektowe, nie treść
  `prompt.md` — prompt napisze bench-build na zadeklarowanym poziomie
  naprowadzenia.
