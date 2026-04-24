"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  const timedOut = __test.resolveTpP1AckWatchdogDecision({
    meta: { tp_p1_pending: true },
    intent: {
      intent_id: "INTENT__ETH__TP1",
      status: "PENDING",
      live_submit_state: "SUBMITTING",
      live_submit_started_at_ms: 1000,
      live_submit_ack_at_ms: null,
      live_submit_order_id: null,
      live_submit_client_order_id: null,
    },
    now: 62000,
    graceMs: 45000,
  });
  assert.strictEqual(timedOut.timedOut, true);
  assert.strictEqual(timedOut.reason, "TP1_ACK_TIMEOUT");
  assert.strictEqual(timedOut.elapsedMs, 61000);

  const acked = __test.resolveTpP1AckWatchdogDecision({
    meta: { tp_p1_pending: true },
    intent: {
      status: "PENDING",
      live_submit_state: "ACKED",
      live_submit_started_at_ms: 1000,
      live_submit_ack_at_ms: 5000,
      live_submit_order_id: "12345",
    },
    now: 62000,
    graceMs: 45000,
  });
  assert.strictEqual(acked.timedOut, false);
  assert.strictEqual(acked.reason, "TP1_ALREADY_ACKED");

  const inactive = __test.resolveTpP1AckWatchdogDecision({
    meta: { tp_p1_pending: false },
    intent: {
      status: "PENDING",
      live_submit_started_at_ms: 1000,
    },
    now: 62000,
  });
  assert.strictEqual(inactive.timedOut, false);
  assert.strictEqual(inactive.reason, "TP1_PENDING_INACTIVE");

  const payload = __test.buildTpP1AckTimeoutAlertPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    pendingEvent: "EXIT_TP_P1_3.25P",
    pendingAtMs: Date.parse("2026-04-16T04:30:00.000Z"),
    intent: {
      intent_id: "INTENT__ETH__TP1",
      status: "PENDING",
      live_submit_state: "SUBMITTING",
      live_submit_error: "submit pending",
    },
    decision: {
      liveSubmitState: "SUBMITTING",
      startedAtMs: Date.parse("2026-04-16T04:30:03.000Z"),
      elapsedMs: 61000,
      graceMs: 45000,
    },
  });
  assert.strictEqual(payload.title, "[V2 긴급] ETHUSDT TP1 submit ACK timeout");
  assert.strictEqual(payload.severity, "ERROR");
  assert.ok(payload.body.includes("reason: TP1_ACK_TIMEOUT"));
  assert.ok(payload.body.includes("elapsed_ms: 61000"));
  assert.ok(payload.body.includes("submit_error: submit pending"));

  const first = __test.shouldSendTpP1AckTimeoutAlert({
    symbol: "ETHUSDT",
    intentId: "INTENT__ETH__TP1",
    reason: "TP1_ACK_TIMEOUT",
  });
  const second = __test.shouldSendTpP1AckTimeoutAlert({
    symbol: "ETHUSDT",
    intentId: "INTENT__ETH__TP1",
    reason: "TP1_ACK_TIMEOUT",
  });
  assert.strictEqual(first, true);
  assert.strictEqual(second, false);

  console.log("TP1_ACK_WATCHDOG_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TP1_ACK_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
