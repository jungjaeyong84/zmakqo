#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"

export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR:-/Users/jeongjaeyong/Projects/donbeolja/ops/daily}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE:-v2_repair_queue_firestore_canary_latest.json}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE:-/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_repair_queue_firestore_canary_history.jsonl}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE:-/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_repair_queue_firestore_canary_streak_latest.json}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED:-1}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX:-paperopcanaryv2_$(date +%Y%m%d%H%M%S)__}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_LOOKBACK_HOURS="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_LOOKBACK_HOURS:-24}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MIN_RUNS="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MIN_RUNS:-12}"
export DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MAX_GAP_MINUTES="${DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MAX_GAP_MINUTES:-180}"

cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/run-v2-repair-queue-firestore-canary.js

# Streak is expected to fail-closed until enough history exists. The collector
# records that verdict but does not flap the collection job before 24h coverage.
node scripts/check-v2-repair-queue-firestore-canary-streak.js || true
