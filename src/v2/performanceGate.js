"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const num = toNumberOrNull(value);
    if (num != null) return num;
  }
  return null;
}

function normalizeRateToPct(value) {
  const num = toNumberOrNull(value);
  if (num == null) return null;
  return Math.abs(num) <= 1 ? num * 100 : num;
}

function readMetric(metrics, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = metrics;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

function normalizePerformanceMetrics(input = {}) {
  const row = input && typeof input === "object" ? input : {};
  const perf = row.performance && typeof row.performance === "object" ? row.performance : {};
  const costs = row.costs && typeof row.costs === "object" ? row.costs : {};
  const samples = row.sample_counts && typeof row.sample_counts === "object" ? row.sample_counts : {};
  const summary = row.summary && typeof row.summary === "object" ? row.summary : {};
  return Object.freeze({
    source: trimOrNull(row.source) || trimOrNull(row.report_type) || "V2_PERFORMANCE_METRICS",
    generated_at: trimOrNull(row.generated_at) || trimOrNull(row.generated_at_iso) || trimOrNull(row.generated_at_kst),
    mode: upper(row.mode),
    sample_n: firstNumber(
      row.sample_n,
      row.trade_n,
      row.realized_n,
      row.outcome_n,
      summary.outcome_n,
      summary.trade_n,
      samples.trades,
      samples.outcomes,
      samples.intervals
    ),
    win_rate_pct: normalizeRateToPct(firstNumber(
      row.win_rate_pct,
      row.win_rate,
      perf.interval_win_rate_pct,
      perf.win_rate_pct,
      summary.win_rate_pct,
      summary.win_rate
    )),
    profit_factor: firstNumber(row.profit_factor, perf.interval_profit_factor, perf.profit_factor, summary.profit_factor),
    expectancy_r: firstNumber(row.expectancy_r, row.expectancy, perf.expectancy_r, perf.expectancy, summary.expectancy_r, summary.expectancy),
    avg_ret_net: firstNumber(row.avg_ret_net, perf.avg_ret_net, summary.avg_ret_net),
    net_pnl_pct: firstNumber(row.net_pnl_pct, perf.net_pnl_pct, summary.net_pnl_pct),
    net_pnl_usdt: firstNumber(row.net_pnl_usdt, perf.net_pnl_usdt, summary.net_pnl_usdt),
    max_drawdown_pct: firstNumber(row.max_drawdown_pct, row.mdd_pct, perf.mdd_pct, perf.max_drawdown_pct, summary.max_drawdown_pct),
    cost_ratio_pct: firstNumber(row.cost_ratio_pct, costs.cost_ratio_pct, perf.cost_ratio_pct, summary.cost_ratio_pct),
    error_count_24h: firstNumber(row.error_count_24h, row.latest_error_count_24h, summary.error_count_24h),
  });
}

function resolvePerformanceGateThresholds(env = process.env) {
  return Object.freeze({
    min_sample_n: Math.max(1, Number(env.V2_PERFORMANCE_GATE_MIN_SAMPLE_N || 100)),
    min_win_rate_pct: Number(env.V2_PERFORMANCE_GATE_MIN_WIN_RATE_PCT || 50),
    min_profit_factor: Number(env.V2_PERFORMANCE_GATE_MIN_PROFIT_FACTOR || 1.1),
    min_expectancy_r: Number(env.V2_PERFORMANCE_GATE_MIN_EXPECTANCY_R || 0),
    min_net_pnl_pct: Number(env.V2_PERFORMANCE_GATE_MIN_NET_PNL_PCT || 0),
    max_drawdown_pct: Number(env.V2_PERFORMANCE_GATE_MAX_DRAWDOWN_PCT || -2),
    max_cost_ratio_pct: Number(env.V2_PERFORMANCE_GATE_MAX_COST_RATIO_PCT || 0.24),
    max_error_count_24h: Number(env.V2_PERFORMANCE_GATE_MAX_ERROR_COUNT_24H || 0),
  });
}

function hasFinite(value) {
  return Number.isFinite(Number(value));
}

function evaluateV2PerformanceGate({ metrics = {}, thresholds = resolvePerformanceGateThresholds(), mode = "LIVE" } = {}) {
  const normalized = normalizePerformanceMetrics(metrics);
  const resolvedMode = upper(mode || normalized.mode) || "LIVE";
  const blockers = [];
  const warnings = [];

  if (!hasFinite(normalized.sample_n) || Number(normalized.sample_n) < Number(thresholds.min_sample_n)) {
    blockers.push("PERFORMANCE_GATE:SAMPLE_INSUFFICIENT");
  }
  if (!hasFinite(normalized.win_rate_pct) || Number(normalized.win_rate_pct) < Number(thresholds.min_win_rate_pct)) {
    blockers.push("PERFORMANCE_GATE:WIN_RATE_BELOW_FLOOR");
  }
  if (!hasFinite(normalized.profit_factor) || Number(normalized.profit_factor) < Number(thresholds.min_profit_factor)) {
    blockers.push("PERFORMANCE_GATE:PROFIT_FACTOR_BELOW_FLOOR");
  }
  const expectancy = hasFinite(normalized.expectancy_r) ? Number(normalized.expectancy_r) : Number(normalized.avg_ret_net);
  if (!Number.isFinite(expectancy) || expectancy <= Number(thresholds.min_expectancy_r)) {
    blockers.push("PERFORMANCE_GATE:EXPECTANCY_NOT_POSITIVE");
  }
  if (!hasFinite(normalized.net_pnl_pct) || Number(normalized.net_pnl_pct) <= Number(thresholds.min_net_pnl_pct)) {
    blockers.push("PERFORMANCE_GATE:NET_PNL_NOT_POSITIVE");
  }
  if (!hasFinite(normalized.max_drawdown_pct) || Number(normalized.max_drawdown_pct) < Number(thresholds.max_drawdown_pct)) {
    blockers.push("PERFORMANCE_GATE:DRAWDOWN_LIMIT_EXCEEDED");
  }
  if (hasFinite(normalized.cost_ratio_pct) && Number(normalized.cost_ratio_pct) > Number(thresholds.max_cost_ratio_pct)) {
    blockers.push("PERFORMANCE_GATE:COST_RATIO_LIMIT_EXCEEDED");
  }
  if (hasFinite(normalized.error_count_24h) && Number(normalized.error_count_24h) > Number(thresholds.max_error_count_24h)) {
    blockers.push("PERFORMANCE_GATE:RUNTIME_ERRORS_PRESENT");
  }
  if (resolvedMode !== "LIVE") {
    warnings.push("PERFORMANCE_GATE:NON_LIVE_MODE_REFERENCE_ONLY");
  }

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_PERFORMANCE_GATE_PASS" : "V2_PERFORMANCE_GATE_BLOCKED",
    mode: resolvedMode,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    metrics: normalized,
    thresholds: Object.freeze({ ...thresholds }),
  });
}

module.exports = {
  normalizePerformanceMetrics,
  resolvePerformanceGateThresholds,
  evaluateV2PerformanceGate,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    firstNumber,
    normalizeRateToPct,
    readMetric,
  },
};
