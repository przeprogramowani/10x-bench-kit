# static — analiza statyczna

Asercja `static/<nazwa>/` uruchamia lint / typecheck / build na
workspace'ie po zakończeniu próby.

Konwencja (wiążąca od implementacji `bench evaluate`): katalog zawiera
`check.yaml` z listą komend i sposobem mapowania wyniku na 0–1
(np. build binarnie 0/1, lint proporcjonalnie do liczby błędów względem
stanu startowego — żeby nie karać za zastane problemy repo bazowego).

Obowiązuje zasada neutralności kształtu (README puli): wyłącznie
repo-natywne komendy toolchainu repo bazowego — bez założeń
o ścieżkach, symbolach czy strukturze pracy agenta.

Przykładowe nazwy: `static/lint` (generyczny guard lintu — wykrywa
package managera po lockfile'u, więc działa na dowolnym repo JS/TS),
`static/<zadanie>-…` (guard konkretnego zadania).

**Wyjątek od neutralności kształtu — tylko gdy prompt dyktuje dosłownie.**
Guard sprawdzający np. obecność konkretnej sekcji w `README.md` pozornie
łamie zasadę wyżej. Nie łamie, gdy `prompt.md` dosłownie dyktuje ten
nagłówek i ten plik: guard mierzy wtedy REZULTAT opisany w promptcie,
a nie zgadywany kształt implementacji.
Granica jest ostra — asercja może zakładać tylko to, co prompt przybija
wprost. Wszystko, co prompt zostawia agentowi (układ plików, nazwy,
dekompozycja), należy do przeglądu sędziego, nigdy do guardu.
