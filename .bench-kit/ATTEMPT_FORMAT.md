# ATTEMPT_FORMAT — kontrakt zachowanej próby (format 1)

Zachowana próba to **jedyny punkt styku** między wykonaniem
(`bench attempt`) a oceną (`bench evaluate` / skill `rate-attempt`).
Wykonanie nie wie nic o rubrykach; ocena nie wie nic o kontenerze agenta
(ma własny kontener do build/testów). Próba raz opłacona **nigdy nie
jest wyrzucana** — nowa rubryka czy nowy sędzia to re-ocena zachowanych
prób, nie nowy bieg macierzy.

Wersja formatu: pole `format` w `attempt.json` (obecnie `1`).
`bench evaluate` odmawia oceny formatu nowszego niż zna; zmiana łamiąca
układ katalogu = bump `format` + nota migracyjna w CHANGELOG.

## Układ katalogu

```
attempts/<zadanie>/<model-sanitized>/trial-<n>/
├── attempt.json        # metadane próby (schemat: runner/src/schemas/attempt.ts)
├── patch.diff          # workspace vs commit startowy (git diff --binary)
├── agent.log           # pełne wyjście `opencode run` (na dysku; *.log poza gitem)
├── metrics.json        # koszt/tokeny/czas z LOKALNEGO opencode.db próby
├── execution.json      # surowy status wykonania (agent_exit, timed_out, wall)
├── workspace/          # stan /workspace po pracy agenta — POZA gitem (GB)
├── signal.json         # tylko przy killu sygnałowym po retry (diagnostyka)
├── container.log       # tylko przy awarii infrastruktury
├── running.json        # TYLKO w trakcie wykonania — marker próby w toku (poza gitem)
└── provider-error-attempt-1/   # artefakty pierwszego podejścia przy retry
    (analogicznie signal-kill-attempt-1/)
```

Obok `trial-<n>/` mogą leżeć katalogi odłożone, pomijane przez ocenę
i agregację: `trial-<n>.superseded-<stempel>/` (re-run z `--force`)
i `trial-<n>.aborted-<stempel>/` (artefakty częściowe próby, której
proces `bench attempt` zginął bez sprzątania — patrz „Próba w toku").

`<model-sanitized>` = identyfikator modelu z `[^A-Za-z0-9._-]` → `-`
(np. `openrouter/anthropic/claude-sonnet-5` →
`openrouter-anthropic-claude-sonnet-5`); pole `model` w `attempt.json`
trzyma oryginał — dopasowania robi się po treści, nie po nazwie katalogu.

## Próba w toku (running.json)

`bench attempt` zajmuje numer próby PRZED startem kontenera: zapisuje
`running.json` (`task`, `model`, `trial`, `started_at`, `timeout_s`,
`pid`, `host`) atomowo (`O_EXCL`) i usuwa go po zapisie `attempt.json`.
Dzięki temu wiele niezależnych procesów `bench attempt` — per model,
w tle (tmux/nohup), na drugiej maszynie ze wspólnym drzewem — dogania
braki tej samej macierzy bez koordynacji: katalog z żywym markerem jest
dla planu „w toku" (nie do dublowania, także przy `--force`), a
`bench evaluate` go pomija do czasu pojawienia się `attempt.json`.
Marker przeterminowany (`started_at + timeout_s + 15 min` minęło)
znaczy, że proces zginął: następne zajęcie tego numeru odkłada katalog
do `trial-<n>.aborted-<stempel>/` (artefakty częściowe zostają — praca
opłacona nie ginie) i wykonuje próbę od nowa. Stan macierzy z dysku —
zachowane / w toku / przeterminowane / ocenione — pokazuje
`bench status`.

## Podział dysk / git

- **Commitowalne (KB)**: `attempt.json`, `patch.diff`, `metrics.json`,
  `execution.json`, `signal.json`, `container.log` — pełne metadane
  i diff wystarczają do re-oceny diffowej i triage'u.
- **Tylko dysk**: `workspace/` (`.gitignore`: `attempts/**/workspace/`),
  `agent.log` (`*.log`) i przejściowy `running.json`. Backup workspace'ów to osobna
  odpowiedzialność operatora (rsync/dysk); manifestem drzewa jest sam
  zestaw `attempt.json` — wystarcza do skip-logic (`bench attempt`
  dogania braki) i do agregacji.

## Gwarancje

- **Samowystarczalność**: ocena potrzebuje wyłącznie tego katalogu +
  bieżącej instancji (task.yaml odtwarza obraz zadania, gdy nie ma go
  lokalnie). Sędzia-z-narzędziami pracuje na KOPII `workspace/`
  w jednorazowym kontenerze z obrazu zadania (`bench shell --attempt`;
  oryginał zamontowany tylko do odczytu) — kod wyprodukowany przez
  oceniany model nigdy nie wykonuje się na hoście operatora.
- **Ocena tam, gdzie workspace**: metadane i `patch.diff` wędrują
  przez git między maszynami, `workspace/` nie — sędzia-z-narzędziami
  i `bench shell` biegną na maszynie, która wykonała próbę.
- **Nienaruszalność**: żaden proces nie nadpisuje zachowanej próby.
  Re-run (`bench attempt --force` / `--trial-index n --force`) przenosi
  stary katalog do `trial-<n>.superseded-<stempel>/` (pomijany przez
  ocenę i agregację), nowa próba wchodzi na jego miejsce.
- **Wiarygodność metryk**: `metrics.json` pochodzi z lokalnego storage
  OpenCode próby (`opencode.db` w świeżym XDG_DATA_HOME), nie z łańcucha
  adapter↔provider. `"incomplete": true` = adapter nie znalazł danych —
  wartości nigdy nie są wymyślane.
- **Atrybucja awarii**: `infra_failure`/`resource_kill`/`provider_error`
  w `attempt.json` wyłączają próbę z oceny zamiast wliczać zero do
  median; `bench evaluate` pomija je z warningiem.
- **Świadomość dryfu**: `task_hash` w `attempt.json` to hash katalogu
  zadania W CHWILI WYKONANIA; `bench evaluate` porównuje go z bieżącym
  i głośno ostrzega przy rozjeździe (wynik dostaje stempel bieżącej
  definicji — era oceny jest odklejona od ery wykonania).

## Wyniki oceny

Ocena dokłada do katalogu próby `eval-plan.json`, `checks.json`
(guardy — exit codes i logi jako FAKTY), `judge.json` (werdykty
z uzasadnieniem) i `result.json`, a kanoniczną kopię
`result.json` + `judge.json` zapisuje w repo:

```
results/<zadanie>/<model-sanitized>/trial-<n>/{result.json, judge.json}
```

To drzewo commituje operator; historię wersji ocen (re-oceny po
kalibracji rubryki) trzyma git. Agregacja (`bench report`) i leaderboard
czytają `results/`, grupując wyniki w ery po stemplach z `result.json` —
nigdy nie mieszając er.
