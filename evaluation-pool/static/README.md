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
`static/demo-readme-section` (używana przez zadanie-demo).

**Wyjątek od neutralności kształtu — tylko gdy prompt dyktuje dosłownie.**
`static/demo-readme-section` sprawdza obecność konkretnej sekcji
w `README.md`, czyli pozornie łamie zasadę wyżej. Nie łamie: `prompt.md`
zadania-demo dosłownie dyktuje ten nagłówek i ten plik, więc guard mierzy
REZULTAT opisany w promptcie, a nie zgadywany kształt implementacji.
Granica jest ostra — asercja może zakładać tylko to, co prompt przybija
wprost. Wszystko, co prompt zostawia agentowi (układ plików, nazwy,
dekompozycja), należy do przeglądu sędziego, nigdy do guardu.

Po co zadanie-demo ma guard deterministyczny: dopóki było oceniane
wyłącznie przez sędziego, bramka e2e w CI zależała od jednej opinii LLM-a
— ten sam patch dostawał 0.40 i 1.00 w kolejnych biegach. Guard daje
części oceny wartość, która liczy się sama i zawsze tak samo, a przy
okazji CI w ogóle zaczyna wykonywać ścieżkę asercji (wcześniej
`weights.static = 0` znaczyło, że maszyneria guardów nie była w CI
uruchamiana ani razu).
