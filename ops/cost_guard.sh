#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

PROJECT_ID="${PROJECT_ID:-donbeolja-dev}"
SERVICE="${SERVICE:-donbeolja}"
REGION="${REGION:-asia-northeast3}"

DAY_THRESHOLD_KRW="${DAY_THRESHOLD_KRW:-5000}"
FALLBACK_SPIKE_COUNT="${FALLBACK_SPIKE_COUNT:-30}"
QUERY_BARS_FALLBACK_SPIKE_COUNT="${QUERY_BARS_FALLBACK_SPIKE_COUNT:-30}"
LOOKBACK_MIN="${LOOKBACK_MIN:-15}"
APPLY_PROTECTION="${APPLY_PROTECTION:-1}"

read_cost_today() {
  bq query --project_id "${PROJECT_ID}" --use_legacy_sql=false --format=csv \
    "SELECT COALESCE(ROUND(SUM(cost),2), 0)
     FROM \`${PROJECT_ID}.billing_export.gcp_billing_export_v1_01AF2F_588FE2_BCA6B7\`
     WHERE sku.description IN ('Cloud Firestore Read Ops Seoul','Cloud Firestore Internet Data Transfer Out from APAC to APAC')
       AND DATE(usage_start_time, 'Asia/Seoul') = CURRENT_DATE('Asia/Seoul')" \
    | tail -n +2
}

fallback_count_recent() {
  local since
  since=$(python3 - <<PY
import datetime
print((datetime.datetime.utcnow() - datetime.timedelta(minutes=${LOOKBACK_MIN})).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND timestamp>=\"${since}\" AND (jsonPayload.event=\"signals_fallback_used\" OR textPayload:\"signals_fallback_used\")" \
    --project "${PROJECT_ID}" \
    --limit=10000 \
    --format='value(timestamp)' | wc -l | tr -d ' '
}

query_bars_fallback_count_recent() {
  local since
  since=$(python3 - <<PY
import datetime
print((datetime.datetime.utcnow() - datetime.timedelta(minutes=${LOOKBACK_MIN})).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND timestamp>=\"${since}\" AND textPayload:\"[queryBars] fallback\"" \
    --project "${PROJECT_ID}" \
    --limit=10000 \
    --format='value(timestamp)' | wc -l | tr -d ' '
}

TODAY_COST="$(read_cost_today | tr -d '\"[:space:]')"
TODAY_COST="${TODAY_COST:-0}"
FALLBACK_CNT="$(fallback_count_recent | tr -d '[:space:]')"
FALLBACK_CNT="${FALLBACK_CNT:-0}"
QUERY_BARS_FALLBACK_CNT="$(query_bars_fallback_count_recent | tr -d '[:space:]')"
QUERY_BARS_FALLBACK_CNT="${QUERY_BARS_FALLBACK_CNT:-0}"

echo "[COST_GUARD] today_firestore_cost_krw=${TODAY_COST} threshold=${DAY_THRESHOLD_KRW}"
echo "[COST_GUARD] fallback_count_last_${LOOKBACK_MIN}m=${FALLBACK_CNT} spike_threshold=${FALLBACK_SPIKE_COUNT}"
echo "[COST_GUARD] query_bars_fallback_count_last_${LOOKBACK_MIN}m=${QUERY_BARS_FALLBACK_CNT} spike_threshold=${QUERY_BARS_FALLBACK_SPIKE_COUNT}"

SHOULD_PROTECT=$(python3 - <<PY
cost=float("${TODAY_COST}" or 0)
thr=float("${DAY_THRESHOLD_KRW}")
cnt=int("${FALLBACK_CNT}" or 0)
spike=int("${FALLBACK_SPIKE_COUNT}")
qcnt=int("${QUERY_BARS_FALLBACK_CNT}" or 0)
qspike=int("${QUERY_BARS_FALLBACK_SPIKE_COUNT}")
fallback_hot = (cnt >= spike) or (qcnt >= qspike)
print("1" if (cost >= thr and fallback_hot) else "0")
PY
)

if [[ "${SHOULD_PROTECT}" != "1" ]]; then
  echo "[COST_GUARD] no action"
  exit 0
fi

echo "[COST_GUARD] guard triggered"
if [[ "${APPLY_PROTECTION}" != "1" ]]; then
  echo "[COST_GUARD] APPLY_PROTECTION=0 (dry-run)"
  exit 0
fi

gcloud run services update "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --update-env-vars SIGNALS_FALLBACK_FORCE_OPEN=1

echo "[COST_GUARD] protection applied: SIGNALS_FALLBACK_FORCE_OPEN=1"
