const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

(() => {
  const signalFeatures = {
    strategy_id: "donbeolja_v6.0.3.3",
    pine_stage1_bundle_version: "stage1-v1",
    core_score_abs: 34,
  };
  const localFeatures = { ...signalFeatures };
  const canonicalDetail = {
    canonical_engine_bundle_version: "bundle-v2",
    canonical_engine_threshold_bundle_version: "threshold-v2",
    canonical_engine_source_mode_effective: "PINE_PRIMARY",
    canonical_engine_execution_source_effective: "PINE_ALERT",
    canonical_engine_actual_source_decision: "PASS",
    canonical_engine_actual_source_pass: true,
    canonical_engine_decision_id: "dec-123",
    canonical_engine_policy_origin: "MARKET_OVERRIDE",
    pine_overlay_runtime_role: "PRIMARY_ALERT",
    pine_overlay_audit_only: false,
  };

  const mergedSignalFeatures = __test.mergeCanonicalDecisionDetail(signalFeatures, canonicalDetail);
  Object.assign(localFeatures, canonicalDetail);

  assert.strictEqual(mergedSignalFeatures.canonical_engine_bundle_version, "bundle-v2");
  assert.strictEqual(mergedSignalFeatures.canonical_engine_execution_source_effective, "PINE_ALERT");
  assert.strictEqual(mergedSignalFeatures.pine_overlay_runtime_role, "PRIMARY_ALERT");
  assert.strictEqual(localFeatures.canonical_engine_bundle_version, "bundle-v2");
  assert.strictEqual(localFeatures.canonical_engine_execution_source_effective, "PINE_ALERT");
  assert.strictEqual(localFeatures.pine_overlay_runtime_role, "PRIMARY_ALERT");
  assert.strictEqual(localFeatures.strategy_id, "donbeolja_v6.0.3.3");
})();

console.log("PAPER_UPBIT_RUNNER_CANONICAL_PROVENANCE_TEST_OK");
