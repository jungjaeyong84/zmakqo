"use strict";

// 2026-04-18 P0-1 (audit re-verified): operators reading
// `tick_exit_tp1_break_even_stop_{raised,decision}` must be able to tell
// apart three very different runtime states that previously all looked
// identical as `refresh_ok: true`:
//   A) order placement + post-refresh sync + meta sync all succeeded,
//   B) order placement succeeded but Firestore sync failed
//      (reconciler will re-mark MISSING on next pass),
//   C) order placement succeeded but meta sync failed
//      (admin tooling will read stale meta until a subsequent repair).
// The composite `refresh_synced_ok` flag is the single field dashboards
// and alerts should consume; `refresh_ok` remains placement-only.

const assert = require("assert");
const {
  __test: { buildBreakEvenStopRefreshObservability },
} = require("../services/binanceTickExit");

(function nullRefreshResultYieldsAllNullFields() {
  const out = buildBreakEvenStopRefreshObservability(null);
  assert.strictEqual(out.refresh_ok, null);
  assert.strictEqual(out.refresh_reason, null);
  assert.strictEqual(out.refresh_synced_ok, null);
  assert.strictEqual(out.sync_after_refresh_ok, null);
  assert.strictEqual(out.sync_after_refresh_error, null);
  assert.strictEqual(out.meta_after_refresh_ok, null);
  assert.strictEqual(out.meta_after_refresh_error, null);
  assert.strictEqual(out.observed_stop_order_id, null);
})();

(function allOkYieldsSyncedOk() {
  const out = buildBreakEvenStopRefreshObservability({
    ok: true,
    reason: null,
    sync_after_refresh_ok: true,
    meta_after_refresh_ok: true,
    stop_order_id: 4000001234567890n.toString(),
  });
  assert.strictEqual(out.refresh_ok, true);
  assert.strictEqual(out.refresh_synced_ok, true);
  assert.strictEqual(out.sync_after_refresh_ok, true);
  assert.strictEqual(out.meta_after_refresh_ok, true);
  assert.strictEqual(out.observed_stop_order_id, "4000001234567890");
})();

(function placementOkButSyncFailedDoesNotReportSyncedOk() {
  // 2026-04-18 BTCUSDT blackout repro: placement succeeded, sync after
  // refresh swallowed a Firestore timeout, reconciler then re-marked
  // MISSING. Before this fix the log still read `refresh_ok: true` with
  // no hint of the sync failure.
  const out = buildBreakEvenStopRefreshObservability({
    ok: true,
    reason: null,
    sync_after_refresh_ok: false,
    sync_after_refresh_error: "FIRESTORE_DEADLINE_EXCEEDED",
    meta_after_refresh_ok: true,
    stop_order_id: "4000009999",
  });
  assert.strictEqual(out.refresh_ok, true,
    "placement itself succeeded so `refresh_ok` still reports true");
  assert.strictEqual(out.refresh_synced_ok, false,
    "composite must fail-closed when any post-refresh step did not complete");
  assert.strictEqual(out.sync_after_refresh_ok, false);
  assert.strictEqual(out.sync_after_refresh_error, "FIRESTORE_DEADLINE_EXCEEDED");
  assert.strictEqual(out.meta_after_refresh_ok, true);
  assert.strictEqual(out.observed_stop_order_id, "4000009999");
})();

(function placementOkButMetaFailedDoesNotReportSyncedOk() {
  const out = buildBreakEvenStopRefreshObservability({
    ok: true,
    reason: null,
    sync_after_refresh_ok: true,
    meta_after_refresh_ok: false,
    meta_after_refresh_error: "META_SYNC_EGRESS_TIMEOUT",
    stop_order_id: "4000008888",
  });
  assert.strictEqual(out.refresh_synced_ok, false);
  assert.strictEqual(out.meta_after_refresh_ok, false);
  assert.strictEqual(out.meta_after_refresh_error, "META_SYNC_EGRESS_TIMEOUT");
})();

(function placementFailedReportsReasonAndNoSyncFlags() {
  const out = buildBreakEvenStopRefreshObservability({
    ok: false,
    reason: "BINANCEFUT_KEYS_MISSING",
  });
  assert.strictEqual(out.refresh_ok, false);
  assert.strictEqual(out.refresh_reason, "BINANCEFUT_KEYS_MISSING");
  assert.strictEqual(out.refresh_synced_ok, false,
    "placement failure is also a composite failure — dashboards must NOT see null here and treat it as 'unknown'");
  // Placement failed, so no sync/meta attempts were made — fields fall
  // through to false (treating absence as NOT-OK is the safe default).
  assert.strictEqual(out.sync_after_refresh_ok, false);
  assert.strictEqual(out.meta_after_refresh_ok, false);
})();

(function longErrorMessagesAreTruncated() {
  const out = buildBreakEvenStopRefreshObservability({
    ok: true,
    sync_after_refresh_ok: false,
    sync_after_refresh_error: "X".repeat(500),
    meta_after_refresh_ok: true,
  });
  assert.strictEqual(out.sync_after_refresh_error.length, 200,
    "long error messages must be capped so a single bad tick does not blow up log payload size");
})();

console.log("BREAK_EVEN_STOP_REFRESH_OBSERVABILITY_TEST_OK");
