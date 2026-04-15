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
    qtyAfterOpenclawPct: 0.18,
    qtyFinalPct: 0.075,
    requiredQtyPct: 0.1666666667,
    floorApplied: true,
    floorQtyPct: 0.1666666667,
    executionMode: "LIVE",
    reason: "DROP_EV_GATE_TP1_PROB",
  });
  assert.ok(dropped.body.includes("이벤트: SHORT"));
  assert.ok(dropped.body.includes("사이드: 매도"));
  assert.ok(dropped.body.includes("수량(요청): 22%"));
  assert.ok(dropped.body.includes("수량(OpenClaw 후): 18%"));
  assert.ok(dropped.body.includes("수량(최종): 7.5%"));
  assert.ok(dropped.body.includes("최소필요수량: 17%"));
  assert.ok(dropped.body.includes("floor 보정수량: 17%"));

  const blocked = __test.buildDroppedMessage({
    symbol: "XRPUSDT",
    event: "LONG",
    side: "BUY",
    tf: "15m",
    qtyPct: 1,
    executionMode: "LIVE",
    reason: "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK",
  });
  assert.ok(blocked.body.includes("드롭 위치: OpenClaw 실행 가드"));
  assert.ok(blocked.body.includes("해석: 알파 컨텍스트 패널티가 강하게 걸려 있어 현재 구간의 신규 진입을 막았습니다."));
  assert.ok(blocked.body.includes("수량(요청): 100%"));
  assert.ok(blocked.body.includes("수량(최종): 0%"));

  const budgetBlocked = __test.buildDroppedMessage({
    symbol: "ETHUSDT",
    event: "SHORT",
    side: "SELL",
    tf: "15m",
    qtyPct: 1,
    executionMode: "LIVE",
    reason: "MIN_ORDER_EXCEEDS_BUDGET",
  });
  assert.ok(budgetBlocked.body.includes("드롭 위치: 예산/최소주문 가드"));
  assert.ok(budgetBlocked.body.includes("해석: 현재 예산과 배율로는 거래소 최소주문 수량을 만족할 수 없어 진입을 보류했습니다."));

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

  const progressed = __test.buildProgressMessage({
    symbol: "BNBUSDT",
    event: "SHORT",
    side: "SELL",
    tf: "15m",
    qtyPct: 1,
    executionMode: "LIVE",
    progressReason: "INTENT_CREATED",
    pendingReason: "WAIT_NEXT_BAR",
    scheduledExecBarCloseUtc: "2026-04-07T06:00:00.000Z",
  });
  assert.ok(progressed.body.includes("진행 상태: INTENT_CREATED"));
  assert.ok(progressed.body.includes("다음 단계: 다음 바 집행 대기"));
  assert.ok(progressed.body.includes("예정 집행시각: 2026-04-07T06:00:00.000Z"));

  console.log("SIGNAL_LIFECYCLE_ALERT_CHANNEL_TEST_OK");
})();
