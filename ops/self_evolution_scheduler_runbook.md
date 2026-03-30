# Self-Evolution Scheduler Runbook

## Primary Mode

Use an external scheduler as the primary driver for BEST self-evolution.

- loop script: `scripts/automation-self-evolution-loop.js`
- internal auto hook: `src/scheduler/autoSelfEvolution.js`
- authenticated trigger route: `POST /scheduler/self-evolution`
- shell wrapper: `ops/self_evolution_scheduler.sh`

## Default Cadence

- freshness target: every 4 hours
- external scheduler cadence: every 4 hours
- route duplicate check: skip when latest loop is fresh
- lock stale timeout: 2 hours

Environment:

- `AUTO_SELF_EVOLUTION=0`
- `AUTO_SELF_EVOLUTION_CHECK_MS=900000`
- `AUTO_SELF_EVOLUTION_MAX_AGE_MS=14400000`
- `AUTO_SELF_EVOLUTION_LOCK_STALE_MS=7200000`

## How It Runs

1. An external scheduler calls `POST /scheduler/self-evolution`.
2. The route checks the latest loop artifact age.
3. If the latest loop is fresher than 4 hours, it skips with `reason=FRESH`.
4. If stale or missing, it runs `automation-self-evolution-loop.js`.
5. A file lock prevents duplicate execution.

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

## Cron Example

```bash
0 */4 * * * /Users/jeongjaeyong/Projects/donbeolja/ops/self_evolution_scheduler.sh >> /tmp/self_evolution_scheduler.log 2>&1
```

## Recommended Policy

- Primary: external HTTP scheduler hitting `/scheduler/self-evolution`
- Internal app auto hook: keep `AUTO_SELF_EVOLUTION=0` unless you intentionally want local fallback
- Do not run both on overlapping cadences

## Operational Notes

- `DAILY_NO_TRADE_ACTIVITY` and `ZERO_KRW_IDLE` can still hold promotion even when the loop runs on time.
- The scheduler solves cadence. It does not bypass governance or deployment blockers.
- The latest loop artifact remains the source of truth:
  - `ops/daily/best_self_evolution_loop_run_latest.json`
