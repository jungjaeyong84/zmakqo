"use strict";

const assert = require("assert");
const {
  STOP_DIVERGENCE_CODES,
  buildStopDivergenceItems,
  deriveExitIntegrityExposureGuard,
} = require("../utils/exitIntegrityPolicy");

(() => {
  assert.strictEqual(STOP_DIVERGENCE_CODES.has("RUNNER_MIN_GUARANTEE_MISSED"), true);
  const items = buildStopDivergenceItems([
    "runner_min_guarantee_missed",
    "NATIVE_STOP_MISMATCH",
    "RUNNER_MIN_GUARANTEE_MISSED",
  ]);
  assert.deepStrictEqual(
    items.map((item) => item.code),
    ["RUNNER_MIN_GUARANTEE_MISSED", "NATIVE_STOP_MISMATCH"]
  );
  assert.strictEqual(items[0].display, "RUNNER_MIN_GUARANTEE_MISSED · 최소 보장 수익 미준수");
})();

(() => {
  const blocked = deriveExitIntegrityExposureGuard({
    status: "WARN",
    stop_divergence_gate: "BLOCK",
    stop_divergence_symbol_n: 3,
    live_gate_blocked: false,
  }, { blockedScale: 0.5 });
  assert.strictEqual(blocked.active, true);
  assert.strictEqual(blocked.scale, 0.5);
  assert.strictEqual(blocked.reason, "LIVE_POLICY_EXIT_INTEGRITY_STOP_DIVERGENCE_SCALE");

  const pass = deriveExitIntegrityExposureGuard({
    status: "OK",
    stop_divergence_gate: "PASS",
    stop_divergence_symbol_n: 0,
    live_gate_blocked: false,
  }, { blockedScale: 0.5 });
  assert.strictEqual(pass.active, false);
  assert.strictEqual(pass.scale, 1);
})();

console.log("EXIT_INTEGRITY_POLICY_TEST_OK");
