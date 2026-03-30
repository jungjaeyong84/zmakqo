# Self-Evolution Scheduler Runbook

## Primary Mode

Use the app scheduler as the primary driver for BEST self-evolution.

- loop script: `scripts/automation-self-evolution-loop.js`
- internal auto hook: `src/scheduler/autoSelfEvolution.js`
- manual/external trigger route: `POST /scheduler/self-evolution`

## Default Cadence

- freshness target: every 4 hours
- scheduler check cadence: every 15 minutes
- lock stale timeout: 2 hours

Environment:

- `AUTO_SELF_EVOLUTION=1`
- `AUTO_SELF_EVOLUTION_CHECK_MS=900000`
- `AUTO_SELF_EVOLUTION_MAX_AGE_MS=14400000`
- `AUTO_SELF_EVOLUTION_LOCK_STALE_MS=7200000`

## How It Runs

1. The normal app scheduler tick runs.
2. `maybeAutoSelfEvolutionLoop()` checks the latest loop artifact age.
3. If the latest loop is fresher than 4 hours, it skips with `reason=FRESH`.
4. If stale or missing, it runs `automation-self-evolution-loop.js`.
5. A file lock prevents duplicate execution.

## External Trigger

Use the authenticated route when the app scheduler is externally managed or when you want Cloud Scheduler / cron to be the source of truth.

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

## Recommended Policy

- Primary: app scheduler auto hook
- Secondary/fallback: external HTTP scheduler hitting `/scheduler/self-evolution`
- Do not run both on overlapping cadences unless the external scheduler is only used as a fallback

## Operational Notes

- `DAILY_NO_TRADE_ACTIVITY` and `ZERO_KRW_IDLE` can still hold promotion even when the loop runs on time.
- The scheduler solves cadence. It does not bypass governance or deployment blockers.
- The latest loop artifact remains the source of truth:
  - `ops/daily/best_self_evolution_loop_run_latest.json`
