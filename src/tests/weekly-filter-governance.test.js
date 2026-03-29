"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-weekly-filter-governance");

function run() {
  const drops = __test.summarizeDropStages([
    { reason: "DROP_ENTRY_QUALITY_CONF" },
    { reason: "DROP_AI_MISSING" },
    { reason: "DROP_AI_BIAS_NEUTRAL_BLOCK" },
    { reason: "DROP_EV_GATE_TP1_PROB" },
    { reason: "DROP_OVERLAP" },
  ]);
  assert.strictEqual(drops.total, 5);
  assert.strictEqual(drops.counts.QUALITY, 1);
  assert.strictEqual(drops.counts.AI, 1);
  assert.strictEqual(drops.counts.MARKET, 1);
  assert.strictEqual(drops.counts.EV, 1);
  assert.strictEqual(drops.counts.OPS, 1);

  const overall = __test.aggregateOverallFromQuality({
    by_tier: {
      EARLY: { signals_n: 2, executed_n: 1 },
      CORE: { signals_n: 3, executed_n: 2 },
      PRE_REAL: { signals_n: 1, executed_n: 1 },
      REAL: { signals_n: 0, executed_n: 0 },
    },
    chain_rows: [
      { tp1_hit: true, realized: true, realized_ret_net: 0.02, realized_pnl_quote: 10 },
      { tp1_hit: false, realized: true, realized_ret_net: -0.01, realized_pnl_quote: -4 },
      { tp1_hit: true, realized: false },
    ],
  });
  assert.strictEqual(overall.signals_n, 6);
  assert.strictEqual(overall.executed_n, 4);
  assert.strictEqual(overall.realized_n, 2);
  assert.strictEqual(overall.win_n, 1);
  assert.strictEqual(Number(overall.net_pnl_quote.toFixed(2)), 6.00);

  const insufficient = __test.buildObjectiveVerdict(
    { realized_n: 3, win_rate: 1, avg_ret_net: 0.01, net_pnl_quote: 5 },
    { realizedMinSample: 8, minWinRate: 0.60, minMonthlyNetKrw: 100, monthlyNetPnlKrw: 120, monthlyObservedDays: 30 }
  );
  assert.strictEqual(insufficient.verdict, "INSUFFICIENT_SAMPLE");

  const pass = __test.buildObjectiveVerdict(
    { realized_n: 10, win_rate: 0.7, avg_ret_net: 0.01, net_pnl_quote: 12 },
    { realizedMinSample: 8, minWinRate: 0.60, minMonthlyNetKrw: 100, monthlyNetPnlKrw: 120, monthlyObservedDays: 30 }
  );
  assert.strictEqual(pass.pass, true);
  assert.strictEqual(pass.monthly_pass, true);

  const recTighten = __test.pickStageRecommendation({
    stageKey: "QUALITY",
    current: { total: 10, counts: { QUALITY: 2 }, overall: { execution_rate: 0.45 } },
    previous: { counts: { QUALITY: 1 } },
    objective: { enough_sample: true, pass: false },
    settings: {},
  });
  assert.strictEqual(recTighten.action, "REVIEW_TIGHTEN");

  const recData = __test.pickStageRecommendation({
    stageKey: "AI",
    current: { total: 10, counts: { AI: 3 }, top_reasons: [{ reason: "DROP_AI_MISSING", n: 2 }] },
    previous: { counts: { AI: 0 } },
    objective: { enough_sample: true, pass: false },
    settings: {},
  });
  assert.strictEqual(recData.action, "REVIEW_DATA");

  const recMarket = __test.pickStageRecommendation({
    stageKey: "MARKET",
    current: { total: 10, counts: { MARKET: 4 }, top_reasons: [] },
    previous: { counts: { MARKET: 1 } },
    objective: { enough_sample: true, pass: true },
    settings: { ai_bias_gate_neutral_policy: "allow" },
  });
  assert.strictEqual(recMarket.action, "REVIEW_SOFTEN");

  assert.strictEqual(__test.resolveFillMs({
    signal_bar_close_time_utc_ms: 2000,
    exec_bar_close_time_utc_ms: 1000,
  }), 1000);

  const cf = __test.evaluateDropCounterfactual(
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      tf: "15m",
      event: "CORE_LONG",
      side: "BUY",
      bar_close_time_utc_ms: 1000,
      reason: "DROP_LONG_GATE_SCORE",
      features_json: {
        market_state_summary_state: "MIXED",
        market_state_summary_action: "REDUCE",
        wait_one_bar_market_state_action: "DROP",
        ev_gate_policy_version: "TP1_WEIGHT_V1",
        ev_gate_policy_source: "DEFAULT",
      },
    },
    [
      { timestamp: 1000, open: 100, high: 101, low: 99, close: 100 },
      { timestamp: 1900, open: 100, high: 102, low: 99.5, close: 101 },
      { timestamp: 2800, open: 101, high: 102, low: 98, close: 99 },
    ],
    { sysCfg: { futures_leverage: 2 }, horizonMs: 5000, nowMs: 10000 }
  );
  assert.strictEqual(cf.ok, true);
  assert.strictEqual(cf.outcome, "TP1_FIRST");
  assert.strictEqual(cf.market_state_summary_state, "MIXED");
  assert.strictEqual(cf.market_state_summary_action, "REDUCE");
  assert.strictEqual(cf.wait_one_bar_market_state_action, "DROP");
  assert.strictEqual(cf.ev_gate_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(cf.ev_gate_policy_source, "DEFAULT");

  const cfSummary = __test.summarizeDropCounterfactual([
    {
      ok: true,
      stage_key: "QUALITY",
      reason: "DROP_LONG_GATE_SCORE",
      outcome: "TP1_FIRST",
      horizon_ret_net: 0.02,
      market_state_summary_state: "MIXED",
      market_state_summary_action: "REDUCE",
      wait_one_bar_market_state_action: "WAIT",
      ev_gate_policy_version: "TP1_WEIGHT_V1",
      ev_gate_policy_source: "DEFAULT",
    },
    {
      ok: true,
      stage_key: "QUALITY",
      reason: "DROP_LONG_GATE_SCORE",
      outcome: "SL_FIRST",
      horizon_ret_net: -0.01,
      market_state_summary_state: "ORDERED",
      market_state_summary_action: "ALLOW",
      wait_one_bar_market_state_action: "ALLOW",
      ev_gate_policy_version: "TP1_WEIGHT_V1",
      ev_gate_policy_source: "ENV_OVERRIDE",
    },
  ]);
  assert.strictEqual(cfSummary.overall.matured_n, 2);
  assert.strictEqual(cfSummary.by_stage.QUALITY.tp1_first_n, 1);
  assert.strictEqual(Array.isArray(cfSummary.overall.competing_risk), true);
  assert.strictEqual(cfSummary.feature_breakdown.market_state[0].value, "MIXED");
  assert.strictEqual(cfSummary.feature_breakdown.ev_policy_version[0].value, "TP1_WEIGHT_V1");
  assert.strictEqual(cfSummary.feature_breakdown.ev_policy_source.length, 2);
  const cfSummaryLines = __test.buildCounterfactualFeatureSummaryLines(cfSummary);
  assert.strictEqual(cfSummaryLines.length, 3);
  assert.ok(cfSummaryLines[0].includes("market state"));
  assert.ok(cfSummaryLines[2].includes("source"));
  const weeklyLayerLines = __test.buildWeeklyTelegramLayerLines({
    current: { drop_counterfactual: cfSummary },
    recommendations: {
      QUALITY: { action: "KEEP", reason: "STABLE" },
      AI: { action: "KEEP", reason: "ALIGNED" },
      MARKET: { action: "SOFTEN", reason: "STATE_MIXED" },
    },
    settings: {
      ai_bias_gate_neutral_mult: 0.5,
      ai_bias_gate_opposite_mult: 0.25,
      ai_bias_gate_strong_opposite_score: 0.35,
      ai_bias_gate_strong_opposite_conf: 0.60,
      ev_gate_tp1_prob_min: 0.52,
      ev_gate_tp1_prob_min_early: 0.48,
      ev_gate_tp1_prob_full: 0.66,
      ev_gate_tp1_prob_kill: 0.40,
      ev_gate_qty_scale_mid: 0.70,
      ev_gate_qty_scale_low: 0.45,
      wait_one_bar_same_dir_streak_min: 3,
      wait_one_bar_chase_ratio_min: 1.5,
      wait_one_bar_last_close_control_min: 0.55,
      wait_one_bar_last_dir_body_min: 0.25,
      wait_one_bar_last_opposite_wick_max: 0.35,
      wait_one_bar_recent_move1_pct_min: 0.008,
      wait_one_bar_counter_dir_bars_max: 2,
    },
    phase0: {
      legacy_wait_baseline: {
        immediate_win_rate: 0.57,
        saved_loss_pct: 0.31,
        missed_gain_pct: 0.12,
        saved_loss_minus_missed_gain: 0.19,
      },
      bridge_latency: {
        webhook_to_fill_ms: { p95: 1420 },
        duplicate_count: 1,
        reject_count: 2,
      },
    },
  });
  assert.strictEqual(weeklyLayerLines.length >= 9, true);
  assert.ok(weeklyLayerLines[0].includes("1차 상태/무결성"));
  assert.ok(weeklyLayerLines.some((line) => line.includes("3차 상태 분포")));
  assert.ok(weeklyLayerLines.some((line) => line.includes("4차 EV/시간가치층 policy")));
  assert.ok(weeklyLayerLines.some((line) => line.includes("5차 WAIT 타이밍층")));
  assert.ok(weeklyLayerLines.some((line) => line.includes("FEBT Phase0 immediate win")));
  assert.ok(weeklyLayerLines.some((line) => line.includes("bridge p95")));

  const riskCurve = __test.buildCompetingRiskCurve([
    { ok: true, tp1_time_h: 1, sl_time_h: null },
    { ok: true, tp1_time_h: null, sl_time_h: 3 },
    { ok: true, tp1_time_h: null, sl_time_h: null },
  ], [2, 4]);
  assert.strictEqual(riskCurve.length, 2);
  assert.strictEqual(Number(riskCurve[0].tp1_cum_rate.toFixed(4)), 0.3333);
  assert.strictEqual(Number(riskCurve[0].sl_cum_rate.toFixed(4)), 0.0000);
  assert.strictEqual(Number(riskCurve[1].sl_cum_rate.toFixed(4)), 0.3333);
  assert.strictEqual(Number(riskCurve[1].unresolved_rate.toFixed(4)), 0.3333);

  const wilson = __test.wilsonInterval(6, 10);
  assert.ok(wilson.lower < 0.6);
  assert.ok(wilson.upper > 0.6);

  const qualityDeep = __test.buildQualityDeepDive({
    drops: [
      { reason: "DROP_SHORT_GATE_SCORE" },
      { reason: "DROP_SHORT_GATE_SCORE" },
      { reason: "DROP_LONG_GATE_CONF" },
    ],
    cfRows: [
      { ok: true, stage_key: "QUALITY", reason: "DROP_SHORT_GATE_SCORE", side: "SHORT", tier: "CORE", regime: "trend", outcome: "SL_FIRST", horizon_ret_net: -0.02 },
      { ok: true, stage_key: "QUALITY", reason: "DROP_SHORT_GATE_SCORE", side: "SHORT", tier: "CORE", regime: "trend", outcome: "SL_FIRST", horizon_ret_net: -0.01 },
      { ok: true, stage_key: "QUALITY", reason: "DROP_LONG_GATE_CONF", side: "LONG", tier: "CORE", regime: "trend", outcome: "TP1_FIRST", horizon_ret_net: 0.03 },
      { ok: false, stage_key: "QUALITY", skip_reason: "IMMATURE" },
    ],
    executedChains: [
      {
        side: "SHORT",
        tier: "CORE",
        regime: "trend",
        score_bucket: "35-44",
        conf_bucket: "0.40-0.49",
        wave_bucket: "0.60-0.64",
        volatility_bucket: "unknown",
        late_bucket: "on_time",
        session_bucket: "asia",
        tp1_hit: true,
        realized_ret_net: 0.02,
        mfe: 0.03,
        mae: -0.01,
        tp1_time_h: 2,
        sl_time_h: null,
      },
    ],
  });
  assert.strictEqual(qualityDeep.total_quality_drops_n, 3);
  assert.strictEqual(qualityDeep.matured_n, 3);
  assert.strictEqual(qualityDeep.skipped_n, 1);
  assert.strictEqual(qualityDeep.by_reason[0].reason, "DROP_SHORT_GATE_SCORE");
  assert.ok(["HOLD_SAMPLE", "KEEP_OR_TIGHTEN", "REVIEW_SOFTEN", "KEEP"].includes(qualityDeep.by_reason[0].verdict));
  assert.strictEqual(qualityDeep.by_reason_side_tier_regime.length > 0, true);
  assert.ok("matched_avg_mfe" in qualityDeep.by_reason_side_tier_regime[0]);

  const pineFollow = __test.summarizePineFollowThrough({
    quality: {
      chain_rows: [
        {
          market: "BTCUSDT",
          tier: "CORE",
          side: "LONG",
          regime: "trend",
          entry_bar_ms: 1000,
          entry_price: 100,
          tp1_ms: 2000,
          sl_ms: null,
          first_exit_ms: 3000,
          score_bucket: "35-44",
          conf_bucket: "0.50-0.54",
          wave_bucket: "0.65-0.69",
          volatility_bucket: "unknown",
          late_bucket: "on_time",
          session_bucket: "asia",
        },
      ],
    },
    barsByMarket: new Map([[
      "BTCUSDT",
      [
        { timestamp: 1000, open: 100, high: 101, low: 99, close: 100 },
        { timestamp: 2000, open: 100, high: 104, low: 99.5, close: 103 },
        { timestamp: 3000, open: 103, high: 105, low: 102, close: 104 },
      ],
    ]]),
    tf: "15m",
    horizonMs: 4000,
  });
  assert.strictEqual(pineFollow.by_tier.CORE.executed_n, 1);
  assert.ok(pineFollow.by_tier.CORE.avg_mfe > 0);
  assert.ok(pineFollow.by_tier.CORE.avg_time_to_tp1_h > 0);
  assert.strictEqual(Array.isArray(pineFollow.by_tier.CORE.survival), true);
  assert.strictEqual(Array.isArray(pineFollow.by_tier.CORE.competing_risk), true);
  assert.strictEqual(Array.isArray(pineFollow.enriched_rows), true);

  const linkage = __test.buildPineQualityLinkage({
    pineFollow,
    qualityDeep: {
      by_reason_side_tier_regime: [
        {
          reason: "DROP_LONG_GATE_SCORE",
          side: "LONG",
          tier: "CORE",
          regime: "trend",
          matured_n: 12,
          avg_horizon_ret_net: -0.01,
          matched_support_n: 12,
          matched_pool_avg_n: 4,
          matched_avg_ret_net: 0.02,
          matched_win_rate: 0.6,
          matched_avg_mfe: 0.03,
          matched_avg_mae: -0.01,
          matched_avg_time_to_tp1_h: 2,
          matched_avg_time_to_sl_h: 5,
        },
      ],
    },
  });
  assert.strictEqual(linkage.length, 1);
  assert.strictEqual(linkage[0].reason, "DROP_LONG_GATE_SCORE");
  assert.ok("matched_avg_mfe" in linkage[0]);
  assert.strictEqual(Array.isArray(linkage[0].tier_competing_risk), true);

  const patchCandidates = __test.buildPineStage1PatchCandidates({
    current: {
      objective: { enough_sample: false, pass: false },
      sequential_guard: { verdict: "NORMAL", patch_budget_vars: 2 },
      pine_quality_linkage: [
        {
          reason: "DROP_LONG_GATE_CONF",
          tier: "CORE",
          analyzed_n: 14,
          verdict: "KEEP_OR_TIGHTEN",
          dropped_avg_ret_net: -0.012,
          tier_competing_risk: [
            { hours: 4, tp1_cum_rate: 0.20, sl_cum_rate: 0.40, unresolved_rate: 0.40 },
          ],
        },
      ],
    },
    settings: {},
  });
  assert.strictEqual(patchCandidates.verdict, "WATCHLIST_ONLY");
  assert.strictEqual(Array.isArray(patchCandidates.candidates), true);
  assert.strictEqual(patchCandidates.candidates[0].symmetry, "LONG_SHORT_SHARED");
  assert.strictEqual(patchCandidates.candidates[0].pine_component, "PINE_FULL_QUALITY_BUNDLE");
  assert.strictEqual(patchCandidates.candidates[0].server_stage1_mode, "INTEGRITY_GUARD_ONLY");

  const sizing = __test.summarizeSizingPerformance(
    [
      { entry_event_id: "INTENT__A", realized: true, realized_ret_net: 0.02, realized_pnl_quote: 7 },
      { entry_event_id: "INTENT__B", realized: true, realized_ret_net: -0.01, realized_pnl_quote: -4 },
    ],
    [
      { intent_id: "INTENT__A", features_json: { market_bias_mult: 0.5, ev_mult: 0.7, market_ev_final_mult: 0.35 } },
      { intent_id: "INTENT__B", features_json: { market_bias_mult: 1.0, ev_mult: 0.4, market_ev_final_mult: 0.4 } },
    ],
  );
  assert.strictEqual(sizing.market_bias.length > 0, true);
  assert.strictEqual(sizing.ev_band.length > 0, true);
  assert.strictEqual(__test.ratioX(1.75), "1.75x");
}

try {
  run();
  console.log("WEEKLY_FILTER_GOVERNANCE_TEST_OK");
} catch (err) {
  console.error("WEEKLY_FILTER_GOVERNANCE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
