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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function summarizeOpenClawOutcomes(outcomes = []) {
  const rows = asArray(outcomes).filter((row) => row && typeof row === "object");
  let winN = 0;
  let lossN = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let netPnl = 0;
  let pnlN = 0;
  const labelCounts = {};
  const familyCounts = {};
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
    by_symbol: Object.freeze(Object.fromEntries(Object.entries(bySymbol).map(([symbol, row]) => [symbol, Object.freeze(row)]))),
  });
}

function buildOpenClawDailyPerformanceReport({ outcomes = [], generatedAt = null, source = "OPENCLAW_OUTCOME_ADJUDICATIONS", lookbackHours = 24 } = {}) {
  const generated = trimOrNull(generatedAt) || new Date().toISOString();
  const summary = summarizeOpenClawOutcomes(outcomes);
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
    outcomes: Object.freeze(asArray(outcomes).map((row) => Object.freeze({
      openclaw_outcome_adjudication_id: trimOrNull(row.openclaw_outcome_adjudication_id),
      openclaw_decision_id: trimOrNull(row.openclaw_decision_id),
      position_cycle_id: trimOrNull(row.position_cycle_id),
      signal_intent_id: trimOrNull(row.signal_intent_id),
      adjudication_label: upper(row.adjudication_label),
      adjudication_family: upper(row.adjudication_family),
      realized_exit_event: upper(row.realized_exit_event),
      realized_pnl: toNumberOrNull(row.realized_pnl),
      adjudicated_at: trimOrNull(row.adjudicated_at),
    }))),
  });
}

module.exports = {
  summarizeOpenClawOutcomes,
  buildOpenClawDailyPerformanceReport,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
  },
};
