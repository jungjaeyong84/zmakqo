"use strict";

// 2026-04-29 P0-3 Step 3.1 — broker truth priority in
// validateProtectionActivationResult.
//
// Operator-reported pattern (DOGE 07:01:31, ETH 07:16:11):
// broker side ack'd both STOP and TP placements within 514–690 ms
// (native_protection_unprotected_window_observed status=OK), but the
// previous evidence validator was an 8-check AND on internal stamping
// fields (chainAudit, runtimeDoc, activationCommit, writeDecision).
// One of those fields populates milliseconds AFTER the broker ack
// arrives — the validator caught the race window and returned
// ok=false, so productionEntryRoute classified the entry as
// V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL even when
// the position was fully protected on the exchange.
//
// Fix: broker truth (slAck=PLACED && tp1Ack=PLACED) is the
// authoritative protection signal. Internal stamping checks become a
// quality metric (`quality_check_fails`) — they surface in the
// `v2_entry_protection_evidence_quality_degraded` log so we can track
// the stamping-race rate at our own cadence, but they do NOT raise
// critical when the broker side is sound.
//
// Decision matrix:
//   broker truth available + PLACED+PLACED → ok=true
//                          + anything else → ok=false (true exposure)
//   broker truth NOT available             → fall back to 8-check AND
//                                            (legacy contract preserved
//                                             for fixtures and alternate
//                                             code paths that don't wire
//                                             slAck/tp1Ack).

const assert = require("assert");

delete require.cache[require.resolve("../v2/entrySubmitter")];
const { __test } = require("../v2/entrySubmitter");
const validate = __test.validateProtectionActivationResult;
assert.ok(typeof validate === "function",
  "validateProtectionActivationResult must be exposed via __test");

// ── Stamping race scenario (the operator-reported case) ────────────
// broker truth: slAck=PLACED, tp1Ack=PLACED (= protection placed)
// internal evidence: NOT yet stamped (8 checks fail)
// expected: ok=true, reason indicates degraded internal quality.
(function testBrokerOkInternalRace() {
  const result = validate({
    ok: false, // protection runner hadn't yet flipped this true
    slAck: { status: "PLACED" },
    tp1Ack: { status: "PLACED" },
    activationCommit: null, // race — not yet stamped
    protectionWriteResult: null, // race — not yet stamped
  });
  assert.strictEqual(result.ok, true,
    "(A1) broker truth PLACED+PLACED must classify as ok=true regardless of stamping race");
  assert.strictEqual(result.broker_truth_ok, true);
  assert.strictEqual(result.broker_truth_available, true);
  assert.strictEqual(result.sl_ack_status, "PLACED");
  assert.strictEqual(result.tp1_ack_status, "PLACED");
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_BROKER_TRUTH_OK_INTERNAL_QUALITY_DEGRADED",
    "(A2) reason marks the degraded internal quality so operators see it");
  assert.ok(Array.isArray(result.quality_check_fails)
    && result.quality_check_fails.length === 8,
    "(A3) all 8 internal checks listed as quality fails");
})();

// ── True broker exposure (one ack failed) ──────────────────────────
// broker says SL placed, TP failed. position is genuinely exposed.
// expected: ok=false, reason=BROKER_TRUTH_BLOCKED.
(function testBrokerExposed() {
  const result = validate({
    ok: false,
    slAck: { status: "PLACED" },
    tp1Ack: { status: "FAILED" },
  });
  assert.strictEqual(result.ok, false,
    "(B1) broker exposure (TP failed) must NOT be reclassified as ok");
  assert.strictEqual(result.broker_truth_ok, false);
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_BROKER_TRUTH_BLOCKED");
})();

// ── Both broker acks failed → exposure ────────────────────────────
(function testBothAcksFailed() {
  const result = validate({
    ok: false,
    slAck: { status: "FAILED" },
    tp1Ack: { status: "FAILED" },
  });
  assert.strictEqual(result.ok, false, "(C1) both failed → ok=false");
  assert.strictEqual(result.broker_truth_ok, false);
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_BROKER_TRUTH_BLOCKED");
})();

// ── Backward-compat: no broker ack info → 8-check AND fallback ─────
// Some fixtures and alternate paths construct a protectionResult
// without slAck/tp1Ack. Those callers must keep their pre-2026-04-29
// behaviour (8-check AND) so refactor risk stays bounded.
(function testLegacyFallbackOk() {
  const result = validate({
    ok: true,
    activationCommit: {
      ok: true,
      position_cycle_status: "ACTIVE_PROTECTED",
      chainAudit: { ok: true, fail_n: 0 },
    },
    protectionWriteResult: {
      writeDecision: { ok: true },
      runtimeDoc: {
        health_status: "HEALTHY",
        sl_order_id: "SL_123",
        tp1_order_id: "TP1_123",
      },
    },
    // no slAck / tp1Ack
  });
  assert.strictEqual(result.broker_truth_available, false,
    "(D1) absence of slAck/tp1Ack must mark broker_truth_available=false");
  assert.strictEqual(result.ok, true,
    "(D2) legacy 8-check AND must still return ok when all checks pass");
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_OK");
})();

(function testLegacyFallbackInvalid() {
  const result = validate({
    ok: false, // first check fails
  });
  assert.strictEqual(result.broker_truth_available, false);
  assert.strictEqual(result.ok, false,
    "(D3) legacy 8-check AND fails when no fields are populated");
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_INVALID");
  assert.ok(result.failed_check_ids.length >= 1,
    "(D4) failed_check_ids preserved for legacy dashboards");
})();

// ── Defensive: null input ──────────────────────────────────────────
(function testNullInput() {
  const result = validate(null);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_RESULT_REQUIRED");
})();

// ── Output contract — required keys present ────────────────────────
(function testOutputShape() {
  const result = validate({
    slAck: { status: "PLACED" },
    tp1Ack: { status: "PLACED" },
  });
  for (const key of [
    "ok", "reason",
    "broker_truth_ok", "broker_truth_available",
    "sl_ack_status", "tp1_ack_status",
    "quality_check_fails", "failed_check_ids",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, key),
      `(E) result must include ${key}`);
  }
})();

console.log("V2_PROTECTION_BROKER_TRUTH_PRIORITY_TEST_OK");
