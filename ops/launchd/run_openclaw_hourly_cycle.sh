#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_DRIFT_REMEDIATION_APPLY="${OPENCLAW_DRIFT_REMEDIATION_APPLY:-1}"
# shellcheck disable=SC1091
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_gcp_env.sh

# Local-primary hybrid: child scripts must probe the local scheduler
# surface first so the hourly cycle does not wake Cloud Run just to
# measure scheduler health.
export AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL="${AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL:-${BASE_URL:-http://127.0.0.1:3000}}"
if [ -z "${SCHEDULER_TOKEN:-}" ]; then
  SCHEDULER_TOKEN="$(gcloud secrets versions access latest \
    --secret=DONBEOLJA_SCHEDULER_TOKEN \
    --project=donbeolja-dev 2>/dev/null || true)"
  export SCHEDULER_TOKEN
fi

cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-openclaw-hourly-cycle.js
