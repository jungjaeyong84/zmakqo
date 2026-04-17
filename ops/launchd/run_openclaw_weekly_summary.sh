#!/bin/zsh
# OpenClaw weekly retrospect telegram summary — runs once a week via launchd.
# Reads ops/daily/openclaw_{evidence_linker,calibration,retrospect}_latest.json,
# formats a short Korean summary, and ships it to OPENCLAW_WEEKLY_ALERT_CHANNEL.
# Never raises — exits 0 even on failure so the cron does not flap.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
# Default alert channel comes from env; when unset the script prints the body
# to stdout instead of sending, so the operator sees it in the wrapper log.
# OpenClaw phase flags (OPENCLAW_*) — managed by ops/deploy/apply_openclaw_phase.sh.
if [ -f "$HOME/.env.openclaw" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . "$HOME/.env.openclaw"
  set +o allexport
fi
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/send-openclaw-weekly-retrospect.js
