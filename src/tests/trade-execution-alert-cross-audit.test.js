"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-trade-execution-alert-cross-audit");

function run() {
  assert.strictEqual(typeof __test.classifyEvent, "function", "classifyEvent export missing");
  assert.strictEqual(typeof __test.parseTelegramTradeAlertRows, "function", "parseTelegramTradeAlertRows export missing");
  assert.strictEqual(typeof __test.buildReport, "function", "buildReport export missing");

  assert.strictEqual(__test.classifyEvent("EXIT_TP_P0_0.8P"), "TP0");
  assert.strictEqual(__test.classifyEvent("EXIT_EXTERNAL_SYNC"), "EXTERNAL_SYNC");

  const telegramRows = __test.parseTelegramTradeAlertRows(
    '[2026-04-14 09:00:00] rc=200 {"ok":true,"result":{"text":"BTCUSDT EXTERNAL_SYNC 전량 청산\\n종류: 외부 동기화 청산\\n이벤트: EXIT_EXTERNAL_SYNC"}}\n',
    Date.parse("2026-04-14T00:00:00Z")
  );
  assert.strictEqual(telegramRows.length, 1);

  const report = __test.buildReport({
    fills: [
      { fill_id: "fill-1", symbol: "BTCUSDT", event: "EXIT_EXTERNAL_SYNC", created_at: "2026-04-14T09:00:30.000Z", created_ms: Date.parse("2026-04-14T09:00:30.000Z") },
      { fill_id: "fill-2", symbol: "ETHUSDT", event: "EXIT_TP_P0_0.8P", created_at: "2026-04-14T09:10:00.000Z", created_ms: Date.parse("2026-04-14T09:10:00.000Z") },
    ],
    alertAuditRows: [
      { ts: "2026-04-14T09:00:20.000Z", symbol: "BTCUSDT", event: "EXIT_EXTERNAL_SYNC", title: "BTCUSDT EXTERNAL_SYNC 전량 청산" },
    ],
    telegramTradeRows: telegramRows,
  });
  assert.strictEqual(report.fill_n, 2);
  assert.strictEqual(report.matched_fill_n, 1);
  assert.strictEqual(report.missing_alert_fill_n, 1);
  assert.strictEqual(report.telegram_trade_alert_row_n, 1);
  assert.strictEqual(report.audit_trade_alert_row_n, 1);

  console.log("TRADE_EXECUTION_ALERT_CROSS_AUDIT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRADE_EXECUTION_ALERT_CROSS_AUDIT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
