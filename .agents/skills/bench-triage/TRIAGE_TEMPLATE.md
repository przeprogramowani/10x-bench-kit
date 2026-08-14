# Szablon diagnozy (bench-triage)

Tytuł (issue/komentarz): `triage: <model> × <zadanie> — <symptom w 3-5 słowach>`

```markdown
## Symptom

<co zaskoczyło: run, model, zadanie, liczby z report.json
(mediana, pass@1/pass@k) + stamps ery, której dotyczy diagnoza.>

## Łańcuch dowodów

<od report.json w dół — per próba: która składowa ciągnie w dół
(result.json), co pokazał artefakt (cytat z agent.log / checks.json /
judge.json / execution.json), wyniki reprodukcji komendami
(bench assert / bench judge) z dokładnym wywołaniem.>

## Klasyfikacja

<wina modelu / wina zadania / wina infrastruktury — jedna klasa per
zdiagnozowana przyczyna (przyczyn może być kilka). Jeśli dowodów nie
starcza: "nierozstrzygnięte" + czego zabrakło.>

## Rekomendacja

<wina modelu → wynik zostaje, opisany wzorzec zachowania;
wina zadania → co naprawić i którym skillem (bench-refresh /
bench-task / bench-rubric), które wyniki ery są skażone;
wina infrastruktury → issue w repo template'u, które próby
nieinterpretowalne, czy run powtórzyć.>

## Koszt triage

<koszt reprodukcji (wywołania sędziego / kontenery, $), albo "brak —
tylko czytanie artefaktów".>
```
