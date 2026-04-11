"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function buildPositionWriterAuthorityEventId({
  exchange = null,
  symbol = null,
  mutationKind = null,
  code = null,
  traceId = null,
} = {}) {
  const seed = [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(mutationKind) || "POSITION_UPSERT",
    upper(code) || "UNKNOWN",
    String(traceId || "").trim() || crypto.randomBytes(8).toString("hex"),
  ].join("__");
  return `POSITION_WRITER_AUTHORITY__${seed}`;
}

async function recordPositionWriterAuthorityEvent({
  exchange = null,
  symbol = null,
  mutationKind = null,
  source = null,
  code = null,
  requestId = null,
  runId = null,
  traceId = null,
  error = null,
  expectedWriteToken = null,
  actualWriteToken = null,
  holder = null,
} = {}) {
  const db = getFirestore();
  const createdAt = new Date().toISOString();
  const doc = {
    position_writer_authority_event_id: buildPositionWriterAuthorityEventId({
      exchange,
      symbol,
      mutationKind,
      code,
      traceId,
    }),
    exchange: upper(exchange),
    symbol: upper(symbol),
    mutation_kind: upper(mutationKind) || "POSITION_UPSERT",
    source: upper(source),
    code: upper(code),
    request_id: String(requestId || "").trim() || null,
    run_id: String(runId || "").trim() || null,
    trace_id: String(traceId || "").trim() || null,
    error: String(error || "").trim() || null,
    expected_write_token: String(expectedWriteToken || "").trim() || null,
    actual_write_token: String(actualWriteToken || "").trim() || null,
    holder: String(holder || "").trim() || null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.collection("position_writer_authority_events").doc(doc.position_writer_authority_event_id).set(doc, { merge: false });
  return doc;
}

module.exports = {
  recordPositionWriterAuthorityEvent,
  __test: {
    buildPositionWriterAuthorityEventId,
  },
};
