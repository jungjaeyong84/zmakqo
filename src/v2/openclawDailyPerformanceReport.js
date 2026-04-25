"use strict";

const { summarizeOutcomeCohorts, extractOutcomeContext } = require("./signalCohortReport");

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function performanceExclusionReason(row) {
  const family = upper(row && row.adjudication_family);
  const label = upper(row && row.adjudication_label);
  const realizedExitEvent = upper(row && row.realized_exit_event);
  const evidence = row && row.evidence && typeof row.evidence === "object" ? row.evidence : {};
  const evidenceFamily = upper(evidence.adjudication_family);
  const statusReason = upper(evidence.status_reason);
  const decisionReason = upper(evidence.decision_reason);
  const fillSource = upper(evidence.fill_source || evidence.source);
  const intentId = trimOrNull(row && (row.signal_intent_id || row.intent_id || (row.evidence && row.evidence.signal_intent_id)));
  const decisionId = trimOrNull(row && row.openclaw_decision_id);
  const positionCycleId = trimOrNull(row && row.position_cycle_id);

  if (family === "OPERATOR" || family === "SYSTEM") return `FAMILY_${family}`;
  if (evidenceFamily === "OPERATOR" || evidenceFamily === "SYSTEM") return `EVIDENCE_FAMILY_${evidenceFamily}`;
  if (label === "MANUAL_INTERVENTION" || label === "EXTERNAL_SYNC") return `LABEL_${label}`;
  if (realizedExitEvent && realizedExitEvent.includes("EXTERNAL")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (realizedExitEvent && realizedExitEvent.includes("MANUAL")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (statusReason === "EXTERNAL_FILL_RECONCILED" || decisionReason === "EXTERNAL_FILL_RECONCILED") return "EXTERNAL_FILL_RECONCILED";
  if (fillSource === "EXTERNAL" || fillSource === "MANUAL") return `FILL_SOURCE_${fillSource}`;
  if (evidence.manual_recovery === true || evidence.operator_recovery === true || evidence.external_reconciliation === true) return "MANUAL_OR_EXTERNAL_RECOVERY";
  if (!intentId || !decisionId || !positionCycleId) return "MISSING_OPENCLAW_LINEAGE";
  return null;
}

function isPerformanceEligibleOutcome(row) {
  return performanceExclusionReason(row) === null;
}

function summarizeOpenClawOutcomes(outcomes = []) {
  const rows = asArray(outcomes).filter((row) => row && typeof row === "object");
  let winN = 0;
  let lossN = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let netPnl = 0;
  let pnlN = 0;
  let eligibleN = 0;
  let excludedN = 0;
  const labelCounts = {};
  const familyCounts = {};
  const exclusionReasonCounts = {};
  const bySymbol = {};

  for (const row of rows) {
    const label = upper(row.adjudication_label) || "UNKNOWN";
    const family = upper(row.adjudication_family) || "UNKNOWN";
    labelCounts[label] = (labelCounts[label] || 0) + 1;
    familyCounts[family] = (familyCounts[family] || 0) + 1;
    const pnl = toNumberOrNull(row.realized_pnl);
    const symbol = upper(row.symbol || row.evidence && row.evidence.symbol) || "UNKNOWN";
    bySymbol[symbol] = bySymbol[symbol] || { outcome_n: 0, win_n: 0, loss_n: 0, net_pnl_usdt: 0 };
    bySymbol[symbol].outcome_n += 1;
    const exclusionReason = performanceExclusionReason(row);
    if (exclusionReason) {
      excludedN += 1;
      exclusionReasonCounts[exclusionReason] = (exclusionReasonCounts[exclusionReason] || 0) + 1;
      continue;
    }
    eligibleN += 1;
    if (pnl != null) {
      pnlN += 1;
      netPnl += pnl;
      bySymbol[symbol].net_pnl_usdt += pnl;
      if (pnl > 0) {
        winN += 1;
        grossProfit += pnl;
        bySymbol[symbol].win_n += 1;
      } else if (pnl < 0) {
        lossN += 1;
        grossLossAbs += Math.abs(pnl);
        bySymbol[symbol].loss_n += 1;
      }
    }
  }

  const tradeN = winN + lossN;
  const winRatePct = tradeN > 0 ? (winN / tradeN) * 100 : null;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : null);
  const expectancy = pnlN > 0 ? netPnl / pnlN : null;
  return Object.freeze({
    outcome_n: rows.length,
    performance_eligible_outcome_n: eligibleN,
    performance_excluded_outcome_n: excludedN,
    trade_n: tradeN,
    pnl_sample_n: pnlN,
    win_n: winN,
    loss_n: lossN,
    win_rate_pct: winRatePct,
    gross_profit_usdt: grossProfit,
    gross_loss_abs_usdt: grossLossAbs,
    profit_factor: profitFactor,
    net_pnl_usdt: netPnl,
    expectancy: expectancy,
    label_counts: Object.freeze(labelCounts),
    family_counts: Object.freeze(familyCounts),
    performance_excluded_reason_counts: Object.freeze(exclusionReasonCounts),
    by_symbol: Object.freeze(Object.fromEntries(Object.entries(bySymbol).map(([symbol, row]) => [symbol, Object.freeze(row)]))),
  });
}

function buildOpenClawDailyPerformanceReport({ outcomes = [], generatedAt = null, source = "OPENCLAW_OUTCOME_ADJUDICATIONS", lookbackHours = 24 } = {}) {
  const generated = trimOrNull(generatedAt) || new Date().toISOString();
  const summary = summarizeOpenClawOutcomes(outcomes);
  const performanceEligibleOutcomes = asArray(outcomes).filter(isPerformanceEligibleOutcome);
  const cohortSummary = summarizeOutcomeCohorts(performanceEligibleOutcomes);
  return Object.freeze({
    ok: true,
    reason: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_GENERATED",
    report_type: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT",
    generated_at: generated,
    source: trimOrNull(source) || "OPENCLAW_OUTCOME_ADJUDICATIONS",
    lookback_hours: Number(lookbackHours),
    sample_n: summary.trade_n,
    win_rate_pct: summary.win_rate_pct,
    profit_factor: summary.profit_factor,
    expectancy: summary.expectancy,
    net_pnl_usdt: summary.net_pnl_usdt,
    summary,
    cohort_summary: cohortSummary,
    timing_summary: Object.freeze({
      by_timing_bucket: cohortSummary.by_timing_bucket || Object.freeze([]),
      by_entry_grade: cohortSummary.by_entry_grade || Object.freeze([]),
    }),
    outcomes: Object.freeze(asArray(outcomes).map((row) => Object.freeze({
      openclaw_outcome_adjudication_id: trimOrNull(row.openclaw_outcome_adjudication_id),
      openclaw_decision_id: trimOrNull(row.openclaw_decision_id),
      position_cycle_id: trimOrNull(row.position_cycle_id),
      signal_intent_id: trimOrNull(row.signal_intent_id),
      adjudication_label: upper(row.adjudication_label),
      adjudication_family: upper(row.adjudication_family),
      realized_exit_event: upper(row.realized_exit_event),
      realized_pnl: toNumberOrNull(row.realized_pnl),
      performance_eligible: isPerformanceEligibleOutcome(row),
      performance_exclusion_reason: performanceExclusionReason(row),
      adjudicated_at: trimOrNull(row.adjudicated_at),
      context: extractOutcomeContext(row),
    }))),
  });
}

module.exports = {
  summarizeOpenClawOutcomes,
  buildOpenClawDailyPerformanceReport,
  isPerformanceEligibleOutcome,
  performanceExclusionReason,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
  },
};
