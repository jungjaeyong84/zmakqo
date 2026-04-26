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

  const v2Text = __test.buildTelegramText({
    title: "[P0] SOLUSDT live exit exception",
    body: "reason: LIVE_EXCEPTION",
    severity: "ERROR",
    env: {
      DONBEOLJA_V2_ENABLED: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "SOLUSDT:15|XRPUSDT:15",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "5",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "UNLIMITED",
      DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "10",
      DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "400",
      DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "155",
      DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: "300",
      DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
      DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
      ML_LIVE_SERVING_ARMED: "0",
      OPENCLAW_AGENT_APPLY_ENABLED: "0",
    },
  });
  assert.ok(v2Text.includes("[오류] [V2 DISCOVERY_CANARY] [V2 긴급] SOLUSDT live exit exception"));
  assert.ok(v2Text.includes("runtime=V2 DISCOVERY_CANARY"));
  assert.ok(v2Text.includes("canary_only=1"));
  assert.ok(v2Text.includes("formal_live=0"));
  assert.ok(v2Text.includes("legacy_webhook=차단됨"));
  assert.ok(v2Text.includes("symbols=SOLUSDT|XRPUSDT"));
  assert.ok(v2Text.includes("fallback_notional=25"));
  assert.ok(!v2Text.includes("max_notional=25"));
  assert.ok(v2Text.includes("symbol_notional=SOLUSDT:15|XRPUSDT:15"));
  assert.ok(v2Text.includes("max_pos=5"));
  assert.ok(v2Text.includes("max_trades=UNLIMITED"));
  assert.ok(v2Text.includes("daily_loss_halt=10"));
  assert.ok(v2Text.includes("risk_total=400"));
  assert.ok(v2Text.includes("risk_symbol=155"));
  assert.ok(v2Text.includes("risk_group=300"));
  assert.ok(!v2Text.includes("[P0]"));

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
