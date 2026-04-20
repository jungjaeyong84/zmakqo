"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// trade-execution-alert-blocked-outbox.test.js
//
// 2026-04-20 senior-audit P3 regression.
//
// Scope: canonical-exit-gate BLOCKED rows must appear in trade_alert_outbox.
//
// Prior behaviour (the bug we are locking out):
//   resolveCanonicalExitAlertRequirement() would flag a TP1 payload as
//   required-but-not-satisfied when canonical transitionEvents was empty
//   (the downstream symptom of the P0 lineage bug). sendTradeExecutionAlert
//   then returned { skipped: true, reason: "MISSING_CANONICAL_EXIT_TRANSITION" }
//   BEFORE prepareTradeAlertOutbox was ever invoked. Effect: zero durable
//   Firestore evidence that a TP1 had been silenced. Ops could only find
//   the drop via Cloud Logging scan — no per-symbol row, no per-event row,
//   no dedupe entry.
//
// New contract enforced by this test:
//   (A) On canonical skip, prepareTradeAlertOutbox is called with a
//       placeholder title that encodes the skip reason and symbol/event.
//   (B) markTradeAlertOutboxResult is then called with blocked:true,
//       producing a BLOCKED status row (distinct from SKIPPED/FAILED).
//   (C) sendTradeExecutionAlert still returns skipped:true so the trading
//       path is not regressed — only the observability tail changes.
//   (D) If the outbox write itself fails, the skip still returns — the
//       alert-observability storage must NEVER block the trading path.
//   (E) If prepareTradeAlertOutbox reports skipSend=true (a prior SENT row
//       exists for the same dedupe key), we do NOT clobber the SENT row
//       with BLOCKED — that would erase evidence of the earlier successful
//       dispatch.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Stub ../storage/tradeAlertOutbox before loading tradeExecutionAlert so
// the module binds to our in-memory capture instead of real Firestore.
const outboxStubPath = require.resolve("../storage/tradeAlertOutbox");
const calls = {
  prepareArgs: [],
  markArgs: [],
  prepareBehavior: "ok", // "ok" | "skipSend" | "throw"
  markBehavior: "ok",    // "ok" | "throw"
  lastPrepareId: "OUTBOX_TEST_ID__1",
};

require.cache[outboxStubPath] = {
  id: outboxStubPath,
  filename: outboxStubPath,
  loaded: true,
  exports: {
    prepareTradeAlertOutbox: async (args) => {
      calls.prepareArgs.push(args);
      if (calls.prepareBehavior === "throw") {
        throw new Error("stub: prepare failure");
      }
      if (calls.prepareBehavior === "skipSend") {
        return { outboxId: calls.lastPrepareId, ref: null, doc: { status: "SENT" }, skipSend: true };
      }
      return { outboxId: calls.lastPrepareId, ref: null, doc: null, skipSend: false };
    },
    markTradeAlertOutboxResult: async (args) => {
      calls.markArgs.push(args);
      if (calls.markBehavior === "throw") {
        throw new Error("stub: mark failure");
      }
      return { outboxId: args && args.outboxId, status: args && args.blocked === true ? "BLOCKED" : "?" };
    },
    fetchTradeAlertOutboxItems: async () => [],
  },
};

// Required environment for sendTradeExecutionAlert to reach the canonical
// gate code path. TRADE_ALERT_ENABLED defaults to true, but LIVE mode is
// required unless TRADE_ALERT_INCLUDE_PAPER is set.
process.env.TRADE_ALERT_ENABLED = "1";
process.env.TRADE_ALERT_INCLUDE_PAPER = "1"; // avoid needing LIVE env

// Load under test AFTER stubs are in place.
const { sendTradeExecutionAlert } = require("../services/tradeExecutionAlert");

function resetCalls() {
  calls.prepareArgs.length = 0;
  calls.markArgs.length = 0;
  calls.prepareBehavior = "ok";
  calls.markBehavior = "ok";
}

function buildTp1BlockedPayload() {
  // Payload that trips resolveCanonicalExitAlertRequirement:
  //   required=true (TP1 stage) AND transitionEvents=[] (empty).
  return {
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    event: "EXIT_TP_P1_3.25P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 1000,
    execPrice: 700.5,
    closeRatio: 0.5,
    fullExit: false,
    // Canonical metadata set to simulate the P0 symptom: stage is TP1 but
    // transitionEvents is empty because entry_event_id was missing
    // upstream.
    canonicalExitEvent: "EXIT_TP_P1_3.25P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvents: [],
    canonicalTransitionEvent: null,
    exitRules: {
      SL: -0.0083,
      TP_P1: 0.0083,
      TRAIL_R_MULTIPLE: 1,
      TRAIL_PCT: 0.01,
      RUNNER_MIN_PROFIT_PCT: 0.02,
      BE_PCT: 0.0025,
    },
  };
}

