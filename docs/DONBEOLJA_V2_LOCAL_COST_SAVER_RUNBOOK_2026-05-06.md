# DONBEOLJA V2 Local Cost Saver Runbook

## Goal
Reduce Cloud Run and Cloud Scheduler spend without rewriting V2 state management. Keep Firestore as source of truth. Move cron ownership to local launchd first.

## Scope in this step
- Add local launchd wrappers for V2 Cloud Scheduler jobs
- Add a single reusable `run-v2-fill-sync.js` runner shared by Cloud Run and local launchd
- Add a dry-run/install script for local launchd profile generation

## Commands
Dry-run local cost saver plan:

```bash
node scripts/setup-v2-local-cost-saver.js --dry-run
```

Install launchd plists only:

```bash
node scripts/setup-v2-local-cost-saver.js --install
```

Install and enable launchd jobs:

```bash
node scripts/setup-v2-local-cost-saver.js --enable --kickstart
```

## Cloud Scheduler pause targets after local verification
- `openclaw-server-primary-tick`
- `v2-production-entry-route-canary`
- `v2-exit-runtime-canary`
- `v2-active-protection-reconciliation`
- `v2-fill-sync`
- `v2-performance-evidence-cycle`
- `v2-signal-shadow-counterfactual-walker`
- `v2-signal-shadow-counterfactual-analyzer`
- `v2-liquidation-stream-collector-window`
- `openclaw-evidence-linker`
- `openclaw-calibration`
- `openclaw-retrospect`

## Quality gates before pause
1. Local launchd jobs installed and loaded.
2. `ops/runtime/*.out.log` and `*.err.log` show one successful run for each HIGH job.
3. `v2_performance_gate_latest.json`, `v2_active_protection_reconciliation_latest.json`, `v2_repair_queue_service_latest.json` refresh on local cadence.
4. No duplicate execution between local launchd and Cloud Scheduler during overlap window.

## Explicit non-goals in this step
- Firestore removal
- Full local secret replacement
- Main/exit-worker ownership flip
- Egress removal

## Next step
After this step is validated, move `donbeolja` main and `activeexit` ownership local-first, then set Cloud Run revisions to scale-to-zero or operator-only fallback.
