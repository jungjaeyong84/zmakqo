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
  assert.strictEqual(__test.resolveSignalIdFromDrop(liveDrop), liveDrop.signal_id);

  const discoveryCanaryDrop = {
    ...liveDrop,
    features_json: {
      ...liveDrop.features_json,
      discovery_canary_bridge: true,
      v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
    },
  };
  assert.strictEqual(__test.isV2DiscoveryCanaryBridgePayload(discoveryCanaryDrop), true);
  assert.strictEqual(__test.shouldShadowSelfEvolutionCanaryFromDrop(discoveryCanaryDrop), true);
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(discoveryCanaryDrop), false);
  const canaryShadowDoc = __test.buildCanaryEvolutionShadowDoc({
    payload: discoveryCanaryDrop,
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    tf: "15m",
    createdAt: "2026-04-26T00:00:00.000Z",
  });
  assert.strictEqual(canaryShadowDoc.shadow_type, "V2_DISCOVERY_CANARY_SELF_EVOLUTION_SHADOW");
  assert.strictEqual(canaryShadowDoc.formal_self_evolution_confirmed, false);
  assert.strictEqual(canaryShadowDoc.bridge_discovery_canary_enabled, true);
  assert.strictEqual(canaryShadowDoc.signal_id, liveDrop.signal_id);

  assert.strictEqual(__test.resolveSignalIdFromDrop({
    features_json: {
      signal_id: "SIG__BINANCEFUT__SOLUSDT__15m__1777094100000__SHORT",
    },
  }), "SIG__BINANCEFUT__SOLUSDT__15m__1777094100000__SHORT");
  assert.strictEqual(__test.isSignalDropAlreadyHandled({ reason: "ALREADY_CONSUMED" }), true);
  assert.strictEqual(__test.isSignalDropAlreadyHandled({ reason: "LOCKED" }), true);
  assert.strictEqual(__test.isSignalDropAlreadyHandled({ reason: "NO_SIGNAL" }), false);

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
        _live_exec_policy_quarantine_reason: "REPEATED_TP1_FAIL_CLOSED_ESCALATED",
        _live_exec_policy_quarantine_source: "TP1_FAIL_CLOSED",
      },
    }),
    "TP1_FAIL_CLOSED_REPEAT_QUARANTINE"
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

  assert.deepStrictEqual(
    __test.resolveDropStageBucket({
      event_group: "unknown",
      features_json: {},
    }),
    { group: "UNKNOWN", subtype: null }
  );

  assert.deepStrictEqual(
    __test.resolveDropStageBucket({
      features_json: {
        event_group: "unknown",
        event_subtype: "gen",
      },
    }),
    { group: "UNKNOWN", subtype: "GEN" }
  );

  assert.deepStrictEqual(
    __test.inferDropStageBucketFromReason("MIN_ORDER_EXCEEDS_BUDGET"),
    { group: "ENTRY", subtype: "MIN_ORDER_BUDGET" }
  );

  assert.deepStrictEqual(
    __test.inferDropStageBucketFromReason("TP1_FAIL_CLOSED_REPEAT_QUARANTINE"),
    { group: "ENTRY", subtype: "TP1_FAIL_CLOSED_QUARANTINE" }
  );

  assert.deepStrictEqual(
    __test.resolveDropStageBucket({
      reason: "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK",
      features_json: {},
    }),
    { group: "ENTRY", subtype: "OPENCLAW_ALPHA_CONTEXT" }
  );

  assert.deepStrictEqual(
    __test.resolveDropStageBucket({
      reason: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE",
      features_json: {},
    }),
    { group: "ENTRY", subtype: "OPENCLAW_ALLOCATOR" }
  );

  assert.strictEqual(__test.deriveReasonFamily("MIN_ORDER_EXCEEDS_BUDGET"), "ENTRY_BUDGET_GUARD");
  assert.strictEqual(__test.deriveReasonFamily("TP1_FAIL_CLOSED_REPEAT_QUARANTINE"), "TP1_FAIL_CLOSED");
  assert.strictEqual(__test.deriveReasonFamily("OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE"), "OPENCLAW_EXECUTOR");
  assert.strictEqual(__test.deriveReasonFamily("LIVE_POLICY_QUARANTINE_HARD_BLOCK"), "LIVE_EXEC_POLICY");

  assert.deepStrictEqual(
    __test.extractOpenClawAuthorityTrace({
      _openclaw_authority_qty_requested: 0.5,
      _openclaw_authority_qty_after_openclaw: 0.375,
      _openclaw_authority_qty_final: 0.075,
      _openclaw_authority_entry_budget_guard_required_qty_pct: 0.1666666667,
      _openclaw_authority_entry_budget_guard_floor_applied: true,
      _openclaw_authority_entry_budget_guard_floor_qty_pct: 0.1666666667,
      _openclaw_authority_entry_budget_guard_floor_reason: "min_order_exceeds_budget",
    }),
    {
      qty_requested_pct: 0.5,
      qty_after_openclaw_pct: 0.375,
      qty_final_pct: 0.075,
      entry_budget_required_qty_pct: 0.1666666667,
      entry_budget_required_budget: null,
      entry_budget_min_required_quote: null,
      entry_budget_notional_quote: null,
      entry_budget_budget_max: null,
      entry_budget_leverage: null,
      entry_budget_shortfall_quote: null,
      entry_budget_floor_applied: true,
      entry_budget_floor_previous_qty_pct: null,
      entry_budget_floor_qty_pct: 0.1666666667,
      entry_budget_floor_max_snap_qty_pct: null,
      entry_budget_floor_reason: "MIN_ORDER_EXCEEDS_BUDGET",
    }
  );

  assert.deepStrictEqual(
    __test.buildDropAlertPayload({
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "ETHUSDT",
      tf: "15m",
      event: "SHORT",
      side: "SELL",
      qty_pct: 1,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      drop_reason_code: "MIN_ORDER_EXCEEDS_BUDGET",
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1776170700000__SHORT",
      execution_mode: "LIVE",
      source: "SERVER",
      event_group: "UNKNOWN",
      event_subtype: null,
      qty_requested_pct: null,
      qty_after_openclaw_pct: null,
      qty_final_pct: null,
      entry_budget_required_qty_pct: null,
      entry_budget_floor_applied: null,
      entry_budget_floor_qty_pct: null,
      features_json: {
        _openclaw_authority_qty_requested: 1,
        _openclaw_authority_qty_after_openclaw: 0.65,
        _openclaw_authority_qty_final: 0.13,
        _openclaw_authority_entry_budget_guard_required_qty_pct: 0.5,
      },
    }),
    {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      tf: "15m",
      event: "SHORT",
      side: "SELL",
      qtyPct: 1,
      qtyRequestedPct: 1,
      qtyAfterOpenclawPct: 0.65,
      qtyFinalPct: 0.13,
      requiredQtyPct: 0.5,
      floorApplied: false,
      floorQtyPct: null,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      dropReasonCode: "MIN_ORDER_EXCEEDS_BUDGET",
      signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1776170700000__SHORT",
      executionMode: "LIVE",
      source: "SERVER",
      authoritative: true,
      dropGroup: "UNKNOWN",
      dropSubtype: "MIN_ORDER_BUDGET",
    }
  );

  assert.deepStrictEqual(
    __test.buildDropAlertPayload({
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "XRPUSDT",
      tf: "15m",
      event: "LONG",
      side: "BUY",
      qty_pct: 1,
      reason: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE",
      drop_reason_code: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE",
      signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776158100000__LONG",
      execution_mode: "LIVE",
      source: "SERVER",
    }).dropSubtype,
    "OPENCLAW_ALLOCATOR"
  );

  console.log("SIGNAL_DROPS_TEST_OK");
}

run();
