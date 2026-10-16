# Bazowy obraz pojedynczej próby benchmarku.
#
# W obraz zapieka się (w przygotowaniu runu, nie w próbie):
# - pinowany commit repo bazowego — próby nie zależą od sieci,
# - overlay zadania.
# Materiałów oceny (evaluation-pool) w obrazie NIE ma; asercje montowane są
# dopiero na etapie `bench evaluate`, już bez agenta.
#
# Customizacja pod stack firmy (dodatkowe toolchainy, przeglądarki do e2e)
# odbywa się skillem w instancji — przez obraz pochodny FROM tego obrazu,
# nie przez edycję tego pliku.

FROM node:22-bookworm-slim

# Harnessy prób — pinowane wersje (pliki <harness>.version obok; runner
# podaje je jako build-argi i wpisuje do tagu obrazu). Osobna warstwa per
# CLI: bump jednego pinu przebudowuje tylko jego warstwę.
ARG OPENCODE_VERSION
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
RUN test -n "$OPENCODE_VERSION" && test -n "$CLAUDE_CODE_VERSION" && test -n "$CODEX_VERSION" \
    || (echo "OPENCODE_VERSION, CLAUDE_CODE_VERSION, CODEX_VERSION build-args are required (see *.version)" && exit 1)

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@${OPENCODE_VERSION} && npm cache clean --force
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
RUN npm install -g @openai/codex@${CODEX_VERSION} && npm cache clean --force

# Izolacja historyczna: świeże, puste katalogi stanu per próba — każdy
# harness startuje bez śladu jakiejkolwiek wcześniejszej sesji, a adapter
# metryk czyta wyłącznie stan tej jednej (OpenCode: XDG_DATA_HOME;
# Claude Code: CLAUDE_CONFIG_DIR; Codex: CODEX_HOME — trial.sh).
ENV XDG_DATA_HOME=/bench/xdg-data
RUN mkdir -p /bench/xdg-data /bench/claude-home /bench/codex-home /bench/out /workspace

# Cykl próby + adaptery metryk (szew harness ↔ kit) + ocena nie-LLM.
COPY trial.sh /bench/trial.sh
COPY metrics-adapter/ /bench/metrics-adapter/
COPY evaluate.mjs /bench/evaluate.mjs
RUN chmod +x /bench/trial.sh

WORKDIR /workspace
