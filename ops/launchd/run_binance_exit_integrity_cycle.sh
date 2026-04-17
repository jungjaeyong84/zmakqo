#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED="${OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED:-1}"
export OPENCLAW_EXIT_INTEGRITY_CYCLE_MIN_INTERVAL_HOURS="${OPENCLAW_EXIT_INTEGRITY_CYCLE_MIN_INTERVAL_HOURS:-4}"
export EXIT_INTEGRITY_SKIP_WHEN_NO_ACTIVE_POSITIONS="${EXIT_INTEGRITY_SKIP_WHEN_NO_ACTIVE_POSITIONS:-1}"
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/run-binance-exit-integrity-cycle.js
