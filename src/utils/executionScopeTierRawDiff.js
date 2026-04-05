"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getPath(row, path) {
  const parts = String(path || "").split(".");
  let cur = row;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

function buildRowMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(row && row.row_id);
    if (key) map.set(key, row);
  }
  return map;
}

function parseGroupKey(key = "") {
  const [actualScope, predClass, source, event, market] = String(key || "").split("|");
  return {
    actual_scope: normalizeText(actualScope),
    pred_class: normalizeText(predClass),
    source: normalizeText(source),
    event: normalizeText(event),
    market: normalizeText(market),
  };
}

function percentile(values = [], q = 0.5) {
  const nums = values.map(toNum).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const pos = Math.max(0, Math.min(nums.length - 1, (nums.length - 1) * q));
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return nums[low];
  const weight = pos - low;
  return nums[low] + ((nums[high] - nums[low]) * weight);
}

function countBy(rows = [], keyFn, limit = 8) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(keyFn(row)) || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, rows_n]) => ({ key, rows_n }))
    .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function profileRows(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  return {
    rows_n: scoped.length,
    signal_to_intent_p50_ms: percentile(scoped.map((row) => getPath(row, "execution.signal_to_intent_ms")), 0.5),
    created_to_fill_p50_ms: percentile(scoped.map((row) => getPath(row, "execution.created_to_fill_ms")), 0.5),
    top_reason: countBy(scoped, (row) => getPath(row, "features.reason"), 1)[0]?.key || null,
    top_action: countBy(scoped, (row) => getPath(row, "features.action"), 1)[0]?.key || null,
    top_pos_state: countBy(scoped, (row) => getPath(row, "features.pos_state"), 1)[0]?.key || null,
    top_schedule_profile: countBy(scoped, (row) => getPath(row, "execution.entry_schedule_profile"), 1)[0]?.key || null,
    top_signal_to_intent_bucket: countBy(scoped, (row) => getPath(row, "execution.signal_to_intent_bucket"), 1)[0]?.key || null,
    top_score_bucket: countBy(scoped, (row) => getPath(row, "features.score_bucket"), 1)[0]?.key || null,
    top_policy_block_hint: countBy(scoped, (row) => getPath(row, "features.policy_block_hint"), 1)[0]?.key || null,
    top_stale_pos_entry_latency_profile: countBy(scoped, (row) => getPath(row, "features.stale_pos_entry_latency_profile"), 1)[0]?.key || null,
    top_stale_pos_webhook_profile: countBy(scoped, (row) => getPath(row, "features.stale_pos_webhook_profile"), 1)[0]?.key || null,
    top_webhook_execution_profile: countBy(scoped, (row) => getPath(row, "features.webhook_execution_profile"), 1)[0]?.key || null,
  };
}

function findInferenceRowsForGroup(inferenceRows = [], parsed = null) {
  return (Array.isArray(inferenceRows) ? inferenceRows : []).filter((row) => (
    normalizeText(row.actual_scope) === normalizeText(parsed && parsed.actual_scope)
    && normalizeText(row.pred_class) === normalizeText(parsed && parsed.pred_class)
    && normalizeText(row.source) === normalizeText(parsed && parsed.source)
    && normalizeText(row.event) === normalizeText(parsed && parsed.event)
    && normalizeText(row.market) === normalizeText(parsed && parsed.market)
  ));
}

function findReferenceRows(inferenceRows = [], rowMap = new Map(), parsed = null) {
  const exact = (Array.isArray(inferenceRows) ? inferenceRows : []).filter((row) => (
    normalizeText(row.actual_scope) === normalizeText(parsed && parsed.pred_class)
    && normalizeText(row.pred_class) === normalizeText(parsed && parsed.pred_class)
    && normalizeText(row.source) === normalizeText(parsed && parsed.source)
    && normalizeText(row.event) === normalizeText(parsed && parsed.event)
    && normalizeText(row.market) === normalizeText(parsed && parsed.market)
  ));
  if (exact.length) {
    return {
      mode: "EXACT_SOURCE_EVENT_MARKET",
      rows: exact.map((row) => rowMap.get(row.row_id)).filter(Boolean),
    };
  }
  const fallback = (Array.isArray(inferenceRows) ? inferenceRows : []).filter((row) => (
    normalizeText(row.actual_scope) === normalizeText(parsed && parsed.pred_class)
    && normalizeText(row.pred_class) === normalizeText(parsed && parsed.pred_class)
    && normalizeText(row.source) === normalizeText(parsed && parsed.source)
    && normalizeText(row.event) === normalizeText(parsed && parsed.event)
  ));
  return {
    mode: "SOURCE_EVENT_FALLBACK",
    rows: fallback.map((row) => rowMap.get(row.row_id)).filter(Boolean),
  };
}

