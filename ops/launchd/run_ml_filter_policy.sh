#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
LATEST_CANARY_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.json"
NOW_EPOCH="$(date +%s)"
CANARY_FRESH_WINDOW_SEC=$((8 * 60 * 60))

if [ ! -f "$LATEST_CANARY_JSON" ]; then
  node scripts/automation-filter-shadow-canary.js
else
  CANARY_LATEST_MTIME="$(stat -f %m "$LATEST_CANARY_JSON" 2>/dev/null || echo 0)"
  CANARY_AGE_SEC=$((NOW_EPOCH - CANARY_LATEST_MTIME))
  if [ "$CANARY_AGE_SEC" -gt "$CANARY_FRESH_WINDOW_SEC" ]; then
    node scripts/automation-filter-shadow-canary.js
  fi
fi

node scripts/automation-ml-filter-policy.js
