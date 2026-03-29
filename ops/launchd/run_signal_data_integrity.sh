#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/refresh-analytics-local-cache.js
node scripts/automation-signal-data-integrity.js
node scripts/refresh-analytics-local-cache.js
node scripts/automation-stage-outcome-ledgers.js
node scripts/automation-weekly-filter-governance.js
node scripts/automation-objective-supervisor.js
node scripts/automation-stage-autopilot.js
