"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "y") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "n") return false;
  return fallback;
}

function buildEvGateCompositePolicy({
  provider = "BINANCEFUT",
  systemSettings = null,
} = {}) {
  const sys = systemSettings && typeof systemSettings === "object" ? systemSettings : {};
  const tp1ProbMin = toNum(sys.ev_gate_tp1_prob_min);
  const tp1ProbMinEarly = toNum(sys.ev_gate_tp1_prob_min_early);
  const tp1ProbMinCore = toNum(sys.ev_gate_tp1_prob_min_core);
  const tp1ProbFull = toNum(sys.ev_gate_tp1_prob_full);
  const tp1ProbKill = toNum(sys.ev_gate_tp1_prob_kill);
  const defaultTp0Pct = toNum(sys.ev_gate_default_tp0_pct) ?? 0.8;
  const defaultTp0QtyRatio = toNum(sys.ev_gate_default_tp0_qty_ratio) ?? 0.25;
  const defaultTp1Pct = toNum(sys.ev_gate_default_tp1_pct);
  const defaultSlPct = toNum(sys.ev_gate_default_sl_pct);

  return {
    status: "EV_GATE_COMPOSITE_POLICY_READY",
    provider: String(provider || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT",
    ev_gate_enabled: toBool(sys.ev_gate_enabled, true),
    ev_gate_early_enabled: toBool(sys.ev_gate_early_enabled, true),
    ev_gate_core_enabled: toBool(sys.ev_gate_core_enabled, true),
    policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1",
    canonical_policy_version: "EV_COMPOSITE_EXIT_VALUE_V1",
    compatibility_policy_version: "TP1_WEIGHT_V1",
    threshold_metric: "exit_value_lower_bound",
    threshold_metric_family: "TP_COMPOSITE_EXIT_VALUE",
    compatibility_drop_reason: "DROP_EV_GATE_TP1_PROB",
    estimator_function: "estimateTp1ReachProbability",
    estimator_name_legacy: true,
    tp1_probability_field_legacy: true,
    default_tp0_pct: defaultTp0Pct,
    default_tp0_qty_ratio: defaultTp0QtyRatio,
    default_tp1_pct: defaultTp1Pct,
    default_sl_pct: defaultSlPct,
    composite_lb_min_global: tp1ProbMin,
    composite_lb_min_early: tp1ProbMinEarly,
    composite_lb_min_core: tp1ProbMinCore,
    composite_lb_full: tp1ProbFull,
    composite_lb_kill: tp1ProbKill,
    tp1_prob_min_global: tp1ProbMin,
    tp1_prob_min_early: tp1ProbMinEarly,
    tp1_prob_min_core: tp1ProbMinCore,
    tp1_prob_full: tp1ProbFull,
    tp1_prob_kill: tp1ProbKill,
    legacy_threshold_setting_keys: [
      "ev_gate_tp1_prob_min",
      "ev_gate_tp1_prob_min_early",
      "ev_gate_tp1_prob_min_core",
      "ev_gate_tp1_prob_full",
      "ev_gate_tp1_prob_kill",
    ],
    qty_scale_mid: toNum(sys.ev_gate_qty_scale_mid),
    qty_scale_low: toNum(sys.ev_gate_qty_scale_low),
    lookback_bars: toNum(sys.ev_gate_lookback_bars),
    atr_bars: toNum(sys.ev_gate_atr_bars),
    composite_components: [
      "tp0_hit_probability",
      "tp1_hit_probability",
      "tp0_to_tp1_conversion_probability",
      "pre_tp1_time_stop_risk",
      "expected_exit_value_pct",
      "expected_exit_value_r",
    ],
    interpretation_notes: [
      "gate decision now uses exit_value_probability and exit_value_lower_bound",
      "probability and lowerBound fields remain tp1-calibrated compatibility outputs",
      "DROP_EV_GATE_TP1_PROB reason code is kept for backward compatibility",
    ],
  };
}

module.exports = {
  buildEvGateCompositePolicy,
  __test: {
    buildEvGateCompositePolicy,
  },
};
