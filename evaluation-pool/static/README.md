# static — analiza statyczna

Asercja `static/<nazwa>/` uruchamia lint / typecheck / build na
workspace'ie po zakończeniu próby.

Konwencja (wiążąca od implementacji `bench evaluate`): katalog zawiera
`check.yaml` z listą komend i sposobem mapowania wyniku na 0–1
(np. build binarnie 0/1, lint proporcjonalnie do liczby błędów względem
wersji referencyjnej — żeby nie karać za zastane problemy repo bazowego).

Przykładowa nazwa: `static/lint` (używana przez zadanie-demo).