function summarizeExecutionScopeTierRawDiff({
  executionEntryDataset = null,
  executionScopeInference = null,
  executionScopeTierDiagnostics = null,
} = {}) {
  const datasetRows = executionEntryDataset && Array.isArray(executionEntryDataset.rows) ? executionEntryDataset.rows : [];
  const inferenceRows = executionScopeInference && Array.isArray(executionScopeInference.rows) ? executionScopeInference.rows : [];
  const tierSummary = executionScopeTierDiagnostics && executionScopeTierDiagnostics.summary && typeof executionScopeTierDiagnostics.summary === "object"
    ? executionScopeTierDiagnostics.summary
    : (executionScopeTierDiagnostics || {});
  const topGroupKey = normalizeText(tierSummary.top_false_positive_group);
  if (!topGroupKey) {
    return {
      summary: {
        status: "EXECUTION_SCOPE_TIER_RAW_DIFF_EMPTY",
        target_tier: normalizeText(tierSummary.target_tier),
        top_false_positive_group: null,
      },
      rows: [],
    };
  }

  const rowMap = buildRowMap(datasetRows);
  const parsed = parseGroupKey(topGroupKey);
  const mismatchInferenceRows = findInferenceRowsForGroup(inferenceRows, parsed);
  const mismatchRows = mismatchInferenceRows.map((row) => rowMap.get(row.row_id)).filter(Boolean);
  const reference = findReferenceRows(inferenceRows, rowMap, parsed);

  return {
    summary: {
      status: "EXECUTION_SCOPE_TIER_RAW_DIFF_READY",
      target_tier: normalizeText(tierSummary.target_tier),
      top_false_positive_group: topGroupKey,
      top_false_positive_rows_n: mismatchRows.length,
      reference_group_mode: reference.mode,
      mismatch_profile: profileRows(mismatchRows),
      reference_profile: profileRows(reference.rows),
      mismatch_top_policy_block_hints: countBy(mismatchRows, (row) => getPath(row, "features.policy_block_hint")),
      reference_top_policy_block_hints: countBy(reference.rows, (row) => getPath(row, "features.policy_block_hint")),
    },
    rows: mismatchInferenceRows.map((row) => {
      const doc = rowMap.get(row.row_id);
      return {
        row_id: row.row_id,
        actual_scope: row.actual_scope,
        pred_class: row.pred_class,
        pred_class_prob: row.pred_class_prob,
        source: row.source,
        event: row.event,
        market: row.market,
        reason: getPath(doc, "features.reason"),
        action: getPath(doc, "features.action"),
        pos_state: getPath(doc, "features.pos_state"),
        pro_conflict: getPath(doc, "features.pro_conflict"),
        score_bucket: getPath(doc, "features.score_bucket"),
        policy_block_hint: getPath(doc, "features.policy_block_hint"),
        stale_pos_entry_profile: getPath(doc, "features.stale_pos_entry_profile"),
        stale_pos_entry_latency_profile: getPath(doc, "features.stale_pos_entry_latency_profile"),
        stale_pos_webhook_profile: getPath(doc, "features.stale_pos_webhook_profile"),
        webhook_execution_profile: getPath(doc, "features.webhook_execution_profile"),
        entry_schedule_profile: getPath(doc, "execution.entry_schedule_profile"),
        signal_to_intent_bucket: getPath(doc, "execution.signal_to_intent_bucket"),
        signal_to_intent_ms: getPath(doc, "execution.signal_to_intent_ms"),
        created_to_fill_ms: getPath(doc, "execution.created_to_fill_ms"),
      };
    }),
  };
}

module.exports = {
  summarizeExecutionScopeTierRawDiff,
};
