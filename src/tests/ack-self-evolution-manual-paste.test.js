"use strict";

const assert = require("assert");

const { __test } = require("../../scripts/ack-self-evolution-manual-paste");

(() => {
  assert.strictEqual(
    __test.parseStrategyId('/definitely/missing/file.txt'),
    null
  );

  const envText = "DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1\nWEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0\n";
  assert.strictEqual(
    __test.parseEnvLine(envText, "WEBHOOK_ALLOWED_STRATEGY_IDS"),
    "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0"
  );

  const carryforward = __test.buildRuntimeCarryforward(
    {
      plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY",
      engine_bundle_loaded: true,
      policy_bundle_loaded: true,
      market_data_flow_ok: true,
      probe_pass: true,
      probe_status: "PASS",
      probe_reason: "PROBE_PASS",
      activation_confirmed: true,
      activation_status: "ACTIVE",
      activation_reason: "ACTIVE_BY_PROBE",
    },
    {
      first_decision_seen: false,
      live_signal_confirmed: false,
      authority_bypass_active: true,
    }
  );
  assert.strictEqual(carryforward.plan_status, "APPLIED_ACTIVE_PENDING_AUTHORITY");
  assert.strictEqual(carryforward.engine_bundle_loaded, true);
  assert.strictEqual(carryforward.policy_bundle_loaded, true);
  assert.strictEqual(carryforward.market_data_flow_ok, true);
  assert.strictEqual(carryforward.probe_pass, true);
  assert.strictEqual(carryforward.bundle_activation_confirmed, true);
  assert.strictEqual(carryforward.bundle_activation_status, "ACTIVE");
  assert.strictEqual(carryforward.bundle_activation_reason, "ACTIVE_BY_PROBE");

  console.log("ACK_SELF_EVOLUTION_MANUAL_PASTE_TEST_OK");
})();
