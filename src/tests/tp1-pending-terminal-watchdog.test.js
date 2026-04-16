"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  assert.strictEqual(__test.isTpP1IntentEvent("EXIT_TP_P1_1.65P"), true);
  assert.strictEqual(__test.isTpP1IntentEvent("EXIT_TRAIL"), false);

  assert.strictEqual(__test.isTpP1PendingTerminalFailureIntent({
    status: "CANCELED",
    status_reason: "LIVE_EXCEPTION",
    terminal_failure_status: "FAILED_INTERNAL",
  }), true);
  assert.strictEqual(__test.isTpP1PendingTerminalFailureIntent({
    status: "CANCELED",
    cancel_reason: "LIVE_FAILED",
  }), true);
  assert.strictEqual(__test.isTpP1PendingTerminalFailureIntent({
    status: "PENDING",
    status_reason: "LIVE_EXCEPTION",
  }), false);
  assert.strictEqual(__test.isTpP1PendingTerminalFailureIntent({
    status: "CANCELED",
    status_reason: "EXTERNAL_FILL_RECONCILED",
  }), false);

  const payload = __test.buildTpP1PendingTerminalAlertPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    pendingEvent: "EXIT_TP_P1_1.65P",
    pendingAtMs: Date.parse("2026-04-15T19:30:11.283Z"),
    pendingUntilMs: Date.parse("2026-04-15T19:35:11.283Z"),
    intent: {
      intent_id: "INTENT__ETH__TP1",
      status: "CANCELED",
      status_reason: "LIVE_EXCEPTION",
      last_error: "signalId is not defined",
    },
  });
  assert.strictEqual(payload.title, "[P0] ETHUSDT TP1 pending terminal failure");
  assert.strictEqual(payload.severity, "ERROR");
  assert.ok(payload.body.includes("reason: TP1_PENDING_TERMINAL_LIVE_FAILURE"));
  assert.ok(payload.body.includes("status_reason: LIVE_EXCEPTION"));
  assert.ok(payload.body.includes("error: signalId is not defined"));

  const first = __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "ETHUSDT",
    intentId: "INTENT__ETH__TP1",
    reason: "LIVE_EXCEPTION",
  });
  const second = __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "ETHUSDT",
    intentId: "INTENT__ETH__TP1",
    reason: "LIVE_EXCEPTION",
  });
  assert.strictEqual(first, true);
  assert.strictEqual(second, false);

  console.log("TP1_PENDING_TERMINAL_WATCHDOG_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TP1_PENDING_TERMINAL_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
