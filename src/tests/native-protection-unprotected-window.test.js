"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// native-protection-unprotected-window.test.js
//
// 2026-04-20 senior-audit P2 regression.
//
// Scope: the new unprotected-window observability contract.
//
// Prior behaviour (the bug we are locking out):
//   `refreshBinanceNativeProtection` is architecturally cancel-first — it
//   DELETEs the existing closePosition STOP_MARKET + TAKE_PROFIT_MARKET
//   orders on Binance BEFORE posting their replacements. Between the
//   cancel and the replacement ack the position is literally naked. The
//   refresh code had no timing instrumentation, so ops had no way to
//   distinguish a healthy 300ms naked window from a pathological 20s one
//   other than hand-correlating Cloud Logging lines by timestamp.
//
// New contract enforced by this test:
//   (A) buildNativeProtectionMetaPatch surfaces the three timing fields
//       unchanged when the refresh result carried them (cancel_ms,
//       stop_ack_ms, tp_ack_ms).
//   (B) buildNativeProtectionMetaPatch computes
//       native_protection_unprotected_window_ms =
//         max(stop_ack_ms, tp_ack_ms) - cancel_ms
//       — i.e. the window does NOT close until the later of SL and TP
//       acks. This is the whole point: TP ack is useless if SL is still
//       pending.
//   (C) When only SL acked (partial protection, or TP-disabled path),
//       the window is stop_ack_ms - cancel_ms.
//   (D) When cancel_ms is set but no ack timestamp is, the computed
//       window is null — the record signals "cancel emitted but no ack
//       recorded" which the gate treats as strictly worse than a numeric
//       breach (unbounded window).
//   (E) classifyUnprotectedWindowRecord returns class="WINDOW_BREACH"
//       only when the numeric window exceeds threshold; returns
//       class="CANCEL_WITHOUT_ACK" when cancel_ms set but no ack;
//       returns class="NOT_MEASURED" when cancel_ms missing.
//   (F) cancel_succeeded=false in the refresh result is classified as
//       "CANCEL_FAILED_NO_WINDOW" and is NOT a breach (old orders intact,
//       the position was never unprotected).
//   (G) The gate CLI wrapper encodes breach_count > 0 as gate_status=
//       "BLOCK" and 0 as "PASS". This is the single line the deploy gate
//       reads — regressing it would silently re-hide breaches.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

const { __test: paperTest } = require("../engine/paperBinanceRunner");
const {
  __test: runtimeTest,
  loadUnprotectedWindowRuntime,
  DEFAULT_THRESHOLD_MS,
} = require("../services/nativeProtectionUnprotectedWindowRuntime");
const {
  __test: reportTest,
} = require("../../scripts/report-native-protection-unprotected-window");

// ─────────────────────────────────────────────────────────────────────────────
// (A)+(B)+(C)+(D) buildNativeProtectionMetaPatch: timing persistence
// ─────────────────────────────────────────────────────────────────────────────
(function bothAcksPatch() {
  const cancelMs = 1_700_000_000_000;
  const stopAckMs = cancelMs + 200;
  const tpAckMs = cancelMs + 450; // tpAck is later → window ends here
  const patch = paperTest.buildNativeProtectionMetaPatch({
    intent: "ENTRY",
    execBarCloseMs: cancelMs,
    nativeProtection: {
      ok: true,
      cancel_ms: cancelMs,
      cancel_succeeded: true,
      stop_ack_ms: stopAckMs,
      tp_ack_ms: tpAckMs,
      stop_order_id: "STOP_OK",
      tp_order_id: "TP_OK",
      stop_price: 100, tp_price: 101, entry_price: 100, position_side: "LONG",
    },
  });
  assert.ok(patch, "patch must be produced for ENTRY");
  assert.strictEqual(patch.native_protection_cancel_ms, cancelMs,
    "cancel_ms must be persisted as-is");
  assert.strictEqual(patch.native_protection_stop_ack_ms, stopAckMs,
    "stop_ack_ms must be persisted as-is");
  assert.strictEqual(patch.native_protection_tp_ack_ms, tpAckMs,
    "tp_ack_ms must be persisted as-is");
  assert.strictEqual(patch.native_protection_unprotected_window_ms, tpAckMs - cancelMs,
    "window_ms must be max(stop_ack, tp_ack) - cancel, i.e. 450ms here — NOT stop_ack-cancel (200) because TP ack is the later one");
  assert.strictEqual(patch.native_protection_cancel_succeeded, true,
    "cancel_succeeded passthrough must preserve the boolean");
})();

