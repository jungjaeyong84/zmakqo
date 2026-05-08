"use strict";

const { summarizeOutcomeCohorts, extractOutcomeContext } = require("./signalCohortReport");
const { buildDecisionEvidenceIndex, buildEntryFeatureEvidence } = require("./openclawOutcomeAdjudicationCollector");

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const text = value.trim();
    return text !== "" && text !== "UNKNOWN" && text !== "NONE";
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function evidenceSourceRank(value) {
  const source = trimOrNull(value);
  if (!source) return 0;
  if (source === "ENTRY_FEATURES_AND_OPENCLAW_DECISION") return 3;
  if (source === "OPENCLAW_DECISION") return 2;
  if (source === "ENTRY_FEATURES") return 1;
  return 0;
}

function mergeRecoveredEvidence(baseEvidence = {}, recoveredEvidence = {}) {
  const base = asObject(baseEvidence) || {};
  const recovered = asObject(recoveredEvidence) || {};
  const merged = { ...base };
  const baseSourceRank = evidenceSourceRank(base.feature_lineage_source);
  const recoveredSourceRank = evidenceSourceRank(recovered.feature_lineage_source);
  const strongerRecovered = recoveredSourceRank > baseSourceRank;
  const strongerOverrideKeys = new Set([
    "feature_lineage_source",
    "feature_lineage_recovered",
    "btc_1h_trend",
    "mtf_1h_direction",
  ]);
  for (const [key, value] of Object.entries(recovered)) {
    if (!hasMeaningfulValue(value)) continue;
    if (!hasMeaningfulValue(merged[key])) {
      merged[key] = cloneJson(value);
      continue;
    }
    if (strongerRecovered && strongerOverrideKeys.has(key)) {
      merged[key] = cloneJson(value);
    }
  }
  return merged;
}

function resolveDecisionEvidenceForOutcome(row, index) {
  if (!index) return null;
  const evidence = asObject(row && row.evidence) || {};
  const openclawDecisionId = trimOrNull(row && row.openclaw_decision_id)
    || trimOrNull(evidence.openclaw_decision_id);
  const signalIntentId = trimOrNull(row && (row.signal_intent_id || row.intent_id))
    || trimOrNull(evidence.signal_intent_id)
    || trimOrNull(evidence.intent_id)
    || trimOrNull(evidence.entry_features && (evidence.entry_features.signal_intent_id || evidence.entry_features.intent_id));
  const positionCycleId = trimOrNull(row && row.position_cycle_id)
    || trimOrNull(evidence.position_cycle_id)
    || trimOrNull(evidence.entry_features && evidence.entry_features.position_cycle_id);
  if (openclawDecisionId && index.byOpenClawDecisionId && index.byOpenClawDecisionId.get(openclawDecisionId)) {
    return index.byOpenClawDecisionId.get(openclawDecisionId);
  }
  if (signalIntentId && index.bySignalIntentId && index.bySignalIntentId.get(signalIntentId)) {
    return index.bySignalIntentId.get(signalIntentId);
  }
  if (positionCycleId && index.byPositionCycleId && index.byPositionCycleId.get(positionCycleId)) {
    return index.byPositionCycleId.get(positionCycleId);
  }
  return null;
}

