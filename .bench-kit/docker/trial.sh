#!/usr/bin/env bash
# Cykl pojedynczej próby — uruchamiany PID 1 w jednorazowym kontenerze.
#
# Zapieczone w obrazie: /workspace (repo@pin + overlay, commit startowy),
# /bench/prompt.md, /bench/start-sha. Zamontowane: /bench/out (artefakty).
# Sekrety modeli przychodzą przez env (-e), nigdy nie są w obrazie.
#
# Użycie: trial.sh <model> <timeout_s>
set -u

model="$1"
timeout_s="$2"
out=/bench/out

cd /workspace

# Wykonanie agenta pod twardym timeoutem; SIGKILL 15 s po SIGTERM.
start_epoch=$(date +%s)
timeout --kill-after=15 "$timeout_s" \
  opencode run --model "$model" "$(cat /bench/prompt.md)" \
  >"$out/agent.log" 2>&1
agent_exit=$?
end_epoch=$(date +%s)
wall_s=$((end_epoch - start_epoch))

# patch.diff: workspace vs punkt startowy. `git add -A` łapie pliki
# nieśledzone; diff --cached vs commit startowy łapie też zmiany, które
# agent zdążył scommitować.
git add -A
git diff --cached --binary "$(cat /bench/start-sha)" >"$out/patch.diff"

# Metryki ze storage OpenCode (świeży XDG_DATA_HOME tej próby).
node --experimental-sqlite /bench/metrics-adapter.mjs \
  "$XDG_DATA_HOME" "$out/metrics.json" "$wall_s"

# Surowy status wykonania dla runnera (124 = timeout z coreutils).
timed_out=false
[ "$agent_exit" -eq 124 ] && timed_out=true
cat >"$out/execution.json" <<EOF
{
  "agent_exit": $agent_exit,
  "timed_out": $timed_out,
  "wall_duration_s": $wall_s
}
EOF

exit 0
