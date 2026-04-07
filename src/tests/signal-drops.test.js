const assert = require("assert");

const { __test } = require("../storage/signalDrops");

function run() {
  const liveDrop = {
    signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG",
    execution_mode: "LIVE",
    features_json: {
      strategy_id: "donbeolja_v6.0.3.1",
    },
  };
  assert.strictEqual(__test.pickDropStrategyId(liveDrop), "donbeolja_v6.0.3.1");
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(liveDrop), true);

  const paperDrop = {
    signal_id: liveDrop.signal_id,
    execution_mode: "PAPER",
    features_json: {
      strategy_id: "donbeolja_v6.0.3.1",
    },
  };
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(paperDrop), false);

  const missingStrategy = {
    signal_id: liveDrop.signal_id,
    execution_mode: "LIVE",
    features_json: {},
  };
  assert.strictEqual(__test.pickDropStrategyId(missingStrategy), null);
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(missingStrategy), false);

  const topLevelStrategy = {
    signal_id: liveDrop.signal_id,
    execution_mode: "LIVE",
    strategy_id: "donbeolja_v6.0.3.1",
  };
  assert.strictEqual(__test.pickDropStrategyId(topLevelStrategy), "donbeolja_v6.0.3.1");
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(topLevelStrategy), true);

  assert.strictEqual(
    __test.deriveCanonicalEventId({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      tf: "15m",
      barCloseMs: 1774860300000,
      event: "LONG",
      side: "BUY",
    }),
    "EVENT__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG__BUY"
  );

  assert.strictEqual(
    __test.deriveEffectiveDropReason({
      resolvedReason: "LINEAGE_SLO_FILL_INTENT_NULL_RATE",
      liveExecPolicyTrace: {
        _live_exec_policy_lineage_has_entry_fill_intent_metric: false,
        _live_exec_policy_lineage_reason_suppressed: true,
        _live_exec_policy_action: "QUARANTINE",
        _live_exec_policy_quarantine_reason: "REVERSE_POLICY_PENALTY",
      },
    }),
    "LIVE_POLICY_QUARANTINE_HARD_BLOCK"
  );

  assert.strictEqual(
    __test.deriveEffectiveDropReason({
      resolvedReason: "LINEAGE_SLO_FILL_INTENT_NULL_RATE",
      liveExecPolicyTrace: {
        _live_exec_policy_lineage_has_entry_fill_intent_metric: false,
        _live_exec_policy_plan_mode: "WATCH_ONLY",
      },
    }),
    "LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK"
  );

  assert.strictEqual(
    __test.deriveEffectiveDropReason({
      resolvedReason: "LINEAGE_SLO_FILL_INTENT_NULL_RATE",
      liveExecPolicyTrace: {
        _live_exec_policy_lineage_has_entry_fill_intent_metric: true,
        _live_exec_policy_lineage_entry_fills_intent_id_null_rate: 0.2,
      },
    }),
    "LINEAGE_SLO_FILL_INTENT_NULL_RATE"
  );

  console.log("SIGNAL_DROPS_TEST_OK");
}

run();
