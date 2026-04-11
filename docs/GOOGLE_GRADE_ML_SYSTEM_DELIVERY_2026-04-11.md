# Google-Grade ML System Delivery Status 2026-04-11

## Included in this changeset
1. `position_events` append-only position mutation log
2. `unified_event_timeline` append-only unified event stream
3. `position_read_model_latest` latest mutation materialized index
4. `positions_paper` transactional writer lease + mandatory `expectedWriteToken`
5. `positionStateMachine` transition validation
6. `decisionReplayV2` deterministic decision/intent/fill/position replay
7. `exitIntegrityAudit`, `tick-exit`, `self-heal`, dashboard/report read-model cutover

## Delivery Standard
- Writer path: transactional + leased + token-guarded
- Event truth: append-only
- Read path: latest index first
- Replay path: unified timeline first, legacy fan-in fallback
- Migration path: `position_events` preferred, `positions_paper` bootstrap fallback

## Remaining Out-of-Scope Items
1. `webhook.routes.js` raw position callers
2. `trading.actions.routes.js` raw position callers
3. Some state/admin fallback reads
4. KIWOOM-specific write/read paths
5. Commit / release / production rollout approval

## Release Gate
Release is allowed only if all conditions hold:
1. `npm test` green
2. latest read model backfill writes rows
3. integrity audit is clean on active live symbols
4. no repeated writer-authority failures
5. dashboard/report active position counts remain stable after cutover

## Verified in `donbeolja-dev`
1. `npm run migrate:position-read-model-latest`
   - result: `{"ok":true,"exchange":null,"scanned":0,"pages":0,"latest_rows":126,"bootstrap_rows":126,"written":126,"dry_run":false}`
2. raw vs latest read model count check
   - `BINANCEFUT`: `raw_total=12`, `read_total=12`
   - `BINANCEFUT active`: `raw_active=3`, `read_active=3`
3. `auditBinanceExitIntegrity({ includeFlat: false })`
   - result: `ok=true`, `issue_count=0`, `active_market_count=3`, `market_count=3`
