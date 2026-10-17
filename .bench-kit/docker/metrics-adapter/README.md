# Adaptery metryk (OpenCode, Claude Code, Codex CLI)

Adapter to **jedyny szew** między harnessem (CLI agenta w próbie) a resztą
kitu. Jeden plik per harness; `trial.sh` woła właściwy po zakończeniu
agenta (lub po timeoucie). Harness wybiera prefiks id modelu
(`claude-code:…`, `codex:…`, bez prefiksu = OpenCode;
`runner/src/lib/harness.ts`).

| Harness | Adapter | Źródło tokenów | Koszt z harnessu |
|---|---|---|---|
| OpenCode | `opencode.mjs` | `opencode.db` w świeżym `XDG_DATA_HOME` | tak (`cost` sesji) |
| Claude Code | `claude-code.mjs` | linia `result` stream-json (`modelUsage`, z subagentami); po timeoucie transkrypty w `CLAUDE_CONFIG_DIR/projects/**.jsonl` (finalne `usage`, deduplikacja po `message.id`) | tak (`total_cost_usd`, cennik Claude Code) — tylko gdy jest linia `result` |
| Codex CLI | `codex.mjs` | ostatnie `turn.completed.usage` z `exec --json`; po timeoucie ostatni `token_count` z rolloutu w `CODEX_HOME/sessions/**.jsonl` | nie (Codex nie raportuje USD) |

## Kontrakt

```json
{
  "cost_usd": 0.42,
  "cost_source": "harness",
  "tokens": { "input": 123456, "output": 7890, "cache_read": 0, "cache_write": 0 },
  "duration_s": 314.2
}
```

- `tokens.input` to tokeny wejścia **bez** cache (semantyka Anthropic;
  u Codexa odejmujemy `cached_input_tokens` od `input_tokens`),
  `cache_read` / `cache_write` osobno, `output` z rozumowaniem
  (`reasoning` — informacyjnie, podzbiór `output`).
- `cost_source`: `"harness"` (koszt policzył harness), `"config"` albo
  `"openrouter:<slug>"` (wycenił runner z tokenów, stawki w
  `pricing_usd_per_mtok`), `null` (kosztu nie ma).
- Adapter działa wyłącznie na danych z bieżącej próby — katalog stanu
  harnessu jest pusty na starcie (zapieczony pusty w obrazie).
- `duration_s` to czas sesji agenta, nie czas życia kontenera.
- Brak danych (crash agenta przed pierwszym wywołaniem) → metryki
  częściowe z `"incomplete": true` i `incomplete_reason`; adapter nigdy
  nie wymyśla wartości.

## Koszt: kto go liczy

Adapter zapisuje koszt tylko wtedy, gdy harness sam go podał. Runner
(`runner/src/lib/pricing.ts`) domyka go po próbie wg polityki harnessu:

- **OpenCode** — koszt harnessu, bez zmian.
- **Claude Code, natywnie** (`ANTHROPIC_API_KEY`) — koszt harnessu
  (cennik Claude Code dla modeli pierwszej strony, `cost_basis: "list"`);
  po timeoucie (brak linii `result`) runner wycenia tokeny z transkryptu.
- **Claude Code przez OpenRouter** — runner wycenia zawsze: Claude Code
  dopasowuje slug OpenRouter do własnej tabeli cen po nazwie (sprawdzone:
  `anthropic/claude-sonnet-4.5` liczony jako `claude-sonnet-4-0`), więc
  jego kwota zostaje tylko jako `harness_cost_usd` do porównania.
- **Codex** — runner wycenia zawsze.

Cena pochodzi z `pricing` w `bench.config.yaml` (USD za 1M tokenów)
albo z publicznego katalogu OpenRouter (`/api/v1/models`). Model
wymagający wyceny bez znanej ceny nie startuje — `bench attempt`
odmawia przed wydaniem pieniędzy.

metrics.json jest częścią kontraktu zachowanej próby (ATTEMPT_FORMAT.md)
i wejściem dla `result.json` (`runner/src/schemas/result.ts`).
