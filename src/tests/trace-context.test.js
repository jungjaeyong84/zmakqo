"use strict";

const assert = require("assert");
const { buildTraceId, buildOtelTraceContext, normalizeTraceContext } = require("../utils/traceContext");

function run() {
  const explicit = buildTraceId({
    traceId: "trace-123",
    exchange: "binancefut",
    symbol: "btcusdt",
    mutationKind: "position_upsert",
  });
  assert.strictEqual(explicit, "trace-123");

  const derivedA = buildTraceId({
    requestId: "REQ-1",
    runId: "RUN-1",
    exchange: "binancefut",
    symbol: "btcusdt",
    mutationKind: "position_upsert",
  });
  const derivedB = buildTraceId({
    requestId: "REQ-1",
    runId: "RUN-1",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    mutationKind: "POSITION_UPSERT",
  });
  assert.strictEqual(derivedA, derivedB);

  const trace = normalizeTraceContext({
    requestId: "REQ-2",
    runId: "RUN-2",
    exchange: "binancefut",
    symbol: "ethusdt",
    mutationKind: "position_meta_upsert",
    source: "tick_exit",
  });
  assert.strictEqual(trace.exchange, "BINANCEFUT");
  assert.strictEqual(trace.symbol, "ETHUSDT");
  assert.strictEqual(trace.mutation_kind, "POSITION_META_UPSERT");
  assert.strictEqual(trace.source, "TICK_EXIT");
  assert.ok(trace.trace_id);
  assert.ok(/^[0-9a-f]{32}$/.test(trace.otel_trace_id));
  assert.ok(/^[0-9a-f]{16}$/.test(trace.otel_span_id));
  assert.ok(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(trace.traceparent));

  const otel = buildOtelTraceContext({
    traceId: "abc123",
    requestId: "REQ-2",
    runId: "RUN-2",
    exchange: "binancefut",
    symbol: "ethusdt",
    mutationKind: "position_meta_upsert",
    source: "tick_exit",
  });
  assert.ok(otel.traceparent.includes(otel.otel_trace_id));

  console.log("TRACE_CONTEXT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRACE_CONTEXT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
