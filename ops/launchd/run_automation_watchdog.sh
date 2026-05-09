#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_ai_cli_env.sh
# shellcheck disable=SC1091
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_gcp_env.sh

# Local-primary hybrid: the watchdog must probe the local scheduler
# surface first. Falling back to Cloud Run here reintroduces residual
# cloud traffic and hides local runtime failures.
export AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL="${AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL:-${BASE_URL:-http://127.0.0.1:3000}}"

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
