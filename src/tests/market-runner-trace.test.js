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
      signals_external: 0,
      intents_created: 1,
      signal_drop_n: 0,
      signal_drop_reason_counts: {},
      top_signal_drop_reason: null,
    },
  });
  assert.strictEqual(created.status, "SERVER_SIGNAL_CREATED");
  assert.strictEqual(created.reason, "INTENT_CREATED");

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

  const noSignal = __test.summarizeServerSignalTrace({
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
      signals_external: 0,
      intents_created: 0,
      signal_drop_n: 2,
      signal_drop_reason_counts: { DROP_EV_GATE_TP1_PROB: 2 },
      top_signal_drop_reason: "DROP_EV_GATE_TP1_PROB",
    },
  });
  assert.strictEqual(noSignal.status, "NO_SERVER_SIGNAL");
  assert.strictEqual(noSignal.reason, "DROP_EV_GATE_TP1_PROB");

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
