#!/bin/zsh
# OpenClaw per-source calibration report — runs every 4h via launchd.
# Writes ops/daily/openclaw_calibration_latest.json which drives the Phase E
# autonomy auto-degrade (openclawDecisionAgent's `shouldDropVote`).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_CALIBRATION_LOOKBACK_HOURS="${OPENCLAW_CALIBRATION_LOOKBACK_HOURS:-168}"
export OPENCLAW_CALIBRATION_MIN_SAMPLE="${OPENCLAW_CALIBRATION_MIN_SAMPLE:-20}"
export OPENCLAW_CALIBRATION_TRUST_FLOOR="${OPENCLAW_CALIBRATION_TRUST_FLOOR:-0.3}"
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/report-openclaw-calibration.js
