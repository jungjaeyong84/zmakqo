"use strict";

const assert = require("assert");
const { __test: decisionTest } = require("../storage/openclawPolicyDecisions");
const { __test: tuningTest } = require("../services/openclawPolicyTuning");

function run() {
  const blockedDoc = decisionTest.buildOpenClawPolicyDecisionDoc({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    event: "CORE_LONG",
    stage: "ENTRY",
    blocked: true,
    reason: "RECENT_EXIT_BLOCK",
    requestedQtyPct: 0.5,
    finalQtyPct: 0,
    traceId: "trace-blocked",
    runId: "run-blocked",
    createdAt: "2026-04-11T00:00:00.000Z",
  });
  assert.strictEqual(blockedDoc.action, "BLOCK");
  assert.strictEqual(blockedDoc.blocked, true);
  assert.strictEqual(blockedDoc.reason, "RECENT_EXIT_BLOCK");

  const reducedDoc = decisionTest.buildOpenClawPolicyDecisionDoc({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    event: "CORE_LONG",
    stage: "ENTRY",
    blocked: false,
    requestedQtyPct: 0.8,
    finalQtyPct: 0.32,
    reason: "CORRELATED_SIDE_REDUCE",
    traceId: "trace-reduce",
    runId: "run-reduce",
    createdAt: "2026-04-11T00:05:00.000Z",
  });
  assert.strictEqual(reducedDoc.action, "REDUCE");

  const aggressiveDoc = decisionTest.buildOpenClawPolicyDecisionDoc({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "CORE_LONG",
    stage: "ENTRY",
    blocked: false,
    requestedQtyPct: 0.5,
    finalQtyPct: 0.5,
    exitProfileMode: "AGGRESSIVE",
    reason: "HIGH_CONFIDENCE_ALLOW",
    traceId: "trace-aggressive",
    runId: "run-aggressive",
    createdAt: "2026-04-11T00:10:00.000Z",
  });
  assert.strictEqual(aggressiveDoc.action, "AGGRESSIVE");

  const nowMs = Date.parse("2026-04-11T12:34:56.000Z");
  const periods = tuningTest.buildPeriods(nowMs);
  assert.deepStrictEqual(Object.keys(periods), ["DAILY", "WEEKLY", "DAYS_7", "DAYS_14", "DAYS_30", "DAYS_90", "MONTHLY", "YEARLY"]);
  assert.strictEqual(periods.DAILY.label, "일간");
  assert.strictEqual(periods.DAYS_7.label, "최근 7일");
  assert.strictEqual(periods.DAYS_14.label, "최근 14일");
  assert.strictEqual(periods.DAYS_30.label, "최근 30일");
  assert.strictEqual(periods.DAYS_90.label, "최근 90일");
  assert.strictEqual(periods.WEEKLY.label, "주간");
  assert.strictEqual(periods.MONTHLY.label, "월간");
  assert.strictEqual(periods.YEARLY.label, "연간");

  const decisionSummary = tuningTest.summarizeDecisionRows([
    blockedDoc,
    reducedDoc,
    aggressiveDoc,
  ]);
  assert.strictEqual(decisionSummary.rows_n, 3);
  assert.strictEqual(decisionSummary.blocked_n, 1);
  assert.strictEqual(decisionSummary.reduced_n, 2);
  assert.strictEqual(decisionSummary.aggressive_n, 1);

  const fillSummary = tuningTest.summarizeFillRows([
    {
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P0_0.8P",
      fee_value: 0.4,
      external_realized_pnl: 0.8,
      exit_profile: "BASE",
      created_at: "2026-04-11T00:00:00.000Z",
    },
    {
      symbol: "DOGEUSDT",
      event: "EXIT_TRAIL",
      fee_value: 0.3,
      external_realized_pnl: -0.1,
      exit_profile: "AGGRESSIVE",
      created_at: "2026-04-11T01:00:00.000Z",
    },
  ]);
  assert.strictEqual(fillSummary.exit_fills_n, 2);
  assert.strictEqual(fillSummary.aggressive_exit_n, 1);
  assert.ok(fillSummary.fee_to_abs_realized_ratio > 0);

  const shadowSummary = tuningTest.summarizeShadowRows([
    {
      created_at: "2026-04-11T00:00:00.000Z",
      shadow_decision: {
        inference: { ok: false, reason: "RECENT_EXIT_BLOCK", exit_profile_mode: "BASE" },
        policy: { stage: "ENTRY" },
      },
      extra: { policy_stage: "ENTRY" },
    },
    {
      created_at: "2026-04-11T00:05:00.000Z",
      shadow_decision: {
        inference: { ok: true, reason: "HIGH_CONFIDENCE_ALLOW", exit_profile_mode: "AGGRESSIVE" },
        policy: { stage: "ENTRY" },
      },
      extra: { policy_stage: "ENTRY" },
    },
  ]);
  assert.strictEqual(shadowSummary.rows_n, 2);
  assert.strictEqual(shadowSummary.block_n, 1);
  assert.strictEqual(shadowSummary.aggressive_n, 1);

  const recommendations = tuningTest.buildRecommendations({
    decisionSummary: { rows_n: 60, blocked_rate: 0.05 },
    fillSummary: {
      fee_to_abs_realized_ratio: 0.42,
      aggressive_exit_n: 8,
      aggressive_realized_pnl_sum: -1.2,
      by_symbol: [
        { symbol: "ETHUSDT", fee_to_abs_realized_ratio: 2.1, realized_pnl_sum: -3.2, exit_fills_n: 7 },
      ],
    },
    shadowSummary: { rows_n: 39 },
  });
  assert.ok(recommendations.some((row) => row.key === "RAISE_RECENT_REENTRY_GUARD" && row.target_symbol === "ETHUSDT"));
  assert.ok(recommendations.some((row) => row.key === "REVIEW_TOP_COST_SYMBOL" && row.target_symbol === "ETHUSDT"));
  assert.ok(recommendations.some((row) => row.key === "DISABLE_AGGRESSIVE_UPSCALE"));
  assert.ok(recommendations.some((row) => row.key === "INSUFFICIENT_POLICY_EVIDENCE"));

  const blockGate = tuningTest.buildPromotionGate({
    decisionSummary: { rows_n: 80 },
    fillSummary: {
      fee_to_abs_realized_ratio: 0.61,
      aggressive_exit_n: 10,
      aggressive_realized_pnl_sum: -2.5,
      by_symbol: [
        { symbol: "DOGEUSDT", fee_to_abs_realized_ratio: 1.8, realized_pnl_sum: -4.2 },
      ],
    },
    shadowSummary: { rows_n: 80 },
    recommendations,
  });
  assert.strictEqual(blockGate.status, "BLOCK");
  assert.strictEqual(blockGate.top_cost_symbol, "DOGEUSDT");
  assert.strictEqual(blockGate.top_cost_symbol_fee_to_abs_realized_ratio, 1.8);

  const periodSummary = tuningTest.buildPeriodSummary({
    period: periods.DAYS_7,
    decisions: [blockedDoc, reducedDoc, aggressiveDoc],
    fills: [
      {
        symbol: "DOGEUSDT",
        event: "EXIT_TP_P0_0.8P",
        fee_value: 2.4,
        external_realized_pnl: 1.2,
        exit_profile: "BASE",
        created_at: "2026-04-11T00:00:00.000Z",
      },
    ],
    shadows: [
      {
        created_at: "2026-04-11T00:00:00.000Z",
        shadow_decision: {
          inference: { ok: false, reason: "RECENT_EXIT_BLOCK", exit_profile_mode: "BASE" },
          policy: { stage: "ENTRY" },
        },
      },
    ],
  });
  assert.ok(periodSummary.recommendations.some((row) => row.key === "REVIEW_TOP_COST_SYMBOL"));
  const markdown = tuningTest.renderMarkdown({
    generated_at_kst: "2026-04-11 21:34:56 KST",
    exchange: "BINANCEFUT",
    periods: {
      DAILY: { ...periodSummary, label: "일간" },
      WEEKLY: { ...periodSummary, label: "주간" },
      DAYS_7: { ...periodSummary, label: "최근 7일" },
      DAYS_14: { ...periodSummary, label: "최근 14일" },
      DAYS_30: { ...periodSummary, label: "최근 30일" },
      DAYS_90: { ...periodSummary, label: "최근 90일" },
      MONTHLY: { ...periodSummary, label: "월간" },
      YEARLY: { ...periodSummary, label: "연간" },
    },
  });
  assert.ok(markdown.includes("일간"));
  assert.ok(markdown.includes("주간"));
  assert.ok(markdown.includes("최근 7일"));
  assert.ok(markdown.includes("최근 14일"));
  assert.ok(markdown.includes("최근 30일"));
  assert.ok(markdown.includes("최근 90일"));
  assert.ok(markdown.includes("월간"));
  assert.ok(markdown.includes("연간"));
  assert.ok(markdown.includes("REVIEW_TOP_COST_SYMBOL"));
  assert.strictEqual(tuningTest.boundedPositiveInt(999999, 2000, { min: 100, max: 5000 }), 5000);
  assert.strictEqual(tuningTest.boundedPositiveInt(0, 2000, { min: 100, max: 5000 }), 2000);

  console.log("OPENCLAW_POLICY_AUTHORITY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("OPENCLAW_POLICY_AUTHORITY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
