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

ARG OPENCODE_VERSION
RUN test -n "$OPENCODE_VERSION" || (echo "OPENCODE_VERSION build-arg is required (see opencode.version)" && exit 1)

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@${OPENCODE_VERSION}

# Izolacja historyczna: świeży, pusty XDG_DATA_HOME per próba — OpenCode
# startuje bez śladu jakiejkolwiek wcześniejszej sesji.
ENV XDG_DATA_HOME=/bench/xdg-data
RUN mkdir -p /bench/xdg-data /bench/out /workspace

# Cykl próby + adapter metryk (jedyny szew harness ↔ kit) + ocena nie-LLM.
COPY trial.sh /bench/trial.sh
COPY metrics-adapter/adapter.mjs /bench/metrics-adapter.mjs
COPY evaluate.mjs /bench/evaluate.mjs
RUN chmod +x /bench/trial.sh

WORKDIR /workspace
