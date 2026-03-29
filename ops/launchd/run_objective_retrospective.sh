#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-objective-retrospective.js
/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_objective_supervisor.sh
/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_stage_autopilot.sh
/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_automation_watchdog.sh
