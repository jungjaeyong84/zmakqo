"use strict";

const assert = require("assert");
const { __test } = require("../utils/alerts");

function run() {
  assert.strictEqual(__test.normalizeTelegramSeverity("INFO"), "알림");
  assert.strictEqual(__test.normalizeTelegramSeverity("WARN"), "주의");
  assert.strictEqual(__test.normalizeTelegramSeverity("ERROR"), "오류");

  const title = __test.normalizeTelegramTitle("[AI] BINANCEFUT HOLD 요약", "WARN");
  assert.ok(title.includes("[주의]"));
  assert.ok(title.includes("AI 판단"));
  assert.ok(title.includes("유지"));

  const body = __test.normalizeTelegramBody([
    "reason: DAILY_NO_TRADE_ACTIVITY",
    "side: BUY",
    "close_position: true",
    "tracked_client: false",
    "order_id: 12345",
  ].join("\n"));

  assert.ok(body.includes("사유:"));
  assert.ok(body.includes("오늘 거래가 없음"));
  assert.ok(body.includes("방향: 매수"));
  assert.ok(body.includes("포지션 종료 주문: 예"));
  assert.ok(body.includes("내부 추적 주문 여부: 아니오"));
  assert.ok(body.includes("주문 ID: 12345"));

  console.log("TELEGRAM_ALERT_KOREAN_TEST_OK");
}

run();
