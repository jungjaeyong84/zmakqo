"use strict";

const { buildFeePnlKpiAuthority } = require("./feePnlKpiAuthority");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function unwrapSummary(value) {
  if (!value || typeof value !== "object") return {};
  if (value.summary && typeof value.summary === "object") return value.summary;
  if (value.raw && typeof value.raw === "object") return unwrapSummary(value.raw);
  if (value.display && typeof value.display === "object") return unwrapSummary(value.display);
  return value;
}

function unwrapDataset(value) {
  if (!value || typeof value !== "object") return {};
  if (value.dataset && typeof value.dataset === "object") return value.dataset;
  return value;
}

function buildRollingPeriods(nowMs = Date.now()) {
  return {
    DAYS_7: { label: "최근 7일", from_ms: nowMs - (7 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_14: { label: "최근 14일", from_ms: nowMs - (14 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_30: { label: "최근 30일", from_ms: nowMs - (30 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_90: { label: "최근 90일", from_ms: nowMs - (90 * 24 * 60 * 60 * 1000), to_ms: nowMs },
  };
}

function subsetDatasetByPeriod(dataset = null, period = null) {
  const raw = unwrapDataset(dataset);
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const fromMs = toNum(period && period.from_ms);
  const toMs = toNum(period && period.to_ms);
  return {
    ...raw,
    rows: rows.filter((row) => {
      const closeMs = toNum(row && row.close_ms);
      return Number.isFinite(closeMs) && closeMs >= fromMs && closeMs <= toMs;
    }),
  };
}

function axisStatusFromExecution(summary = {}) {
  const status = upper(summary.status);
  if (status === "EXECUTION_QUALITY_STABLE") return "PASS";
  if (status === "EXECUTION_QUALITY_REVIEW") return "WARN";
  return "UNKNOWN";
}

function axisStatusFromFee(summary = {}) {
  const status = upper(summary.evidence_status);
  if (status === "FEE_PNL_KPI_PASS") return "PASS";
  if (status === "FEE_PNL_KPI_REVIEW") return "WARN";
  if (status === "FEE_PNL_KPI_BLOCK") return "BLOCK";
  return "UNKNOWN";
}

function axisStatusFromAlpha(summary = {}) {
  const status = upper(summary.evidence_status);
  if (status === "EVENT_TRUTH_ALPHA_PASS") return "PASS";
  if (status === "EVENT_TRUTH_SAMPLE_LOW" || status === "EVENT_TRUTH_WIN_RATE_WEAK") return "WARN";
  if (status === "EVENT_TRUTH_ALPHA_NOT_POSITIVE" || status === "EVENT_TRUTH_SOURCE_INVALID") return "BLOCK";
  return "UNKNOWN";
}

function axisStatusFromAllocator(summary = {}) {
  const status = upper(summary.status);
  if (status === "CAPITAL_ALLOCATION_ACTIVE") return "PASS";
  if (status === "QUARANTINE_REVIEW" || status === "CAPITAL_ALLOCATION_HOLD") return "WARN";
  return "UNKNOWN";
}

function axisStatusFromOpenClaw(period = null) {
  const gate = period && period.gate && typeof period.gate === "object" ? period.gate : {};
  const status = upper(gate.status || gate.verdict);
  if (status === "PASS") return "PASS";
  if (status === "WARN" || status === "HOLD") return "WARN";
  if (status === "BLOCK") return "BLOCK";
  return "UNKNOWN";
}

function worstStatus(values = []) {
  const ranks = { PASS: 0, WARN: 1, UNKNOWN: 2, BLOCK: 3 };
  return (Array.isArray(values) ? values : [])
    .map((value) => upper(value) || "UNKNOWN")
    .sort((a, b) => (ranks[b] || 0) - (ranks[a] || 0))[0] || "UNKNOWN";
}

function findBlockingAxis({ executionSummary = {}, feeSummary = {}, alphaSummary = {}, allocatorSummary = {}, openclawPeriods = {} } = {}) {
  const openclaw30 = openclawPeriods.DAYS_30 || openclawPeriods.DAYS_14 || openclawPeriods.DAYS_7 || {};
  const axes = [
    {
      axis: "OPENCLAW_SINGLE_AUTHORITY",
      status: axisStatusFromOpenClaw(openclaw30),
      reason: upper(openclaw30.gate && openclaw30.gate.reason) || null,
    },
    {
      axis: "FEE_PNL",
      status: axisStatusFromFee(feeSummary),
      reason: upper(feeSummary.evidence_status) || null,
    },
    {
      axis: "CONTINUOUS_ALPHA_PROOF",
      status: axisStatusFromAlpha(alphaSummary),
      reason: upper(alphaSummary.evidence_status) || null,
    },
    {
      axis: "PORTFOLIO_ML",
      status: axisStatusFromAllocator(allocatorSummary),
      reason: upper(allocatorSummary.status) || null,
    },
    {
      axis: "EXECUTION_EDGE",
      status: axisStatusFromExecution(executionSummary),
      reason: upper(executionSummary.status) || null,
    },
  ];
  return axes.find((row) => row.status === "BLOCK") || axes.find((row) => row.status === "WARN") || null;
}

function buildQuantMlCoreAuthority({
  dataset = null,
  executionQuality = null,
  feePnlKpi = null,
  alphaValidation = null,
  openclawPolicyAuthority = null,
  capitalAllocator = null,
  nowMs = Date.now(),
} = {}) {
  const executionSummary = unwrapSummary(executionQuality);
  const feeSummary = unwrapSummary(feePnlKpi);
  const alphaSummary = unwrapSummary(alphaValidation);
  const allocatorSummary = unwrapSummary(capitalAllocator);
  const openclawRaw = openclawPolicyAuthority && typeof openclawPolicyAuthority === "object"
    ? (openclawPolicyAuthority.raw && typeof openclawPolicyAuthority.raw === "object" ? openclawPolicyAuthority.raw : openclawPolicyAuthority)
    : {};
  const openclawPeriods = openclawRaw.periods && typeof openclawRaw.periods === "object" ? openclawRaw.periods : {};

  const periods = {};
  for (const [key, period] of Object.entries(buildRollingPeriods(nowMs))) {
    const feePeriodSummary = buildFeePnlKpiAuthority({
      dataset: subsetDatasetByPeriod(dataset, period),
    });
    const alphaPeriodSummary = alphaSummary && alphaSummary.periods && alphaSummary.periods[key] ? alphaSummary.periods[key] : {};
    const openclawPeriod = openclawPeriods[key] && typeof openclawPeriods[key] === "object" ? openclawPeriods[key] : {};
    periods[key] = {
      label: period.label,
      from_ms: period.from_ms,
      to_ms: period.to_ms,
      execution_status: axisStatusFromExecution(executionSummary),
      fee_pnl_status: axisStatusFromFee(feePeriodSummary),
      alpha_status: axisStatusFromAlpha(alphaPeriodSummary),
      openclaw_status: axisStatusFromOpenClaw(openclawPeriod),
      fee_pnl_evidence_status: feePeriodSummary.evidence_status || null,
      fee_to_abs_realized_ratio: feePeriodSummary.cost_to_abs_realized_ratio,
      alpha_evidence_status: alphaPeriodSummary.evidence_status || null,
      alpha_realized_rows_n: alphaPeriodSummary.realized_rows_n ?? null,
      alpha_positive_rate: alphaPeriodSummary.positive_rate ?? null,
      alpha_avg_realized_ret_net: alphaPeriodSummary.avg_realized_ret_net ?? null,
      openclaw_gate_status: upper(openclawPeriod.gate && (openclawPeriod.gate.status || openclawPeriod.gate.verdict)) || null,
      openclaw_reason: upper(openclawPeriod.gate && openclawPeriod.gate.reason) || null,
      portfolio_status: axisStatusFromAllocator(allocatorSummary),
      overall_status: worstStatus([
        axisStatusFromExecution(executionSummary),
        axisStatusFromFee(feePeriodSummary),
        axisStatusFromAlpha(alphaPeriodSummary),
        axisStatusFromOpenClaw(openclawPeriod),
        axisStatusFromAllocator(allocatorSummary),
      ]),
    };
  }

  const overallStatus = worstStatus([
    axisStatusFromExecution(executionSummary),
    axisStatusFromFee(feeSummary),
    axisStatusFromAlpha(alphaSummary),
    axisStatusFromOpenClaw(openclawPeriods.DAYS_30 || openclawPeriods.DAYS_14 || {}),
    axisStatusFromAllocator(allocatorSummary),
  ]);
  const primaryBlockingAxis = findBlockingAxis({
    executionSummary,
    feeSummary,
    alphaSummary,
    allocatorSummary,
    openclawPeriods,
  });

  return {
    status: overallStatus === "PASS"
      ? "QUANT_ML_CORE_READY"
      : (overallStatus === "WARN" ? "QUANT_ML_CORE_REVIEW" : "QUANT_ML_CORE_BLOCK"),
    overall_axis_status: overallStatus,
    primary_blocking_axis: primaryBlockingAxis ? primaryBlockingAxis.axis : null,
    primary_blocking_reason: primaryBlockingAxis ? primaryBlockingAxis.reason : null,
    axes: {
      execution_edge: {
        status: axisStatusFromExecution(executionSummary),
        created_to_fill_p95_ms: executionSummary.guard_created_to_fill_p95_ms ?? executionSummary.created_to_fill_p95_ms ?? null,
        adverse_slippage_p95_bps: executionSummary.adverse_slippage_p95_bps ?? null,
        partial_fill_rate_pct: executionSummary.partial_fill_rate_pct ?? null,
        top_latency_market: executionSummary.top_latency_market || null,
      },
      fee_pnl: {
        status: axisStatusFromFee(feeSummary),
        evidence_status: feeSummary.evidence_status || null,
        cost_to_abs_realized_ratio: feeSummary.cost_to_abs_realized_ratio ?? null,
        top_fee_drag_market: feeSummary.top_fee_drag_market || null,
      },
      openclaw_single_authority: {
        status: axisStatusFromOpenClaw(openclawPeriods.DAYS_30 || openclawPeriods.DAYS_14 || {}),
        final_decider: "OPENCLAW_EXECUTION_AUTHORITY",
        days_7_gate: upper(openclawPeriods.DAYS_7 && openclawPeriods.DAYS_7.gate && (openclawPeriods.DAYS_7.gate.status || openclawPeriods.DAYS_7.gate.verdict)) || null,
        days_7_reason: upper(openclawPeriods.DAYS_7 && openclawPeriods.DAYS_7.gate && openclawPeriods.DAYS_7.gate.reason) || null,
        days_14_gate: upper(openclawPeriods.DAYS_14 && openclawPeriods.DAYS_14.gate && (openclawPeriods.DAYS_14.gate.status || openclawPeriods.DAYS_14.gate.verdict)) || null,
        days_14_reason: upper(openclawPeriods.DAYS_14 && openclawPeriods.DAYS_14.gate && openclawPeriods.DAYS_14.gate.reason) || null,
        days_30_gate: upper(openclawPeriods.DAYS_30 && openclawPeriods.DAYS_30.gate && (openclawPeriods.DAYS_30.gate.status || openclawPeriods.DAYS_30.gate.verdict)) || null,
        days_30_reason: upper(openclawPeriods.DAYS_30 && openclawPeriods.DAYS_30.gate && openclawPeriods.DAYS_30.gate.reason) || null,
        days_90_gate: upper(openclawPeriods.DAYS_90 && openclawPeriods.DAYS_90.gate && (openclawPeriods.DAYS_90.gate.status || openclawPeriods.DAYS_90.gate.verdict)) || null,
        days_90_reason: upper(openclawPeriods.DAYS_90 && openclawPeriods.DAYS_90.gate && openclawPeriods.DAYS_90.gate.reason) || null,
      },
      portfolio_ml: {
        status: axisStatusFromAllocator(allocatorSummary),
        allocator_status: allocatorSummary.status || null,
        top_quarantine_market: allocatorSummary.top_quarantine_market || null,
        top_reduce_market: allocatorSummary.top_reduce_market || null,
        top_increase_market: allocatorSummary.top_increase_market || null,
        alpha_hard_penalty_market_n: Array.isArray(allocatorSummary.alpha_hard_penalty_markets) ? allocatorSummary.alpha_hard_penalty_markets.length : 0,
        fee_pnl_hard_penalty_market_n: Array.isArray(allocatorSummary.fee_pnl_hard_penalty_markets) ? allocatorSummary.fee_pnl_hard_penalty_markets.length : 0,
        execution_hard_penalty_market_n: Array.isArray(allocatorSummary.execution_hard_penalty_markets) ? allocatorSummary.execution_hard_penalty_markets.length : 0,
      },
      continuous_alpha_proof: {
        status: axisStatusFromAlpha(alphaSummary),
        evidence_status: alphaSummary.evidence_status || null,
        top_positive_symbol: alphaSummary.top_positive_market || null,
        top_negative_symbol: alphaSummary.top_negative_market || null,
        top_positive_strategy: alphaSummary.top_positive_strategy || null,
        top_negative_strategy: alphaSummary.top_negative_strategy || null,
        top_positive_regime: alphaSummary.top_positive_regime || null,
        top_negative_regime: alphaSummary.top_negative_regime || null,
        days_7_status: upper(alphaSummary.periods && alphaSummary.periods.DAYS_7 && alphaSummary.periods.DAYS_7.evidence_status) || null,
        days_14_status: upper(alphaSummary.periods && alphaSummary.periods.DAYS_14 && alphaSummary.periods.DAYS_14.evidence_status) || null,
        days_30_status: upper(alphaSummary.periods && alphaSummary.periods.DAYS_30 && alphaSummary.periods.DAYS_30.evidence_status) || null,
        days_90_status: upper(alphaSummary.periods && alphaSummary.periods.DAYS_90 && alphaSummary.periods.DAYS_90.evidence_status) || null,
      },
    },
    periods,
  };
}

module.exports = {
  buildQuantMlCoreAuthority,
  __test: {
    buildRollingPeriods,
    subsetDatasetByPeriod,
    axisStatusFromExecution,
    axisStatusFromFee,
    axisStatusFromAlpha,
    axisStatusFromAllocator,
    axisStatusFromOpenClaw,
    worstStatus,
  },
};