function enrichOutcomeRowsWithDecisionEvidence({ outcomes = [], decisionEvidenceRows = [] } = {}) {
  const rows = asArray(outcomes).filter((row) => row && typeof row === "object");
  const evidenceRows = asArray(decisionEvidenceRows).filter((row) => row && typeof row === "object");
  if (!rows.length || !evidenceRows.length) return rows;
  const index = buildDecisionEvidenceIndex(evidenceRows);
  return rows.map((row) => {
    const evidence = asObject(row.evidence) || {};
    const decisionEvidence = resolveDecisionEvidenceForOutcome(row, index);
    if (!decisionEvidence) return row;
    const recoveredEvidence = buildEntryFeatureEvidence({
      entryFeatures: asObject(evidence.entry_features),
      decisionEvidence,
    });
    return Object.freeze({
      ...row,
      evidence: Object.freeze(mergeRecoveredEvidence(evidence, recoveredEvidence)),
    });
  });
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
  const lineageQuality = upper(evidence.lineage_quality);
  const performanceBasis = upper(evidence.performance_eligibility_basis);
  const exitActions = asArray(evidence.exit_actions).map(upper).filter(Boolean);
  const exitReasons = asArray(evidence.exit_status_reasons).map(upper).filter(Boolean);
  const intentId = trimOrNull(row && (row.signal_intent_id || row.intent_id || (row.evidence && row.evidence.signal_intent_id)));
  const decisionId = trimOrNull(row && row.openclaw_decision_id);
  const positionCycleId = trimOrNull(row && row.position_cycle_id);

  if (family === "OPERATOR" || family === "SYSTEM") return `FAMILY_${family}`;
  if (evidenceFamily === "OPERATOR" || evidenceFamily === "SYSTEM") return `EVIDENCE_FAMILY_${evidenceFamily}`;
  if (label === "MANUAL_INTERVENTION" || label === "EXTERNAL_SYNC") return `LABEL_${label}`;
  if (label === "LINEAGE_GAP") return "LABEL_LINEAGE_GAP";
  if (realizedExitEvent && realizedExitEvent.includes("EXTERNAL")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (realizedExitEvent && realizedExitEvent.includes("MANUAL")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (realizedExitEvent && realizedExitEvent.includes("UNVERIFIED")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (realizedExitEvent && realizedExitEvent.includes("LINEAGE_GAP")) return `EXIT_EVENT_${realizedExitEvent}`;
  if (statusReason === "EXTERNAL_FILL_RECONCILED" || decisionReason === "EXTERNAL_FILL_RECONCILED") return "EXTERNAL_FILL_RECONCILED";
  if (statusReason === "MISSING_CANONICAL_EXIT_TRANSITION" || decisionReason === "MISSING_CANONICAL_EXIT_TRANSITION") return "LINEAGE_GAP_MISSING_CANONICAL_EXIT_TRANSITION";
  if (lineageQuality && (lineageQuality.includes("GAP") || lineageQuality.includes("MISSING"))) return `LINEAGE_QUALITY_${lineageQuality}`;
  if (performanceBasis && performanceBasis.includes("LINEAGE_GAP")) return `PERFORMANCE_BASIS_${performanceBasis}`;
  if (exitActions.some((action) => action.includes("UNVERIFIED") || action.includes("EXTERNAL") || action.includes("MANUAL"))) return "EXIT_ACTION_UNVERIFIED_OR_EXTERNAL";
  if (exitReasons.some((reason) => reason.includes("MISSING_CANONICAL_EXIT_TRANSITION") || reason.includes("LINEAGE_GAP"))) return "EXIT_REASON_LINEAGE_GAP";
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
  let fullEvidenceSampleN = 0;
  let unknownEvidenceSampleN = 0;
  let extendedMicrostructureEvidenceSampleN = 0;
  let coreEvidenceOnlySampleN = 0;
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
    const context = extractOutcomeContext(row);
    if (context.full_evidence === true) {
      fullEvidenceSampleN += 1;
    } else {
      unknownEvidenceSampleN += 1;
    }
    if (context.extended_microstructure_evidence_complete === true) {
      extendedMicrostructureEvidenceSampleN += 1;
    } else if (context.full_evidence === true) {
      coreEvidenceOnlySampleN += 1;
    }
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
    full_evidence_sample_n: fullEvidenceSampleN,
    unknown_evidence_sample_n: unknownEvidenceSampleN,
    extended_microstructure_evidence_sample_n: extendedMicrostructureEvidenceSampleN,
    core_evidence_only_sample_n: coreEvidenceOnlySampleN,
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

function buildOpenClawDailyPerformanceReport({ outcomes = [], decisionEvidenceRows = [], generatedAt = null, source = "OPENCLAW_OUTCOME_ADJUDICATIONS", lookbackHours = 24 } = {}) {
  const generated = trimOrNull(generatedAt) || new Date().toISOString();
  const enrichedOutcomes = enrichOutcomeRowsWithDecisionEvidence({ outcomes, decisionEvidenceRows });
  const summary = summarizeOpenClawOutcomes(enrichedOutcomes);
  const performanceEligibleOutcomes = asArray(enrichedOutcomes).filter(isPerformanceEligibleOutcome);
  const fullEvidenceOutcomes = performanceEligibleOutcomes.filter((row) => extractOutcomeContext(row).full_evidence === true);
  const coreEvidenceOnlyOutcomes = fullEvidenceOutcomes.filter((row) => extractOutcomeContext(row).extended_microstructure_evidence_complete !== true);
  const extendedMicrostructureEvidenceOutcomes = performanceEligibleOutcomes.filter((row) => extractOutcomeContext(row).extended_microstructure_evidence_complete === true);
  const unknownEvidenceOutcomes = performanceEligibleOutcomes.filter((row) => extractOutcomeContext(row).full_evidence !== true);
  const cohortSummary = summarizeOutcomeCohorts(performanceEligibleOutcomes);
  const fullEvidenceSummary = summarizeOpenClawOutcomes(fullEvidenceOutcomes);
  const coreEvidenceOnlySummary = summarizeOpenClawOutcomes(coreEvidenceOnlyOutcomes);
  const extendedMicrostructureEvidenceSummary = summarizeOpenClawOutcomes(extendedMicrostructureEvidenceOutcomes);
  const unknownEvidenceSummary = summarizeOpenClawOutcomes(unknownEvidenceOutcomes);
  return Object.freeze({
    ok: true,
    reason: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_GENERATED",
    report_type: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT",
    generated_at: generated,
    source: trimOrNull(source) || "OPENCLAW_OUTCOME_ADJUDICATIONS",
    lookback_hours: Number(lookbackHours),
    sample_n: summary.trade_n,
    full_evidence_sample_n: summary.full_evidence_sample_n,
    unknown_evidence_sample_n: summary.unknown_evidence_sample_n,
    extended_microstructure_evidence_sample_n: summary.extended_microstructure_evidence_sample_n,
    core_evidence_only_sample_n: summary.core_evidence_only_sample_n,
    win_rate_pct: summary.win_rate_pct,
    profit_factor: summary.profit_factor,
    expectancy: summary.expectancy,
    net_pnl_usdt: summary.net_pnl_usdt,
    summary,
    full_evidence_summary: fullEvidenceSummary,
    core_evidence_only_summary: coreEvidenceOnlySummary,
    extended_microstructure_evidence_summary: extendedMicrostructureEvidenceSummary,
    unknown_evidence_summary: unknownEvidenceSummary,
    cohort_summary: cohortSummary,
    by_evidence_completeness: cohortSummary.by_evidence_completeness || Object.freeze([]),
    by_extended_microstructure_evidence_completeness: cohortSummary.by_extended_microstructure_evidence_completeness || Object.freeze([]),
    by_feature_lineage_source: cohortSummary.by_feature_lineage_source || Object.freeze([]),
    by_setup_type: cohortSummary.by_setup_type || Object.freeze([]),
    by_side: cohortSummary.by_side || Object.freeze([]),
    by_edge_cohort: cohortSummary.by_edge_cohort || Object.freeze([]),
    by_btc_1h_alignment: cohortSummary.by_btc_1h_alignment || Object.freeze([]),
    by_market_quality_bucket: cohortSummary.by_market_quality_bucket || Object.freeze([]),
    timing_summary: Object.freeze({
      by_timing_bucket: cohortSummary.by_timing_bucket || Object.freeze([]),
      by_entry_grade: cohortSummary.by_entry_grade || Object.freeze([]),
    }),
    outcomes: Object.freeze(asArray(enrichedOutcomes).map((row) => Object.freeze({
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
  enrichOutcomeRowsWithDecisionEvidence,
  isPerformanceEligibleOutcome,
  performanceExclusionReason,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
  },
};
