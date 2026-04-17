#!/bin/zsh
# OpenClaw evidence-outcome linker — runs every 15 min via launchd.
# Writes the linked outcomes back to `openclaw_evidence_ledger` so the
# calibration cycle can score each source's realized accuracy.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
# Linker must actually write when Phase A+ is live. Keep DRY_RUN=0 default so
# the cron is effective the moment OPENCLAW_AGENT_SHADOW_ENABLED=1 is flipped.
export DRY_RUN="${OPENCLAW_LINKER_DRY_RUN:-0}"
export OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS="${OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS:-7}"
# OpenClaw phase flags (OPENCLAW_*) — managed by ops/deploy/apply_openclaw_phase.sh.
if [ -f "$HOME/.env.openclaw" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . "$HOME/.env.openclaw"
  set +o allexport
fi
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/link-openclaw-evidence-outcomes.js
