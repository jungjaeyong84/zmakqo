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

function toFixedHex(value, length) {
  const text = String(value || "").trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (!text) return null;
  if (text.length === length) return text;
  if (text.length > length) return text.slice(0, length);
  return text.padStart(length, "0");
}

function buildHexDigest(seed, length) {
  return crypto.createHash("sha256").update(String(seed || "-"), "utf8").digest("hex").slice(0, length);
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

function buildOtelTraceContext({
  traceId = null,
  requestId = null,
  runId = null,
  exchange = null,
  symbol = null,
  mutationKind = null,
  source = null,
  spanName = null,
  traceFlags = "01",
} = {}) {
  const canonicalTraceId = buildTraceId({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind,
  });
  const otelTraceId = toFixedHex(canonicalTraceId, 32) || buildHexDigest(canonicalTraceId, 32);
  const spanSeed = [
    canonicalTraceId,
    cleanText(requestId),
    cleanText(runId),
    upper(exchange),
    upper(symbol),
    upper(mutationKind),
    upper(source),
    cleanText(spanName),
  ].map((value) => (value == null ? "-" : value)).join("|");
  const otelSpanId = buildHexDigest(spanSeed, 16);
  const flags = toFixedHex(traceFlags, 2) || "01";
  return {
    trace_id: canonicalTraceId,
    otel_trace_id: otelTraceId,
    otel_span_id: otelSpanId,
    traceparent: `00-${otelTraceId}-${otelSpanId}-${flags}`,
    span_name: cleanText(spanName) || upper(mutationKind) || "UNKNOWN_SPAN",
  };
}

function normalizeTraceContext({
  traceId = null,
  requestId = null,
  runId = null,
  exchange = null,
  symbol = null,
  mutationKind = null,
  source = null,
  spanName = null,
} = {}) {
  const otel = buildOtelTraceContext({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind,
    source,
    spanName,
  });
  return {
    trace_id: otel.trace_id,
    otel_trace_id: otel.otel_trace_id,
    otel_span_id: otel.otel_span_id,
    traceparent: otel.traceparent,
    span_name: otel.span_name,
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
  buildOtelTraceContext,
  normalizeTraceContext,
  __test: {
    cleanText,
    upper,
    toFixedHex,
    buildHexDigest,
  },
};
