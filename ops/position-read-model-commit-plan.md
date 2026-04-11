# Position Read Model Commit Plan

## Goal
- Split the delivery into reviewable, auditable commits.
- Avoid mixing this rollout with unrelated dirty worktree files.

## Commit 1: Event Truth + Replay Foundation
- `src/storage/positionEvents.js`
- `src/storage/unifiedEventTimeline.js`
- `src/storage/positionReadModelLatest.js`
- `src/storage/fillEvents.js`
- `src/storage/orderIntentEvents.js`
- `src/storage/shadowEvaluations.js`
- `src/storage/shadowCanaryGates.js`
- `src/services/positionEventReplay.js`
- `src/services/decisionReplayV2.js`
- `src/services/unifiedEventBackfill.js`
- `src/services/intentFillEventBackfill.js`
- `src/services/featureLabelDataset.js`
- `src/services/mlOpsPipeline.js`
- `src/services/shadowCanaryGateView.js`
- `src/utils/traceContext.js`
- matching tests
- scripts:
  - `scripts/backfill-intent-fill-events.js`
  - `scripts/backfill-unified-event-timeline.js`
  - `scripts/build-feature-label-dataset.js`
  - `scripts/report-decision-replay-v2.js`
  - `scripts/report-shadow-evaluation-summary.js`
  - `scripts/report-shadow-inference-canary.js`
  - `scripts/run-ml-ops-pipeline.js`

## Commit 2: Writer Authority + State Machine
- `src/storage/positionsPaper.js`
- `src/services/positionStateMachine.js`
- `src/engine/paperUpbitRunner.js`
- `src/services/binanceLiveStateSelfHeal.js`
- `src/services/kiwoomWsSync.js`
- `src/storage/fillsPaper.js`
- `src/storage/orderIntentsPaper.js`
- `src/storage/actionHookLedger.js`
- matching tests:
  - `src/tests/positions-paper.test.js`
  - `src/tests/position-state-machine.test.js`
  - `src/tests/position-single-writer.test.js`

## Commit 3: Read Model Cutover
- `src/services/positionReadModel.js`
- `src/services/positionReadModelBackfill.js`
- `src/services/exitIntegrityAudit.js`
- `src/services/binanceTickExit.js`
- `src/services/binanceFuturesFillsSync.js`
- `src/services/aiSignalGuard.js`
- `src/services/exitWorkerScale.js`
- routes:
  - `src/routes/dashboard.home.routes.js`
  - `src/routes/dashboard.profit.routes.js`
  - `src/routes/dashboard.report.routes.js`
  - `src/routes/dashboard.routes.js`
  - `src/routes/report.latest.routes.js`
  - `src/routes/report.pack.routes.js`
  - `src/routes/report.pack.v4plus.routes.js`
  - `src/routes/report.improvement-pack.routes.js`
  - `src/routes/scheduler.report.routes.js`
  - `src/routes/sse.routes.js`
  - `src/routes/state.routes.js`

## Commit 4: Backfill + Ops Docs
- `scripts/backfill-position-read-model-latest.js`
- `package.json`
- `docs/GOOGLE_GRADE_ML_SYSTEM_DELIVERY_2026-04-11.md`
- `ops/position-read-model-cutover-runbook.md`
- `ops/position-read-model-commit-plan.md`

## Do Not Stage in This Rollout
- `openclaw-ops-workspace/.openclaw/workspace-state.json`
- `scripts/automation-objective-supervisor.js`
- `scripts/automation-stage-autopilot.js`
- `scripts/refresh-analytics-local-cache.js`
- `src/tests/objective-supervisor.test.js`
- `src/tests/stage-autopilot.test.js`
- `src/utils/actionExecutionHooks.js`
- unrelated files under `ops/runtime/` unless separately reviewed

## Review Order
1. Commit 1 for append-only truth and replay contract
2. Commit 2 for writer linearization and transition safety
3. Commit 3 for reader cutover blast radius
4. Commit 4 for migration and rollout procedure
