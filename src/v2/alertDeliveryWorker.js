"use strict";

const { applyAlertDeliveryResult } = require("./alertWorker");
const { classifyAlertFailureReason } = require("./alertFailureTaxonomy");
const { putV2Doc } = require("./storage");
const { sendKoreanTelegramSummary } = require("../../scripts/lib/automation-utils");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function validatePreparedAlert(preparedAlert) {
  const prepared = preparedAlert && typeof preparedAlert === "object" ? preparedAlert : null;
  if (!prepared) throw new Error("PREPARED_ALERT_REQUIRED");
  if (prepared.ok !== true) throw new Error("PREPARED_ALERT_NOT_DELIVERABLE");
  if (!prepared.outbox || typeof prepared.outbox !== "object") throw new Error("ALERT_OUTBOX_REQUIRED");
  if (!prepared.payload || typeof prepared.payload !== "object") throw new Error("ALERT_PAYLOAD_REQUIRED");
  return prepared;
}

function resolveAlertSeverity(event) {
  const normalized = upper(event);
  if (normalized === "TP1_REACHED" || normalized === "TRAIL_ACTIVATED") return "INFO";
  if (normalized === "SL_HIT" || normalized === "TRAIL_HIT") return "WARN";
  if (normalized === "EXTERNAL_CLOSE_SYNC" || normalized === "MANUAL_CLOSE_SYNC") return "WARN";
  return "INFO";
}

function buildTelegramSectionsFromPayload(payload) {
  const lines = String(payload && payload.body || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  return Object.freeze([Object.freeze({
    header: "V2 Exit Transition",
    lines: Object.freeze(lines),
  })]);
}

function buildExitTransitionDeliveryRequest({
  preparedAlert,
  provider = "BINANCEFUT",
  dedupeWindowSec = 300,
} = {}) {
  const prepared = validatePreparedAlert(preparedAlert);
  return Object.freeze({
    title: trimOrNull(prepared.payload.title),
    sections: buildTelegramSectionsFromPayload(prepared.payload),
    severity: resolveAlertSeverity(prepared.payload.event),
    provider: trimOrNull(provider) || "BINANCEFUT",
    dedupeKey: trimOrNull(prepared.outbox.alert_outbox_id),
    dedupeWindowSec: Math.max(60, Number(dedupeWindowSec || 0)),
    dedupeFingerprint: trimOrNull(prepared.payload.canonical_transition_id),
  });
}

function buildPersistedPreparedAlertOutbox({
  preparedAlert,
  provider = "BINANCEFUT",
  dedupeWindowSec = 300,
} = {}) {
  const prepared = validatePreparedAlert(preparedAlert);
  return Object.freeze({
    ...prepared.outbox,
    prepared_payload: Object.freeze({ ...prepared.payload }),
    delivery_request: buildExitTransitionDeliveryRequest({
      preparedAlert: prepared,
      provider,
      dedupeWindowSec,
    }),
  });
}

function validateStoredOutboxForRetry(outbox) {
  const row = outbox && typeof outbox === "object" ? outbox : null;
  if (!row) throw new Error("ALERT_OUTBOX_REQUIRED");
  if (!row.delivery_request || typeof row.delivery_request !== "object") {
    throw new Error("ALERT_DELIVERY_REQUEST_REQUIRED");
  }
  if (!row.prepared_payload || typeof row.prepared_payload !== "object") {
    throw new Error("ALERT_PREPARED_PAYLOAD_REQUIRED");
  }
  return row;
}

function applyFailureTaxonomyToOutbox(outbox, deliveryOk) {
  if (deliveryOk === true) {
    return Object.freeze({
      ...outbox,
      last_reason_family: null,
      retry_policy_code: "DELIVERED",
      runbook_refs: [],
    });
  }
  const taxonomy = classifyAlertFailureReason(outbox.last_reason);
  return Object.freeze({
    ...outbox,
    last_reason_family: taxonomy.family,
    retry_policy_code: taxonomy.retry_policy_code,
    runbook_refs: taxonomy.runbook_refs,
  });
}

async function deliverPreparedExitTransitionAlert({
  preparedAlert,
  db = null,
  env = process.env,
  provider = "BINANCEFUT",
  dedupeWindowSec = 300,
  sendSummary = sendKoreanTelegramSummary,
  sentAt = null,
} = {}) {
  const prepared = validatePreparedAlert(preparedAlert);
  const persistedOutbox = buildPersistedPreparedAlertOutbox({
    preparedAlert: prepared,
    provider,
    dedupeWindowSec,
  });
  const request = buildExitTransitionDeliveryRequest({
    preparedAlert: prepared,
    provider,
    dedupeWindowSec,
  });
  const deliveryEnabled = parseBool(env && env.DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED, false);
  const transportResult = deliveryEnabled
    ? await sendSummary(request)
    : { ok: false, skipped: true, reason: "V2_SHADOW_ALERT_DELIVERY_DISABLED" };
  const deliveryOk = transportResult && transportResult.ok === true && transportResult.skipped !== true;
  const updatedOutbox = applyAlertDeliveryResult({
    outbox: persistedOutbox,
    deliveryOk,
    deliveryReason: trimOrNull(transportResult && (transportResult.reason || transportResult.policy_reason))
      || (deliveryOk ? null : "ALERT_DELIVERY_FAILED"),
    sentAt,
  });
  const normalizedOutbox = applyFailureTaxonomyToOutbox(updatedOutbox, deliveryOk);
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "TRADE_ALERT_OUTBOX",
    doc: normalizedOutbox,
    merge: false,
  });
  return Object.freeze({
    ok: deliveryOk,
    deliveryEnabled,
    request,
    transportResult,
    updatedOutbox: normalizedOutbox,
    persisted,
  });
}

