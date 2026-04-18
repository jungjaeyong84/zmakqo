#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_ai_cli_env.sh

# 2026-04-18: production runtime moved from local server (127.0.0.1:3000)
# to the donbeolja Cloud Run service. Point the watchdog at Cloud Run so
# its scheduler SLA probe reaches the right endpoint; otherwise every
# run reports SCHEDULER_STATUS_UNREACHABLE because the local server is
# no longer running.
export AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL="${AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL:-https://donbeolja-350958953672.asia-northeast3.run.app}"

# Scheduler token — resolved from Secret Manager at run time so it stays
# in sync with what Cloud Run uses. Safe to export inline for the child
# node process; the value never touches disk.
if [ -z "${SCHEDULER_TOKEN:-}" ]; then
  SCHEDULER_TOKEN="$(gcloud secrets versions access latest \
    --secret=DONBEOLJA_SCHEDULER_TOKEN \
    --project=donbeolja-dev 2>/dev/null || true)"
  export SCHEDULER_TOKEN
fi

cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-automation-watchdog.js
