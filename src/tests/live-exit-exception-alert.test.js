const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(__test.isCriticalLiveExitExceptionEvent("EXIT_TP_P0_0.8P"), true);
  assert.strictEqual(__test.isCriticalLiveExitExceptionEvent("EXIT_TP_P1_1.65P"), true);
  assert.strictEqual(__test.isCriticalLiveExitExceptionEvent("EXIT_TRAIL"), true);
  assert.strictEqual(__test.isCriticalLiveExitExceptionEvent("EXIT_SL_1.65"), true);
  assert.strictEqual(__test.isCriticalLiveExitExceptionEvent("ENTRY_LONG"), false);

  const payload = __test.buildLiveExitExceptionIntegrityAlertPayload({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intentId: "INTENT__ETH__TP1",
    signalId: "SIG__ETH__TP1",
    error: "signalId is not defined",
    executionMode: "LIVE",
  });

  assert.strictEqual(payload.title, "[P0] ETHUSDT live exit exception");
  assert.strictEqual(payload.severity, "ERROR");
  assert.ok(payload.body.includes("reason: LIVE_EXCEPTION"));
  assert.ok(payload.body.includes("phase: LIVE_EXIT_EXECUTION"));
  assert.ok(payload.body.includes("exchange: BINANCEFUT"));
  assert.ok(payload.body.includes("event: EXIT_TP_P1_1.65P"));
  assert.ok(payload.body.includes("intent_id: INTENT__ETH__TP1"));
  assert.ok(payload.body.includes("signal_id: SIG__ETH__TP1"));
  assert.ok(payload.body.includes("error: signalId is not defined"));

  console.log("LIVE_EXIT_EXCEPTION_ALERT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("LIVE_EXIT_EXCEPTION_ALERT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
