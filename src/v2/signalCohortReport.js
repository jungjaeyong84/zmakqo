"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
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

function getPath(obj, path) {
  let cursor = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }
  return cursor == null ? null : cursor;
}

function firstValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  return null;
}

function bucketSignalScore(score) {
  const n = toNumberOrNull(score);
  if (n === null) return "UNKNOWN";
  if (n >= 90) return "ELITE";
  if (n >= 80) return "QUALIFIED";
  if (n >= 70) return "MARGINAL";
  return "SUBTHRESHOLD";
}

function bucketTriggerQuality({ triggerConfirmed = null, volumeZScore = null } = {}) {
  if (triggerConfirmed !== true) return "UNCONFIRMED";
  const volume = toNumberOrNull(volumeZScore) ?? 0;
  if (volume >= 1.8) return "CONFIRMED_EXPANSION";
  if (volume >= 1) return "CONFIRMED_BASE";
  return "CONFIRMED_LOW_POWER";
}

function extractOutcomeContext(row) {
  const evidence = asObject(row && row.evidence) || {};
  const criteria = asObject(firstValue(
    evidence.signal_criteria,
    getPath(evidence, ["bundle", "signalCriteria"]),
    getPath(evidence, ["canonical_evidence_summary", "signal_criteria"])
  )) || {};
  const regimeProfile = asObject(firstValue(
    evidence.signal_regime_profile,
    criteria.regime_profile,
    getPath(evidence, ["bundle", "signalCriteria", "regime_profile"])
  )) || {};
  const expectedEdgeModel = asObject(firstValue(
    evidence.expected_edge_model,
    criteria.expected_edge_model,
    getPath(evidence, ["bundle", "signalCriteria", "expected_edge_model"])
  )) || {};
  const triggerGate = asObject(firstValue(
    criteria.trigger_gate,
    getPath(evidence, ["bundle", "signalCriteria", "trigger_gate"])
  )) || {};
  const setupGate = asObject(firstValue(
    criteria.setup_gate,
    getPath(evidence, ["bundle", "signalCriteria", "setup_gate"])
  )) || {};

  const symbol = upper(firstValue(row && row.symbol, evidence.symbol, getPath(evidence, ["bundle", "signalIntent", "symbol"]))) || "UNKNOWN";
  const side = upper(firstValue(row && row.side, evidence.side, getPath(evidence, ["bundle", "signalIntent", "side"]))) || "UNKNOWN";
  const setupType = upper(firstValue(evidence.setup_type, setupGate.setup_type)) || "UNKNOWN";
  const structuralRegime = upper(firstValue(evidence.structural_regime, regimeProfile.structural_regime, evidence.market_regime)) || "UNKNOWN";
  const regimeCohort = upper(firstValue(evidence.regime_cohort, regimeProfile.regime_cohort)) || `${structuralRegime}__UNKNOWN__UNKNOWN`;
  const edgeCohort = upper(firstValue(evidence.edge_cohort, expectedEdgeModel.edge_cohort)) || "UNKNOWN";
  const signalScore = toNumberOrNull(firstValue(evidence.signal_score, criteria.signal_score));
  const volumeZScore = toNumberOrNull(firstValue(evidence.volume_zscore, triggerGate.volume_zscore));
  const triggerConfirmed = firstValue(evidence.trigger_confirmed, triggerGate.trigger_confirmed) === true;
  const expectedNetRAfterCost = toNumberOrNull(firstValue(
    evidence.expected_net_r_after_cost,
    getPath(criteria, ["expected_edge_gate", "expected_net_r_after_cost"]),
    expectedEdgeModel.net_r_multiple
  ));
  const timingMeasurement = asObject(evidence.timing_measurement) || {};
  const entryGrade = upper(firstValue(evidence.entry_grade, criteria.entry_grade, timingMeasurement.entry_grade)) || "UNKNOWN";
  const triggerType = upper(firstValue(evidence.trigger_type, criteria.trigger_type, triggerGate.trigger_type, timingMeasurement.trigger_type)) || "UNKNOWN";
  const timingBucket = upper(firstValue(evidence.timing_bucket, timingMeasurement.timing_bucket, evidence.febt_phase)) || "UNKNOWN";

  return Object.freeze({
    symbol,
    side,
    entry_grade: entryGrade,
    trigger_type: triggerType,
    timing_bucket: timingBucket,
    setup_type: setupType,
    structural_regime: structuralRegime,
    regime_cohort: regimeCohort,
    edge_cohort: edgeCohort,
    signal_score_bucket: bucketSignalScore(signalScore),
    trigger_quality_bucket: bucketTriggerQuality({ triggerConfirmed, volumeZScore }),
    expected_edge_bucket: edgeCohort,
    setup_regime_key: `${setupType}__${structuralRegime}`,
    expected_net_r_after_cost: expectedNetRAfterCost,
  });
}

