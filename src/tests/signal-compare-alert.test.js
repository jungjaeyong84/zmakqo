"use strict";

const assert = require("assert");
const { __test } = require("../services/signalLifecycleAlert");

(() => {
  assert.strictEqual(
    __test.shouldSendCompareAlert({
      webhookSeen: true,
      serverSignalCreated: false,
      signalDropN: 0,
    }),
    true
  );
  assert.strictEqual(
    __test.shouldSendCompareAlert({
      webhookSeen: false,
      serverSignalCreated: false,
      signalDropN: 0,
    }),
    false
  );
  assert.strictEqual(
    __test.shouldSendCompareAlert({
      newBar: false,
      webhookSeen: true,
      serverSignalCreated: false,
      serverReason: "NO_NEW_BAR",
      signalDropN: 0,
    }),
    false
  );

  const msg = __test.buildCompareMessage({
    symbol: "ETHUSDT",
    barCloseUtc: "2026-04-01 23:45:00 KST",
    webhookSeen: true,
    webhookDecision: "SAVED",
    serverSignalCreated: false,
    serverReason: "DROP_EV_GATE_TP1_PROB",
    topDropReason: "DROP_EV_GATE_TP1_PROB",
  });
  assert.ok(msg.title.includes("ETHUSDT"));
  assert.ok(msg.body.includes("시장: ETHUSDT"));
  assert.ok(msg.body.includes("웹훅신호: 있음 (SAVED)"));
  assert.ok(msg.body.includes("서버신호 생성여부: 아니오"));
  assert.ok(msg.body.includes("미생성 주원인: DROP_EV_GATE_TP1_PROB"));
  assert.ok(msg.body.includes("드롭상위사유: DROP_EV_GATE_TP1_PROB"));

  const createdMsg = __test.buildCompareMessage({
    symbol: "BNBUSDT",
    barCloseUtc: "2026-04-07 14:45:00 KST",
    webhookSeen: false,
    serverSignalCreated: true,
    serverReason: "INTENT_CREATED",
    topDropReason: null,
  });
  assert.ok(createdMsg.body.includes("서버신호 생성여부: 예"));
  assert.ok(createdMsg.body.includes("생성 후 상태: INTENT_CREATED"));
  assert.ok(!createdMsg.body.includes("미생성 주원인: INTENT_CREATED"));

  console.log("SIGNAL_COMPARE_ALERT_TEST_OK");
})();
