#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
LATEST_OBJECTIVE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json"
NOW_EPOCH="$(date +%s)"
OBJECTIVE_FRESH_WINDOW_SEC=$((8 * 60 * 60))

if [ ! -f "$LATEST_OBJECTIVE_JSON" ]; then
  /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh
else
  OBJ_LATEST_MTIME="$(stat -f %m "$LATEST_OBJECTIVE_JSON" 2>/dev/null || echo 0)"
  OBJ_AGE_SEC=$((NOW_EPOCH - OBJ_LATEST_MTIME))
  if [ "$OBJ_AGE_SEC" -gt "$OBJECTIVE_FRESH_WINDOW_SEC" ]; then
    /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh
  fi
fi

node scripts/automation-rollback-monitor.js
