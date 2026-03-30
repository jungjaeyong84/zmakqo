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
  });
  assert.strictEqual(normalizedPending.live_signal_confirmation_pending, true);

  const normalizedConfirmed = __test.normalizeSelfEvolutionRuntimeState({
    acknowledged: true,
    applied_strategy_id: "donbeolja_v6.0.3.1",
    live_signal_confirmed: true,
    confirmed_signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG",
  });
  assert.strictEqual(normalizedConfirmed.live_signal_confirmation_pending, false);
  assert.strictEqual(normalizedConfirmed.confirmed_signal_id, "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG");

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

  console.log("SELF_EVOLUTION_RUNTIME_STATE_TEST_OK");
})();
