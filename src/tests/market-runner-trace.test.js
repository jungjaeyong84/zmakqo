"use strict";

const assert = require("assert");
const { __test } = require("../scheduler/marketRunner");

(() => {
  const created = __test.summarizeServerSignalTrace({
    exchange: "BINANCEFUT",
    market: "ETHUSDT",
    signalTf: "15m",
    execTf: "15m",
    barCloseMs: 1775053800000,
    barCloseUtc: "2026-04-01T14:30:00Z",
    newBar: true,
    actorAllowed: true,
    executionEnabled: true,
    gate: { status: "PASS", reasonCodes: [] },
    paper: {
      signals_seen: 1,
      signals_internal: 1,
      signals_seen_total: 2,
      signals_internal_total: 2,
      signals_external: 0,
      intents_created: 1,
      direct_handoff_generated_n: 1,
      direct_handoff_executed_n: 1,
      direct_handoff_blocked_n: 0,
      signal_drop_n: 0,
      signal_drop_reason_counts: {},
      top_signal_drop_reason: null,
    },
  });
  assert.strictEqual(created.status, "SERVER_SIGNAL_CREATED");
  assert.strictEqual(created.reason, "INTENT_CREATED");
  assert.strictEqual(created.signals_seen_total, 2);
  assert.strictEqual(created.direct_handoff_generated_n, 1);

  const blocked = __test.summarizeServerSignalTrace({
    exchange: "BINANCEFUT",
    market: "ETHUSDT",
    signalTf: "15m",
    execTf: "15m",
    newBar: true,
    actorAllowed: false,
    executionEnabled: true,
    gate: { status: "FAIL", reasonCodes: ["RATE_LIMIT_OR_FETCH_FAIL"] },
    paper: null,
  });
  assert.strictEqual(blocked.status, "BLOCKED");
  assert.strictEqual(blocked.reason, "RATE_LIMIT_OR_FETCH_FAIL");

  const blockedDirectHandoff = __test.summarizeServerSignalTrace({
    exchange: "BINANCEFUT",
    market: "AXSUSDT",
    signalTf: "15m",
    execTf: "15m",
    newBar: true,
    actorAllowed: true,
    executionEnabled: true,
    gate: { status: "PASS", reasonCodes: [] },
    paper: {
      signals_seen: 0,
      signals_internal: 0,
      signals_seen_total: 1,
      signals_internal_total: 1,
      signals_external: 0,
      intents_created: 0,
      direct_handoff_generated_n: 1,
      direct_handoff_executed_n: 0,
      direct_handoff_blocked_n: 1,
      signal_drop_n: 2,
      signal_drop_reason_counts: { DROP_EV_GATE_TP1_PROB: 2, SIGNAL_CRITERIA_BLOCKED: 1 },
      top_signal_drop_reason: "DROP_EV_GATE_TP1_PROB",
    },
  });
  assert.strictEqual(blockedDirectHandoff.status, "SERVER_SIGNAL_CREATED");
  assert.strictEqual(blockedDirectHandoff.reason, "DROP_EV_GATE_TP1_PROB");

  const replayed = __test.summarizeServerSignalTrace({
    exchange: "BINANCEFUT",
    market: "BNBUSDT",
    signalTf: "15m",
    execTf: "15m",
    newBar: false,
    actorAllowed: true,
    executionEnabled: true,
    gate: { status: "PASS", reasonCodes: [] },
    paper: {
      signals_seen: 0,
      signals_internal: 0,
      signals_external: 0,
      intents_created: 0,
      signal_drop_n: 0,
      signal_drop_reason_counts: {},
      top_signal_drop_reason: null,
    },
  });
  assert.strictEqual(replayed.status, "NO_SERVER_SIGNAL");
  assert.strictEqual(replayed.reason, "NO_SIGNAL_GENERATED");

  console.log("MARKET_RUNNER_TRACE_TEST_OK");
})();
