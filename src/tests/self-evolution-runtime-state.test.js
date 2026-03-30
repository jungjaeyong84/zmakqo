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

  console.log("SELF_EVOLUTION_RUNTIME_STATE_TEST_OK");
})();
