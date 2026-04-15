"use strict";

const assert = require("assert");
const { __test } = require("../storage/tradeAlertOutbox");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildTradeAlertOutboxId, "function", "buildTradeAlertOutboxId export missing");

  const first = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
  });
  const second = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
    payload: { orderId: 1, ts: "2026-04-15T00:00:00.000Z" },
  });
  assert.strictEqual(first, second, "source fill id should dominate outbox id stability");

  const fallbackA = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  const fallbackB = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  assert.strictEqual(fallbackA, fallbackB, "fallback hash should be stable for identical payload identity");

  console.log("TRADE_ALERT_OUTBOX_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRADE_ALERT_OUTBOX_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
