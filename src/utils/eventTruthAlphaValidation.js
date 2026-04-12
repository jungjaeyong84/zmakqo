"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function avg(values = []) {
  const rows = (Array.isArray(values) ? values : []).map((row) => toNum(row)).filter((row) => Number.isFinite(row));
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function normalizeDataset(dataset = null) {
  if (!dataset || typeof dataset !== "object") return {};
  if (dataset.dataset && typeof dataset.dataset === "object") return dataset.dataset;
  return dataset;
}

function resolveStrategyKey(row = null) {
  const feature = row && row.feature_snapshot && typeof row.feature_snapshot === "object" ? row.feature_snapshot : {};
  const tf = norm(row && row.tf) || norm(feature.tf) || "UNKNOWN";
  const entryTier = upper(feature.entry_tier) || "UNKNOWN";
  const side = upper(feature.position_side) || "UNKNOWN";
  return `${tf}|${entryTier}|${side}`;
}

function resolveRegimeKey(row = null) {
  const feature = row && row.feature_snapshot && typeof row.feature_snapshot === "object" ? row.feature_snapshot : {};
  return upper(
    feature.openclaw_market_regime_cohort
    || feature.market_regime_cohort
    || feature.regime_state
    || feature.market_regime
    || feature.regime
  ) || "UNKNOWN";
}

function normalizeRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const feature = row && row.feature_snapshot && typeof row.feature_snapshot === "object" ? row.feature_snapshot : {};
      const label = row && row.label_snapshot && typeof row.label_snapshot === "object" ? row.label_snapshot : {};
      const positionSide = upper(feature.position_side) || "UNKNOWN";
      const regimeKey = resolveRegimeKey(row);
      return {
        market: upper(row && row.market) || "UNKNOWN",
        close_ms: toNum(row && row.close_ms),
        strategy_key: resolveStrategyKey(row),
        regime_key: regimeKey,
        position_side: positionSide,
        market_side_key: `${upper(row && row.market) || "UNKNOWN"}|${positionSide}`,
        market_side_regime_key: `${upper(row && row.market) || "UNKNOWN"}|${positionSide}|${regimeKey}`,
        is_executed: label.is_executed === true,
        is_realized: label.is_realized === true,
        realized_direction: upper(label.realized_direction),
        realized_ret_net: toNum(label.realized_ret_net),
        realized_pnl_quote: toNum(label.realized_pnl_quote),
        tp0_hit: label.tp0_hit === true,
        tp0_to_tp1_converted: label.tp0_to_tp1_converted === true,
      };
    });
}

