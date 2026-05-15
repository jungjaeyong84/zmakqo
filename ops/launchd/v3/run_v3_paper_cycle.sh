#!/bin/zsh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OPS_RUNTIME_DIR="$REPO_ROOT/ops/runtime"
OPS_DAILY_DIR="$REPO_ROOT/ops/daily"
LOCK_DIR="$OPS_RUNTIME_DIR/v3_paper_cycle.lock"
LOCK_TTL_SEC="${V3_PAPER_CYCLE_LOCK_TTL_SEC:-900}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
CYCLE_OUT_LOG="$OPS_RUNTIME_DIR/v3_paper_cycle.out.log"
CYCLE_ERR_LOG="$OPS_RUNTIME_DIR/v3_paper_cycle.err.log"

mkdir -p "$OPS_RUNTIME_DIR" "$OPS_DAILY_DIR"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "{\"ok\":false,\"reason\":\"NODE_BIN_MISSING\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$CYCLE_ERR_LOG"
  exit 1
fi

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    date +%s > "$LOCK_DIR/pid"
    return 0
  fi

  local now epoch age
  now="$(date +%s)"
  epoch="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo 0)"
  age=$(( now - epoch ))
  if [[ "$age" -ge "$LOCK_TTL_SEC" ]]; then
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
    date +%s > "$LOCK_DIR/pid"
    echo "{\"ok\":true,\"event\":\"STALE_LOCK_RECOVERED\",\"age_sec\":$age,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$CYCLE_OUT_LOG"
    return 0
  fi

  echo "{\"ok\":true,\"event\":\"LOCK_BUSY_SKIP\",\"age_sec\":$age,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$CYCLE_OUT_LOG"
  exit 0
}

cleanup() {
  rm -rf "$LOCK_DIR"
}

trap cleanup EXIT INT TERM

run_step() {
  local step_name="$1"
  local script_name="$2"
  local out_log="$OPS_RUNTIME_DIR/v3_paper_${step_name}.out.log"
  local err_log="$OPS_RUNTIME_DIR/v3_paper_${step_name}.err.log"
  local started_at ended_at duration_ms rc

  started_at="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  if "$NODE_BIN" "$REPO_ROOT/scripts/$script_name" >> "$out_log" 2>> "$err_log"; then
    rc=0
  else
    rc=$?
  fi
  ended_at="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  duration_ms=$(( ended_at - started_at ))
  echo "{\"step\":\"$step_name\",\"script\":\"$script_name\",\"rc\":$rc,\"duration_ms\":$duration_ms,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$CYCLE_OUT_LOG"
  return "$rc"
}

acquire_lock
cd "$REPO_ROOT"

overall_rc=0

run_step "source_feed" "run-v3-source-generator.js" || overall_rc=1
run_step "lane" "run-v3-paper-lane.js" || overall_rc=1
run_step "entry_ledger" "run-v3-paper-entry-ledger.js" || overall_rc=1
run_step "exit_ledger" "run-v3-paper-exit-ledger.js" || overall_rc=1
run_step "performance" "report-v3-paper-performance.js" || overall_rc=1
run_step "bootstrap_live_seed" "report-v3-bootstrap-live-seed.js" || overall_rc=1
run_step "bootstrap_refresh" "report-v3-paper-bootstrap.js" || overall_rc=1
run_step "validation" "report-v3-paper-validation.js" || overall_rc=1
run_step "learning_state" "report-v3-openclaw-learning-state.js" || overall_rc=1

echo "{\"ok\":$([[ "$overall_rc" -eq 0 ]] && echo true || echo false),\"event\":\"V3_PAPER_CYCLE_DONE\",\"rc\":$overall_rc,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$CYCLE_OUT_LOG"
exit "$overall_rc"