(function slOnlyAckPatch() {
  // TP leg disabled (e.g. TP1 not eligible) — only SL acked.
  const cancelMs = 1_700_000_001_000;
  const stopAckMs = cancelMs + 300;
  const patch = paperTest.buildNativeProtectionMetaPatch({
    intent: "ENTRY",
    nativeProtection: {
      ok: true,
      cancel_ms: cancelMs,
      cancel_succeeded: true,
      stop_ack_ms: stopAckMs,
      tp_ack_ms: null,
      stop_order_id: "STOP_OK", tp_order_id: null,
      stop_price: 100, tp_price: null, entry_price: 100, position_side: "LONG",
    },
  });
  assert.strictEqual(patch.native_protection_tp_ack_ms, null);
  assert.strictEqual(patch.native_protection_unprotected_window_ms, stopAckMs - cancelMs,
    "when only SL acked, window must be stop_ack - cancel — we must not treat null tpAck as 0");
})();

(function cancelWithoutAckPatch() {
  // UNPROTECTED_ACTIVE_POSITION style: cancel succeeded, both acks missing.
  const cancelMs = 1_700_000_002_000;
  const patch = paperTest.buildNativeProtectionMetaPatch({
    intent: "ENTRY",
    nativeProtection: {
      ok: false,
      reason: "UNPROTECTED_ACTIVE_POSITION",
      cancel_ms: cancelMs,
      cancel_succeeded: true,
      stop_ack_ms: null,
      tp_ack_ms: null,
    },
  });
  assert.strictEqual(patch.native_protection_cancel_ms, cancelMs,
    "cancel_ms must persist even on UNPROTECTED_ACTIVE_POSITION so the gate can see the breach");
  assert.strictEqual(patch.native_protection_unprotected_window_ms, null,
    "window_ms must be null when no ack was recorded — null signals 'unbounded', which is worse than any numeric value");
})();

(function resolveUnprotectedWindowFieldsIsolated() {
  const fields = paperTest.resolveNativeProtectionUnprotectedWindowFields({
    cancel_ms: 1000,
    cancel_succeeded: true,
    stop_ack_ms: 1150,
    tp_ack_ms: 1200,
  });
  assert.deepStrictEqual(fields, {
    native_protection_cancel_ms: 1000,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: 1150,
    native_protection_tp_ack_ms: 1200,
    native_protection_unprotected_window_ms: 200,
  });
  // Negative/invalid numbers get scrubbed to null — prevents a buggy caller
  // from persisting 0 or NaN into meta.
  const scrubbed = paperTest.resolveNativeProtectionUnprotectedWindowFields({
    cancel_ms: 0, // falsy → null
    stop_ack_ms: "not a number",
    tp_ack_ms: -1,
  });
  assert.strictEqual(scrubbed.native_protection_cancel_ms, null);
  assert.strictEqual(scrubbed.native_protection_stop_ack_ms, null);
  assert.strictEqual(scrubbed.native_protection_tp_ack_ms, null);
  assert.strictEqual(scrubbed.native_protection_unprotected_window_ms, null);
})();

// ─────────────────────────────────────────────────────────────────────────────
// (E) classifyUnprotectedWindowRecord classification
// ─────────────────────────────────────────────────────────────────────────────
function posFixture(meta = {}, overrides = {}) {
  return {
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "BNBUSDT",
    position_state: "OPEN",
    qty_base: 1,
    meta,
    ...overrides,
  };
}

(function classifyWindowOk() {
  const cancelMs = 1_700_000_100_000;
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: cancelMs + 300,
    native_protection_tp_ack_ms: cancelMs + 500,
    native_protection_unprotected_window_ms: 500,
  }), { thresholdMs: 3000, nowMs: cancelMs + 1000 });
  assert.strictEqual(record.class, "WINDOW_OK",
    "500ms window under 3000ms threshold must be WINDOW_OK");
  assert.strictEqual(record.gate_breach, false);
  assert.strictEqual(record.window_ms, 500);
})();

(function classifyWindowBreach() {
  const cancelMs = 1_700_000_200_000;
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: cancelMs + 6000,
    native_protection_tp_ack_ms: cancelMs + 8000,
    native_protection_unprotected_window_ms: 8000,
  }), { thresholdMs: 3000, nowMs: cancelMs + 10000 });
  assert.strictEqual(record.class, "WINDOW_BREACH",
    "8000ms window over 3000ms threshold must be WINDOW_BREACH");
  assert.strictEqual(record.gate_breach, true,
    "WINDOW_BREACH must contribute to the gate block count");
})();

