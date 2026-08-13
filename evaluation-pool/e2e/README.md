# e2e — scenariusze end-to-end (Playwright)

Asercja `e2e/<nazwa>/` to scenariusze Playwright uruchamiane na działającej
aplikacji z workspace'u po próbie.

Konwencje:

- scenariusz definiuje też sposób postawienia aplikacji (komenda startu,
  port, warunek gotowości),
- wymagane zależności przeglądarek dokłada obraz pochodny instancji
  (patrz `.bench-kit/docker/Dockerfile`), nie sama asercja,
- wynik = frakcja przechodzących scenariuszy (0–1).
