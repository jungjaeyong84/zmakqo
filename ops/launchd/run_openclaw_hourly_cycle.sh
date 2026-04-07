#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"
export OPENCLAW_DRIFT_REMEDIATION_APPLY="${OPENCLAW_DRIFT_REMEDIATION_APPLY:-1}"
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-openclaw-hourly-cycle.js
