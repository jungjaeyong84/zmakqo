"use strict";

const { classifyAlertFailureReason } = require("./alertFailureTaxonomy");
const { queryV2DocsByField } = require("./storage");
const { retryStoredExitTransitionAlert } = require("./alertDeliveryWorker");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function evaluateRetryEligibility({
  outbox,
  maxAttempt = 3,
  cooldownSec = 300,
  nowMs = Date.now(),
} = {}) {
  const row = outbox && typeof outbox === "object" ? outbox : null;
  if (!row) throw new Error("ALERT_OUTBOX_REQUIRED");
  const status = upper(row.status);
  const attemptCount = Math.max(0, Number(row.attempt_count) || 0);
  const lastReason = upper(row.last_reason);
  const lastAttemptMs = toMs(row.last_attempt_at);
  if (status !== "FAILED") {
    return Object.freeze({ ok: false, reason: "RETRY_STATUS_NOT_FAILED" });
  }
  if (attemptCount >= Math.max(1, Number(maxAttempt) || 1)) {
    return Object.freeze({
      ok: false,
      reason: "RETRY_MAX_ATTEMPT_EXCEEDED",
      family: "RETRY_GOVERNANCE",
      runbook_refs: Object.freeze(["ALERT_RBK_05"]),
    });
  }
  if (lastReason) {
    const taxonomy = classifyAlertFailureReason(lastReason);
    if (taxonomy.terminal === true || taxonomy.retryable !== true) {
      return Object.freeze({
        ok: false,
        reason: "RETRY_TERMINAL_REASON",
        family: taxonomy.family,
        runbook_refs: taxonomy.runbook_refs,
      });
    }
  }
  if (lastAttemptMs != null && (nowMs - lastAttemptMs) < (Math.max(0, Number(cooldownSec) || 0) * 1000)) {
    return Object.freeze({
      ok: false,
      reason: "RETRY_COOLDOWN_ACTIVE",
      family: "RETRY_GOVERNANCE",
      runbook_refs: Object.freeze(["ALERT_RBK_05"]),
    });
  }
  return Object.freeze({
    ok: true,
    reason: "RETRY_ALLOWED",
    family: "TRANSPORT",
    runbook_refs: Object.freeze(["ALERT_RBK_04"]),
  });
}

async function retryFailedExitTransitionAlerts({
  db = null,
  env = process.env,
  limit = 20,
  statuses = ["FAILED"],
  sendSummary,
  sentAt = null,
  maxAttempt = 3,
  cooldownSec = 300,
} = {}) {
  const normalizedStatuses = Array.from(new Set(
    (Array.isArray(statuses) ? statuses : [statuses])
      .map((status) => upper(status))
      .filter(Boolean)
  ));
  const rows = [];
  for (const status of normalizedStatuses) {
    const result = await queryV2DocsByField({
      db,
      env,
      collectionKey: "TRADE_ALERT_OUTBOX",
      field: "status",
      value: status,
      limit,
    });
    for (const row of result.rows) {
      rows.push(row);
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }

  const attempts = [];
  for (const row of rows) {
    try {
      const eligibility = evaluateRetryEligibility({
        outbox: row,
        maxAttempt,
        cooldownSec,
        nowMs: sentAt ? (toMs(sentAt) || Date.now()) : Date.now(),
      });
      if (eligibility.ok !== true) {
        attempts.push({
          ok: false,
          alert_outbox_id: row && row.alert_outbox_id || null,
          status: upper(row && row.status) || null,
          reason: eligibility.reason,
          family: eligibility.family || null,
          runbook_refs: eligibility.runbook_refs || [],
        });
        continue;
      }
      const retried = await retryStoredExitTransitionAlert({
        outbox: row,
        db,
        env,
        sendSummary,
        sentAt,
      });
      attempts.push({
        ok: retried.ok,
        alert_outbox_id: retried.updatedOutbox.alert_outbox_id,
        status: retried.updatedOutbox.status,
        reason: retried.updatedOutbox.last_reason || null,
        family: retried.updatedOutbox.last_reason_family || null,
        runbook_refs: retried.updatedOutbox.runbook_refs || [],
      });
    } catch (error) {
      attempts.push({
        ok: false,
        alert_outbox_id: row && row.alert_outbox_id || null,
        status: upper(row && row.status) || null,
        reason: error && error.message ? error.message : "V2_ALERT_RETRY_FAILED",
        family: "UNKNOWN",
        runbook_refs: ["ALERT_RBK_99"],
      });
    }
  }

  return Object.freeze({
    ok: true,
    fetched_n: rows.length,
    retried_n: attempts.length,
    sent_n: attempts.filter((row) => row.status === "SENT").length,
    failed_n: attempts.filter((row) => row.ok !== true).length,
    attempts: Object.freeze(attempts),
  });
}

module.exports = {
  retryFailedExitTransitionAlerts,
  __test: {
    toMs,
    evaluateRetryEligibility,
  },
};
