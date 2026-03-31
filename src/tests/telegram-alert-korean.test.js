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

  const openclawText = __test.buildTelegramText({
    title: "[AI] HOLD",
    body: "reason: DAILY_NO_TRADE_ACTIVITY",
    severity: "INFO",
  });
  assert.ok(openclawText.includes("[알림]"));
  assert.ok(openclawText.includes("AI 판단 유지"));
  assert.ok(openclawText.includes("사유: 오늘 거래가 없음"));

  delete process.env.TELEGRAM_ALERT_TRANSPORT;
  assert.strictEqual(__test.resolveTelegramTransport({ token: "" }), "auto");
  assert.strictEqual(__test.resolveTelegramTransport({ token: "inline-token" }), "api");
  process.env.TELEGRAM_ALERT_TRANSPORT = "openclaw";
  assert.strictEqual(__test.resolveTelegramTransport({ token: "" }), "openclaw");
  process.env.TELEGRAM_ALERT_TRANSPORT = "api";
  assert.strictEqual(__test.resolveTelegramTransport({ token: "" }), "api");
  delete process.env.TELEGRAM_ALERT_TRANSPORT;

  const args = __test.buildOpenClawSendArgs({ chatId: "7428566524", text: "hello" });
  assert.deepStrictEqual(args, [
    "message",
    "send",
    "--channel",
    "telegram",
    "--target",
    "7428566524",
    "--message",
    "hello",
    "--json",
  ]);

  console.log("TELEGRAM_ALERT_KOREAN_TEST_OK");
}

run();
