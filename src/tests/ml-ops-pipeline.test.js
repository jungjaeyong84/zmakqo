"use strict";

const assert = require("assert");
const { __test } = require("../services/mlOpsPipeline");

function run() {
  const markets = __test.parseMarkets("btcusdt, ethusdt", "BINANCEFUT");
  assert.deepStrictEqual(markets, ["BTCUSDT", "ETHUSDT"]);

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
  assert.ok(__test.renderShadowInferenceCanaryMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", summary: canarySummary }).includes("Shadow Inference Canary"));
  assert.ok(__test.renderShadowCanaryGateMarkdown({ generated_at_kst: "2026-04-11 12:00:00 KST", exchange: "BINANCEFUT", summary: canarySummary, gate }).includes("Shadow Canary Gate"));
  const binding = __test.buildServingBindingSnapshot({
    aiGuard: {
      claude_model: "claude-guard-test",
    },
  });
  assert.ok(binding.provider_mode);
  assert.ok(binding.claude_model);
  assert.ok(binding.openai_model);

  console.log("ML_OPS_PIPELINE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("ML_OPS_PIPELINE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