(function classifyCancelWithoutAck() {
  const cancelMs = 1_700_000_300_000;
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: null,
    native_protection_tp_ack_ms: null,
    native_protection_unprotected_window_ms: null,
  }), { thresholdMs: 3000, nowMs: cancelMs + 500 });
  assert.strictEqual(record.class, "CANCEL_WITHOUT_ACK",
    "cancel set but no ack must be CANCEL_WITHOUT_ACK — strictly worse than any numeric breach");
  assert.strictEqual(record.gate_breach, true);
  assert.strictEqual(record.window_ms, null);
})();

(function classifyNotMeasured() {
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    // old-style meta with no timing fields
    native_protection_refresh_status: "OK",
    native_protection_stop_order_id: "LEGACY_SL",
  }), { thresholdMs: 3000 });
  assert.strictEqual(record.class, "NOT_MEASURED",
    "positions without cancel_ms must be NOT_MEASURED — we must not regress and block on pre-rollout positions");
  assert.strictEqual(record.gate_breach, false);
})();

(function classifyCancelFailedNoWindow() {
  // (F) cancel succeeded=false → window never opened.
  const cancelMs = 1_700_000_400_000;
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: false,
    native_protection_stop_ack_ms: null,
    native_protection_tp_ack_ms: null,
  }), { thresholdMs: 3000, nowMs: cancelMs + 500 });
  assert.strictEqual(record.class, "CANCEL_FAILED_NO_WINDOW",
    "cancel itself failed means old orders still on exchange — not a breach");
  assert.strictEqual(record.gate_breach, false);
})();

(function classifyStale() {
  const cancelMs = 1_000_000_000_000;
  const now = cancelMs + (48 * 60 * 60 * 1000); // 48h later
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: null, // would otherwise be CANCEL_WITHOUT_ACK
  }), { thresholdMs: 3000, staleMaxAgeMs: 24 * 60 * 60 * 1000, nowMs: now });
  assert.strictEqual(record.class, "STALE",
    "cancel older than staleMaxAgeMs must downgrade to STALE — observability only, not a live breach");
  assert.strictEqual(record.gate_breach, false);
})();

(function classifyPartialAck() {
  // TP1-eligible (tp_p1_done=false, trail_active=false), only SL acked.
  const cancelMs = 1_700_000_500_000;
  const record = runtimeTest.classifyUnprotectedWindowRecord(posFixture({
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: true,
    native_protection_stop_ack_ms: cancelMs + 200,
    native_protection_tp_ack_ms: null,
    native_protection_unprotected_window_ms: 200,
    tp_p1_done: false,
    trail_active: false,
  }), { thresholdMs: 3000, nowMs: cancelMs + 1000 });
  assert.strictEqual(record.class, "PARTIAL_ACK",
    "TP1-eligible position with only SL acked is PARTIAL_ACK — flagged but not a hard breach");
  assert.strictEqual(record.gate_breach, false,
    "PARTIAL_ACK must NOT block deploys on its own — it's an ops signal, not a liveness error");
})();

