"use strict";

const assert = require("assert");

const { __test } = require("../../src/utils/selfEvolutionRuntimeState");

(() => {
  const merged = __test.mergeSelfEvolutionRuntimeStateRaw(
    { acknowledged: true, applied_strategy_id: "donbeolja_v6.0.3.0" },
    { applied_strategy_id: "donbeolja_v6.0.3.1", live_signal_confirmed: false }
  );
  assert.strictEqual(merged.acknowledged, true);
  assert.strictEqual(merged.applied_strategy_id, "donbeolja_v6.0.3.1");
  assert.strictEqual(merged.live_signal_confirmed, false);

  const normalizedPending = __test.normalizeSelfEvolutionRuntimeState({
    acknowledged: true,
    applied_strategy_id: "donbeolja_v6.0.3.1",
    live_signal_confirmed: false,
    prepared_stage_ready: true,
    ready_for_manual_paste: true,
    prepared_strategy_id: "donbeolja_v6.0.3.2",
  });
  assert.strictEqual(normalizedPending.live_signal_confirmation_pending, true);
  assert.strictEqual(normalizedPending.prepared_stage_ready, true);
  assert.strictEqual(normalizedPending.prepared_strategy_id, "donbeolja_v6.0.3.2");
  assert.strictEqual(normalizedPending.plan_status, "APPLIED_PENDING_BUNDLE_ACTIVATION");

  const normalizedConfirmed = __test.normalizeSelfEvolutionRuntimeState({
    acknowledged: true,
    applied_strategy_id: "donbeolja_v6.0.3.1",
    live_signal_confirmed: true,
    confirmed_signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG",
    authority_bypass_active: true,
  });
  assert.strictEqual(normalizedConfirmed.live_signal_confirmation_pending, false);
  assert.strictEqual(normalizedConfirmed.confirmed_signal_id, "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG");
  assert.strictEqual(normalizedConfirmed.plan_status, "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY");

  const derivedPendingBypass = __test.deriveRuntimePlanStatus({
    acknowledged: true,
    liveSignalConfirmed: false,
    authorityBypassActive: true,
  });
  assert.strictEqual(derivedPendingBypass, "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY");

  const preAckMatch = __test.assessSelfEvolutionRuntimeSignalConfirmation(
    {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-30T08:48:07.723Z",
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    {
      strategyId: "donbeolja_v6.0.3.1",
      createdAt: "2026-03-30T08:45:11.125Z",
    }
  );
  assert.strictEqual(preAckMatch.ok, true);
  assert.strictEqual(preAckMatch.reason, "MATCHED_STRATEGY_PRE_ACK");

  const wrongStrategy = __test.assessSelfEvolutionRuntimeSignalConfirmation(
    {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-30T08:48:07.723Z",
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    {
      strategyId: "donbeolja_v6.0.3.0",
      createdAt: "2026-03-30T08:49:11.125Z",
    }
  );
  assert.strictEqual(wrongStrategy.ok, false);
  assert.strictEqual(wrongStrategy.reason, "STRATEGY_ID_NOT_APPLIED");

  const preparedStrategy = __test.assessSelfEvolutionRuntimeSignalConfirmation(
    {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-30T08:48:07.723Z",
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    {
      strategyId: "donbeolja_v6.0.3.2",
      createdAt: "2026-03-30T11:45:11.125Z",
      preparedRuntime: {
        target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        prepared_file_path: "/tmp/donbeolja_v6.0.3.2.pine.txt",
        prepared_strategy_id: "donbeolja_v6.0.3.2",
      },
    }
  );
  assert.strictEqual(preparedStrategy.ok, true);
  assert.strictEqual(preparedStrategy.reason, "MATCHED_PREPARED_STRATEGY");

  const preparedPatch = __test.buildPreparedRuntimePatch({
    prepared_stage_ready: true,
    ready_for_manual_paste: true,
    plan_status: "READY_FOR_MANUAL_PASTE",
    prepared_strategy_id: "donbeolja_v6.0.3.2",
    prepared_file_path: "/tmp/donbeolja_v6.0.3.2.pine.txt",
    latest_generated_file_path: "/tmp/donbeolja_latest_generated.pine.txt",
    target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
    prepared_origin_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
    recommended_target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
  });
  assert.strictEqual(preparedPatch.prepared_strategy_id, "donbeolja_v6.0.3.2");
  assert.strictEqual(preparedPatch.ready_for_manual_paste, true);
  assert.strictEqual(preparedPatch.target_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(preparedPatch.recommended_target_candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");

  const preparedPatchReset = __test.buildPreparedRuntimePatch({
    prepared_stage_ready: true,
    ready_for_manual_paste: true,
    plan_status: "READY_FOR_MANUAL_PASTE",
    prepared_strategy_id: "donbeolja_v6.0.3.3",
    prepared_file_path: "/tmp/donbeolja_v6.0.3.3.pine.txt",
  }, {
    acknowledged: true,
    applied_strategy_id: "donbeolja_v6.0.3.2",
    confirmed_strategy_id: "donbeolja_v6.0.3.2",
    live_signal_confirmed: true,
    confirmed_signal_id: "SIG__OLD",
  });
  assert.strictEqual(preparedPatchReset.acknowledged, false);
  assert.strictEqual(preparedPatchReset.live_signal_confirmed, false);
  assert.strictEqual(preparedPatchReset.confirmed_signal_id, null);
  assert.strictEqual(preparedPatchReset.confirmed_strategy_id, null);

  const clearedPreparedPatch = __test.buildPreparedRuntimePatch({
    prepared_stage_ready: false,
    ready_for_manual_paste: false,
    plan_status: "IDLE",
  });
  assert.strictEqual(clearedPreparedPatch.prepared_strategy_id, null);
  assert.strictEqual(clearedPreparedPatch.ready_for_manual_paste, false);

  console.log("SELF_EVOLUTION_RUNTIME_STATE_TEST_OK");
})();
