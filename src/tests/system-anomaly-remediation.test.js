"use strict";

const assert = require("assert");
const { runSystemAnomalyRemediation, __test } = require("../services/systemAnomalyRemediation");

async function run() {
  assert.strictEqual(__test.isExposedPosition({ state: "ACTIVE", size_pct: 1 }), true);
  assert.strictEqual(__test.isExposedPosition({ state: "FLAT", size_pct: 0 }), false);
  assert.strictEqual(__test.sideFromPosition({ position_side: "LONG" }), "SELL");
  assert.strictEqual(__test.sideFromPosition({ position_side: "SHORT" }), "BUY");

  const skipped = await runSystemAnomalyRemediation({
    exchange: "BINANCEFUT",
    anomalyState: {
      status: "CLEAR",
      reason: "SYSTEM_ANOMALY_CLEAR",
      circuit_breaker_open: false,
    },
  });
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual(skipped.reason, "SYSTEM_ANOMALY_BREAKER_CLOSED");

  const calls = {
    canceled: [],
    intents: [],
    executor: [],
    syncs: [],
    leases: [],
  };
  const remediated = await runSystemAnomalyRemediation({
    exchange: "BINANCEFUT",
    anomalyState: {
      status: "BLOCK",
      reason: "ANOMALY_AUDIT_ISSUE_PRESENT",
      circuit_breaker_open: true,
      issues: ["ANOMALY_AUDIT_ISSUE_PRESENT"],
    },
    listPositions: async () => ([
      { exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", state: "ACTIVE", position_side: "LONG", size_pct: 1 },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", state: "FLAT", position_side: null, size_pct: 0 },
    ]),
    getExchangeSettings: async () => ({
      provider: "BINANCEFUT",
      tf_allowlist: ["15m"],
      exec_tf: "15m",
    }),
    getSystemSettings: async () => ({ data: { execution_mode: "LIVE" } }),
    fetchBars: async () => ([{ closeTimeUtcMs: 1712800000000, closeTimeUtc: "2025-04-11T00:00:00.000Z", open: 100 }]),
    cancelPending: async (payload) => {
      calls.canceled.push(payload);
      return { canceled: 2 };
    },
    createIntent: async (payload) => {
      calls.intents.push(payload);
      return { intent_id: "INTENT__BTCUSDT" };
    },
    runExecutor: async (payload) => {
      calls.executor.push(payload);
      return { ok: true, fills_executed: 1, intents_created: 0 };
    },
    syncPosition: async (payload) => {
      calls.syncs.push(payload);
      return { ok: true };
    },
    runLease: async ({ exchange, symbol, runner }) => {
      calls.leases.push({ exchange, symbol });
      return runner();
    },
    getRawPosition: async () => ({ state: "FLAT", size_pct: 0 }),
    getReadPosition: async () => ({ state: "FLAT", size_pct: 0 }),
    now: () => Date.parse("2026-04-11T01:23:45.000Z"),
  });

  assert.strictEqual(remediated.ok, true);
  assert.strictEqual(remediated.remediated_positions, 1);
  assert.strictEqual(remediated.rows.length, 1);
  assert.strictEqual(remediated.rows[0].intent_id, "INTENT__BTCUSDT");
  assert.strictEqual(calls.canceled.length, 1);
  assert.strictEqual(calls.canceled[0].reason, "SYSTEM_ANOMALY_FLATTEN");
  assert.strictEqual(calls.intents.length, 1);
  assert.strictEqual(calls.intents[0].event, "FORCE_EXIT_ALL");
  assert.strictEqual(calls.intents[0].side, "SELL");
  assert.strictEqual(calls.executor.length, 1);
  assert.strictEqual(calls.syncs.length, 1);
  assert.deepStrictEqual(calls.leases[0], { exchange: "BINANCEFUT", symbol: "BTCUSDT" });
}

run()
  .then(() => {
    console.log("SYSTEM_ANOMALY_REMEDIATION_TEST_OK");
  })
  .catch((err) => {
    console.error("SYSTEM_ANOMALY_REMEDIATION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
