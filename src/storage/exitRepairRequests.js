"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function nowIso() {
  return new Date().toISOString();
}

function buildExitRepairRequestId({
  exchange = null,
  symbol = null,
  source = null,
  requestKind = null,
  traceId = null,
  dedupeKey = null,
} = {}) {
  const stable = String(dedupeKey || "").trim();
  const seed = stable || [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(source) || "UNKNOWN_SOURCE",
    upper(requestKind) || "UNKNOWN_REQUEST",
    String(traceId || "").trim() || crypto.randomBytes(8).toString("hex"),
  ].join("__");
  return `EXIT_REPAIR_REQUEST__${seed}`;
}

async function recordExitRepairRequest({
  exchange = null,
  symbol = null,
  source = null,
  requestKind = null,
  reason = null,
  runId = null,
  traceId = null,
  dedupeKey = null,
  payload = null,
} = {}) {
  const createdAt = nowIso();
  const doc = {
    exit_repair_request_id: buildExitRepairRequestId({
      exchange,
      symbol,
      source,
      requestKind,
      traceId,
      dedupeKey,
    }),
    exchange: upper(exchange),
    symbol: upper(symbol),
    source: upper(source),
    request_kind: upper(requestKind),
    reason: String(reason || "").trim() || null,
    run_id: String(runId || "").trim() || null,
    trace_id: String(traceId || "").trim() || null,
    created_at: createdAt,
    updated_at: createdAt,
    payload: payload && typeof payload === "object" ? JSON.parse(JSON.stringify(payload)) : null,
  };
  const db = getFirestore();
  await db.collection("exit_repair_requests").doc(doc.exit_repair_request_id).set(doc, { merge: true });
  await recordUnifiedEvent({
    eventKind: "EXIT_REPAIR_REQUEST",
    eventSource: upper(source) || "EXIT_REPAIR_REQUEST",
    exchange,
    symbol,
    event: upper(requestKind) || "UNKNOWN_REQUEST",
    traceId,
    runId,
    sourceDocumentId: doc.exit_repair_request_id,
    createdAt,
    payload: doc,
  }).catch(() => null);
  return doc;
}

module.exports = {
  recordExitRepairRequest,
  __test: {
    buildExitRepairRequestId,
  },
};
