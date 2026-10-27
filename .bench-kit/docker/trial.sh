#!/usr/bin/env bash
# Cykl pojedynczej próby — uruchamiany PID 1 w jednorazowym kontenerze.
#
# Zapieczone w obrazie: /workspace (repo@pin + overlay, commit startowy),
# /bench/prompt.md, /bench/start-sha. Zamontowane: /bench/out (katalog
# zachowanej próby — ATTEMPT_FORMAT.md). Sekrety modeli przychodzą przez
# env (-e), nigdy nie są w obrazie.
#
# Użycie: trial.sh <timeout_s> <harness> <route> <model>
#   harness: opencode | claude-code | codex   (runner/src/lib/harness.ts)
#   route:   native | openrouter              (dostawca modelu)
#   model:   nazwa modelu w konwencji danego CLI
#
# Każdy harness startuje z pustym katalogiem stanu (XDG_DATA_HOME /
# CLAUDE_CONFIG_DIR / CODEX_HOME zapieczone puste w obrazie) — próba nie
# widzi śladu żadnej wcześniejszej sesji, a adapter metryk czyta stan
# wyłącznie tej jednej.
set -u

timeout_s="$1"
harness="$2"
route="$3"
model="$4"
out=/bench/out
openrouter_api="${BENCH_OPENROUTER_BASE_URL:-https://openrouter.ai/api}"

cd /workspace

# Pliki instrukcji projektu, które agent ZASTAŁ (przed startem) — różne
# CLI czytają różne pliki, więc to część kontekstu próby (attempt.json →
# context_files; wyrównanie: defaults.context_files, lib/context-files.ts).
find . -maxdepth 3 \( -name node_modules -o -name .git \) -prune -o -type f \
  \( -name AGENTS.md -o -name CLAUDE.md -o -name CLAUDE.local.md -o -name GEMINI.md \
     -o -name .cursorrules -o -path ./.github/copilot-instructions.md \) -print \
  -o -type l \( -name AGENTS.md -o -name CLAUDE.md \) -print 2>/dev/null |
  sed 's|^\./||' | sort >"$out/context-files.txt"

# Wykonanie agenta pod twardym timeoutem. OpenCode: SIGTERM (jak dotąd).
# Claude Code i Codex dostają SIGINT — przerwanie tury zostawia na dysku
# zdarzenia i transkrypt do tej chwili (SIGTERM gubi bufor stdout Claude
# Code), więc adapter odtworzy tokeny także z próby po timeoucie.
# SIGKILL 30 s po sygnale, gdy CLI nie zejdzie samo.
start_epoch=$(date +%s)
case "$harness" in
  opencode)
    timeout --kill-after=15 "$timeout_s" \
      opencode run --model "$model" "$(cat /bench/prompt.md)" \
      >"$out/agent.log" 2>&1
    agent_exit=$?
    ;;
  claude-code)
    export CLAUDE_CONFIG_DIR=/bench/claude-home
    # Kontener jest piaskownicą (root w jednorazowym kontenerze bez
    # materiałów oceny): IS_SANDBOX=1 zdejmuje odmowę bypassu uprawnień
    # dla roota. Wszystkie harnessy pracują z tymi samymi uprawnieniami.
    export IS_SANDBOX=1
    export DISABLE_UPDATES=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
    export DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 DISABLE_COST_WARNINGS=1
    if [ "$route" = openrouter ]; then
      # Integracja wg OpenRouter: endpoint zgodny z Anthropic, token jako
      # Bearer, ANTHROPIC_API_KEY jawnie pusty. Wszystkie aliasy (także
      # haiku do zadań w tle i model subagentów) wskazują oceniany model —
      # każdy token próby pochodzi z modelu, który mierzymy.
      export ANTHROPIC_BASE_URL="$openrouter_api"
      export ANTHROPIC_AUTH_TOKEN="${OPENROUTER_API_KEY:-}"
      export ANTHROPIC_API_KEY=""
      export ANTHROPIC_DEFAULT_OPUS_MODEL="$model" ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
      export ANTHROPIC_DEFAULT_HAIKU_MODEL="$model" CLAUDE_CODE_SUBAGENT_MODEL="$model"
    fi
    # Prompt przez stdin (nie argument — treść zaczynająca się od "-"
    # nie zostanie wzięta za flagę); tryb uprawnień jawnie, bo domyślny
    # tryb -p zależy od pobrania feature flag.
    timeout -s INT --kill-after=30 "$timeout_s" \
      claude -p --model "$model" \
      --permission-mode bypassPermissions \
      --output-format stream-json --verbose \
      </bench/prompt.md >"$out/agent.log" 2>"$out/agent.stderr.log"
    agent_exit=$?
    ;;
  codex)
    export CODEX_HOME=/bench/codex-home
    if [ "$route" = openrouter ]; then
      # Provider wg przewodnika OpenRouter (wire_api: wyłącznie responses);
      # auth przez komendę — Codex pobiera wtedy katalog modeli providera.
      cat >"$CODEX_HOME/config.toml" <<EOF
