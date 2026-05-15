"use strict";

const assert = require("assert");
const { __test } = require("../services/mlOpsPipeline");

function run() {
  const markets = __test.parseMarkets("btcusdt, ethusdt", "BINANCEFUT");
  assert.deepStrictEqual(markets, ["BTCUSDT", "ETHUSDT"]);
  const pipeMarkets = __test.parseMarkets("solusdt|xrpusdt", "BINANCEFUT");
  assert.deepStrictEqual(pipeMarkets, ["SOLUSDT", "XRPUSDT"]);

  const featureSummary = __test.summarizeFeatureLabelDataset({
    rows: [
      { market: "BTCUSDT" },
      { market: "ETHUSDT" },
      { market: "BTCUSDT" },
    ],
  });
  assert.strictEqual(featureSummary.rows_n, 3);
  assert.strictEqual(featureSummary.top_markets[0].market, "BTCUSDT");
  assert.strictEqual(featureSummary.top_markets[0].rows_n, 2);

  const shadowSummary = __test.summarizeShadowEvaluations([
    { event: "CORE_LONG", model_key: "LIVE_ENTRY_POLICY_SHADOW_V1", symbol: "BTCUSDT", baseline_decision: { ok: true, reason: "ALLOW" } },
    { event: "CORE_LONG", model_key: "LIVE_ENTRY_POLICY_SHADOW_V1", symbol: "BTCUSDT", baseline_decision: { ok: false, reason: "BLOCK" } },
    { event: "CORE_SHORT", model_key: "LIVE_ENTRY_POLICY_SHADOW_V1", symbol: "ETHUSDT", baseline_decision: { ok: false, reason: "BLOCK" } },
  ]);
  assert.strictEqual(shadowSummary.rows_n, 3);
  assert.strictEqual(shadowSummary.allow_n, 1);
  assert.strictEqual(shadowSummary.block_n, 2);
  assert.strictEqual(shadowSummary.by_reason[0].key, "BLOCK");
  assert.ok(__test.renderFeatureLabelDatasetMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", tf: "15m", markets_n: 2, summary: featureSummary, window: { from_ms: 1, to_ms: 2 } }).includes("Feature Label Dataset"));
  assert.ok(__test.renderShadowSummaryMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", summary: shadowSummary }).includes("Shadow Evaluation Summary"));
  const canarySummary = __test.summarizeShadowInferenceCanary([
    {
      symbol: "BTCUSDT",
      baseline_decision: { ok: true, reason: "ALLOW", qty_pct_final: 0.5 },
      shadow_decision: { inference: { ok: false, reason: "BLOCKED", qty_pct_final: 0 } },
    },
    {
      symbol: "ETHUSDT",
      baseline_decision: { ok: false, reason: "BLOCK", qty_pct_final: 0 },
      shadow_decision: { inference: { ok: false, reason: "BLOCK", qty_pct_final: 0 } },
    },
  ]);
  const gate = __test.buildShadowCanaryGate({
    ...canarySummary,
    compared_n: 25,
    disagreement_n: 5,
    disagreement_rate: 0.2,
    rollback_triggered: true,
  });
  assert.strictEqual(gate.status, "BLOCK");
  assert.strictEqual(gate.promotion_blocked, true);
  const shadowReadyGate = __test.buildShadowCanaryGate({
    ...canarySummary,
    compared_n: 25,
    disagreement_n: 0,
    disagreement_rate: 0,
    rollback_triggered: false,
  }, {
    policyCandidate: {
      ok: true,
      decision: "SHADOW_EVALUATE_ONLY",
      policy_candidate_id: "pc_1",
      readiness: {
        raw_retained_meets_target: false,
        future_effective_meets_target: true,
        runtime_blocked_historical_debt_sample_n: 5,
      },
    },
  });
  assert.strictEqual(shadowReadyGate.status, "PASS");
  assert.strictEqual(shadowReadyGate.reason, "CANARY_STABLE_SHADOW_TARGET_MET");
  assert.strictEqual(shadowReadyGate.policy_candidate_ready_for_shadow, true);
  assert.strictEqual(shadowReadyGate.shadow_future_effective_meets_target, true);
  assert.strictEqual(shadowReadyGate.runtime_blocked_historical_debt_sample_n, 5);
  assert.ok(__test.renderShadowInferenceCanaryMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", summary: canarySummary }).includes("Shadow Inference Canary"));
  assert.ok(__test.renderShadowCanaryGateMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", summary: canarySummary, gate: shadowReadyGate }).includes("future_effective_target_met"));
  const rollbackAction = __test.buildShadowPromotionAction({
    gate,
    servingState: {
      preferred_model_artifact_id: "artifact-shadow-1",
      live_serving_allowed: false,
      block_new_entries: true,
      reason: "ML_SERVING_BLOCK",
    },
  });
  assert.strictEqual(rollbackAction.action, "ROLLBACK_AND_BLOCK");
  const promoteAction = __test.buildShadowPromotionAction({
    gate: {
      status: "PASS",
      reason: "SHADOW_CANARY_OK",
      promotion_blocked: false,
    },
    servingState: {
      preferred_model_artifact_id: "artifact-live-1",
      live_serving_allowed: true,
      block_new_entries: false,
      reason: "ML_SERVING_OK",
    },
  });
  assert.strictEqual(promoteAction.action, "PROMOTE_PREFERRED_ARTIFACT");
  const binding = __test.buildServingBindingSnapshot({
    aiGuard: {
      claude_model: "claude-guard-test",
    },
  });
  assert.ok(binding.provider_mode);
  assert.ok(binding.claude_model);
  assert.ok(binding.openai_model);
  assert.strictEqual(__test.resolveBoundedInt(999999, 500, { min: 20, max: 1000 }), 1000);
  assert.strictEqual(__test.resolveBoundedInt(0, 500, { min: 20, max: 1000 }), 500);
  const oldMlOpsMarkets = process.env.ML_OPS_PIPELINE_MARKETS;
  const oldDiscoveryMarkets = process.env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS;
  process.env.ML_OPS_PIPELINE_MARKETS = "";
  process.env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS = "SOLUSDT|XRPUSDT";
  assert.deepStrictEqual(__test.resolveMlOpsPipelineMarkets(null, "BINANCEFUT"), ["SOLUSDT", "XRPUSDT"]);
  assert.deepStrictEqual(__test.resolveMlOpsPipelineMarkets("ETHUSDT", "BINANCEFUT"), ["ETHUSDT"]);
  if (oldMlOpsMarkets == null) delete process.env.ML_OPS_PIPELINE_MARKETS;
  else process.env.ML_OPS_PIPELINE_MARKETS = oldMlOpsMarkets;
  if (oldDiscoveryMarkets == null) delete process.env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS;
  else process.env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS = oldDiscoveryMarkets;

  console.log("ML_OPS_PIPELINE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("ML_OPS_PIPELINE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
