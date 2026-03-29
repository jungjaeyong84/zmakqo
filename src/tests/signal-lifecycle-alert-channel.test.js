"use strict";

const assert = require("assert");
const { __test } = require("../services/signalLifecycleAlert");

(() => {
  assert.strictEqual(typeof __test.resolveAlertChannelFromSources, "function", "resolveAlertChannelFromSources export missing");
  assert.strictEqual(typeof __test.buildTelegramChannelFromChatId, "function", "buildTelegramChannelFromChatId export missing");

  assert.strictEqual(
    __test.resolveAlertChannelFromSources({
      lifecycleChannel: "telegram:100",
      systemChannel: "telegram:200",
      tradeChannel: "telegram:300",
      exitIntegrityChannel: "telegram:400",
      telegramChatId: "500",
    }),
    "telegram:100"
  );

  assert.strictEqual(
    __test.resolveAlertChannelFromSources({
      lifecycleChannel: "",
      systemChannel: "telegram:200",
      tradeChannel: "telegram:300",
      exitIntegrityChannel: "telegram:400",
      telegramChatId: "500",
    }),
    "telegram:200"
  );

  assert.strictEqual(
    __test.resolveAlertChannelFromSources({
      lifecycleChannel: "",
      systemChannel: "",
      tradeChannel: "telegram:300",
      exitIntegrityChannel: "telegram:400",
      telegramChatId: "500",
    }),
    "telegram:300"
  );

  assert.strictEqual(
    __test.resolveAlertChannelFromSources({
      lifecycleChannel: "",
      systemChannel: "",
      tradeChannel: "",
      exitIntegrityChannel: "telegram:400",
      telegramChatId: "500",
    }),
    "telegram:400"
  );

  assert.strictEqual(
    __test.resolveAlertChannelFromSources({
      lifecycleChannel: "",
      systemChannel: "",
      tradeChannel: "",
      exitIntegrityChannel: "",
      telegramChatId: "500",
    }),
    "telegram:500"
  );

  assert.strictEqual(__test.buildTelegramChannelFromChatId("7428566524"), "telegram:7428566524");
  assert.strictEqual(__test.buildTelegramChannelFromChatId(""), "");

  const dropped = __test.buildDroppedMessage({
    symbol: "SOLUSDT",
    event: "PRE_REAL_SHORT",
    side: "SELL",
    tf: "15m",
    qtyPct: 0.22,
    executionMode: "LIVE",
    reason: "DROP_EV_GATE_TP1_PROB",
  });
  assert.ok(dropped.body.includes("이벤트: SHORT"));
  assert.ok(dropped.body.includes("사이드: 매도"));

  const received = __test.buildReceivedMessage({
    symbol: "BTCUSDT",
    event: "EARLY_LONG",
    side: "BUY",
    tf: "15m",
    qtyPct: 0.15,
    executionMode: "LIVE",
  });
  assert.ok(received.body.includes("이벤트: LONG"));
  assert.ok(received.body.includes("사이드: 매수"));

  console.log("SIGNAL_LIFECYCLE_ALERT_CHANNEL_TEST_OK");
})();
