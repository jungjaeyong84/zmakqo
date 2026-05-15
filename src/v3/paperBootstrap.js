"use strict";

const {
  V3_PAPER_VERSION,
  V3_PAPER_PHASE,
  V3_PAPER_ALLOWED_COHORTS,
  buildV3PaperCohortKey,
  evaluateV3PaperPolicy,
} = require("./paperPolicy");

const CORE_EVIDENCE_FIELDS = Object.freeze([
  "side",
  "setup_type",
  "structural_regime",
  "edge_cohort",
  "entry_grade",
  "market_quality_score",
  "spread_bps",
  "funding_rate",
  "btc_1h_trend",
  "mtf_1h_direction",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  return null;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const text = value.trim().toUpperCase();
    return text !== "" && text !== "UNKNOWN" && text !== "NONE";
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function deriveSide(row, evidence = {}) {
  const direct = upper(firstValue(row && row.side, evidence.side));
  if (direct) return direct;
  const exitSide = upper(evidence.exit_side);
  if (exitSide === "SELL") return "LONG";
  if (exitSide === "BUY") return "SHORT";
  return null;
}

function deriveAlignment(side, direction) {
  const normalizedSide = upper(side);
  const normalizedDirection = upper(direction);
  if (!normalizedSide || !normalizedDirection) return null;
  if (normalizedDirection === normalizedSide) return "ALIGNED";
  if (normalizedDirection === "NEUTRAL") return "NEUTRAL";
  return "OPPOSED";
}

function normalizeContext(row) {
  const evidence = asObject(row && row.evidence) || {};
  const side = deriveSide(row, evidence);
  const setupType = upper(firstValue(
    row && row.setup_type,
    evidence.setup_type,
    evidence.effective_setup_type,
    evidence.raw_setup_type
  ));
  const structuralRegime = upper(firstValue(
    row && row.structural_regime,
    evidence.structural_regime,
    evidence.market_regime,
    evidence.regime
  ));
  const btcTrend = upper(firstValue(row && row.btc_1h_trend, evidence.btc_1h_trend));
  const mtfDirection = upper(firstValue(row && row.mtf_1h_direction, evidence.mtf_1h_direction));
  const context = Object.freeze({
    side,
    setup_type: setupType,
    structural_regime: structuralRegime,
    edge_cohort: upper(firstValue(row && row.edge_cohort, evidence.edge_cohort)),
    entry_grade: upper(firstValue(row && row.entry_grade, evidence.entry_grade)),
    market_quality_score: toNumberOrNull(firstValue(row && row.market_quality_score, evidence.market_quality_score)),
    spread_bps: toNumberOrNull(firstValue(row && row.spread_bps, evidence.spread_bps)),
    funding_rate: toNumberOrNull(firstValue(row && row.funding_rate, evidence.funding_rate)),
    btc_1h_trend: btcTrend,
    btc_1h_alignment: upper(firstValue(row && row.btc_1h_alignment, evidence.btc_1h_alignment)) || deriveAlignment(side, btcTrend),
    mtf_1h_direction: mtfDirection,
    mtf_1h_alignment: upper(firstValue(row && row.mtf_1h_alignment, evidence.mtf_1h_alignment)) || deriveAlignment(side, mtfDirection),
    feature_lineage_source: upper(firstValue(row && row.feature_lineage_source, evidence.feature_lineage_source)),
  });
  return context;
}

function isModelOutcome(row) {
  return upper(row && row.adjudication_family) === "MODEL";
}

function isEligibleV3ReferenceOutcome(row) {
  if (!row || typeof row !== "object") return false;
  if (!isModelOutcome(row)) return false;
  if (toNumberOrNull(row.realized_pnl) === null && toNumberOrNull(row.realized_r) === null) return false;
  const intentId = trimOrNull(firstValue(row.signal_intent_id, row.intent_id, row.evidence && row.evidence.signal_intent_id));
  const decisionId = trimOrNull(firstValue(row.openclaw_decision_id, row.evidence && row.evidence.openclaw_decision_id));
  const positionCycleId = trimOrNull(firstValue(row.position_cycle_id, row.evidence && row.evidence.position_cycle_id));
  if (!intentId || !decisionId || !positionCycleId) return false;
  return true;
}

function isFullEvidenceContext(context = {}) {
  return CORE_EVIDENCE_FIELDS.every((field) => hasMeaningfulValue(context[field]));
}

function resolveOutcomeValue(row) {
  const realizedR = toNumberOrNull(row && row.realized_r);
  if (realizedR !== null) return realizedR;
  return toNumberOrNull(row && row.realized_pnl);
}

function summarizeOutcomeRows(rows = []) {
  let winN = 0;
  let lossN = 0;
  for (const row of rows) {
    const value = Number(resolveOutcomeValue(row) || 0);
    if (value > 0) winN += 1;
    else if (value < 0) lossN += 1;
  }
  const tradeN = rows.length;
  const winRatePct = tradeN > 0 ? (winN / tradeN) * 100 : 0;
  return Object.freeze({
    sample_n: tradeN,
    win_rate_pct: round(winRatePct, 2),
    win_n: winN,
    loss_n: lossN,
  });
}

function summarizeRowsByNumericField(rows = [], {
  field = "realized_pnl",
  expectancyKey = "expectancy_usdt",
  netKey = "net_pnl_usdt",
} = {}) {
  let winN = 0;
  let lossN = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let netValue = 0;
  let sampleN = 0;
  for (const row of rows) {
    const value = toNumberOrNull(row && row[field]);
    if (value === null) continue;
    sampleN += 1;
    netValue += value;
    if (value > 0) {
      winN += 1;
      grossProfit += value;
    } else if (value < 0) {
      lossN += 1;
      grossLossAbs += Math.abs(value);
    }
  }
  const winRatePct = sampleN > 0 ? (winN / sampleN) * 100 : 0;
  const expectancy = sampleN > 0 ? netValue / sampleN : 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : 0);
  return Object.freeze({
    sample_n: sampleN,
    win_rate_pct: round(winRatePct, 2),
    profit_factor: profitFactor === Infinity ? "INF" : round(profitFactor, 4),
    [expectancyKey]: round(expectancy, 4),
    [netKey]: round(netValue, 4),
    win_n: winN,
    loss_n: lossN,
  });
}

function buildMixedUnitMetrics(rows = []) {
  const outcomeMetrics = summarizeOutcomeRows(rows);
  const staticPnlMetrics = summarizeRowsByNumericField(rows, {
    field: "realized_pnl",
    expectancyKey: "expectancy_usdt",
    netKey: "net_pnl_usdt",
  });
  return Object.freeze({
    sample_n: outcomeMetrics.sample_n,
    win_rate_pct: outcomeMetrics.win_rate_pct,
    win_n: outcomeMetrics.win_n,
    loss_n: outcomeMetrics.loss_n,
    static_pnl_sample_n: staticPnlMetrics.sample_n,
    profit_factor: staticPnlMetrics.profit_factor,
    expectancy_usdt: staticPnlMetrics.expectancy_usdt,
    net_pnl_usdt: staticPnlMetrics.net_pnl_usdt,
    sample_basis: "COMBINED_OUTCOME_ROWS",
    pnl_basis: "STATIC_USDT_ONLY",
  });
}

function incrementCounter(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function buildTopCohorts(rows = [], limit = 10) {
  const groups = new Map();
  for (const row of rows) {
    const context = row && row.context ? row.context : normalizeContext(row);
    const key = buildV3PaperCohortKey(context);
    const pnl = toNumberOrNull(row && row.realized_pnl);
    const realizedR = toNumberOrNull(row && row.realized_r);
    const current = groups.get(key) || {
      key,
      n_total: 0,
      usdt_n: 0,
      usdt_wins: 0,
      usdt_losses: 0,
      usdt_net: 0,
      r_n: 0,
      r_wins: 0,
      r_losses: 0,
      r_net: 0,
    };
    current.n_total += 1;
    if (pnl !== null) {
      current.usdt_n += 1;
      current.usdt_net += pnl;
      if (pnl > 0) current.usdt_wins += 1;
      else if (pnl < 0) current.usdt_losses += 1;
    }
    if (realizedR !== null) {
      current.r_n += 1;
      current.r_net += realizedR;
      if (realizedR > 0) current.r_wins += 1;
      else if (realizedR < 0) current.r_losses += 1;
    }
    groups.set(key, current);
  }
  return Object.freeze(
    [...groups.values()]
      .map((row) => {
        const usdtWl = row.usdt_wins + row.usdt_losses;
        const rWl = row.r_wins + row.r_losses;
        return Object.freeze({
          key: row.key,
          n_total: row.n_total,
          usdt: Object.freeze({
            sample_n: row.usdt_n,
            wins: row.usdt_wins,
            losses: row.usdt_losses,
            win_rate_pct: usdtWl > 0 ? round((row.usdt_wins / usdtWl) * 100, 2) : null,
            expectancy_usdt: row.usdt_n > 0 ? round(row.usdt_net / row.usdt_n, 4) : null,
            net_pnl_usdt: round(row.usdt_net, 4),
          }),
          r: Object.freeze({
            sample_n: row.r_n,
            wins: row.r_wins,
            losses: row.r_losses,
            win_rate_pct: rWl > 0 ? round((row.r_wins / rWl) * 100, 2) : null,
            expectancy_r: row.r_n > 0 ? round(row.r_net / row.r_n, 4) : null,
            net_r: round(row.r_net, 4),
          }),
        });
      })
      .sort((a, b) => (
        Number(b.n_total || 0) - Number(a.n_total || 0)
        || String(a.key).localeCompare(String(b.key))
      ))
      .slice(0, limit)
  );
}

function summarizeUsdtOnly(rows = []) {
  return summarizeRowsByNumericField(rows, {
    field: "realized_pnl",
    expectancyKey: "expectancy_usdt",
    netKey: "net_pnl_usdt",
  });
}

function summarizeROnly(rows = []) {
  return summarizeRowsByNumericField(rows, {
    field: "realized_r",
    expectancyKey: "expectancy_r",
    netKey: "net_r",
  });
}

function buildV3PaperBootstrapReport(outcomes = []) {
  const referenceRows = (Array.isArray(outcomes) ? outcomes : [])
    .filter(isEligibleV3ReferenceOutcome)
    .map((row) => Object.freeze({
      ...row,
      context: normalizeContext(row),
    }))
    .filter((row) => isFullEvidenceContext(row.context));

  const retainedRows = [];
  const activeRows = [];
  const shadowRows = [];
  const removedRows = [];
  const removedReasonCounts = Object.create(null);

  for (const row of referenceRows) {
    const verdict = evaluateV3PaperPolicy(row.context);
    if (verdict.ok) {
      const enriched = Object.freeze({ ...row, v3_policy: verdict });
      retainedRows.push(enriched);
      if (verdict.apply_mode === "SHADOW_ONLY") shadowRows.push(enriched);
      else activeRows.push(enriched);
    } else {
      removedRows.push(Object.freeze({ ...row, v3_policy: verdict }));
      incrementCounter(removedReasonCounts, verdict.reason);
    }
  }

  const baselineMetrics = buildMixedUnitMetrics(referenceRows);
  const retainedMetrics = buildMixedUnitMetrics(activeRows);
  const shadowMetrics = buildMixedUnitMetrics(shadowRows);
  const combinedRetainedMetrics = buildMixedUnitMetrics(retainedRows);
  const removedMetrics = buildMixedUnitMetrics(removedRows);
  const retainedLiveMetricsR = summarizeROnly(activeRows);
  const baselineLiveMetricsR = summarizeROnly(referenceRows);
  const retainedStaticMetricsUsdt = summarizeUsdtOnly(activeRows);
  const baselineStaticMetricsUsdt = summarizeUsdtOnly(referenceRows);

  // Gate (C-plan): require BOTH external static USDT WR >= 55% AND v3 live R WR >= 55%.
  // The combined outcome WR (retainedMetrics.win_rate_pct) is kept for backward visibility only.
  const TARGET_WR_PCT = 55;
  const staticWr = Number(retainedStaticMetricsUsdt.win_rate_pct || 0);
  const liveWr = Number(retainedLiveMetricsR.win_rate_pct || 0);
  const staticGateHit = staticWr >= TARGET_WR_PCT && retainedStaticMetricsUsdt.sample_n > 0;
  const liveGateHit = liveWr >= TARGET_WR_PCT && retainedLiveMetricsR.sample_n > 0;
  const targetHit = staticGateHit && liveGateHit;
  const staticPositive = Number(retainedStaticMetricsUsdt.expectancy_usdt || 0) > 0;
  const livePositive = Number(retainedLiveMetricsR.expectancy_r || 0) > 0;
  const positiveExpectancy = staticPositive && livePositive;
  const combinedOutcomeWr = Number(retainedMetrics.win_rate_pct || 0);
  const recommendation = targetHit && positiveExpectancy
    ? "READY_FOR_PARALLEL_PAPER_LANE"
    : "KEEP_SHADOW_ONLY";

  return Object.freeze({
    ok: true,
    strategy_id: V3_PAPER_VERSION,
    phase: V3_PAPER_PHASE,
    active_allowlist: Object.freeze(V3_PAPER_ALLOWED_COHORTS.map((row) => Object.freeze({ ...row }))),
    source_sample_n: referenceRows.length,
    retained_sample_n: activeRows.length,
    shadow_sample_n: shadowRows.length,
    combined_retained_sample_n: retainedRows.length,
    removed_sample_n: removedRows.length,
    baseline_metrics: baselineMetrics,
    retained_metrics: retainedMetrics,
    baseline_live_metrics_r: baselineLiveMetricsR,
    retained_live_metrics_r: retainedLiveMetricsR,
    baseline_static_metrics_usdt: baselineStaticMetricsUsdt,
    retained_static_metrics_usdt: retainedStaticMetricsUsdt,
    shadow_metrics: shadowMetrics,
    combined_retained_metrics: combinedRetainedMetrics,
    removed_metrics: removedMetrics,
    removed_reason_counts: Object.freeze(removedReasonCounts),
    retained_top_cohorts: buildTopCohorts(activeRows),
    shadow_top_cohorts: buildTopCohorts(shadowRows),
    target_win_rate_pct: TARGET_WR_PCT,
    target_hit: targetHit,
    positive_expectancy: positiveExpectancy,
    gate_breakdown: Object.freeze({
      static_usdt: Object.freeze({
        sample_n: retainedStaticMetricsUsdt.sample_n,
        win_rate_pct: retainedStaticMetricsUsdt.win_rate_pct,
        expectancy_usdt: retainedStaticMetricsUsdt.expectancy_usdt,
        hit: staticGateHit,
        positive: staticPositive,
      }),
      live_r: Object.freeze({
        sample_n: retainedLiveMetricsR.sample_n,
        win_rate_pct: retainedLiveMetricsR.win_rate_pct,
        expectancy_r: retainedLiveMetricsR.expectancy_r,
        hit: liveGateHit,
        positive: livePositive,
      }),
      combined_outcome: Object.freeze({
        sample_n: retainedMetrics.sample_n,
        win_rate_pct: combinedOutcomeWr,
        note: "DEPRECATED_INFORMATIONAL_ONLY",
      }),
      both_required: true,
    }),
    recommendation,
  });
}

module.exports = Object.freeze({
  buildV3PaperBootstrapReport,
  normalizeContext,
  isFullEvidenceContext,
  isEligibleV3ReferenceOutcome,
  summarizeOutcomeRows,
  summarizeRowsByNumericField,
  buildMixedUnitMetrics,
});
