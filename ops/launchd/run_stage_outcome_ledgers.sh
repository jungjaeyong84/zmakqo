#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
LATEST_ML_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/ml_filter_policy_latest.json"
NOW_EPOCH="$(date +%s)"
ML_FRESH_WINDOW_SEC=$((6 * 60 * 60))

if [ ! -f "$LATEST_ML_JSON" ]; then
  node scripts/automation-ml-filter-policy.js
else
  ML_LATEST_MTIME="$(stat -f %m "$LATEST_ML_JSON" 2>/dev/null || echo 0)"
  ML_AGE_SEC=$((NOW_EPOCH - ML_LATEST_MTIME))
  if [ "$ML_AGE_SEC" -gt "$ML_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-ml-filter-policy.js
  fi
fi

node scripts/automation-stage-outcome-ledgers.js
