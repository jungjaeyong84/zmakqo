#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { fetchTradeAlertOutboxItems } = require("../src/storage/tradeAlertOutbox");
const { sendTradeExecutionAlert, sendTradeExecutionFailureAlert } = require("../src/services/tradeExecutionAlert");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

async function main() {
  const apply = String(process.env.APPLY || "").trim() === "1";
  const limit = Math.max(1, Math.min(200, Number(process.env.TRADE_ALERT_OUTBOX_RETRY_LIMIT) || 50));
  const statuses = String(process.env.TRADE_ALERT_OUTBOX_RETRY_STATUSES || "FAILED,SKIPPED,PENDING")
    .split(/[\s,]+/)
    .map((value) => upper(value))
    .filter(Boolean);
  const items = await fetchTradeAlertOutboxItems({ statuses, limit });
  const rows = [];
  for (const item of items) {
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : null;
    const type = upper(item && item.type);
    if (!payload) {
      rows.push({ outbox_id: item && item.trade_alert_outbox_id || item && item.id || null, status: "SKIP", reason: "PAYLOAD_MISSING" });
      continue;
    }
    if (!apply) {
      rows.push({
        outbox_id: item.trade_alert_outbox_id || item.id,
        type,
        symbol: upper(item.symbol),
        event: upper(item.event),
        status: "DRY_RUN",
        reason: upper(item.status),
      });
      continue;
    }
    const result = type === "TRADE_EXECUTION_FAILURE_ALERT"
      ? await sendTradeExecutionFailureAlert(payload)
      : await sendTradeExecutionAlert(payload);
    rows.push({
      outbox_id: item.trade_alert_outbox_id || item.id,
      type,
      symbol: upper(item.symbol),
      event: upper(item.event),
      status: result && result.ok === true ? "SENT" : (result && result.skipped === true ? "SKIP" : "FAILED"),
      reason: result && result.reason ? result.reason : null,
      next_outbox_id: result && result.outboxId ? result.outboxId : null,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    apply,
    requested_statuses: statuses,
    fetched_n: items.length,
    sent_n: rows.filter((row) => row.status === "SENT").length,
    dry_run_n: rows.filter((row) => row.status === "DRY_RUN").length,
    skipped_n: rows.filter((row) => row.status === "SKIP").length,
    failed_n: rows.filter((row) => row.status === "FAILED").length,
    rows,
  }, null, 2));
}

main().catch((err) => {
  console.error("RETRY_TRADE_ALERT_OUTBOX_FAIL", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
