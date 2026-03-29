"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-ev-gate-impact");

function run() {
  assert.strictEqual(typeof __test.hasEvGateObservation, "function", "hasEvGateObservation export missing");
  assert.strictEqual(typeof __test.isEvGateSkipped, "function", "isEvGateSkipped export missing");
  assert.strictEqual(typeof __test.uniqueEntryCount, "function", "uniqueEntryCount export missing");
  assert.strictEqual(typeof __test.buildEvGateBreakdowns, "function", "buildEvGateBreakdowns export missing");
  assert.strictEqual(typeof __test.buildRecentEvGateExamples, "function", "buildRecentEvGateExamples export missing");
  assert.strictEqual(typeof __test.buildObservationSourceSummary, "function", "buildObservationSourceSummary export missing");
  assert.strictEqual(typeof __test.resolveObservationMs, "function", "resolveObservationMs export missing");

  const allowRow = {
    signal_id: "SIG1",
    features_json: {
      ev_gate_enabled: true,
      ev_gate_action: "ALLOW",
      ev_gate_tp1_reach_prob: 0.67,
    },
  };
  const skipRow = {
    signal_id: "SIG2",
    features_json: {
      ev_gate_enabled: true,
      ev_gate_skipped: true,
      ev_gate_skip_reason: "INSUFFICIENT_BARS",
    },
  };
  const dropRow = {
    signal_id: "SIG3",
    drop_reason_code: "DROP_EV_GATE_TP1_PROB",
  };

  assert.strictEqual(__test.hasEvGateObservation(allowRow), true);
  assert.strictEqual(__test.hasEvGateObservation(skipRow), true);
  assert.strictEqual(__test.hasEvGateObservation(dropRow), true);
  assert.strictEqual(__test.isEvGateSkipped(skipRow), true);
  assert.strictEqual(__test.uniqueEntryCount([allowRow, allowRow, dropRow]), 2);

  const diagnosticsRows = [
    {
      event: "CORE_LONG",
      side: "BUY",
      execution_mode: "PAPER",
      exec_bar_close_time_utc_ms: 1000,
      observation_source: "FILL",
      features_json: {
        signal_id: "SIG_FILL_1",
        ev_gate_plan_source: "EXIT_RULES",
        ev_gate_exit_profile: "TREND",
        ev_gate_policy_version: "TP1_WEIGHT_V1",
        ev_gate_policy_source: "DEFAULT",
        market_state_summary_state: "MIXED",
        market_state_summary_action: "REDUCE",
      },
    },
  ];
  const breakdowns = __test.buildEvGateBreakdowns(diagnosticsRows);
  assert.strictEqual(breakdowns.by_observation_source[0].key, "FILL");
  assert.strictEqual(breakdowns.by_policy_version[0].key, "TP1_WEIGHT_V1");
  assert.strictEqual(breakdowns.by_policy_source[0].key, "DEFAULT");
  assert.strictEqual(breakdowns.by_market_state[0].key, "MIXED");
  assert.strictEqual(breakdowns.by_market_action[0].key, "REDUCE");

  const examples = __test.buildRecentEvGateExamples(diagnosticsRows);
  assert.strictEqual(__test.resolveObservationMs(diagnosticsRows[0]), 1000);
  assert.strictEqual(__test.uniqueEntryCount(diagnosticsRows), 1);
  assert.strictEqual(examples[0].policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(examples[0].policy_source, "DEFAULT");
  assert.strictEqual(examples[0].market_state, "MIXED");
  assert.strictEqual(examples[0].market_action, "REDUCE");
  assert.strictEqual(examples[0].observation_source, "FILL");

  const sourceSummary = __test.buildObservationSourceSummary({
    signals: [{ signal_id: "SIG_A" }],
    intents: [{ signal_id: "SIG_B" }],
    drops: [{ signal_id: "SIG_C" }],
    fills: diagnosticsRows,
    trades: [{ features_json: { signal_id: "SIG_TRADE_1" }, exec_bar_close_time_utc_ms: 1200, event: "CORE_LONG", side: "BUY" }],
  });
  assert.deepStrictEqual(sourceSummary, {
    signals: 1,
    intents: 1,
    drops: 1,
    fills: 1,
    trades: 1,
  });
}

try {
  run();
  console.log("EV_GATE_IMPACT_REPORT_TEST_OK");
} catch (err) {
  console.error("EV_GATE_IMPACT_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
