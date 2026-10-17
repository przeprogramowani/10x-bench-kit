# Offline harness tests — mock LLM

`mock-llm.mjs` udaje dostawcę modelu, żeby przejść całą ścieżkę
`trial.sh` → CLI agenta → `metrics.json` bez kluczy i bez kosztu.
Obsługuje:

- `POST …/messages` (Anthropic Messages, stream SSE) — Claude Code,
- `POST …/responses` (OpenAI Responses, stream SSE) — Codex,
- `GET /api/v1/models` — katalog cen w formacie OpenRouter
  (`BENCH_PRICING_CATALOG_URL`).

Scenariusz: pierwsza tura z narzędziami → jedno wywołanie narzędzia
powłoki (zapis `HELLO.md` albo komenda z pliku, 4. argument), po wyniku
narzędzia → „Done.”. Usage jest stałe i niezerowe (cache read/write
włącznie), więc ścieżka wyceny tokenów dostaje realne liczby.

```
node .github/tests/harness/mock-llm.mjs <port> [log] [delayMs] [cmd-file]
```

`delayMs` > 0 opóźnia każde żądanie modelu po pierwszym — test
timeoutu (SIGINT, fallback tokenów z transkryptu/rollout).

## Jak podpiąć pod trial

Oba harnessy przez trasę OpenRouter czytają bazowy URL z
`BENCH_OPENROUTER_BASE_URL` (runner forwarduje go do kontenera):

```
node .github/tests/harness/mock-llm.mjs 8787 /tmp/mock.log &   # słucha na 0.0.0.0
# Kontener próby stoi w domyślnej sieci bridge: host to brama docker0,
# nie 127.0.0.1 (sprawdź: docker network inspect bridge → Gateway).
export BENCH_OPENROUTER_BASE_URL=http://172.17.0.1:8787/api
export BENCH_PRICING_CATALOG_URL=http://127.0.0.1:8787/api/v1/models  # czyta runner na hoście
export OPENROUTER_API_KEY=mock
bench attempt --task <t> --model claude-code:openrouter/anthropic/claude-sonnet-4.5 --trials 1
bench attempt --task <t> --model codex:openrouter/openai/gpt-5.1-codex --trials 1
```

Trasa natywna (`claude-code:<model>`) przez mock: `ANTHROPIC_BASE_URL`
w środowisku samego CLI (poza `trial.sh`). Nie jest to jeszcze krok CI —
patrz `docs/HANDOFF.md`.