function createBucketRow(key, context) {
  return {
    key,
    symbol: context.symbol,
    side: context.side,
    setup_type: context.setup_type,
    structural_regime: context.structural_regime,
    regime_cohort: context.regime_cohort,
    edge_cohort: context.edge_cohort,
    signal_score_bucket: context.signal_score_bucket,
    trigger_quality_bucket: context.trigger_quality_bucket,
    entry_grade: context.entry_grade,
    trigger_type: context.trigger_type,
    timing_bucket: context.timing_bucket,
    outcome_n: 0,
    trade_n: 0,
    win_n: 0,
    loss_n: 0,
    net_pnl_usdt: 0,
    gross_profit_usdt: 0,
    gross_loss_abs_usdt: 0,
    avg_expected_net_r_after_cost: 0,
    expected_edge_sample_n: 0,
  };
}

function finalizeBucketRows(map) {
  return Object.freeze(Array.from(map.values()).map((row) => {
    const tradeN = row.trade_n;
    return Object.freeze({
      ...row,
      win_rate_pct: tradeN > 0 ? (row.win_n / tradeN) * 100 : null,
      profit_factor: row.gross_loss_abs_usdt > 0 ? row.gross_profit_usdt / row.gross_loss_abs_usdt : (row.gross_profit_usdt > 0 ? Infinity : null),
      avg_expected_net_r_after_cost: row.expected_edge_sample_n > 0 ? row.avg_expected_net_r_after_cost / row.expected_edge_sample_n : null,
    });
  }).sort((a, b) => Number(b.net_pnl_usdt || 0) - Number(a.net_pnl_usdt || 0) || String(a.key).localeCompare(String(b.key))));
}

function summarizeOutcomeCohorts(outcomes = []) {
  const rows = asArray(outcomes).filter((row) => row && typeof row === "object");
  const bySetupType = new Map();
  const byRegimeCohort = new Map();
  const byEdgeCohort = new Map();
  const bySetupRegime = new Map();
  const bySignalScoreBucket = new Map();
  const byTriggerQualityBucket = new Map();
  const byEntryGrade = new Map();
  const byTimingBucket = new Map();

  function record(map, key, row, context) {
    if (!map.has(key)) map.set(key, createBucketRow(key, context));
    const bucket = map.get(key);
    const pnl = toNumberOrNull(row.realized_pnl);
    bucket.outcome_n += 1;
    if (pnl != null) {
      bucket.trade_n += 1;
      bucket.net_pnl_usdt += pnl;
      if (pnl > 0) {
        bucket.win_n += 1;
        bucket.gross_profit_usdt += pnl;
      } else if (pnl < 0) {
        bucket.loss_n += 1;
        bucket.gross_loss_abs_usdt += Math.abs(pnl);
      }
    }
    if (context.expected_net_r_after_cost != null) {
      bucket.avg_expected_net_r_after_cost += context.expected_net_r_after_cost;
      bucket.expected_edge_sample_n += 1;
    }
  }

  for (const row of rows) {
    const context = extractOutcomeContext(row);
    record(bySetupType, context.setup_type, row, context);
    record(byRegimeCohort, context.regime_cohort, row, context);
    record(byEdgeCohort, context.edge_cohort, row, context);
    record(bySetupRegime, context.setup_regime_key, row, context);
    record(bySignalScoreBucket, context.signal_score_bucket, row, context);
    record(byTriggerQualityBucket, context.trigger_quality_bucket, row, context);
    record(byEntryGrade, context.entry_grade, row, context);
    record(byTimingBucket, context.timing_bucket, row, context);
  }

  const setupRegimeRows = finalizeBucketRows(bySetupRegime);
  const topPositiveSetupRegime = setupRegimeRows[0] || null;
  const topNegativeSetupRegime = setupRegimeRows.length
    ? [...setupRegimeRows].sort((a, b) => Number(a.net_pnl_usdt || 0) - Number(b.net_pnl_usdt || 0) || String(a.key).localeCompare(String(b.key)))[0]
    : null;

  return Object.freeze({
    by_setup_type: finalizeBucketRows(bySetupType),
    by_regime_cohort: finalizeBucketRows(byRegimeCohort),
    by_edge_cohort: finalizeBucketRows(byEdgeCohort),
    by_setup_regime: setupRegimeRows,
    by_signal_score_bucket: finalizeBucketRows(bySignalScoreBucket),
    by_trigger_quality_bucket: finalizeBucketRows(byTriggerQualityBucket),
    by_entry_grade: finalizeBucketRows(byEntryGrade),
    by_timing_bucket: finalizeBucketRows(byTimingBucket),
    top_positive_setup_regime: topPositiveSetupRegime,
    top_negative_setup_regime: topNegativeSetupRegime,
  });
}

module.exports = {
  extractOutcomeContext,
  summarizeOutcomeCohorts,
  __test: {
    bucketSignalScore,
    bucketTriggerQuality,
  },
};
