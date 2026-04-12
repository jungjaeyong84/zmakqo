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
LATEST_GOVERNANCE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json"
LATEST_RETRO_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.json"
NOW_EPOCH="$(date +%s)"
CANARY_FRESH_WINDOW_SEC=$((8 * 60 * 60))
ML_FRESH_WINDOW_SEC=$((6 * 60 * 60))
STAGE_LEDGER_FRESH_WINDOW_SEC=$((6 * 60 * 60))
WAIT_FRESH_WINDOW_SEC=$((30 * 60 * 60))
GOVERNANCE_FRESH_WINDOW_SEC=$((30 * 60 * 60))
RETRO_FRESH_WINDOW_SEC=$((30 * 60 * 60))

if [ ! -f "$LATEST_CANARY_JSON" ]; then
  node scripts/automation-filter-shadow-canary.js
else
  CANARY_LATEST_MTIME="$(stat -f %m "$LATEST_CANARY_JSON" 2>/dev/null || echo 0)"
  CANARY_AGE_SEC=$((NOW_EPOCH - CANARY_LATEST_MTIME))
  if [ "$CANARY_AGE_SEC" -gt "$CANARY_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-filter-shadow-canary.js
  fi
fi

if [ ! -f "$LATEST_ML_JSON" ]; then
  node scripts/automation-ml-filter-policy.js
else
  ML_LATEST_MTIME="$(stat -f %m "$LATEST_ML_JSON" 2>/dev/null || echo 0)"
  ML_AGE_SEC=$((NOW_EPOCH - ML_LATEST_MTIME))
  if [ "$ML_AGE_SEC" -gt "$ML_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-ml-filter-policy.js
  fi
fi

if [ ! -f "$LATEST_WAIT_JSON" ]; then
  node scripts/automation-wait-one-bar-tune.js
else
  WAIT_LATEST_MTIME="$(stat -f %m "$LATEST_WAIT_JSON" 2>/dev/null || echo 0)"
  WAIT_AGE_SEC=$((NOW_EPOCH - WAIT_LATEST_MTIME))
  if [ "$WAIT_AGE_SEC" -gt "$WAIT_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-wait-one-bar-tune.js
  fi
fi

if [ ! -f "$LATEST_STAGE_LEDGER_JSON" ]; then
  node scripts/automation-stage-outcome-ledgers.js
else
  STAGE_LATEST_MTIME="$(stat -f %m "$LATEST_STAGE_LEDGER_JSON" 2>/dev/null || echo 0)"
  STAGE_AGE_SEC=$((NOW_EPOCH - STAGE_LATEST_MTIME))
  if [ "$STAGE_AGE_SEC" -gt "$STAGE_LEDGER_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-stage-outcome-ledgers.js
  fi
fi

if [ ! -f "$LATEST_GOVERNANCE_JSON" ]; then
  node scripts/automation-weekly-filter-governance.js
else
  LATEST_MTIME="$(stat -f %m "$LATEST_GOVERNANCE_JSON" 2>/dev/null || echo 0)"
  AGE_SEC=$((NOW_EPOCH - LATEST_MTIME))
  if [ "$AGE_SEC" -gt "$GOVERNANCE_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-weekly-filter-governance.js
  fi
fi

if [ ! -f "$LATEST_RETRO_JSON" ]; then
  node scripts/automation-objective-retrospective.js
else
  RETRO_LATEST_MTIME="$(stat -f %m "$LATEST_RETRO_JSON" 2>/dev/null || echo 0)"
  RETRO_AGE_SEC=$((NOW_EPOCH - RETRO_LATEST_MTIME))
  if [ "$RETRO_AGE_SEC" -gt "$RETRO_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-objective-retrospective.js
  fi
fi

node scripts/automation-objective-supervisor.js
