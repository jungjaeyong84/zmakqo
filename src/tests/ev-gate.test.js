"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function makeBars({
  count = 12,
  start = 100,
  driftPct = 0.35,
  rangePct = 1.30,
  closeControl = 0.78,
  direction = "LONG",
  adverseEvery = 0,
} = {}) {
  const bars = [];
  let close = start;
  let ts = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    const sign = (adverseEvery > 0 && i > 0 && i % adverseEvery === 0) ? -1 : 1;
    const drift = driftPct * sign * (direction === "SHORT" ? -1 : 1);
    const open = close;
    close = open * (1 + (drift / 100));
    const center = Math.max(open, close);
    const floor = Math.min(open, close);
    const fullRange = open * (rangePct / 100);
    const high = center + (fullRange * (1 - closeControl));
    const low = floor - (fullRange * closeControl);
    bars.push({
      open,
      high,
      low,
      close,
      bar_close_time_utc_ms: ts,
    });
    ts += 900_000;
  }
  return bars;
}

async function run() {
  process.env.EV_TP1_PROBABILITY_CALIBRATION_ENABLED = "0";
  assert.strictEqual(typeof __test.resolveEvGateConfig, "function", "resolveEvGateConfig export missing");
  assert.strictEqual(typeof __test.resolveEvGateDecision, "function", "resolveEvGateDecision export missing");
  assert.strictEqual(typeof __test.resolveEvGateTradePlan, "function", "resolveEvGateTradePlan export missing");
  assert.strictEqual(typeof __test.applyEvQtyScale, "function", "applyEvQtyScale export missing");
  assert.strictEqual(typeof __test.restoreFixedEntryQtyFraction, "function", "restoreFixedEntryQtyFraction export missing");
  assert.strictEqual(typeof __test.shouldBypassEvEntryGate, "function", "shouldBypassEvEntryGate export missing");
  assert.strictEqual(typeof __test.evaluateEvEntryGate, "function", "evaluateEvEntryGate export missing");

  const cfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_core_enabled: true,
    ev_gate_pre_real_enabled: true,
    ev_gate_real_enabled: true,
    ev_gate_early_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.60,
    ev_gate_tp1_prob_min_core: 0.55,
    ev_gate_tp1_prob_min_pre_real: 0.56,
    ev_gate_tp1_prob_min_real: 0.58,
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
    ev_gate_qty_scale_mid: 0.70,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_lookback_bars: 12,
    ev_gate_atr_bars: 8,
    ev_gate_default_tp1_pct: 3.25,
    ev_gate_default_sl_pct: 1.65,
    ev_gate_skip_missing_bars: true,
  }, "BINANCEFUT");

  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.applyEarly, true);
  assert.strictEqual(cfg.tp1ProbMin, 0.55);
  assert.strictEqual(cfg.tp1ProbMinEarly, 0.60);
  assert.strictEqual(cfg.tp1ProbFull, 0.60);
  assert.strictEqual(cfg.tp1ProbKill, 0.50);
  assert.strictEqual(cfg.pointPassKillRescueEnabled, true);
  assert.strictEqual(cfg.pointPassKillRescueMargin, 0.06);
  assert.strictEqual(cfg.qtyScaleKillRescue, 0.25);
  assert.strictEqual(cfg.defaultTp0Pct, 0.8);
  assert.strictEqual(cfg.defaultTp0QtyRatio, 0.25);

  const marketCfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.60,
    ev_gate_tp1_prob_min_core: 0.57,
    ev_gate_tp1_prob_min_by_market: {
      SOLUSDT: 0.50,
    },
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
  }, "BINANCEFUT", "SOLUSDT");
  assert.strictEqual(marketCfg.tp1ProbMinGlobal, 0.55);
  assert.strictEqual(marketCfg.tp1ProbMinMarketOverride, 0.50);
  assert.strictEqual(marketCfg.tp1ProbMin, 0.50);
  assert.strictEqual(marketCfg.tp1ProbMinEarly, 0.50);
  assert.strictEqual(marketCfg.tp1ProbMinCore, 0.50);

  const reportOnlyMarketCfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.60,
    ev_gate_tp1_prob_min_core: 0.57,
    ev_gate_tp1_prob_min_by_market_report_only_enabled: true,
    ev_gate_tp1_prob_min_by_market_report_only: {
      SOLUSDT: 0.501,
    },
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
  }, "BINANCEFUT", "SOLUSDT");
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinGlobal, 0.55);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinMarketOverride, null);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinMarketReportOnlyOverride, 0.501);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinReportOnlyEnabled, true);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMin, 0.501);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinEarly, 0.501);
  assert.strictEqual(reportOnlyMarketCfg.tp1ProbMinCore, 0.501);

  const reportOnlyCohortCfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.60,
    ev_gate_tp1_prob_min_core: 0.57,
    ev_gate_tp1_prob_min_report_only_cohort_enabled: true,
    ev_gate_tp1_prob_min_report_only_cohort: 0.502,
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
  }, "BINANCEFUT", "DOGEUSDT");
  assert.strictEqual(reportOnlyCohortCfg.tp1ProbMinGlobal, 0.55);
  assert.strictEqual(reportOnlyCohortCfg.tp1ProbMinCohortReportOnlyOverride, 0.502);
  assert.strictEqual(reportOnlyCohortCfg.tp1ProbMin, 0.502);
  assert.strictEqual(reportOnlyCohortCfg.tp1ProbMinEarly, 0.502);
  assert.strictEqual(reportOnlyCohortCfg.tp1ProbMinCore, 0.502);

  const unknownGenRelaxCfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.60,
    ev_gate_tp1_prob_min_core: 0.55,
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
    ev_gate_unknown_gen_relax_enabled: true,
    ev_gate_unknown_gen_relax_started_at: new Date().toISOString(),
    ev_gate_unknown_gen_relax_window_hours: 6,
    ev_gate_unknown_gen_relax_review_after_hours: 4,
    ev_gate_unknown_gen_relax_tp1_prob_min_delta: 0.04,
    ev_gate_unknown_gen_relax_tp1_prob_full_delta: 0.03,
    ev_gate_unknown_gen_relax_tp1_prob_kill_delta: 0.02,
  }, "BINANCEFUT", "XRPUSDT");
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxEnabled, true);
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxStatus, "ACTIVE");
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxActive, true);
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxEnforcementMode, "REPORT_ONLY");
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxWindowHours, 6);
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxReviewAfterHours, 4);
  assert.strictEqual(unknownGenRelaxCfg.unknownGenRelaxMinDelta, 0.04);

  const rescuedDecision = __test.resolveEvGateDecision({
    cfg,
    tp1ProbMin: 0.55,
    estimate: {
      probability: 0.6005366150130764,
      lowerBound: 0.4698889564706964,
    },
  });
  assert.strictEqual(rescuedDecision.ok, true);
  assert.strictEqual(rescuedDecision.action, "REDUCE_RESCUE");
  assert.strictEqual(rescuedDecision.qtyScale, 0.25);
  assert.strictEqual(rescuedDecision.pointPass, true);
  assert.strictEqual(rescuedDecision.pointPassKillRescueApplied, true);

  const fixedQtySuppressed = __test.applyEvQtyScale({
    qtyFraction: 0.154,
    evScale: 0.25,
    intent: "ENTRY",
    event: "LONG",
    features: { entry_grade: "EARLY" },
  });
  assert.strictEqual(fixedQtySuppressed.suppressedForFixed, true);
  assert.strictEqual(fixedQtySuppressed.appliedScale, 1);
  assert.strictEqual(fixedQtySuppressed.suggestedScale, 0.25);
  assert.ok(Math.abs(fixedQtySuppressed.qtyFraction - 0.154) < 1e-12);
  assert.ok(Math.abs(fixedQtySuppressed.suggestedQtyFraction - 0.0385) < 1e-12);

  const legacyQtyScaled = __test.applyEvQtyScale({
    qtyFraction: 0.154,
    evScale: 0.25,
    intent: "ENTRY",
    event: "CORE_LONG",
    features: {},
  });
  assert.strictEqual(legacyQtyScaled.suppressedForFixed, false);
  assert.strictEqual(legacyQtyScaled.appliedScale, 0.25);
  assert.ok(Math.abs(legacyQtyScaled.qtyFraction - 0.0385) < 1e-12);

  const restoredFixedQty = __test.restoreFixedEntryQtyFraction({
    qtyFraction: 0.0385,
    intent: "ENTRY",
    event: "SHORT",
    features: {
      entry_grade: "EARLY",
      ev_gate_qty_before: 0.154,
      ev_gate_qty_after: 0.0385,
    },
  });
  assert.strictEqual(restoredFixedQty.restored, true);
  assert.ok(Math.abs(restoredFixedQty.qtyFraction - 0.154) < 1e-12);
  assert.ok(Math.abs(restoredFixedQty.originalQtyFraction - 0.0385) < 1e-12);

  const dropDecision = __test.resolveEvGateDecision({
    cfg,
    tp1ProbMin: 0.55,
    estimate: {
      probability: 0.52,
      lowerBound: 0.39,
    },
  });
  assert.strictEqual(dropDecision.ok, false);
  assert.strictEqual(dropDecision.action, "DROP");
  assert.strictEqual(dropDecision.reason, "DROP_EV_GATE_TP1_PROB");

  const allowCoreLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.50, rangePct: 1.80, closeControl: 0.92 }),
  });
  assert.strictEqual(allowCoreLong.ok, true);
  assert.strictEqual(allowCoreLong.detail.ev_gate_action, "REDUCE_MID");
  assert.strictEqual(allowCoreLong.qtyScale, 0.70);
  assert.strictEqual(allowCoreLong.detail.ev_gate_source, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(allowCoreLong.detail.ev_gate_policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(allowCoreLong.detail.ev_gate_tp0_pct, 0.8);
  assert.strictEqual(allowCoreLong.detail.ev_gate_tp1_prob_min, 0.55);
  assert.strictEqual(allowCoreLong.detail.ev_gate_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(allowCoreLong.detail.ev_gate_policy_source, "DEFAULT");
  assert.ok(allowCoreLong.detail.ev_gate_component_weights);
  assert.ok(allowCoreLong.detail.ev_gate_tp1_reach_prob_lower_bound > 0.55);
  assert.ok(allowCoreLong.detail.ev_gate_tp1_reach_prob_lower_bound < 0.60);
  assert.ok(allowCoreLong.detail.ev_gate_exit_value_prob_lower_bound > 0.55);
  assert.ok(allowCoreLong.detail.ev_gate_exit_value_prob_lower_bound < 0.60);

  const reduceCoreLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.20, rangePct: 1.40, closeControl: 0.65, adverseEvery: 4 }),
  });
  assert.strictEqual(reduceCoreLong.ok, true);
  assert.strictEqual(reduceCoreLong.detail.ev_gate_action, "REDUCE_MID");
  assert.strictEqual(reduceCoreLong.qtyScale, 0.70);
  assert.ok(reduceCoreLong.detail.ev_gate_tp1_reach_prob_lower_bound >= 0.50);
  assert.ok(reduceCoreLong.detail.ev_gate_tp1_reach_prob_lower_bound < 0.55);
  assert.ok(reduceCoreLong.detail.ev_gate_exit_value_prob_lower_bound >= 0.55);
  assert.ok(reduceCoreLong.detail.ev_gate_exit_value_prob_lower_bound < 0.60);

  const dropCoreLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.03, rangePct: 2.2, closeControl: 0.2, adverseEvery: 1 }),
  });
  assert.strictEqual(dropCoreLong.ok, false);
  assert.strictEqual(dropCoreLong.reason, "DROP_EV_GATE_TP1_PROB");
  assert.strictEqual(dropCoreLong.detail.ev_gate_action, "DROP");

  const rescueCoreLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.05, rangePct: 1.35, closeControl: 0.40, adverseEvery: 2 }),
  });
  assert.strictEqual(rescueCoreLong.ok, true);
  assert.strictEqual(rescueCoreLong.detail.ev_gate_action, "REDUCE_LOW");
  assert.strictEqual(rescueCoreLong.qtyScale, 0.40);
  assert.strictEqual(rescueCoreLong.detail.ev_gate_point_pass, true);
  assert.strictEqual(rescueCoreLong.detail.ev_gate_point_pass_kill_rescue_applied, false);
  assert.ok(rescueCoreLong.detail.ev_gate_exit_value_prob >= rescueCoreLong.detail.ev_gate_tp1_prob_min);
  assert.ok(rescueCoreLong.detail.ev_gate_exit_value_prob_lower_bound >= rescueCoreLong.detail.ev_gate_tp1_prob_kill);
  assert.ok(rescueCoreLong.detail.ev_gate_exit_value_prob_lower_bound < rescueCoreLong.detail.ev_gate_tp1_prob_min);

  const reduceEarlyLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "EARLY_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.50, rangePct: 1.80, closeControl: 0.92 }),
  });
  assert.strictEqual(reduceEarlyLong.ok, true);
  assert.strictEqual(reduceEarlyLong.detail.ev_gate_tp1_prob_min, 0.6);
  assert.strictEqual(reduceEarlyLong.detail.ev_gate_action, "REDUCE_LOW");

  const relaxedEarlyLong = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "EARLY_LONG",
    features: {
      event_group: "ENTRY",
      event_subtype: "GEN",
      market_state_summary_state: "UNKNOWN",
    },
    cfg: unknownGenRelaxCfg,
    bars: makeBars({ direction: "LONG", driftPct: 0.50, rangePct: 1.80, closeControl: 0.92 }),
  });
  assert.strictEqual(relaxedEarlyLong.ok, true);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_unknown_gen_relax_applied, true);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_tp1_prob_min, 0.56);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_tp1_prob_full, 0.57);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_tp1_prob_kill, 0.48);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_signal_subtype, "GEN");
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_market_state, "UNKNOWN");
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_unknown_gen_relax_enforcement_mode, "REPORT_ONLY");
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_unknown_gen_relax_auto_rollback_enabled, false);
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_action, "REPORT_ONLY");
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_raw_action, "ALLOW");
  assert.strictEqual(relaxedEarlyLong.detail.ev_gate_report_only_applied, true);
  assert.strictEqual(relaxedEarlyLong.qtyScale, 1);

  const reportOnlyDropUnknownGen = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "EARLY_SHORT",
    features: {
      event_group: "ENTRY",
      event_subtype: "GEN",
      market_state_summary_state: "UNKNOWN",
    },
    cfg: unknownGenRelaxCfg,
    bars: makeBars({ direction: "SHORT", driftPct: 0.05, rangePct: 0.6, closeControl: 0.2, adverseEvery: 2 }),
  });
  assert.strictEqual(reportOnlyDropUnknownGen.ok, true);
  assert.strictEqual(reportOnlyDropUnknownGen.action, "REPORT_ONLY");
  assert.strictEqual(reportOnlyDropUnknownGen.qtyScale, 1);
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_report_only_applied, true);
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_report_only_scope, "UNKNOWN_GEN");
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_report_only_would_drop, true);
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_raw_action, "DROP");
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_raw_reason, "DROP_EV_GATE_TP1_PROB");
  assert.strictEqual(reportOnlyDropUnknownGen.detail.ev_gate_action, "REPORT_ONLY");

  const reportOnlyExplicitGenBearState = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "SHORT",
    features: {
      event_group: "UNKNOWN",
      event_subtype: "GEN",
      event_intent: "ENTRY",
      market_state: "BEAR",
    },
    cfg: unknownGenRelaxCfg,
    bars: makeBars({ direction: "SHORT", driftPct: 0.05, rangePct: 0.6, closeControl: 0.2, adverseEvery: 2 }),
  });
  assert.strictEqual(reportOnlyExplicitGenBearState.ok, true);
  assert.strictEqual(reportOnlyExplicitGenBearState.action, "REPORT_ONLY");
  assert.strictEqual(reportOnlyExplicitGenBearState.detail.ev_gate_signal_subtype, "GEN");
  assert.strictEqual(reportOnlyExplicitGenBearState.detail.ev_gate_market_state, "BEAR");
  assert.strictEqual(reportOnlyExplicitGenBearState.detail.ev_gate_report_only_applied, true);
  assert.strictEqual(reportOnlyExplicitGenBearState.detail.ev_gate_raw_reason, "DROP_EV_GATE_TP1_PROB");

  const reportOnlyServerUnknownGen = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "SHORT",
    features: {
      event_intent: "ENTRY",
    },
    cfg: unknownGenRelaxCfg,
    bars: makeBars({ direction: "SHORT", driftPct: 0.05, rangePct: 0.6, closeControl: 0.2, adverseEvery: 2 }),
  });
  assert.strictEqual(reportOnlyServerUnknownGen.ok, true);
  assert.strictEqual(reportOnlyServerUnknownGen.action, "REPORT_ONLY");
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_event_intent, "ENTRY");
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_signal_group, "ENTRY");
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_signal_stage_metadata_present, false);
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_signal_subtype, "LONG_SHORT");
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_market_state, "UNKNOWN");
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_report_only_applied, true);
  assert.strictEqual(reportOnlyServerUnknownGen.detail.ev_gate_raw_reason, "DROP_EV_GATE_TP1_PROB");

  const reportOnlyBareServerEntry = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "SHORT",
    features: {
      event_intent: "ENTRY",
    },
    cfg: unknownGenRelaxCfg,
    bars: makeBars({ direction: "SHORT", driftPct: 0.05, rangePct: 0.6, closeControl: 0.2, adverseEvery: 2 }),
  });
  assert.strictEqual(reportOnlyBareServerEntry.ok, true);
  assert.strictEqual(reportOnlyBareServerEntry.action, "REPORT_ONLY");
  assert.strictEqual(reportOnlyBareServerEntry.detail.ev_gate_signal_stage_metadata_present, false);
  assert.strictEqual(reportOnlyBareServerEntry.detail.ev_gate_report_only_applied, true);
  assert.strictEqual(reportOnlyBareServerEntry.detail.ev_gate_raw_reason, "DROP_EV_GATE_TP1_PROB");

  const allowCoreShort = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (11 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    features: {},
    cfg,
    bars: makeBars({ direction: "SHORT", driftPct: 0.50, rangePct: 1.80, closeControl: 0.92 }),
  });
  assert.strictEqual(allowCoreShort.ok, true);
  assert.strictEqual(allowCoreShort.detail.ev_gate_action, "ALLOW");
  assert.strictEqual(allowCoreShort.qtyScale, 1);
  assert.ok(allowCoreShort.detail.ev_gate_tp1_reach_prob_lower_bound >= 0.60);

  const overridePlan = __test.resolveEvGateTradePlan({
    cfg,
    exitRules: { SL: -0.02, TP_P1: 0.03, TP_P1_QTY: 0.5, BE_ENABLE: true, BE_PCT: 0.0025, RUNNER_MIN_PROFIT_PCT: 0.02 },
    features: {
      exit_policy_source: "PINE_FIXED",
      exit_policy_sl_pct: 1.0,
      exit_policy_tp1_pct: 4.0,
      exit_policy_be_pct: 0,
      exit_policy_runner_min_profit_pct: 1.5,
    },
  });
  assert.strictEqual(overridePlan.source, "exit_rules");
  assert.strictEqual(overridePlan.tp1Pct, 4);
  assert.strictEqual(overridePlan.slPct, 1);

  const skipMissingBars = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (4 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    features: {},
    cfg,
    bars: makeBars({ count: 5, direction: "SHORT" }),
  });
  assert.strictEqual(skipMissingBars.ok, true);
  assert.strictEqual(skipMissingBars.detail.ev_gate_skipped, true);
  assert.strictEqual(skipMissingBars.detail.ev_gate_skip_reason, "INSUFFICIENT_BARS");

  const strictCfg = __test.resolveEvGateConfig({
    ev_gate_enabled: true,
    ev_gate_skip_missing_bars: false,
  }, "BINANCEFUT");
  const dropMissingBars = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1_700_000_000_000 + (4 * 900_000),
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    features: {},
    cfg: strictCfg,
    bars: makeBars({ count: 5, direction: "SHORT" }),
  });
  assert.strictEqual(dropMissingBars.ok, false);
  assert.strictEqual(dropMissingBars.reason, "DROP_EV_GATE_BARS_MISSING");

  const skipAdd = await __test.evaluateEvEntryGate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    intent: "ADD",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    features: {},
    cfg,
    bars: makeBars({ direction: "LONG" }),
  });
  assert.strictEqual(skipAdd.ok, true);
  assert.strictEqual(skipAdd.detail, undefined);

  assert.strictEqual(__test.shouldBypassEvEntryGate({
    intent: "ENTRY",
    features: { _manual_retry_by_user: true },
  }), true);
  assert.strictEqual(__test.shouldBypassEvEntryGate({
    intent: "ENTRY",
    features: {},
  }), false);

  console.log("EV_GATE_TEST_OK");
}

run().catch((err) => {
  console.error("EV_GATE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
