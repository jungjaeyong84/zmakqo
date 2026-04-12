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

function normalizeDataset(dataset = null) {
  if (!dataset || typeof dataset !== "object") return {};
  if (dataset.dataset && typeof dataset.dataset === "object") return dataset.dataset;
  return dataset;
}

function buildEventTruthAlphaValidation({
  dataset = null,
} = {}) {
  const item = normalizeDataset(dataset);
  const manifest = item.source_manifest && typeof item.source_manifest === "object" ? item.source_manifest : {};
  const rows = Array.isArray(item.rows) ? item.rows : [];
  const strictEventTruthOnly = item.immutable_source === true
    && item.source_collection === "UNIFIED_EVENT_TIMELINE"
    && manifest.immutable_source === true
    && manifest.strict_event_truth_only === true
    && manifest.source_collection === "UNIFIED_EVENT_TIMELINE";
  const realizedRows = rows.filter((row) => row && row.label_snapshot && row.label_snapshot.is_realized === true);
  const executedRows = rows.filter((row) => row && row.label_snapshot && row.label_snapshot.is_executed === true);
  const positiveRows = realizedRows.filter((row) => row.label_snapshot.realized_direction === "POSITIVE");
  const negativeRows = realizedRows.filter((row) => row.label_snapshot.realized_direction === "NEGATIVE");
  const tp0HitRows = executedRows.filter((row) => row.label_snapshot.tp0_hit === true);
  const tp0ToTp1Rows = tp0HitRows.filter((row) => row.label_snapshot.tp0_to_tp1_converted === true);

  const byMarket = new Map();
  for (const row of realizedRows) {
    const market = upper(row.market) || "UNKNOWN";
    const ret = toNum(row.label_snapshot && row.label_snapshot.realized_ret_net) || 0;
    const acc = byMarket.get(market) || { market, realized_n: 0, positive_n: 0, negative_n: 0, realized_ret_sum: 0 };
    acc.realized_n += 1;
    acc.realized_ret_sum += ret;
    if (ret > 0) acc.positive_n += 1;
    else if (ret < 0) acc.negative_n += 1;
    byMarket.set(market, acc);
  }
  const marketRows = [...byMarket.values()]
    .map((row) => ({
      ...row,
      positive_rate: row.realized_n > 0 ? row.positive_n / row.realized_n : null,
      avg_realized_ret_net: row.realized_n > 0 ? row.realized_ret_sum / row.realized_n : null,
    }))
    .sort((a, b) => (toNum(b.avg_realized_ret_net) || -Infinity) - (toNum(a.avg_realized_ret_net) || -Infinity));

  const minSampleN = Math.max(10, Number(process.env.EVENT_TRUTH_ALPHA_MIN_REALIZED_N || 30));
  const minPositiveRate = Math.max(0, Math.min(1, Number(process.env.EVENT_TRUTH_ALPHA_MIN_POSITIVE_RATE || 0.5)));
  const minAvgRetNet = Number(process.env.EVENT_TRUTH_ALPHA_MIN_AVG_REALIZED_RET_NET || 0);
  const avgRealizedRetNet = avg(realizedRows.map((row) => row.label_snapshot && row.label_snapshot.realized_ret_net));
  const positiveRate = realizedRows.length > 0 ? positiveRows.length / realizedRows.length : null;
  const tp0ToTp1ConversionRate = tp0HitRows.length > 0 ? tp0ToTp1Rows.length / tp0HitRows.length : null;

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

  return {
    status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
    alpha_ready: blockingReasons.length === 0,
    evidence_status: evidenceStatus,
    strict_event_truth_only: strictEventTruthOnly,
    immutable_source: item.immutable_source === true,
    source_collection: norm(item.source_collection),
    dataset_hash: norm(item.dataset_hash),
    manifest_hash: norm(manifest.manifest_hash),
    rows_n: rows.length,
    executed_rows_n: executedRows.length,
    realized_rows_n: realizedRows.length,
    positive_n: positiveRows.length,
    negative_n: negativeRows.length,
    positive_rate: positiveRate,
    avg_realized_ret_net: avgRealizedRetNet,
    avg_realized_pnl_quote: avg(realizedRows.map((row) => row.label_snapshot && row.label_snapshot.realized_pnl_quote)),
    tp0_hit_rate: executedRows.length > 0 ? tp0HitRows.length / executedRows.length : null,
    tp0_to_tp1_conversion_rate: tp0ToTp1ConversionRate,
    top_positive_market: marketRows[0] ? marketRows[0].market : null,
    top_negative_market: marketRows.slice().sort((a, b) => (toNum(a.avg_realized_ret_net) || Infinity) - (toNum(b.avg_realized_ret_net) || Infinity))[0]?.market || null,
    by_market: marketRows.slice(0, 10),
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildEventTruthAlphaValidation,
  __test: {
    normalizeDataset,
  },
};
