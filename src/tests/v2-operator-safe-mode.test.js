"use strict";

const assert = require("assert");
const { ACTIONS, planOperatorSafeModeAction } = require("../v2/operatorSafeMode");

{
  const result = planOperatorSafeModeAction({
    action: ACTIONS.PAUSE_ENTRIES,
    confirm: "CONFIRM_PAUSE_ENTRIES",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.env_patch.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "0");
  assert.strictEqual(result.env_patch.ML_LIVE_SERVING_ARMED, "0");
  assert.strictEqual(result.apply_performed, false);
}

{
  const result = planOperatorSafeModeAction({
    action: ACTIONS.ARM_DISCOVERY_CANARY,
    options: { symbol: "ETHUSDT" },
    confirm: "CONFIRM_ARM_DISCOVERY_CANARY",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.env_patch.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "1");
  assert.strictEqual(result.env_patch.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "ETHUSDT");
}

{
  const result = planOperatorSafeModeAction({
    action: ACTIONS.ARM_DISCOVERY_CANARY,
    confirm: "CONFIRM_ARM_DISCOVERY_CANARY",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("OPERATOR_SAFE_MODE:DISCOVERY_SYMBOL_REQUIRED"));
}

{
  const result = planOperatorSafeModeAction({
    action: ACTIONS.ARM_DISCOVERY_CANARY,
    options: { symbol: "ETHUSDT'; rm -rf /" },
    confirm: "CONFIRM_ARM_DISCOVERY_CANARY",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("OPERATOR_SAFE_MODE:DISCOVERY_SYMBOL_INVALID"));
  assert.strictEqual(result.env_patch.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "");
}

{
  const result = planOperatorSafeModeAction({
    action: ACTIONS.PAUSE_ENTRIES,
    options: { service: "donbeolja;rm -rf /", region: "asia-northeast3 && whoami" },
    confirm: "CONFIRM_PAUSE_ENTRIES",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("OPERATOR_SAFE_MODE:SERVICE_INVALID"));
  assert.ok(result.blockers.includes("OPERATOR_SAFE_MODE:REGION_INVALID"));
  assert.ok(result.command_preview.includes("gcloud run services update donbeolja --region=asia-northeast3"));
}

console.log("V2_OPERATOR_SAFE_MODE_TEST_OK");
