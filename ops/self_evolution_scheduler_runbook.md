# Self-Evolution Scheduler Runbook

## Primary Mode

Use an external scheduler as the primary driver for BEST self-evolution.

- loop script: `scripts/automation-self-evolution-loop.js`
- internal auto hook: `src/scheduler/autoSelfEvolution.js`
- authenticated trigger route: `POST /scheduler/self-evolution`
- shell wrapper: `ops/self_evolution_scheduler.sh`
- cache refresh wrapper: `ops/analytics_local_cache_refresh.sh`

## Default Cadence

- freshness target: every 4 hours
- analytics cache refresh cadence: every 15 minutes
- self-evolution cadence: every 4 hours
- route duplicate check: skip when latest loop is fresh
- lock stale timeout: 2 hours

Environment:

- `AUTO_SELF_EVOLUTION=0`
- `AUTO_SELF_EVOLUTION_CHECK_MS=900000`
- `AUTO_SELF_EVOLUTION_MAX_AGE_MS=14400000`
- `AUTO_SELF_EVOLUTION_LOCK_STALE_MS=7200000`

## How It Runs

1. An external scheduler refreshes analytics cache first.
2. A second external scheduler calls `POST /scheduler/self-evolution`.
3. The dataset step reads only local cache snapshots.
4. If the latest loop is fresher than 4 hours, it skips with `reason=FRESH`.
5. If stale or missing, it runs `automation-self-evolution-loop.js`.
6. A file lock prevents duplicate execution.

## Cache Refresh Route

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/analytics-local-cache-refresh" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{}'
```

## Runtime Guards Route

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/system-runtime-guards" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"exchange":"BINANCEFUT","remediate_on_block":true}'
```

Dry-run:

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/system-runtime-guards" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"exchange":"BINANCEFUT","remediate_on_block":true,"dry_run":true}'
```

## Trail Authority Feedback Route

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/trail-authority-feedback" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"exchange":"BINANCEFUT","lookback_hours":24,"fetch_limit":3000}'
```

## ML Ops Pipeline Route

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/ml-ops-pipeline" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"exchange":"BINANCEFUT","force":true}'
```

## Authenticated Route

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/self-evolution" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{}'
```

Force re-run:

```bash
curl -sS -X POST "http://127.0.0.1:3000/scheduler/self-evolution" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d '{"force":true}'
```

## Shell Wrapper

```bash
/Users/jeongjaeyong/Projects/donbeolja/ops/self_evolution_scheduler.sh
```

Cache refresh:

```bash
/Users/jeongjaeyong/Projects/donbeolja/ops/analytics_local_cache_refresh.sh
```

Force re-run:

```bash
FORCE=1 /Users/jeongjaeyong/Projects/donbeolja/ops/self_evolution_scheduler.sh
```

## Cloud Scheduler Example

```bash
gcloud scheduler jobs create http donbeolja-self-evolution \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="0 */4 * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/self-evolution" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{}'
```

Analytics cache refresh:

```bash
gcloud scheduler jobs create http donbeolja-analytics-cache-refresh \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="*/15 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/analytics-local-cache-refresh" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{}'
```

Runtime guards:

```bash
gcloud scheduler jobs create http donbeolja-system-runtime-guards \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="2,17,32,47 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/system-runtime-guards" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{\"exchange\":\"BINANCEFUT\",\"remediate_on_block\":true}'
```

Trail authority feedback:

```bash
gcloud scheduler jobs create http donbeolja-trail-authority-feedback \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="7 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/trail-authority-feedback" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{\"exchange\":\"BINANCEFUT\",\"lookback_hours\":24,\"fetch_limit\":3000}'
```

ML Ops pipeline:

```bash
gcloud scheduler jobs create http donbeolja-ml-ops-pipeline \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="8 */4 * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/ml-ops-pipeline" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{\"exchange\":\"BINANCEFUT\",\"force\":true}'
```

Update existing job:

```bash
gcloud scheduler jobs update http donbeolja-self-evolution \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="0 */4 * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/self-evolution" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{}'
```

Runtime guards update:

```bash
gcloud scheduler jobs update http donbeolja-system-runtime-guards \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="2,17,32,47 * * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/system-runtime-guards" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{\"exchange\":\"BINANCEFUT\",\"remediate_on_block\":true}'
```

ML Ops pipeline update:

```bash
gcloud scheduler jobs update http donbeolja-ml-ops-pipeline \
  --location=asia-northeast3 \
  --time-zone=Asia/Seoul \
  --schedule="8 */4 * * *" \
  --uri="https://donbeolja-350958953672.asia-northeast3.run.app/scheduler/ml-ops-pipeline" \
  --http-method=POST \
  --headers="content-type=application/json,x-scheduler-token=${SCHEDULER_TOKEN}" \
  --message-body='{\"exchange\":\"BINANCEFUT\",\"force\":true}'
```

## Cron Example

```bash
*/15 * * * * /Users/jeongjaeyong/Projects/donbeolja/ops/analytics_local_cache_refresh.sh >> /tmp/analytics_local_cache_refresh.log 2>&1
0 */4 * * * /Users/jeongjaeyong/Projects/donbeolja/ops/self_evolution_scheduler.sh >> /tmp/self_evolution_scheduler.log 2>&1
```

## Recommended Policy

- Primary: external HTTP scheduler hitting `/scheduler/self-evolution`
- Runtime safety: external HTTP scheduler hitting `/scheduler/system-runtime-guards`
- ML closed loop: external HTTP scheduler hitting `/scheduler/ml-ops-pipeline`
- Precondition: keep analytics local cache fresh via `/scheduler/analytics-local-cache-refresh`
- Internal app auto hook: keep `AUTO_SELF_EVOLUTION=0` unless you intentionally want local fallback
- Do not run both on overlapping cadences

## Operational Notes

- `DAILY_NO_TRADE_ACTIVITY` and `ZERO_KRW_IDLE` can still hold promotion even when the loop runs on time.
- The scheduler solves cadence. It does not bypass governance or deployment blockers.
- The latest loop artifact remains the source of truth:
  - `ops/daily/best_self_evolution_loop_run_latest.json`
- If `DAILY_NO_TRADE_ACTIVITY` persists across loops, prefer running self-evolution during active trading hours first and return to the default 4-hour cadence only after real executions resume.
- Recommended fallback while daily executed trades remain 0:
  - analytics cache refresh: every 15 minutes
  - self-evolution loop: hourly during active trading hours
  - revert to every 4 hours after `retrospective daily executed_n > 0`
