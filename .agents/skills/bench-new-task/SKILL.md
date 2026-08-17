---
name: bench-new-task
description: >-
  Zbiera zlecenie nowego zadania benchmarku w krótkim wywiadzie i dopisuje
  je do backlogu (`tasks/backlog.md`) — bez budowania. W jednej sesji można
  zdefiniować 5–10 zleceń; budowaniem zajmuje się później skill bench-build.
  Użyj, gdy użytkownik chce dodać zadanie do benchmarku, ma pomysł(y) na
  zadania albo mówi "nowe zadanie / task do bencha / dopisz do backlogu".
---

# bench-new-task — zlecenie zadania do backlogu

Zamieniasz pomysł użytkownika na **zlecenie** w stanowym backlogu
`tasks/backlog.md`. Zlecenie to komplet decyzji projektowych zadania —
wszystko, co zmienia, CO zadanie mierzy — zapisany na tyle precyzyjnie,
że subagent bench-build zbuduje z niego zadanie **bez dopytywania
użytkownika**. Ten skill jest celowo szybki: sam wywiad, żadnego
klonowania rep, kontenerów ani komend runnera.

## Twarde zasady

1. **Zero budowania.** Nie wybierasz pina, nie piszesz `prompt.md`,
   overlaya ani asercji, nie wołasz komend `bench`. To praca
   bench-build. Jeśli użytkownik chce budować od razu, dopisz zlecenie
   i wskaż bench-build — nie buduj w ramach tego skilla.
2. **Zero gita.** Wyjściem tego skilla jest edycja pliku
   `tasks/backlog.md` w drzewie roboczym — nie commitujesz, nie
   tworzysz gałęzi, nie pushujesz; kiedy i jak backlog trafia do gita,
   decyduje użytkownik. Backlog to stan koordynacji, nie scoring
   (runner ignoruje pliki w `tasks/` niebędące katalogami zadań).
3. **Decyzje należą do użytkownika.** Pola zlecenia rozstrzyga wywiad,
   nie twoje domysły — źle dobrany poziom naprowadzenia czy timeout
   zmienia, co zadanie mierzy. Wnioski z opisu użytkownika to
   propozycje do akceptacji, nie decyzje.
4. **Jedno zlecenie = jedna intencja.** Pomysł "napraw X i przy okazji
   zrefaktoruj Y" to dwa zlecenia.
5. **Zlecenie ma być samowystarczalne.** Subagent bench-build dostanie
   wpis backlogu i nic więcej — bez dostępu do tej rozmowy. Wszystko,
   co ustaliliście, musi być we wpisie.

## Procedura

### 1. Wywiad (krótki)

Zbierz od użytkownika pomysły — może ich podać kilka naraz. Dla każdego
wyprowadź z opisu propozycje pól zlecenia (schemat wpisu:
[BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md)) i oznacz, co jest
wywnioskowane, a czego w opisie nie ma. Pytania zadawaj mechanizmem
pytań twojego narzędzia (AskUserQuestion / request_user_input; gdy
brak — zwykłe pytania w rozmowie), **jednym blokiem na całą paczkę
zleceń**, wyłącznie o luki i niejednoznaczności — z jednym wyjątkiem:

- **Poziom naprowadzenia promptu** pytaj zawsze, chyba że opis
  rozstrzyga go wprost, z konsekwencjami podanymi przy opcjach:
  - *produktowy* — sam objaw/cel, zero plików i symboli; mierzy
    lokalizację w kodzie + wykonanie — trudniejsze, dłuższy timeout;
  - *kierunkowy* — nazwany obszar/moduł; środek skali;
  - *chirurgiczny* — konkretne pliki/symbole; mierzy samo wykonanie —
    łatwiejsze, krótszy timeout.

Pozostałe pola (pytaj tylko, gdy opis ich nie rozstrzyga):

- **Co zadanie mierzy**: implementacja / naprawa buga / refaktor /
  dokumentacja.
- **Repo bazowe** — musi być w `base_repos` w bench.config.yaml
  (sprawdź!); jeśli nie jest, to najpierw bench-wiring, nie to
  zlecenie.
- **Trudność i `timeout_s`** (typowo 300–900 s; spójny z poziomem
  naprowadzenia — za krótki timeout mierzy szybkość, nie jakość).
- **Nazwa zadania**: kebab-case, mówiąca co jest do zrobienia
  (np. `fix-cart-total-rounding`), nie jak (`edit-cart-ts`).

### 2. Akceptacja paczki

Przedstaw zlecenia zbiorczo (tabelka: nazwa, typ, repo, naprowadzenie,
timeout + jedno zdanie opisu) i uzyskaj akceptację użytkownika. Dopiero
po niej pisz do backlogu.

### 3. Zapis do backlogu

Jeśli `tasks/backlog.md` nie istnieje, załóż go wg
[BACKLOG_TEMPLATE.md](BACKLOG_TEMPLATE.md). Dopisz każde zlecenie jako
wpis ze statusem `pending` i datą. Nazwa zlecenia nie może kolidować
z istniejącym katalogiem `tasks/<nazwa>/` ani innym wpisem backlogu.
Nic w gicie (zasada 2) — plik zostaje w drzewie roboczym.

### 4. Następny krok

Zakończ odpowiedź podsumowującą sekcją **Następny krok**: ile zleceń
czeka w backlogu (`pending`), **jedna** rekomendacja — zwykle: dopisać
kolejne zlecenia (ten skill) albo uruchomić **bench-build**, gdy paczka
jest gotowa — oraz to, co czeka na decyzję człowieka.
