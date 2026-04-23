"use strict";

const assert = require("assert");
const { resolveV2RuntimeConfig } = require("../v2/runtime");
const { buildShadowLiveComparisonReport, compareProposalPair } = require("../v2/shadowLiveComparison");

(function identicalProposalPairPasses() {
  const row = compareProposalPair({
    label: "BTC_PASS",
    shadowProposal: {
      symbol: "BTCUSDT",
      side: "LONG",
      timeframe: "15M",
      proposal_verdict: "PASS",
      strategy_filter_verdict: "PASS",
      quality_score: 0.81,
      rank_score: 0.72,
      size_ratio: 0.5,
    },
    liveProposal: {
      symbol: "BTCUSDT",
      side: "LONG",
      timeframe: "15M",
      proposal_verdict: "PASS",
      strategy_filter_verdict: "PASS",
      quality_score: 0.8,
      rank_score: 0.73,
      size_ratio: 0.5,
    },
    shadowDecision: { approved: true },
    liveDecision: { approved: true },
  });
  assert.strictEqual(row.pass, true);
  assert.deepStrictEqual(row.blocker_reasons, []);
})();

(function verdictMismatchBlocks() {
  const row = compareProposalPair({
    label: "ETH_BLOCK",
    shadowProposal: {
      symbol: "ETHUSDT",
      side: "SHORT",
      timeframe: "15M",
      proposal_verdict: "PASS",
      strategy_filter_verdict: "PASS",
      quality_score: 0.76,
      rank_score: 0.77,
      size_ratio: 0.5,
    },
    liveProposal: {
      symbol: "ETHUSDT",
      side: "SHORT",
      timeframe: "15M",
      proposal_verdict: "BLOCK",
      strategy_filter_verdict: "PASS",
      quality_score: 0.76,
      rank_score: 0.52,
      size_ratio: 0.2,
    },
  });
  assert.strictEqual(row.pass, false);
  assert.ok(row.blocker_reasons.includes("PROPOSAL_VERDICT_MISMATCH"));
})();

(function driftWarningUsesRuntimeThresholds() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildShadowLiveComparisonReport({
    thresholds: cfg.defaultComparisonThresholds,
    pairs: [{
      label: "SOL_WARN",
      shadowProposal: {
        symbol: "SOLUSDT",
        side: "LONG",
        timeframe: "15M",
        proposal_verdict: "PASS",
        strategy_filter_verdict: "PASS",
        quality_score: 0.9,
        rank_score: 0.85,
        size_ratio: 0.8,
      },
      liveProposal: {
        symbol: "SOLUSDT",
        side: "LONG",
        timeframe: "15M",
        proposal_verdict: "PASS",
        strategy_filter_verdict: "PASS",
        quality_score: 0.7,
        rank_score: 0.55,
        size_ratio: 0.45,
      },
      shadowDecision: { approved: true },
      liveDecision: { approved: true },
    }],
  });
  assert.strictEqual(report.pass, true);
  assert.ok(report.warnings.some((row) => row.includes("QUALITY_SCORE_DRIFT")));
  assert.ok(report.warnings.some((row) => row.includes("RANK_SCORE_DRIFT")));
  assert.ok(report.warnings.some((row) => row.includes("SIZE_RATIO_DRIFT")));
})();

console.log("V2_SHADOW_LIVE_COMPARISON_TEST_OK");