model_provider = "openrouter"

[model_providers.openrouter]
name = "openrouter"
base_url = "$openrouter_api/v1"

[model_providers.openrouter.auth]
command = "sh"
args = ["-c", "printf %s \"\$OPENROUTER_API_KEY\""]
EOF
    else
      # codex exec czyta CODEX_API_KEY, nie OPENAI_API_KEY.
      export CODEX_API_KEY="${CODEX_API_KEY:-${OPENAI_API_KEY:-}}"
    fi
    # Kontener jest granicą izolacji — bez drugiej warstwy sandboxa Codexa
    # (bwrap/seccomp w Dockerze bywa niedostępny). Prompt przez stdin ("-").
    # Bez --ephemeral: rollout sesji w CODEX_HOME to źródło tokenów po timeoucie.
    timeout -s INT --kill-after=30 "$timeout_s" \
      codex exec --json \
      --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
      -C /workspace -m "$model" - \
      </bench/prompt.md >"$out/agent.log" 2>"$out/agent.stderr.log"
    agent_exit=$?
    ;;
  *)
    echo "bench: nieznany harness \"$harness\" (opencode | claude-code | codex)" >"$out/agent.log"
    agent_exit=2
    ;;
esac
end_epoch=$(date +%s)
wall_s=$((end_epoch - start_epoch))

# patch.diff: workspace vs punkt startowy. `git add -A` łapie pliki
# nieśledzone; diff --cached vs commit startowy łapie też zmiany, które
# agent zdążył scommitować.
git add -A
git diff --cached --binary "$(cat /bench/start-sha)" >"$out/patch.diff"

# Metryki ze stanu harnessu tej próby (adapter per harness; kontrakt:
# metrics-adapter/README.md). Koszt bez wiarygodnego źródła w harnessie
# zostaje null — wycenia go runner (lib/pricing.ts), z zapisanym źródłem.
case "$harness" in
  opencode) node --experimental-sqlite /bench/metrics-adapter/opencode.mjs "$XDG_DATA_HOME" "$out/metrics.json" "$wall_s" ;;
  claude-code) node /bench/metrics-adapter/claude-code.mjs "$out/agent.log" /bench/claude-home "$out/metrics.json" "$wall_s" ;;
  codex) node /bench/metrics-adapter/codex.mjs "$out/agent.log" /bench/codex-home "$out/metrics.json" "$wall_s" ;;
  *) printf '{"cost_usd":null,"tokens":{"input":null,"output":null},"duration_s":%s,"incomplete":true,"incomplete_reason":"nieznany harness"}\n' "$wall_s" >"$out/metrics.json" ;;
esac

# Surowy status wykonania dla runnera. 124 = timeout z coreutils; 137 po
# upływie limitu = CLI nie zeszło po sygnale i dostało SIGKILL z
# --kill-after — to też timeout, nie kill zasobowy (OOM).
timed_out=false
[ "$agent_exit" -eq 124 ] && timed_out=true
[ "$agent_exit" -eq 137 ] && [ "$wall_s" -ge "$timeout_s" ] && timed_out=true
cat >"$out/execution.json" <<EOF
{
  "agent_exit": $agent_exit,
  "timed_out": $timed_out,
  "wall_duration_s": $wall_s
}
EOF

# Workspace po pracy agenta — ZAWSZE zachowywany (kontrakt zachowanej
# próby, ATTEMPT_FORMAT.md): stan /workspace — także po timeoucie —
# trafia do katalogu próby jako workspace/ (poza gitem, .gitignore).
# To surowiec dla sędziego-z-narzędziami (rate-attempt): build, testy,
# uruchomienie aplikacji na kopii tego katalogu.
# Bez node_modules i bez .git: próba biegnie offline, więc node_modules
# pochodzi z obrazu zadania (task.prepare), a .git to commit startowy z obrazu
# (zmiany agenta są w drzewie i w patch.diff) — setki MB na próbę, które
# `bench shell` bierze z obrazu z powrotem. Kopia idzie PO metrics/execution.json:
# pełny dysk nie może wyzerować plików, z których runner czyta wynik.
rm -rf "$out/workspace"
mkdir -p "$out/workspace"
# Ucięta kopia jest gorsza niż żadna (0-bajtowy package.json myli `bench
# shell` i sędziego) — usuwamy ją i zostawiamy znacznik, który runner
# przenosi do attempt.json (workspace_preserved: false).
if ! ( cd /workspace && tar --exclude=node_modules --exclude=./.git -cf - . ) | tar -xpf - -C "$out/workspace"; then
  rm -rf "$out/workspace"
  echo "bench: zachowanie workspace nie powiodło się — pełny dysk?" >>"$out/agent.log"
  echo "zachowanie workspace nie powiodło się (pełny dysk?)" >"$out/workspace-incomplete.txt" || true
fi

exit 0
