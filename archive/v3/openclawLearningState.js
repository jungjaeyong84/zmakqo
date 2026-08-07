"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNum(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function isBootstrapNearReady(bootstrap = {}, validation = {}) {
  const retainedSampleN = toNum(bootstrap && bootstrap.retained_sample_n, 0);
  const targetHit = bootstrap && bootstrap.target_hit === true;
  const expectancy = toNum(bootstrap && bootstrap.retained_metrics && bootstrap.retained_metrics.expectancy_usdt, 0);
  const minRequiredN = toNum(validation && validation.bootstrap_gate && validation.bootstrap_gate.min_required_n, 50);
  const livePositiveExpectancy = validation && validation.bootstrap_gate && validation.bootstrap_gate.live_positive_expectancy;
  return (
    retainedSampleN >= Math.max(1, minRequiredN - 5)
    && targetHit
    && expectancy > 0
    && livePositiveExpectancy !== false
  );
}

function resolveLearningStatus(validation = {}, bootstrap = {}) {
  const readiness = upper(validation && validation.readiness);
  switch (readiness) {
    case "READY_FOR_RUNTIME_LANE_REVIEW":
      return Object.freeze({
        status: "PASS",
        reason: "V3_PAPER_RUNTIME_REVIEW_READY",
        shadow_observation_ready: true,
        shadow_evaluation_ready: true,
        shadow_ready: true,
        promotion_ready: false,
      });
    case "WAIT_LIVE_SEED_MIX_EXPANSION":
      return Object.freeze({
        status: "WARN",
        reason: "V3_PAPER_LIVE_SEED_MIX_BELOW_TARGET",
        shadow_observation_ready: true,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
      });
    case "WAIT_PAPER_SAMPLE_ACCUMULATION":
      return Object.freeze({
        status: "WARN",
        reason: "V3_PAPER_SAMPLE_ACCUMULATING",
        shadow_observation_ready: true,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
      });
    case "PAPER_SAMPLE_FAILS_QUALITY":
      return Object.freeze({
        status: "WARN",
        reason: "V3_PAPER_QUALITY_BELOW_TARGET",
        shadow_observation_ready: true,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
      });
    case "WAIT_BOOTSTRAP_EXPANSION":
      if (isBootstrapNearReady(bootstrap, validation)) {
        return Object.freeze({
          status: "WARN",
          reason: "V3_PAPER_BOOTSTRAP_NEAR_READY",
          shadow_observation_ready: true,
          shadow_evaluation_ready: false,
          shadow_ready: false,
          promotion_ready: false,
        });
      }
      return Object.freeze({
        status: "HOLD",
        reason: "V3_PAPER_BOOTSTRAP_BELOW_TARGET",
        shadow_observation_ready: false,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
      });
    default:
      return Object.freeze({
        status: "HOLD",
        reason: "V3_PAPER_BOOTSTRAP_BELOW_TARGET",
        shadow_observation_ready: false,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
      });
  }
}

function buildV3OpenClawLearningState({
  bootstrap = {},
  performance = {},
  validation = {},
} = {}) {
  const learning = resolveLearningStatus(validation, bootstrap);
  const bootstrapGate = bootstrap && typeof bootstrap === "object" ? (bootstrap.bootstrap_gate || bootstrap) : {};
  const performanceToday = performance && typeof performance === "object" ? (performance.today_metrics_r || {}) : {};
  const performanceAllTime = performance && typeof performance === "object" ? (performance.all_time_metrics_r || {}) : {};
  const paperGate = validation && typeof validation === "object" ? (validation.paper_gate || {}) : {};
  const seedMixGate = validation && typeof validation === "object" ? (validation.seed_mix_gate || {}) : {};
  const summaryLines = Array.isArray(validation && validation.summary_lines) ? validation.summary_lines : [];

  return Object.freeze({
    ok: true,
    learning_scope: "V3_PAPER_ONLY",
    learning_enabled: true,
    v1_learning_blocked: true,
    v2_learning_blocked: true,
    source_lane: "V3_LOCAL_PAPER",
    strategy_family: "OPENCLAW_V3_PAPER",
    status: learning.status,
    reason: learning.reason,
    shadow_observation_ready: learning.shadow_observation_ready,
    shadow_evaluation_ready: learning.shadow_evaluation_ready,
    shadow_ready: learning.shadow_ready,
    promotion_ready: learning.promotion_ready,
    live_serving_allowed: false,
    block_new_entries: false,
    bootstrap_metrics: Object.freeze({
      retained_sample_n: toNum(bootstrap.retained_sample_n, 0),
      win_rate_pct: round(bootstrap.retained_metrics && bootstrap.retained_metrics.win_rate_pct, 2),
      expectancy_usdt: round(bootstrap.retained_metrics && bootstrap.retained_metrics.expectancy_usdt, 4),
      profit_factor: bootstrap.retained_metrics && bootstrap.retained_metrics.profit_factor != null
        ? bootstrap.retained_metrics.profit_factor
        : null,
      target_hit: bootstrap.target_hit === true,
      recommendation: trimOrNull(bootstrap.recommendation),
    }),
    paper_metrics: Object.freeze({
      open_position_n: toNum(performance.open_position_n, 0),
      today_closed_trade_n: toNum(performance.today_closed_trade_n, 0),
      today_win_rate_pct: round(performanceToday.win_rate_pct, 2),
      today_expectancy_r: round(performanceToday.expectancy, 4),
      all_time_closed_trade_n: toNum(performanceAllTime.sample_n, 0),
      all_time_win_rate_pct: round(performanceAllTime.win_rate_pct, 2),
      all_time_expectancy_r: round(performanceAllTime.expectancy, 4),
      all_time_profit_factor: performanceAllTime.profit_factor != null ? performanceAllTime.profit_factor : null,
    }),
    validation_gate: Object.freeze({
      readiness: upper(validation.readiness),
      bootstrap_ok: bootstrapGate.ok === true,
      seed_mix_active: seedMixGate.active === true,
      seed_mix_ok: seedMixGate.ok === true,
      seed_mix_mature: seedMixGate.mature === true,
      paper_ok: paperGate.ok === true,
      paper_sample_ok: paperGate.sample_ok === true,
      paper_quality_ok: paperGate.quality_ok === true,
      paper_rolling_ok: paperGate.rolling_ok === true,
      paper_closed_trade_n: toNum(paperGate.closed_trade_n, 0),
      paper_min_required_n: toNum(paperGate.min_required_n, 0),
      paper_win_rate_pct: round(paperGate.win_rate_pct, 2),
      paper_expectancy_r: round(paperGate.expectancy_r, 4),
      min_win_rate_pct: round(paperGate.min_win_rate_pct, 2),
      min_expectancy_r: round(paperGate.min_expectancy_r, 4),
    }),
    seed_mix_metrics: Object.freeze({
      live_seed_source_n: toNum(seedMixGate.live_seed_source_n, 0),
      static_seed_source_n: toNum(seedMixGate.static_seed_source_n, 0),
      effective_static_reference_n: toNum(seedMixGate.effective_static_reference_n, 0),
      effective_live_seed_share_pct: round(seedMixGate.effective_live_seed_share_pct, 2),
      min_live_seed_share_pct: round(seedMixGate.min_live_seed_share_pct, 2),
      remaining_to_mature_n: toNum(seedMixGate.remaining_to_mature_n, 0),
    }),
    summary_lines: Object.freeze(summaryLines.slice(0, 8)),
  });
}

module.exports = Object.freeze({
  buildV3OpenClawLearningState,
  __test: {
    resolveLearningStatus,
  },
});
