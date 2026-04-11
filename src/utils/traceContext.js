"use strict";

const crypto = require("crypto");

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  const text = cleanText(value);
  return text ? text.toUpperCase() : null;
}

function buildTraceId({
  traceId = null,
  requestId = null,
  runId = null,
  exchange = null,
  symbol = null,
  mutationKind = null,
} = {}) {
  const explicit = cleanText(traceId);
  if (explicit) return explicit;
  const base = [
    cleanText(requestId),
    cleanText(runId),
    upper(exchange),
    upper(symbol),
    upper(mutationKind),
  ].map((value) => (value == null ? "-" : String(value))).join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

function normalizeTraceContext({
  traceId = null,
  requestId = null,
  runId = null,
  exchange = null,
  symbol = null,
  mutationKind = null,
  source = null,
} = {}) {
  return {
    trace_id: buildTraceId({ traceId, requestId, runId, exchange, symbol, mutationKind }),
    request_id: cleanText(requestId),
    run_id: cleanText(runId),
    exchange: upper(exchange),
    symbol: upper(symbol),
    mutation_kind: upper(mutationKind),
    source: upper(source),
  };
}

module.exports = {
  buildTraceId,
  normalizeTraceContext,
  __test: {
    cleanText,
    upper,
  },
};
