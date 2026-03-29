# Firestore Cost Guard Runbook

## Goal
- Prevent recurrence of Firestore cost spikes by combining:
1. Billing-based threshold detection (`>= 5,000 KRW/day`)
2. Runtime fallback-scan surge detection
3. Automatic protection toggle (`SIGNALS_FALLBACK_FORCE_OPEN`)

## Scope
- Project: `donbeolja-dev`
- Service: `donbeolja` (Cloud Run, region `asia-northeast3`)
- Billing source: `donbeolja-dev.billing_export.gcp_billing_export_v1_01AF2F_588FE2_BCA6B7`

## Detection (BigQuery)
- Query file: `/Users/jeongjaeyong/Projects/donbeolja/ops/cost_guard.sql`
- Manual run:
```bash
bq query --use_legacy_sql=false --format=prettyjson < /Users/jeongjaeyong/Projects/donbeolja/ops/cost_guard.sql
```
- Guard condition:
1. `firestore_total_krw >= 5000` for current KST day

## Runtime fallback surge signal (Cloud Logging)
- Check fallback events in recent 15 minutes:
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="donbeolja" AND (jsonPayload.event="signals_fallback_used" OR textPayload:"signals_fallback_used") AND timestamp>="'$(date -u -v-15M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || python3 - <<'PY'
import datetime
print((datetime.datetime.utcnow()-datetime.timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)'"' \
  --limit=500 --format='value(timestamp)'
```
- Check `queryBars` fallback events in recent 15 minutes:
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="donbeolja" AND textPayload:"[queryBars] fallback" AND timestamp>="'$(date -u -v-15M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || python3 - <<'PY'
import datetime
print((datetime.datetime.utcnow()-datetime.timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)'"' \
  --limit=500 --format='value(timestamp)'
```
- Surge guideline:
1. `signals_fallback_used >= 30` / 15min
2. `queryBars fallback >= 30` / 15min
3. OR repeated `signals_fallback_circuit_open`

## Automatic protection action
- Automated script:
```bash
/Users/jeongjaeyong/Projects/donbeolja/ops/cost_guard.sh
```
- Optional threshold overrides:
```bash
DAY_THRESHOLD_KRW=5000 FALLBACK_SPIKE_COUNT=30 QUERY_BARS_FALLBACK_SPIKE_COUNT=30 LOOKBACK_MIN=15 /Users/jeongjaeyong/Projects/donbeolja/ops/cost_guard.sh
```
- Cloud Run endpoint (same guard logic):
```bash
curl -sS -X POST "https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/cost-guard" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"lookback_min":15,"day_threshold_krw":5000,"fallback_spike_count":30,"query_bars_fallback_spike_count":30}'
```
- Recommended scheduler (every 15 minutes):
```bash
gcloud scheduler jobs create http donbeolja-cost-guard \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="*/15 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/cost-guard" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{"lookback_min":15,"day_threshold_krw":5000,"fallback_spike_count":30,"query_bars_fallback_spike_count":30}'
```
- Existing job update (if already created):
```bash
gcloud scheduler jobs update http donbeolja-cost-guard \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="*/15 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/cost-guard" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{"lookback_min":15,"day_threshold_krw":5000,"fallback_spike_count":30,"query_bars_fallback_spike_count":30}'
```

- Enable forced circuit-open (blocks expensive fallback scans):
```bash
gcloud run services update donbeolja \
  --region asia-northeast3 \
  --update-env-vars SIGNALS_FALLBACK_FORCE_OPEN=1
```

- Optional extra hardening during incident:
```bash
gcloud run services update donbeolja \
  --region asia-northeast3 \
  --update-env-vars TICK_EXIT_INTERVAL_MS=60000,TICK_EXIT_SYMBOL_COOLDOWN_MS=180000
```

## Recovery action
- After 24h stable costs and no fallback surge, reopen fallback:
```bash
gcloud run services update donbeolja \
  --region asia-northeast3 \
  --update-env-vars SIGNALS_FALLBACK_FORCE_OPEN=0,TICK_EXIT_INTERVAL_MS=5000,TICK_EXIT_SYMBOL_COOLDOWN_MS=10000,TICK_EXIT_NEAR_PCT=0.006
```

## Deployment checklist gate
- Before deploy, enforce index sync:
```bash
/Users/jeongjaeyong/Projects/donbeolja/ops/firestore_indexes_apply.sh
```
- Required file exists and is reviewed:
1. `/Users/jeongjaeyong/Projects/donbeolja/firestore.indexes.json`

## Verification checklist
1. Cloud Run env includes:
   - `SIGNALS_FALLBACK_SCAN_LIMIT=500`
   - `SIGNALS_FALLBACK_MAX_CALLS_PER_MIN=30`
   - `SIGNALS_FALLBACK_COOLDOWN_MS=900000`
   - `SIGNALS_FALLBACK_ALERT_MIN_INTERVAL_MS=300000`
   - `TICK_EXIT_INTERVAL_MS=5000`
   - `TICK_EXIT_SYMBOL_COOLDOWN_MS=10000`
   - `TICK_EXIT_NEAR_PCT=0.006`
2. Logs include structured events:
   - `signals_fallback_used`
   - `signals_fallback_circuit_open`
   - `signals_fallback_circuit_close`
   - `tick_exit_skipped_by_cooldown`
   - text log: `[queryBars] fallback ...`
3. System settings doc (`settings/system`) may include:
   - `signals_fallback_force_open_until_ms`
   - `signals_fallback_force_open_reason=COST_GUARD`
4. Billing (KST day) drops under the guard threshold in normal conditions.
