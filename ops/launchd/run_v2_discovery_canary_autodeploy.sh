#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"

export DONBEOLJA_V2_COLLECTION_PREFIX="${DONBEOLJA_V2_COLLECTION_PREFIX:-v2__}"
export DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL="${DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL:-BTCUSDT}"
export DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE="${DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE:-25}"
export DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT="${DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT:-1}"
export DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY="${DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY:-1}"
export DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE="${DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE:-10}"
export DONBEOLJA_V2_DISCOVERY_CANARY_AUTODEPLOY_STATE_FILE="${DONBEOLJA_V2_DISCOVERY_CANARY_AUTODEPLOY_STATE_FILE:-/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_discovery_canary_autodeploy_latest.json}"

cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/run-v2-discovery-canary-preflight-deploy.js || true
