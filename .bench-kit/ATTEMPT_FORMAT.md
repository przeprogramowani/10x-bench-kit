# ATTEMPT_FORMAT — kontrakt zachowanej próby (format 1)

Zachowana próba to **jedyny punkt styku** między wykonaniem
(`bench attempt`) a oceną (`bench evaluate`).
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
├── agent.log           # wyjście agenta: `opencode run` (tekst) / zdarzenia JSONL
│                       #   Claude Code i Codexa (na dysku; *.log poza gitem)
├── agent.stderr.log    # stderr harnessu JSONL (Claude Code, Codex; poza gitem)
├── metrics.json        # koszt/tokeny/czas ze stanu harnessu tej próby
│                       #   (+ wycena runnera ze źródłem — metrics-adapter/README.md)
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
  `agent.log` (`*.log`) i przejściowy `running.json`. `workspace/` jest
  bez katalogów `node_modules` (próba biegnie offline, więc pochodzą z
  obrazu zadania — `task.prepare`) i bez głównego `.git` (commit startowy
  z obrazu; zmiany agenta są w drzewie i w `patch.diff`); `bench shell`
  przenosi oba do kopii z obrazu. Kopia nieudana (pełny dysk) jest
  usuwana, a `attempt.json` ma wtedy `workspace_preserved: false`. Backup workspace'ów to osobna
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
- **Wiarygodność metryk**: `metrics.json` pochodzi ze stanu harnessu
  tej próby (OpenCode: `opencode.db`; Claude Code: linia `result` albo
  transkrypt; Codex: `turn.completed` albo rollout — zawsze z pustego na
  starcie katalogu stanu), nie z łańcucha adapter↔provider. Gdy harness
  nie daje wiarygodnego kosztu, runner wycenia tokeny i zapisuje źródło
  (`cost_source`, `pricing_usd_per_mtok`). `"incomplete": true` =
  brak danych — wartości nigdy nie są wymyślane.
- **Harness**: `attempt.json.harness` = `{name, version, route}` — CLI
  agenta, jego pinowana wersja (`docker/<harness>.version`) i routing
  dostawcy (`native` / `openrouter`). Id modelu niesie harness jako
  prefiks (`claude-code:…`, `codex:…`; bez prefiksu = OpenCode), więc
  ten sam model w innym CLI to osobna komórka macierzy. Brak pola =
  próba sprzed harnessów (OpenCode). Pole jest addytywne — `format`
  pozostaje `1`.
- **Atrybucja awarii**: `infra_failure`/`resource_kill`/`provider_error`
  w `attempt.json` wyłączają próbę z oceny zamiast wliczać zero do
  median; `bench evaluate` pomija je z warningiem.
- **Świadomość dryfu**: `task_hash` w `attempt.json` to hash katalogu
  zadania W CHWILI WYKONANIA; `bench evaluate` porównuje go z bieżącym
  i głośno ostrzega przy rozjeździe (wynik dostaje stempel bieżącej
  definicji — era oceny jest odklejona od ery wykonania).

## Wyniki oceny

Ocena dokłada do katalogu próby `eval-plan.json`, `checks.json`
(guardy — exit codes i logi jako FAKTY), `checks.stamp.json` (z czego
powstały: task_hash, hashe asercji puli, obraz oceny, patch — fold
werdyktu reużywa guardów tylko przy pełnej zgodności), `judge.json` (werdykty
z uzasadnieniem) i `result.json`, a kanoniczną kopię
`result.json` + `judge.json` zapisuje w repo:

```
results/<zadanie>/<model-sanitized>/trial-<n>/{result.json, judge.json}
```

To drzewo commituje operator; historię wersji ocen (re-oceny po
kalibracji rubryki) trzyma git. Agregacja (`bench report`) i leaderboard
czytają `results/`, grupując wyniki w ery po stemplach z `result.json` —
nigdy nie mieszając er.
