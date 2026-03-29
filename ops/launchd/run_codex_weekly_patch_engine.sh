#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
LATEST_OBJECTIVE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json"
LATEST_GOVERNANCE_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json"
LATEST_RETRO_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.json"
LATEST_STAGE_AUTOPILOT_JSON="/Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_autopilot_latest.json"
NOW_EPOCH="$(date +%s)"
OBJECTIVE_FRESH_WINDOW_SEC=$((6 * 60 * 60))
GOVERNANCE_FRESH_WINDOW_SEC=$((90 * 60))
RETRO_FRESH_WINDOW_SEC=$((30 * 60 * 60))
STAGE_AUTOPILOT_FRESH_WINDOW_SEC=$((6 * 60 * 60))

if [ ! -f "$LATEST_GOVERNANCE_JSON" ]; then
  /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_weekly_filter_governance.sh
else
  GOV_LATEST_MTIME="$(stat -f %m "$LATEST_GOVERNANCE_JSON" 2>/dev/null || echo 0)"
  GOV_AGE_SEC=$((NOW_EPOCH - GOV_LATEST_MTIME))
  if [ "$GOV_AGE_SEC" -gt "$GOVERNANCE_FRESH_WINDOW_SEC" ]; then
    /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_weekly_filter_governance.sh
  fi
fi

if [ ! -f "$LATEST_RETRO_JSON" ]; then
  /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_retrospective.sh
else
  RETRO_LATEST_MTIME="$(stat -f %m "$LATEST_RETRO_JSON" 2>/dev/null || echo 0)"
  RETRO_AGE_SEC=$((NOW_EPOCH - RETRO_LATEST_MTIME))
  if [ "$RETRO_AGE_SEC" -gt "$RETRO_FRESH_WINDOW_SEC" ]; then
    /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_retrospective.sh
  fi
fi

if [ ! -f "$LATEST_OBJECTIVE_JSON" ]; then
  /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh
else
  OBJ_LATEST_MTIME="$(stat -f %m "$LATEST_OBJECTIVE_JSON" 2>/dev/null || echo 0)"
  OBJ_AGE_SEC=$((NOW_EPOCH - OBJ_LATEST_MTIME))
  if [ "$OBJ_AGE_SEC" -gt "$OBJECTIVE_FRESH_WINDOW_SEC" ]; then
    /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh
  fi
fi

if [ ! -f "$LATEST_STAGE_AUTOPILOT_JSON" ]; then
  /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_stage_autopilot.sh
else
  AUTOPILOT_LATEST_MTIME="$(stat -f %m "$LATEST_STAGE_AUTOPILOT_JSON" 2>/dev/null || echo 0)"
  AUTOPILOT_AGE_SEC=$((NOW_EPOCH - AUTOPILOT_LATEST_MTIME))
  if [ "$AUTOPILOT_AGE_SEC" -gt "$STAGE_AUTOPILOT_FRESH_WINDOW_SEC" ]; then
    /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_stage_autopilot.sh
  fi
fi

node scripts/automation-codex-weekly-patch-engine.js
node scripts/automation-objective-supervisor.js
node scripts/automation-stage-autopilot.js