(async () => {
  // ── (A)+(B)+(C): canonical skip → BLOCKED outbox row, still returns skipped
  {
    resetCalls();
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true,
      "canonical skip must still return skipped:true");
    assert.strictEqual(result.reason, "MISSING_CANONICAL_EXIT_TRANSITION",
      "skip reason must be preserved for audit");
    assert.strictEqual(result.blocked, true,
      "result must carry blocked:true so upstream callers can tell this "
      + "was a canonical refusal vs an ordinary skip");
    assert.strictEqual(result.outboxId, "OUTBOX_TEST_ID__1",
      "result must expose outboxId for operator drill-down");

    assert.strictEqual(calls.prepareArgs.length, 1,
      "prepareTradeAlertOutbox must be called exactly once on canonical skip");
    const prep = calls.prepareArgs[0];
    assert.strictEqual(prep.type, "TRADE_EXECUTION_ALERT");
    assert.strictEqual(prep.exchange, "BINANCEFUT");
    assert.strictEqual(prep.symbol, "BNBUSDT");
    assert.strictEqual(prep.event, "EXIT_TP_P1_3.25P");
    assert.ok(prep.title && prep.title.includes("[BLOCKED:MISSING_CANONICAL_EXIT_TRANSITION]"),
      "placeholder title must encode the skip reason so dashboards can "
      + "render BLOCKED rows without needing to re-derive the cause");
    assert.ok(prep.title.includes("BNBUSDT") && prep.title.includes("EXIT_TP_P1_3.25P"),
      "placeholder title must carry symbol/event for at-a-glance ops view");
    assert.strictEqual(prep.allowResend, false,
      "BLOCKED prep must NOT allowResend — we must not clobber prior SENT rows");
    assert.strictEqual(prep.source, "tradeExecutionAlert.sendTradeExecutionAlert.blocked",
      "source tag must identify this as the canonical-block path");

    assert.strictEqual(calls.markArgs.length, 1,
      "markTradeAlertOutboxResult must be called exactly once for the BLOCKED mark");
    const mark = calls.markArgs[0];
    assert.strictEqual(mark.blocked, true,
      "mark must be BLOCKED, not SKIPPED — SKIPPED is reserved for no-op "
      + "paths like OUTBOX_ALREADY_SENT; BLOCKED is the ops-actionable case");
    assert.strictEqual(mark.outboxId, "OUTBOX_TEST_ID__1");
    assert.strictEqual(mark.reason, "MISSING_CANONICAL_EXIT_TRANSITION",
      "BLOCKED reason must match the canonical requirement reason");
    assert.strictEqual(mark.source, "tradeExecutionAlert.sendTradeExecutionAlert.blocked");
  }

  // ── (D): outbox prep failure must NOT block the trading path
  {
    resetCalls();
    calls.prepareBehavior = "throw";
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true,
      "prep failure must still return skipped:true — trading path uninterrupted");
    assert.strictEqual(result.reason, "MISSING_CANONICAL_EXIT_TRANSITION",
      "reason must still carry the canonical block reason");
    assert.strictEqual(result.blocked, true,
      "blocked flag must still be set even when storage fails — the "
      + "semantic state is 'we blocked the send', regardless of whether "
      + "we managed to write a row about it");
    assert.strictEqual(result.outboxId, null,
      "outboxId must be null when prep fails — don't fabricate an id");
    assert.strictEqual(calls.markArgs.length, 0,
      "mark must not be called when prep failed");
  }

  // ── (D'): mark failure must also NOT block the trading path
  {
    resetCalls();
    calls.markBehavior = "throw";
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, "MISSING_CANONICAL_EXIT_TRANSITION");
    assert.strictEqual(result.blocked, true);
    // outboxId was assigned before the mark threw — keep it for ops drill-down.
    assert.strictEqual(result.outboxId, "OUTBOX_TEST_ID__1",
      "outboxId must still surface even if the mark write failed — ops "
      + "can inspect the PENDING row that prep left behind");
  }

  // ── (E): prior SENT row must not be clobbered by BLOCKED
  {
    resetCalls();
    calls.prepareBehavior = "skipSend";
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.blocked, true,
      "result.blocked remains true — the canonical gate did block this send");
    assert.strictEqual(result.outboxId, "OUTBOX_TEST_ID__1",
      "outboxId is still exposed (points at the pre-existing SENT row)");
    assert.strictEqual(calls.markArgs.length, 0,
      "mark must NOT be invoked when prepare returned skipSend:true — "
      + "doing so would downgrade a SENT row to BLOCKED and erase evidence "
      + "of the earlier successful dispatch");
  }

  console.log("TRADE_EXECUTION_ALERT_BLOCKED_OUTBOX_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