// ─────────────────────────────────────────────────────────────────────────────
// loadUnprotectedWindowRuntime aggregate math
// ─────────────────────────────────────────────────────────────────────────────
(async function runtimeAggregates() {
  const nowMs = 1_700_001_000_000;
  const positions = [
    // healthy
    { exchange: "BINANCEFUT", symbol: "AAA", position_state: "OPEN", qty_base: 1, meta: {
      native_protection_cancel_ms: nowMs - 500, native_protection_cancel_succeeded: true,
      native_protection_stop_ack_ms: nowMs - 300, native_protection_tp_ack_ms: nowMs - 250,
      native_protection_unprotected_window_ms: 250,
    }},
    // breach
    { exchange: "BINANCEFUT", symbol: "BBB", position_state: "OPEN", qty_base: 1, meta: {
      native_protection_cancel_ms: nowMs - 9000, native_protection_cancel_succeeded: true,
      native_protection_stop_ack_ms: nowMs - 3000, native_protection_tp_ack_ms: nowMs - 2000,
      native_protection_unprotected_window_ms: 7000,
    }},
    // cancel without ack
    { exchange: "BINANCEFUT", symbol: "CCC", position_state: "OPEN", qty_base: 1, meta: {
      native_protection_cancel_ms: nowMs - 400, native_protection_cancel_succeeded: true,
    }},
    // not measured (no cancel_ms)
    { exchange: "BINANCEFUT", symbol: "DDD", position_state: "OPEN", qty_base: 1, meta: {} },
    // closed — filtered out by isActivePosition
    { exchange: "BINANCEFUT", symbol: "EEE", position_state: "FLAT", qty_base: 0, meta: {} },
  ];
  const summary = await loadUnprotectedWindowRuntime({
    exchange: "BINANCEFUT",
    thresholdMs: 3000,
    listPositions: async () => positions,
    nowMs,
  });
  assert.strictEqual(summary.active_position_count, 4,
    "FLAT position must be excluded from active count");
  assert.strictEqual(summary.breach_count, 2,
    "breach_count = WINDOW_BREACH (BBB) + CANCEL_WITHOUT_ACK (CCC) = 2");
  assert.strictEqual(summary.breach_window_count, 1,
    "breach_window_count counts ONLY numeric-window breaches");
  assert.strictEqual(summary.breach_cancel_without_ack_count, 1);
  assert.strictEqual(summary.not_measured_count, 1);
  assert.strictEqual(summary.max_window_ms, 250,
    "max_window_ms aggregates ONLY over WINDOW_OK/PARTIAL_ACK — WINDOW_BREACH is a separate class");
  const cli = reportTest.buildCliResult(summary, "/tmp/x.json", "/tmp/x.md");
  assert.strictEqual(cli.gate_status, "BLOCK",
    "CLI wrapper must emit BLOCK when breach_count > 0 — this is the single line the deploy gate reads");
  assert.strictEqual(cli.reason, "NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// (G) CLI gate_status passthrough
// ─────────────────────────────────────────────────────────────────────────────
(function cliPassStatus() {
  const cli = reportTest.buildCliResult({
    breach_count: 0,
    threshold_ms: DEFAULT_THRESHOLD_MS,
    active_position_count: 3,
    max_window_ms: 250,
    avg_window_ms: 200,
    breach_rows: [],
  }, "/tmp/x.json", "/tmp/x.md");
  assert.strictEqual(cli.gate_status, "PASS",
    "0 breaches must emit PASS");
  assert.strictEqual(cli.reason, null,
    "reason must be null on PASS so the deploy gate parser doesn't spuriously reject");
  assert.strictEqual(cli.status, "OK");
})();

// ─────────────────────────────────────────────────────────────────────────────
// M1: listPositions throwing must surface as available:false + BLOCK, NOT
// silently pass with breach_count: 0. Prior behaviour swallowed the error
// with `.catch(() => [])`, which collapsed a Firestore outage into a clean
// gate pass — the inverse of what a fail-closed invariant needs.
// ─────────────────────────────────────────────────────────────────────────────
(async function runtimeListPositionsFailureBlocks() {
  const summary = await loadUnprotectedWindowRuntime({
    exchange: "BINANCEFUT",
    thresholdMs: 3000,
    listPositions: async () => {
      const err = new Error("RPC error: UNAVAILABLE");
      err.code = "UNAVAILABLE";
      throw err;
    },
    nowMs: 1_700_000_000_000,
  });
  assert.strictEqual(summary.available, false,
    "listPositions throw must mark the snapshot unavailable — not silently empty");
  assert.strictEqual(summary.unavailable_reason, "LIST_POSITIONS_FAILED");
  assert.ok(String(summary.unavailable_detail || "").includes("UNAVAILABLE"),
    "unavailable_detail must include the underlying error code/message for ops triage");
  assert.strictEqual(summary.breach_count, 0,
    "breach_count stays 0 — the 'block' signal is available:false, not a synthetic breach");
  const cli = reportTest.buildCliResult(summary, "/tmp/x.json", "/tmp/x.md");
  assert.strictEqual(cli.gate_status, "BLOCK",
    "CLI must BLOCK on unavailable — fleet-blindness is not a pass");
  assert.strictEqual(cli.reason, "NATIVE_PROTECTION_UNPROTECTED_WINDOW_UNAVAILABLE",
    "distinct reason from UNPROTECTED_WINDOW_BREACH so on-call can tell 'outage' from 'real breach'");
  assert.strictEqual(cli.available, false);
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});

console.log("NATIVE_PROTECTION_UNPROTECTED_WINDOW_TEST_OK");