async function retryStoredExitTransitionAlert({
  outbox,
  db = null,
  env = process.env,
  sendSummary = sendKoreanTelegramSummary,
  sentAt = null,
} = {}) {
  const storedOutbox = validateStoredOutboxForRetry(outbox);
  const request = Object.freeze({
    ...storedOutbox.delivery_request,
    title: trimOrNull(storedOutbox.delivery_request.title),
    provider: trimOrNull(storedOutbox.delivery_request.provider) || "BINANCEFUT",
    sections: Array.isArray(storedOutbox.delivery_request.sections)
      ? storedOutbox.delivery_request.sections.map((section) => ({
        header: trimOrNull(section && section.header),
        lines: Array.isArray(section && section.lines) ? section.lines.map((line) => String(line || "")) : [],
      }))
      : [],
  });
  const deliveryEnabled = parseBool(env && env.DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED, false);
  const transportResult = deliveryEnabled
    ? await sendSummary(request)
    : { ok: false, skipped: true, reason: "V2_SHADOW_ALERT_DELIVERY_DISABLED" };
  const deliveryOk = transportResult && transportResult.ok === true && transportResult.skipped !== true;
  const updatedOutbox = applyAlertDeliveryResult({
    outbox: storedOutbox,
    deliveryOk,
    deliveryReason: trimOrNull(transportResult && (transportResult.reason || transportResult.policy_reason))
      || (deliveryOk ? null : "ALERT_DELIVERY_FAILED"),
    sentAt,
  });
  const normalizedOutbox = applyFailureTaxonomyToOutbox(updatedOutbox, deliveryOk);
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "TRADE_ALERT_OUTBOX",
    doc: normalizedOutbox,
    merge: false,
  });
  return Object.freeze({
    ok: deliveryOk,
    deliveryEnabled,
    request,
    transportResult,
    updatedOutbox: normalizedOutbox,
    persisted,
  });
}

module.exports = {
  buildExitTransitionDeliveryRequest,
  buildPersistedPreparedAlertOutbox,
  deliverPreparedExitTransitionAlert,
  retryStoredExitTransitionAlert,
  __test: {
    trimOrNull,
    upper,
    parseBool,
    validatePreparedAlert,
    validateStoredOutboxForRetry,
    applyFailureTaxonomyToOutbox,
    resolveAlertSeverity,
    buildTelegramSectionsFromPayload,
  },
};
