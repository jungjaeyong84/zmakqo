"use strict";

const assert = require("assert");
const sender = require("../../scripts/send-v2-promotion-submit-operator-alert");

(async function dryRunDoesNotCallTransport() {
  let called = false;
  const result = await sender.sendOperatorAlert({}, {
    renderAlert() {
      return {
        preview: { title: "V2 Promotion Submit Blocked" },
        telegram_args: {
          title: "V2 Promotion Submit Blocked",
          severity: "WARN",
          sections: [{ header: "정본 요약", lines: ["SUBMIT_BLOCKED"] }],
          provider: "BINANCEFUT",
          dedupeKey: "v2-promotion-submit:BLOCKED:test",
        },
      };
    },
    async sendSummary() {
      called = true;
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.send_enabled, false);
  assert.strictEqual(called, false);
})();

(async function sendModeUsesRenderedTelegramArgs() {
  let captured = null;
  const result = await sender.sendOperatorAlert({
    V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED: "1",
  }, {
    renderAlert() {
      return {
        preview: { title: "V2 Promotion Submit Ready" },
        telegram_args: {
          title: "V2 Promotion Submit Ready",
          severity: "INFO",
          sections: [{ header: "정본 요약", lines: ["SUBMIT_READY"] }],
          provider: "BINANCEFUT",
          dedupeKey: "v2-promotion-submit:READY:test",
        },
      };
    },
    async sendSummary(args) {
      captured = args;
      return { ok: true, transport: "fake" };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.send_enabled, true);
  assert.strictEqual(captured.title, "V2 Promotion Submit Ready");
  assert.strictEqual(captured.severity, "INFO");
  assert.strictEqual(captured.dedupeKey, "v2-promotion-submit:READY:test");
})();

console.log("SEND_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_TEST_OK");
