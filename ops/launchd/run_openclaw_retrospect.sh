#!/bin/zsh
# OpenClaw retrospect loop — runs every 4h via launchd.
# Feeds the last 24h of realized trades to the narrative reasoner and writes
# ops/daily/openclaw_retrospect_latest.json. Never applies; operator reviews.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_RETROSPECT_LOOKBACK_HOURS="${OPENCLAW_RETROSPECT_LOOKBACK_HOURS:-24}"
export OPENCLAW_RETROSPECT_LIMIT="${OPENCLAW_RETROSPECT_LIMIT:-50}"
# OpenClaw phase flags (OPENCLAW_*) — managed by ops/deploy/apply_openclaw_phase.sh.
if [ -f "$HOME/.env.openclaw" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . "$HOME/.env.openclaw"
  set +o allexport
fi
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/run-openclaw-retrospect.js
