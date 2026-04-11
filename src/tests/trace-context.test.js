"use strict";

const assert = require("assert");
const { buildTraceId, normalizeTraceContext } = require("../utils/traceContext");

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

  console.log("TRACE_CONTEXT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRACE_CONTEXT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
