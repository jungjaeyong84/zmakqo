#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

PROJECT_ID="${PROJECT_ID:-donbeolja-dev}"
DATABASE_ID="${FIRESTORE_DATABASE:-(default)}"

echo "[INDEX] project=${PROJECT_ID} database=${DATABASE_ID}"

create_index() {
  local name="$1"
  shift
  echo "[INDEX] create: ${name}"
  set +e
  local output
  output=$(gcloud firestore indexes composite create \
    --project "${PROJECT_ID}" \
    --database "${DATABASE_ID}" \
    --async \
    "$@" 2>&1)
  local rc=$?
  set -e
  if [[ ${rc} -ne 0 ]]; then
    if echo "${output}" | grep -qiE "already exists|ALREADY_EXISTS"; then
      echo "[INDEX] exists: ${name}"
      return 0
    fi
    echo "${output}"
    return ${rc}
  fi
  echo "${output}"
}

create_index "signals(exchange,symbol_or_pair_id,tf,bar_close_time_utc_ms)" \
  --collection-group=signals \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol_or_pair_id,order=ascending \
  --field-config=field-path=tf,order=ascending \
  --field-config=field-path=bar_close_time_utc_ms,order=ascending

create_index "signals(exchange,symbol,tf,bar_close_time_utc_ms)" \
  --collection-group=signals \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol,order=ascending \
  --field-config=field-path=tf,order=ascending \
  --field-config=field-path=bar_close_time_utc_ms,order=ascending

create_index "signals(exchange,symbol_or_pair_id,tf,created_at desc)" \
  --collection-group=signals \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol_or_pair_id,order=ascending \
  --field-config=field-path=tf,order=ascending \
  --field-config=field-path=created_at,order=descending

create_index "signals(exchange,symbol,tf,created_at desc)" \
  --collection-group=signals \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol,order=ascending \
  --field-config=field-path=tf,order=ascending \
  --field-config=field-path=created_at,order=descending

create_index "funding_fees(exchange,symbol,time_ms)" \
  --collection-group=funding_fees \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol,order=ascending \
  --field-config=field-path=time_ms,order=ascending

create_index "position_events(exchange,sequence_ms desc)" \
  --collection-group=position_events \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=sequence_ms,order=descending

create_index "unified_event_timeline(exchange,symbol,ts_ms)" \
  --collection-group=unified_event_timeline \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=symbol,order=ascending \
  --field-config=field-path=ts_ms,order=ascending

create_index "position_read_model_latest(exchange,ts_ms desc)" \
  --collection-group=position_read_model_latest \
  --query-scope=COLLECTION \
  --field-config=field-path=exchange,order=ascending \
  --field-config=field-path=ts_ms,order=descending

create_index "v2__signal_shadow_counterfactuals(status,horizon_close_ms)" \
  --collection-group=v2__signal_shadow_counterfactuals \
  --query-scope=COLLECTION \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=horizon_close_ms,order=ascending

echo "[INDEX] done"
