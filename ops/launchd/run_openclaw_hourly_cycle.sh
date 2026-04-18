#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_DRIFT_REMEDIATION_APPLY="${OPENCLAW_DRIFT_REMEDIATION_APPLY:-1}"

# Child scripts (notably automation-automation-watchdog.js spawned from
# the hourly cycle) inherit this env and use it to reach Cloud Run's
# /scheduler/status with the scheduler token. Without these exports the
# watchdog defaulted to 127.0.0.1:3000 with no token and emitted a
# SCHEDULER_STATUS_UNREACHABLE alert every hour (see 2026-04-18 14:22
# incident). Point them at production and resolve the token from
# Secret Manager at run time.
export AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL="${AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL:-https://donbeolja-350958953672.asia-northeast3.run.app}"
if [ -z "${SCHEDULER_TOKEN:-}" ]; then
  SCHEDULER_TOKEN="$(gcloud secrets versions access latest \
    --secret=DONBEOLJA_SCHEDULER_TOKEN \
    --project=donbeolja-dev 2>/dev/null || true)"
  export SCHEDULER_TOKEN
fi

cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-openclaw-hourly-cycle.js
