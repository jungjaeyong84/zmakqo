#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_ai_cli_env.sh
cd /Users/jeongjaeyong/Projects/donbeolja
LATEST_CANARY_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.json"
LATEST_ML_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/ml_filter_policy_latest.json"
LATEST_STAGE_LEDGER_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_outcome_ledgers_latest.json"
LATEST_WAIT_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/wait_one_bar_tune_latest.json"
LATEST_EV_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/ev_tp1_threshold_tune_latest.json"
LATEST_GOVERNANCE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json"
LATEST_OBJECTIVE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json"
NOW_EPOCH="$(date +%s)"
CANARY_FRESH_WINDOW_SEC=$((8 * 60 * 60))
ML_FRESH_WINDOW_SEC=$((6 * 60 * 60))
STAGE_LEDGER_FRESH_WINDOW_SEC=$((6 * 60 * 60))
WAIT_FRESH_WINDOW_SEC=$((30 * 60 * 60))
EV_FRESH_WINDOW_SEC=$((84 * 60 * 60))
GOVERNANCE_FRESH_WINDOW_SEC=$((30 * 60 * 60))
OBJECTIVE_FRESH_WINDOW_SEC=$((6 * 60 * 60))

ensure_fresh_json() {
  local latest_path="$1"
  local freshness_sec="$2"
  local cmd="$3"
  if [ ! -f "$latest_path" ]; then
    eval "$cmd"
    return
  fi
  local latest_mtime
  latest_mtime="$(stat -f %m "$latest_path" 2>/dev/null || echo 0)"
  local age_sec=$((NOW_EPOCH - latest_mtime))
  if [ "$age_sec" -gt "$freshness_sec" ]; then
    eval "$cmd"
  fi
}

ensure_fresh_json "$LATEST_CANARY_JSON" "$CANARY_FRESH_WINDOW_SEC" "node scripts/automation-filter-shadow-canary.js"
ensure_fresh_json "$LATEST_ML_JSON" "$ML_FRESH_WINDOW_SEC" "node scripts/automation-ml-filter-policy.js"
ensure_fresh_json "$LATEST_STAGE_LEDGER_JSON" "$STAGE_LEDGER_FRESH_WINDOW_SEC" "node scripts/automation-stage-outcome-ledgers.js"
ensure_fresh_json "$LATEST_WAIT_JSON" "$WAIT_FRESH_WINDOW_SEC" "node scripts/automation-wait-one-bar-tune.js"
ensure_fresh_json "$LATEST_EV_JSON" "$EV_FRESH_WINDOW_SEC" "node scripts/automation-ev-tp1-threshold-tune.js"
ensure_fresh_json "$LATEST_GOVERNANCE_JSON" "$GOVERNANCE_FRESH_WINDOW_SEC" "node scripts/automation-weekly-filter-governance.js"
ensure_fresh_json "$LATEST_OBJECTIVE_JSON" "$OBJECTIVE_FRESH_WINDOW_SEC" "/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh"

node scripts/automation-stage-autopilot.js
