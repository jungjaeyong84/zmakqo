"use strict";

const assert = require("assert");
const { resolveV2RuntimeConfig } = require("../v2/runtime");
const { compareSourceModePair, buildSourceModeComparisonReport } = require("../v2/sourceModeComparison");
const { buildWebhookBundle, buildNativeBundle } = require("../v2/comparisonFixtureFactory");

(function alignedWebhookAndNativePass() {
  const row = compareSourceModePair({
    label: "BTC_ALIGN",
    webhookBundle: buildWebhookBundle(),
    nativeBundle: buildNativeBundle(),
  });
  assert.strictEqual(row.pass, true);
  assert.deepStrictEqual(row.blocker_reasons, []);
  assert.strictEqual(row.native_proposal.proposal_verdict, "PASS");
})();

(function decisionMismatchBlocks() {
  const row = compareSourceModePair({
    label: "BTC_DECISION_MISMATCH",
    webhookBundle: buildWebhookBundle(),
    nativeBundle: buildNativeBundle({
      recommendedAction: "BLOCK_ENTRY",
      approved: false,
      decisionSummary: "native blocked",
      proposalVerdict: "BLOCK",
    }),
  });
  assert.strictEqual(row.pass, false);
  assert.ok(row.blocker_reasons.includes("RECOMMENDED_ACTION_MISMATCH"));
  assert.ok(row.blocker_reasons.includes("DECISION_APPROVAL_MISMATCH"));
})();

(function qualityDriftWarnsWithoutBlocking() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildSourceModeComparisonReport({
    thresholds: cfg.defaultComparisonThresholds,
    pairs: [{
      label: "BTC_DRIFT",
      webhookBundle: buildWebhookBundle(),
      nativeBundle: buildNativeBundle({
        qualityScore: 0.92,
      }),
    }],
  });
  assert.strictEqual(report.pass, true);
  assert.ok(report.warnings.some((row) => row.includes("QUALITY_SCORE_DRIFT")));
})();

console.log("V2_SOURCE_MODE_COMPARISON_TEST_OK");
