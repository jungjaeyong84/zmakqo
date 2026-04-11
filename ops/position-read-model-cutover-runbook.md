# Position Read Model Cutover Runbook

## Goal
- Promote `position_events -> unified_event_timeline -> position_read_model_latest` into the operational read path.
- Enforce `positions_paper` write authority through `expectedWriteToken` + transactional writer lease.
- Cut dashboard/report/guard consumers over to latest read model without losing rollback clarity.

## Scope
- `positions_paper`
- `position_events`
- `unified_event_timeline`
- `position_read_model_latest`
- Binance LIVE service readers:
  - `exitIntegrityAudit`
  - `binanceTickExit`
  - `binanceLiveStateSelfHeal`
  - dashboard/report/sse routes

## Preconditions
1. Firestore indexes are applied.
2. `npm test` passes on the release candidate.
3. `POSITION_WRITE_TOKEN_REQUIRED=1`
4. `POSITION_WRITER_LEASE_ENABLED=1`
5. `POSITION_EVENT_LOG_ENABLED=1`
6. `POSITION_READ_MODEL_USE_UNIFIED_TIMELINE=1`
7. Binance API credentials are valid in target environment.

## Deployment Order
1. Apply Firestore indexes
```bash
/Users/jeongjaeyong/Projects/donbeolja/ops/firestore_indexes_apply.sh
```

2. Deploy service bundle
```bash
gcloud builds submit --config cloudbuild.yaml --project "${PROJECT_ID:-donbeolja-dev}"
```

3. Backfill latest read model
```bash
GOOGLE_CLOUD_PROJECT="${PROJECT_ID:-donbeolja-dev}" \
npm run migrate:position-read-model-latest
```

4. Verify latest index population
```bash
node - <<'NODE'
const { getFirestore } = require('./src/storage/firestore');
(async () => {
  const db = getFirestore();
  const [latestSnap, posSnap] = await Promise.all([
    db.collection('position_read_model_latest').get(),
    db.collection('positions_paper').get(),
  ]);
  console.log(JSON.stringify({
    positions_paper: posSnap.size,
    position_read_model_latest: latestSnap.size,
  }, null, 2));
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
NODE
```

5. Verify integrity audit
```bash
node - <<'NODE'
const { auditBinanceExitIntegrity } = require('./src/services/exitIntegrityAudit');
(async () => {
  const result = await auditBinanceExitIntegrity({ includeFlat: false });
  console.log(JSON.stringify({
    ok: result.ok,
    reason: result.reason || null,
    issue_count: result.issue_count,
    active_market_count: result.active_market_count,
    market_count: result.market_count,
  }, null, 2));
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
NODE
```

## Expected Success Conditions
1. `npm test` is fully green.
2. `position_read_model_latest > 0`
3. `position_read_model_latest >= active live symbols`
4. `auditBinanceExitIntegrity().issue_count === 0` or only known non-blocking issues
5. No `POSITION_WRITE_TOKEN_REQUIRED`
6. No sustained `POSITION_WRITE_TOKEN_MISMATCH`
7. No sustained `POSITION_WRITE_LEASE_HELD`

## Smoke Checks
1. `/dashboard/home`
2. `/dashboard/profit`
3. `/report/latest`
4. `/api/sse/dashboard`
5. `tick-exit` worker logs
6. `self-heal` logs
7. `fills sync` logs

## Log Queries
### Writer authority failures
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND textPayload:"POSITION_WRITE_"' \
  --project "${PROJECT_ID:-donbeolja-dev}" \
  --limit=100 --format='value(timestamp,textPayload)'
```

### Read model fallback/path health
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND (textPayload:"POSITION_READ_MODEL" OR textPayload:"UNIFIED_TIMELINE")' \
  --project "${PROJECT_ID:-donbeolja-dev}" \
  --limit=100 --format='value(timestamp,textPayload)'
```

## Rollback Conditions
Rollback immediately if any of the following persists for more than 5 minutes:
1. Repeated `POSITION_WRITE_TOKEN_MISMATCH`
2. Repeated `POSITION_WRITE_TOKEN_REQUIRED`
3. Repeated `POSITION_WRITE_LEASE_LOST`
4. `exitIntegrityAudit.issue_count > 0` on live symbols without known explanation
5. Active position counts diverge between raw and read model

## Rollback Steps
1. Roll back Cloud Run revision
```bash
gcloud run services update-traffic donbeolja \
  --region asia-northeast3 \
  --to-revisions PREVIOUS_REVISION=100
```

2. Disable read model overlay temporarily
```bash
gcloud run services update donbeolja \
  --region asia-northeast3 \
  --update-env-vars POSITION_READ_MODEL_USE_UNIFIED_TIMELINE=0
```

3. Disable strict token requirement only if rollback of revision is impossible
```bash
gcloud run services update donbeolja \
  --region asia-northeast3 \
  --update-env-vars POSITION_WRITE_TOKEN_REQUIRED=0
```

## Post-Cutover Review
1. Save backfill result JSON
2. Save integrity audit result JSON
3. Save active position count comparison
4. Save first 30 minutes of writer-authority logs
5. Record final deployed revision ids for `donbeolja`, `donbeolja-egress`, `donbeolja-egress-private`, `donbeolja-exit-worker`
