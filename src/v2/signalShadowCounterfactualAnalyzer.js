"use strict";

// V2 Signal Shadow Counterfactual Analyzer (F2).
//
// Consumes CLOSED records from `v2__signal_shadow_counterfactuals`
// (written by signalShadowCounterfactualLedger.js) and produces
// per-filter precision and counterfactual PnL drag metrics, plus a
// leave-one-out attribution that isolates each filter's marginal
// contribution by separating records where the filter was the SOLE
// blocker from records where it co-occurred with other blockers.
//
// Design constraints:
// - Pure analytic functions accept a record array and return a
//   deterministic summary. No Firestore I/O in this module — the
//   companion CLI script does the read.
// - All metrics are evidence proxies, not promotion verdicts. The
//   promotion gate (F3) is responsible for thresholding.
// - PnL "drag" is computed as the negative of mean `exit_close_pct`
//   among records the filter WOULD have blocked. A more-negative
//   drag means the filter would have removed more losing trades.
// - Precision proxy: among records the filter said WOULD_BLOCK,
//   what fraction actually closed with a non-positive exit close.
//   This is a *proxy* because we lack the full strategy exit logic;
//   the analysis layer should not pretend it equals true precision.

const STATUS_CLOSED = "CLOSED";

const REQUIRED_FILTER_IDS = Object.freeze([
  "BTC_1H_TREND_ALT_LONG",
  "MULTI_TF_1H_ALIGNMENT",
  "VOLATILITY_CHAOS_30M",
  "COST_ADJUSTED_EDGE",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function uniqueSorted(values) {
  return Array.from(new Set(asArray(values).filter((v) => trimOrNull(v) !== null).map((v) => String(v))))
    .sort();
}

function isClosedWithKlines(record) {
  if (!record || typeof record !== "object") return false;
  if (upper(record.status) !== STATUS_CLOSED) return false;
  const barN = toNumberOrNull(record.bar_n_observed);
  if (barN === null || barN <= 0) return false;
  if (toNumberOrNull(record.mfe_pct) === null) return false;
  if (toNumberOrNull(record.mae_pct) === null) return false;
  if (toNumberOrNull(record.exit_close_pct) === null) return false;
  return true;
}

function summarizeNumericArray(values) {
  const list = asArray(values).map(toNumberOrNull).filter((v) => v !== null);
  if (list.length === 0) {
    return Object.freeze({
      n: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      min: null,
      max: null,
      stddev: null,
    });
  }
  const sorted = list.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((acc, v) => acc + ((v - mean) * (v - mean)), 0) / sorted.length;
  const stddev = Math.sqrt(variance);
  function quantile(q) {
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }
  return Object.freeze({
    n: sorted.length,
    mean,
    median: quantile(0.5),
    p25: quantile(0.25),
    p75: quantile(0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stddev,
  });
}

function buildPerFilterSummary({ filterId, records }) {
  const presentN = records.length;
  const wouldBlockRecords = records.filter((r) => asArray(r.would_block_filter_set).includes(filterId));
  const wouldPassRecords = records.filter((r) => asArray(r.would_pass_filter_set).includes(filterId));
  const insufficientRecords = records.filter((r) => asArray(r.insufficient_evidence_filter_set).includes(filterId));
  const blockedClosed = wouldBlockRecords.filter(isClosedWithKlines);
  const passedClosed = wouldPassRecords.filter(isClosedWithKlines);
  const blockedExitClose = blockedClosed.map((r) => toNumberOrNull(r.exit_close_pct));
  const passedExitClose = passedClosed.map((r) => toNumberOrNull(r.exit_close_pct));
  const blockedMfe = blockedClosed.map((r) => toNumberOrNull(r.mfe_pct));
  const blockedMae = blockedClosed.map((r) => toNumberOrNull(r.mae_pct));
  const blockedExitSummary = summarizeNumericArray(blockedExitClose);
  const passedExitSummary = summarizeNumericArray(passedExitClose);
  const trueNegativeN = blockedClosed.filter((r) => toNumberOrNull(r.exit_close_pct) <= 0).length;
  const falseBlockN = blockedClosed.filter((r) => toNumberOrNull(r.exit_close_pct) > 0).length;
  const precisionProxy = blockedClosed.length > 0
    ? trueNegativeN / blockedClosed.length
    : null;
  const pnlDragProxyR = blockedExitSummary.mean === null ? null : -blockedExitSummary.mean;
  return Object.freeze({
    filter_id: filterId,
    present_n: presentN,
    would_block_n: wouldBlockRecords.length,
    would_pass_n: wouldPassRecords.length,
    insufficient_evidence_n: insufficientRecords.length,
    blocked_closed_n: blockedClosed.length,
    passed_closed_n: passedClosed.length,
    blocked_exit_close_pct: blockedExitSummary,
    passed_exit_close_pct: passedExitSummary,
    blocked_mfe_pct: summarizeNumericArray(blockedMfe),
    blocked_mae_pct: summarizeNumericArray(blockedMae),
    true_negative_n: trueNegativeN,
    false_block_n: falseBlockN,
    precision_proxy: precisionProxy,
    pnl_drag_proxy_r: pnlDragProxyR,
  });
}

function buildLeaveOneOutSummary({ filterId, records }) {
  const recordsWhereFilterIsSoleBlocker = records.filter((r) => {
    const blockSet = asArray(r.would_block_filter_set);
    return blockSet.length === 1 && blockSet[0] === filterId;
  });
  const recordsWhereFilterCoBlocks = records.filter((r) => {
    const blockSet = asArray(r.would_block_filter_set);
    return blockSet.length > 1 && blockSet.includes(filterId);
  });
  const soleBlockerClosed = recordsWhereFilterIsSoleBlocker.filter(isClosedWithKlines);
  const coBlockerClosed = recordsWhereFilterCoBlocks.filter(isClosedWithKlines);
  return Object.freeze({
    filter_id: filterId,
    sole_blocker_n: recordsWhereFilterIsSoleBlocker.length,
    sole_blocker_closed_n: soleBlockerClosed.length,
    co_blocker_n: recordsWhereFilterCoBlocks.length,
    co_blocker_closed_n: coBlockerClosed.length,
    sole_blocker_exit_close_pct: summarizeNumericArray(
      soleBlockerClosed.map((r) => toNumberOrNull(r.exit_close_pct))
    ),
    co_blocker_exit_close_pct: summarizeNumericArray(
      coBlockerClosed.map((r) => toNumberOrNull(r.exit_close_pct))
    ),
    sole_blocker_pnl_drag_proxy_r: soleBlockerClosed.length === 0
      ? null
      : -summarizeNumericArray(soleBlockerClosed.map((r) => toNumberOrNull(r.exit_close_pct))).mean,
  });
}

function buildFilterCombinationSummary({ records }) {
  const buckets = new Map();
  for (const r of records) {
    if (!isClosedWithKlines(r)) continue;
    const blockSet = uniqueSorted(asArray(r.would_block_filter_set));
    const key = blockSet.join("|") || "__NONE__";
    const bucket = buckets.get(key) || {
      block_set: Object.freeze(blockSet),
      records: [],
    };
    bucket.records.push(r);
    buckets.set(key, bucket);
  }
  const result = [];
  for (const [, bucket] of buckets.entries()) {
    const exitArr = bucket.records.map((r) => toNumberOrNull(r.exit_close_pct));
    const summary = summarizeNumericArray(exitArr);
    result.push(Object.freeze({
      block_set: bucket.block_set,
      n: bucket.records.length,
      exit_close_pct: summary,
      pnl_drag_proxy_r: summary.mean === null ? null : -summary.mean,
    }));
  }
  result.sort((a, b) => b.n - a.n);
  return Object.freeze(result);
}

function buildAnalyzerReport({ records, generated_at_ms = Date.now(), filter_ids = REQUIRED_FILTER_IDS } = {}) {
  const list = asArray(records);
  const closedAll = list.filter((r) => upper(r && r.status) === STATUS_CLOSED);
  const closedWithKlines = list.filter(isClosedWithKlines);
  const expiredN = list.filter((r) => upper(r && r.status) === "EXPIRED").length;
  const pendingN = list.filter((r) => upper(r && r.status) === "PENDING").length;
  const allBlockExits = closedWithKlines
    .filter((r) => asArray(r.would_block_filter_set).length > 0)
    .map((r) => toNumberOrNull(r.exit_close_pct));
  const allPassExits = closedWithKlines
    .filter((r) => asArray(r.would_block_filter_set).length === 0)
    .map((r) => toNumberOrNull(r.exit_close_pct));
  const filterIds = Array.from(new Set([
    ...filter_ids,
    ...closedWithKlines.flatMap((r) => asArray(r.would_block_filter_set)),
    ...closedWithKlines.flatMap((r) => asArray(r.would_pass_filter_set)),
  ])).sort();
  const perFilter = filterIds.map((id) => buildPerFilterSummary({ filterId: id, records: closedWithKlines }));
  const leaveOneOut = filterIds.map((id) => buildLeaveOneOutSummary({ filterId: id, records: closedWithKlines }));
  const filterCombination = buildFilterCombinationSummary({ records: closedWithKlines });
  return Object.freeze({
    report_type: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS",
    generated_at_ms,
    generated_at_iso: new Date(generated_at_ms).toISOString(),
    sample: Object.freeze({
      total_record_n: list.length,
      closed_n: closedAll.length,
      closed_with_klines_n: closedWithKlines.length,
      pending_n: pendingN,
      expired_n: expiredN,
      any_block_exit_summary: summarizeNumericArray(allBlockExits),
      any_pass_exit_summary: summarizeNumericArray(allPassExits),
    }),
    per_filter: Object.freeze(perFilter),
    leave_one_out: Object.freeze(leaveOneOut),
    filter_combination: filterCombination,
  });
}

async function loadCounterfactualRecords({ db, batchLimit = 1000 } = {}) {
  if (!db) throw new Error("ANALYZER_FIRESTORE_DB_REQUIRED");
  if (typeof db.collection !== "function") throw new Error("ANALYZER_FIRESTORE_COLLECTION_UNAVAILABLE");
  const collection = db.collection("v2__signal_shadow_counterfactuals");
  let q = collection;
  if (typeof q.limit === "function") q = q.limit(batchLimit);
  const snap = typeof q.get === "function" ? await q.get() : null;
  const docs = snap && Array.isArray(snap.docs) ? snap.docs : [];
  return docs
    .map((doc) => (typeof doc.data === "function" ? doc.data() : null))
    .filter(Boolean);
}

module.exports = {
  REQUIRED_FILTER_IDS,
  STATUS_CLOSED,
  isClosedWithKlines,
  summarizeNumericArray,
  buildPerFilterSummary,
  buildLeaveOneOutSummary,
  buildFilterCombinationSummary,
  buildAnalyzerReport,
  loadCounterfactualRecords,
  __test: {
    uniqueSorted,
    asArray,
    toNumberOrNull,
  },
};
