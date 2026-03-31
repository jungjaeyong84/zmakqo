"use strict";

const assert = require("assert");
const {
  summarizeLegacyWaitBaseline,
  summarizeLegacyWaitOverlap,
  summarizeBridgeLatency,
  __test,
} = require("../utils/febtPhase0");

function run() {
  assert.strictEqual(__test.normalizeWaitAction("ALLOW"), "ALLOW");
  assert.strictEqual(__test.normalizeWaitAction("WAIT_ONE_BAR"), "WAIT_ONE_BAR");
  assert.strictEqual(__test.normalizeWaitTriggerPath("PHYSICS_ASSIST"), "PHYSICS_ASSIST");
  assert.strictEqual(__test.normalizeEntryExecTiming("immediate"), "IMMEDIATE");
  assert.strictEqual(__test.normalizeDirectionalEvent("CORE_LONG"), "LONG");
  assert.strictEqual(__test.normalizeDirectionalEvent("EARLY_SHORT"), "SHORT");

  const current = {
    signals_n: 4,
    quality: {
      chain_rows: [
        {
          legacy_wait_action: "ALLOW",
          legacy_wait_trigger_path: "BASE",
          market_state_summary_action: "ALLOW",
          market_state_summary_state: "ORDERED",
          entry_exec_timing: "IMMEDIATE",
          ev_gate_policy_source: "DEFAULT",
          tier: "CORE",
          side: "LONG",
          realized: true,
          realized_ret_net: 0.02,
        },
        {
          legacy_wait_action: "ALLOW",
          legacy_wait_trigger_path: "PHYSICS_ASSIST",
          market_state_summary_action: "REDUCE",
          market_state_summary_state: "MIXED",
          entry_exec_timing: "IMMEDIATE",
          ev_gate_policy_source: "ENV_OVERRIDE",
          tier: "EARLY",
          side: "LONG",
          realized: true,
          realized_ret_net: -0.01,
        },
        {
          legacy_wait_action: "SKIP",
          legacy_wait_trigger_path: "UNKNOWN",
          market_state_summary_action: "DROP",
          market_state_summary_state: "CRITICAL",
          entry_exec_timing: "UNKNOWN",
          ev_gate_policy_source: "DEFAULT",
          tier: "CORE",
          side: "SHORT",
          realized: false,
        },
      ],
    },
    drop_counterfactual: {
      by_stage: {
        TIMING: {
          matured_n: 2,
          tp1_first_rate: 0.25,
          sl_first_rate: 0.50,
          avg_horizon_ret_net: -0.015,
        },
      },
    },
  };

  const drops = [
    {
      signal_id: "SIG_DROP_1",
      drop_reason_code: "DROP_WAIT_ONE_BAR_TIMING",
      features_json: {
        wait_one_bar_action: "WAIT_ONE_BAR",
        wait_one_bar_trigger_path: "PHYSICS_HARD",
        market_state_summary_action: "DROP",
        market_state_summary_state: "CRITICAL",
        ev_gate_policy_source: "DEFAULT",
      },
      entry_grade: "CORE",
      side: "BUY",
    },
  ];

  const baseline = summarizeLegacyWaitBaseline({ current, drops });
  assert.strictEqual(baseline.candidate_signals_n, 4);
  assert.strictEqual(baseline.executed_entry_chains_n, 3);
  assert.strictEqual(baseline.wait_allow_chain_n, 2);
  assert.strictEqual(baseline.wait_skip_chain_n, 1);
  assert.strictEqual(baseline.immediate_realized_n, 2);
  assert.strictEqual(Number(baseline.immediate_win_rate.toFixed(4)), 0.5000);
  assert.strictEqual(baseline.timing_drop_signal_n, 1);
  assert.strictEqual(baseline.timing_drop_counterfactual_matured_n, 2);
  assert.strictEqual(Number(baseline.saved_loss_minus_missed_gain.toFixed(4)), 0.2500);
  assert.strictEqual(baseline.wait_trigger_path_breakdown[0].value, "PHYSICS_HARD");

  const overlap = summarizeLegacyWaitOverlap({ current, drops });
  assert.strictEqual(overlap.compared_n, 4);
  assert.strictEqual(overlap.wait_action_breakdown[0].value, "ALLOW");
  assert.ok(overlap.market_state_action_pairs.some((row) => row.wait_action === "WAIT_ONE_BAR" && row.value === "DROP"));
  assert.ok(overlap.entry_exec_timing_pairs.some((row) => row.value === "IMMEDIATE"));

  const webhooks = [
    {
      stage: "INGRESS",
      request_id: "REQ1",
      exchange: "BINANCEFUT",
      tf: "15m",
      symbol: "BTCUSDT",
      created_at: "2026-03-29T00:00:01.100Z",
    },
    {
      stage: "OUTCOME",
      request_id: "REQ1",
      signal_id: "SIG1",
      exchange: "BINANCEFUT",
      tf: "15m",
      symbol: "BTCUSDT",
      event: "CORE_LONG",
      bar_close_time_utc_ms: Date.parse("2026-03-29T00:00:01.000Z"),
      created_at: "2026-03-29T00:00:01.200Z",
    },
  ];
  const intents = [
    {
      signal_id: "SIG1",
      exchange: "BINANCEFUT",
      tf: "15m",
      symbol_or_pair_id: "BTCUSDT",
      event: "CORE_LONG",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-29T00:00:01.000Z"),
      intent_id: "INTENT1",
      status: "PLACED",
      created_at: "2026-03-29T00:00:01.300Z",
    },
  ];
  const fills = [
    {
      signal_id: "SIG1",
      exchange: "BINANCEFUT",
      tf: "15m",
      intent_id: "INTENT1",
      symbol: "BTCUSDT",
      entry_signal_type: "CORE_LONG",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-29T00:00:01.000Z"),
      created_at: "2026-03-29T00:00:01.500Z",
    },
  ];
  const latency = summarizeBridgeLatency({
    webhooks,
    intents,
    fills,
    provider: "BINANCEFUT",
    tf: "15m",
  });
  assert.strictEqual(latency.outcome_n, 1);
  assert.strictEqual(latency.matched_intent_n, 1);
  assert.strictEqual(latency.matched_fill_n, 1);
  assert.strictEqual(Number(latency.bar_close_to_webhook_ms_proxy.avg.toFixed(0)), 100);
  assert.strictEqual(Number(latency.webhook_to_intent_ms.avg.toFixed(0)), 100);
  assert.strictEqual(Number(latency.intent_to_fill_ms.avg.toFixed(0)), 200);
  assert.strictEqual(Number(latency.webhook_to_fill_ms.avg.toFixed(0)), 300);
  assert.strictEqual(latency.duplicate_count, 0);
  assert.strictEqual(latency.reject_count, 0);

  const liveWebhooks = [
    {
      stage: "OUTCOME",
      signal_id: "SIG__BINANCEFUT__DOGEUSDT__15m__1774912500000__SHORT",
      exchange: "BINANCEFUT",
      tf: "15m",
      event: "SHORT",
      symbol: "DOGEUSDT",
      bar_close_time_utc_ms: 1774912500000,
      created_at: "2026-03-30T23:15:08.414Z",
    },
  ];
  const liveIntents = [
    {
      intent_id: "INTENT__BINANCEFUT__DOGEUSDT__15m__1774912500000__SHORT",
      exchange: "BINANCEFUT",
      tf: "15m",
      event: "SHORT",
      symbol_or_pair_id: "DOGEUSDT",
      signal_bar_close_time_utc_ms: 1774912500000,
      created_at: "2026-03-30T23:15:09.414Z",
      status: "FILLED",
    },
  ];
  const liveFills = [
    {
      signal_id: "DOGEUSDT.P|15|SHORT|1774912500000|-1|ENTRY|BAR_CLOSE",
      intent_id: "INTENT__BINANCEFUT__DOGEUSDT__15m__1774912500000__SHORT",
      exchange: "BINANCEFUT",
      tf: "15m",
      event: "SHORT",
      symbol: "DOGEUSDT",
      exec_bar_close_time_utc_ms: 1774912500000,
      created_at: "2026-03-30T23:15:28.158Z",
      entry_signal_type: "SHORT",
    },
  ];
  const liveLatency = summarizeBridgeLatency({
    webhooks: liveWebhooks,
    intents: liveIntents,
    fills: liveFills,
    provider: "BINANCEFUT",
    tf: "15m",
  });
  assert.strictEqual(liveLatency.outcome_n, 1);
  assert.strictEqual(liveLatency.matched_intent_n, 1);
  assert.strictEqual(liveLatency.matched_fill_n, 1);

  console.log("FEBT_PHASE0_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FEBT_PHASE0_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
