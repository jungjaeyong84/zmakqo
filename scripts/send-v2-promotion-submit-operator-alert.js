#!/usr/bin/env node
"use strict";

const renderer = require("./render-v2-promotion-submit-operator-alert");
const { sendKoreanTelegramSummary } = require("./lib/automation-utils");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isEnabled(value) {
  return String(value || "0").trim() === "1";
}

async function sendOperatorAlert(env = process.env, {
  renderAlert = renderer.renderAlert,
  sendSummary = sendKoreanTelegramSummary,
} = {}) {
  const rendered = renderAlert(env);
  const sendEnabled = isEnabled(env.V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED);
  if (!sendEnabled) {
    return Object.freeze({
      ok: true,
      reason: "V2_PROMOTION_OPERATOR_ALERT_READY",
      send_enabled: false,
      preview: rendered.preview,
      telegram_args: rendered.telegram_args,
      transport_result: null,
    });
  }
  const args = rendered.telegram_args || {};
  const transportResult = await sendSummary({
    title: args.title,
    severity: args.severity,
    sections: args.sections,
    provider: args.provider,
    dedupeKey: args.dedupeKey,
  });
  const transportOk = transportResult && (transportResult.ok === true || transportResult.skipped === true);
  return Object.freeze({
    ok: transportOk,
    reason: transportOk
      ? "V2_PROMOTION_OPERATOR_ALERT_SENT"
      : "V2_PROMOTION_OPERATOR_ALERT_SEND_FAILED",
    send_enabled: true,
    preview: rendered.preview,
    telegram_args: rendered.telegram_args,
    transport_result: transportResult || null,
  });
}

async function main(env = process.env) {
  const result = await sendOperatorAlert(env);
  const text = JSON.stringify(result);
  if (result.ok !== true) {
    console.error(text);
    process.exit(1);
  }
  console.log(text);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("SEND_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    sendOperatorAlert,
    __test: {
      trimOrNull,
      isEnabled,
    },
  };
}