function buildPeriods(nowMs = Date.now()) {
  return {
    DAYS_7: { label: "최근 7일", from_ms: nowMs - (7 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_14: { label: "최근 14일", from_ms: nowMs - (14 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_30: { label: "최근 30일", from_ms: nowMs - (30 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_90: { label: "최근 90일", from_ms: nowMs - (90 * 24 * 60 * 60 * 1000), to_ms: nowMs },
  };
}

function summarizeGroupRows(values = [], groupKey) {
  const groups = new Map();
  for (const row of (Array.isArray(values) ? values : [])) {
    const key = upper(row && row[groupKey]) || norm(row && row[groupKey]) || "UNKNOWN";
    const acc = groups.get(key) || {
      key,
      realized_n: 0,
      positive_n: 0,
      negative_n: 0,
      realized_ret_sum: 0,
      realized_pnl_sum: 0,
      executed_n: 0,
      tp0_hit_n: 0,
      tp0_to_tp1_n: 0,
    };
    if (row && row.is_executed) {
      acc.executed_n += 1;
      if (row.tp0_hit) {
        acc.tp0_hit_n += 1;
        if (row.tp0_to_tp1_converted) acc.tp0_to_tp1_n += 1;
      }
    }
    if (row && row.is_realized && Number.isFinite(row.realized_ret_net)) {
      acc.realized_n += 1;
      acc.realized_ret_sum += row.realized_ret_net;
      acc.realized_pnl_sum += Number.isFinite(row.realized_pnl_quote) ? row.realized_pnl_quote : 0;
      if (row.realized_ret_net > 0) acc.positive_n += 1;
      else if (row.realized_ret_net < 0) acc.negative_n += 1;
    }
    groups.set(key, acc);
  }
  return [...groups.values()]
    .map((row) => ({
      key: row.key,
      realized_n: row.realized_n,
      positive_n: row.positive_n,
      negative_n: row.negative_n,
      positive_rate: safeRatio(row.positive_n, row.realized_n),
      avg_realized_ret_net: safeRatio(row.realized_ret_sum, row.realized_n),
      realized_pnl_sum_quote: row.realized_pnl_sum,
      executed_n: row.executed_n,
      tp0_hit_rate: safeRatio(row.tp0_hit_n, row.executed_n),
      tp0_to_tp1_conversion_rate: safeRatio(row.tp0_to_tp1_n, row.tp0_hit_n),
    }))
    .sort((a, b) => {
      const retGap = (toNum(b.avg_realized_ret_net) || -Infinity) - (toNum(a.avg_realized_ret_net) || -Infinity);
      if (Number.isFinite(retGap) && retGap !== 0) return retGap;
      return (toNum(b.realized_n) || 0) - (toNum(a.realized_n) || 0);
    });
}

function summarizeAlphaRows(rows = [], {
  strictEventTruthOnly = false,
  minSampleN = 30,
  minPositiveRate = 0.5,
  minAvgRetNet = 0,
} = {}) {
  const realizedRows = rows.filter((row) => row && row.is_realized);
  const executedRows = rows.filter((row) => row && row.is_executed);
  const positiveRows = realizedRows.filter((row) => row.realized_direction === "POSITIVE" || ((toNum(row.realized_ret_net) || 0) > 0));
  const negativeRows = realizedRows.filter((row) => row.realized_direction === "NEGATIVE" || ((toNum(row.realized_ret_net) || 0) < 0));
  const tp0HitRows = executedRows.filter((row) => row.tp0_hit === true);
  const tp0ToTp1Rows = tp0HitRows.filter((row) => row.tp0_to_tp1_converted === true);

  const byMarket = summarizeGroupRows(realizedRows.concat(executedRows.filter((row) => !row.is_realized)), "market");
  const byMarketSide = summarizeGroupRows(realizedRows.concat(executedRows.filter((row) => !row.is_realized)), "market_side_key");
  const byMarketSideRegime = summarizeGroupRows(realizedRows.concat(executedRows.filter((row) => !row.is_realized)), "market_side_regime_key");
  const byStrategy = summarizeGroupRows(realizedRows.concat(executedRows.filter((row) => !row.is_realized)), "strategy_key");
  const byRegime = summarizeGroupRows(realizedRows.concat(executedRows.filter((row) => !row.is_realized)), "regime_key");

  const avgRealizedRetNet = avg(realizedRows.map((row) => row.realized_ret_net));
  const positiveRate = safeRatio(positiveRows.length, realizedRows.length);
  const tp0ToTp1ConversionRate = safeRatio(tp0ToTp1Rows.length, tp0HitRows.length);

  const blockingReasons = [];
  if (!strictEventTruthOnly) blockingReasons.push("EVENT_TRUTH_SOURCE_INVALID");
  if (realizedRows.length < minSampleN) blockingReasons.push("EVENT_TRUTH_SAMPLE_LOW");
  if (Number.isFinite(avgRealizedRetNet) && avgRealizedRetNet <= minAvgRetNet) blockingReasons.push("EVENT_TRUTH_ALPHA_NOT_POSITIVE");
  if (Number.isFinite(positiveRate) && positiveRate < minPositiveRate) blockingReasons.push("EVENT_TRUTH_WIN_RATE_WEAK");

  let evidenceStatus = "EVENT_TRUTH_ALPHA_PASS";
  if (!strictEventTruthOnly) evidenceStatus = "EVENT_TRUTH_SOURCE_INVALID";
  else if (realizedRows.length < minSampleN) evidenceStatus = "EVENT_TRUTH_SAMPLE_LOW";
  else if (Number.isFinite(avgRealizedRetNet) && avgRealizedRetNet <= minAvgRetNet) evidenceStatus = "EVENT_TRUTH_ALPHA_NOT_POSITIVE";
  else if (Number.isFinite(positiveRate) && positiveRate < minPositiveRate) evidenceStatus = "EVENT_TRUTH_WIN_RATE_WEAK";

  const marketRows = byMarket.slice();
  const weakestMarket = marketRows.slice().sort((a, b) => (toNum(a.avg_realized_ret_net) || Infinity) - (toNum(b.avg_realized_ret_net) || Infinity))[0] || null;
  const strongestStrategy = byStrategy[0] || null;
  const weakestStrategy = byStrategy.slice().sort((a, b) => (toNum(a.avg_realized_ret_net) || Infinity) - (toNum(b.avg_realized_ret_net) || Infinity))[0] || null;
  const strongestRegime = byRegime[0] || null;
  const weakestRegime = byRegime.slice().sort((a, b) => (toNum(a.avg_realized_ret_net) || Infinity) - (toNum(b.avg_realized_ret_net) || Infinity))[0] || null;

  return {
    alpha_ready: blockingReasons.length === 0,
    evidence_status: evidenceStatus,
    rows_n: rows.length,
    executed_rows_n: executedRows.length,
    realized_rows_n: realizedRows.length,
    positive_n: positiveRows.length,
    negative_n: negativeRows.length,
    positive_rate: positiveRate,
    avg_realized_ret_net: avgRealizedRetNet,
    avg_realized_pnl_quote: avg(realizedRows.map((row) => row.realized_pnl_quote)),
    tp0_hit_rate: safeRatio(tp0HitRows.length, executedRows.length),
    tp0_to_tp1_conversion_rate: tp0ToTp1ConversionRate,
    top_positive_market: marketRows[0] ? marketRows[0].key : null,
    top_negative_market: weakestMarket ? weakestMarket.key : null,
    top_positive_strategy: strongestStrategy ? strongestStrategy.key : null,
    top_negative_strategy: weakestStrategy ? weakestStrategy.key : null,
    top_positive_regime: strongestRegime ? strongestRegime.key : null,
    top_negative_regime: weakestRegime ? weakestRegime.key : null,
    by_market: marketRows.slice(0, 10),
    by_market_side: byMarketSide.slice(0, 20),
    by_market_side_regime: byMarketSideRegime.slice(0, 30),
    by_strategy: byStrategy.slice(0, 10),
    by_regime: byRegime.slice(0, 10),
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

function buildEventTruthAlphaValidation({
  dataset = null,
} = {}) {
  const item = normalizeDataset(dataset);
  const manifest = item.source_manifest && typeof item.source_manifest === "object" ? item.source_manifest : {};
  const rawRows = Array.isArray(item.rows) ? item.rows : [];
  const rows = normalizeRows(rawRows);
  const strictEventTruthOnly = item.immutable_source === true
    && item.source_collection === "UNIFIED_EVENT_TIMELINE"
    && manifest.immutable_source === true
    && manifest.strict_event_truth_only === true
    && manifest.source_collection === "UNIFIED_EVENT_TIMELINE";

  const minSampleN = Math.max(10, Number(process.env.EVENT_TRUTH_ALPHA_MIN_REALIZED_N || 30));
  const minPositiveRate = Math.max(0, Math.min(1, Number(process.env.EVENT_TRUTH_ALPHA_MIN_POSITIVE_RATE || 0.5)));
  const minAvgRetNet = Number(process.env.EVENT_TRUTH_ALPHA_MIN_AVG_REALIZED_RET_NET || 0);
  const summary = summarizeAlphaRows(rows, {
    strictEventTruthOnly,
    minSampleN,
    minPositiveRate,
    minAvgRetNet,
  });
  const periods = {};
  for (const [key, period] of Object.entries(buildPeriods(Date.now()))) {
    const windowRows = rows.filter((row) => {
      const closeMs = toNum(row && row.close_ms);
      return Number.isFinite(closeMs) && closeMs >= period.from_ms && closeMs <= period.to_ms;
    });
    periods[key] = {
      label: period.label,
      from_ms: period.from_ms,
      to_ms: period.to_ms,
      ...summarizeAlphaRows(windowRows, {
        strictEventTruthOnly,
        minSampleN,
        minPositiveRate,
        minAvgRetNet,
      }),
    };
  }

  return {
    status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
    alpha_ready: summary.alpha_ready,
    evidence_status: summary.evidence_status,
    strict_event_truth_only: strictEventTruthOnly,
    immutable_source: item.immutable_source === true,
    source_collection: norm(item.source_collection),
    dataset_hash: norm(item.dataset_hash),
    manifest_hash: norm(manifest.manifest_hash),
    strategy_scope: "TF|ENTRY_TIER|POSITION_SIDE",
    rows_n: summary.rows_n,
    executed_rows_n: summary.executed_rows_n,
    realized_rows_n: summary.realized_rows_n,
    positive_n: summary.positive_n,
    negative_n: summary.negative_n,
    positive_rate: summary.positive_rate,
    avg_realized_ret_net: summary.avg_realized_ret_net,
    avg_realized_pnl_quote: summary.avg_realized_pnl_quote,
    tp0_hit_rate: summary.tp0_hit_rate,
    tp0_to_tp1_conversion_rate: summary.tp0_to_tp1_conversion_rate,
    top_positive_market: summary.top_positive_market,
    top_negative_market: summary.top_negative_market,
    top_positive_strategy: summary.top_positive_strategy,
    top_negative_strategy: summary.top_negative_strategy,
    top_positive_regime: summary.top_positive_regime,
    top_negative_regime: summary.top_negative_regime,
    by_market: summary.by_market,
    by_market_side: summary.by_market_side,
    by_market_side_regime: summary.by_market_side_regime,
    by_strategy: summary.by_strategy,
    by_regime: summary.by_regime,
    periods,
    blocking_reason_n: summary.blocking_reason_n,
    blocking_reasons: summary.blocking_reasons,
  };
}

module.exports = {
  buildEventTruthAlphaValidation,
  __test: {
    normalizeDataset,
    normalizeRows,
    buildPeriods,
    summarizeAlphaRows,
  },
};
