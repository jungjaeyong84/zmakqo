"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
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

function mean(values = []) {
  const nums = values.map(toNum).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
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

const SHARED_FEATURE_PATHS = Object.freeze([
  "execution.entry_schedule_profile",
  "execution.entry_schedule_reason",
  "execution.entry_schedule_note_kind",
  "execution.status",
  "context.primary_fill_source",
  "features.reason",
  "features.action",
  "features.pos_state",
  "features.pro_conflict",
  "features.score_bucket",
  "features._entry_exec_timing",
  "features.ai_signal.ai_decision",
  "features.signal_family",
  "features.source_origin",
]);
const GENERIC_SHARED_FEATURE_PATHS = new Set([
  "features.ai_signal.ai_decision",
  "features.signal_family",
  "features.source_origin",
]);
const GENERIC_SHARED_VALUES = new Set(["UNKNOWN", "ALLOW"]);

function summarizeSharedFeatures(rows = [], minShare = 0.6) {
  const result = [];
  const total = Array.isArray(rows) ? rows.length : 0;
  if (!total) return result;
  for (const path of SHARED_FEATURE_PATHS) {
    const counts = new Map();
    for (const row of rows) {
      const value = normalizeText(getPath(row, path)) || "UNKNOWN";
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    const top = Array.from(counts.entries())
      .map(([value, rowsN]) => ({ path, value, rows_n: rowsN, share: rowsN / total }))
      .sort((a, b) => {
        const shareDelta = (b.share || 0) - (a.share || 0);
        if (shareDelta !== 0) return shareDelta;
        return String(a.path || "").localeCompare(String(b.path || ""));
      })[0];
    if (top && top.share >= minShare) result.push(top);
  }
  const rankOf = (path) => {
    const idx = SHARED_FEATURE_PATHS.indexOf(path);
    return idx >= 0 ? idx : SHARED_FEATURE_PATHS.length + 1;
  };
  return result.sort((a, b) => {
    const shareDelta = (b.share || 0) - (a.share || 0);
    if (shareDelta !== 0) return shareDelta;
    return rankOf(a.path) - rankOf(b.path);
  });
}

function pickTopMeaningfulSharedFeature(features = []) {
  const rankOf = (path) => {
    const idx = SHARED_FEATURE_PATHS.indexOf(path);
    return idx >= 0 ? idx : SHARED_FEATURE_PATHS.length + 1;
  };
  const meaningful = (Array.isArray(features) ? features : []).filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (GENERIC_SHARED_FEATURE_PATHS.has(row.path)) return false;
    if (GENERIC_SHARED_VALUES.has(String(row.value || "").trim().toUpperCase())) return false;
    return true;
  });
  const target = (meaningful.length ? meaningful : (Array.isArray(features) ? features : [])).slice().sort((a, b) => {
    const rankDelta = rankOf(a.path) - rankOf(b.path);
    if (rankDelta !== 0) return rankDelta;
    return (b.share || 0) - (a.share || 0);
  })[0];
  return target || null;
}

function summarizeNumericProfile(rows = []) {
  const signalToIntent = rows.map((row) => getPath(row, "execution.signal_to_intent_ms"));
  const createdToFill = rows.map((row) => getPath(row, "execution.created_to_fill_ms"));
  const slippage = rows.map((row) => getPath(row, "execution.slippage_bps"));
  return {
    rows_n: Array.isArray(rows) ? rows.length : 0,
    signal_to_intent_p50_ms: percentile(signalToIntent, 0.5),
    signal_to_intent_p95_ms: percentile(signalToIntent, 0.95),
    created_to_fill_p50_ms: percentile(createdToFill, 0.5),
    created_to_fill_p95_ms: percentile(createdToFill, 0.95),
    slippage_avg_bps: mean(slippage),
    slippage_p50_bps: percentile(slippage, 0.5),
  };
}

function summarizeContextProfiles(rows = [], limit = 5) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [
      normalizeText(getPath(row, "features.reason")) || "UNKNOWN",
      normalizeText(getPath(row, "features.action")) || "UNKNOWN",
      normalizeText(getPath(row, "features.pos_state")) || "UNKNOWN",
      normalizeText(getPath(row, "features.score_bucket")) || "UNKNOWN",
      normalizeText(getPath(row, "execution.entry_schedule_profile")) || "UNKNOWN",
    ].join("|");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, rows_n]) => ({ key, rows_n }))
    .sort((a, b) => b.rows_n - a.rows_n)
    .slice(0, limit);
}

function buildRowMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(row && row.row_id);
    if (key) map.set(key, row);
  }
  return map;
}

function pickReferenceRows({ parsedGroup = {}, inferenceRows = [], rowMap = new Map() } = {}) {
  const exact = (Array.isArray(inferenceRows) ? inferenceRows : []).filter((row) => (
    normalizeText(row.actual_scope) === normalizeText(parsedGroup.pred_class)
    && normalizeText(row.pred_class) === normalizeText(parsedGroup.pred_class)
    && normalizeText(row.source) === normalizeText(parsedGroup.source)
    && normalizeText(row.event) === normalizeText(parsedGroup.event)
    && normalizeText(row.market) === normalizeText(parsedGroup.market)
  ));
  if (exact.length) {
    return {
      mode: "EXACT_SOURCE_EVENT_MARKET",
      rows: exact.map((row) => rowMap.get(row.row_id)).filter(Boolean),
    };
  }
  const relaxed = (Array.isArray(inferenceRows) ? inferenceRows : []).filter((row) => (
    normalizeText(row.actual_scope) === normalizeText(parsedGroup.pred_class)
    && normalizeText(row.pred_class) === normalizeText(parsedGroup.pred_class)
    && normalizeText(row.source) === normalizeText(parsedGroup.source)
    && normalizeText(row.event) === normalizeText(parsedGroup.event)
  ));
  return {
    mode: "SOURCE_EVENT_FALLBACK",
    rows: relaxed.map((row) => rowMap.get(row.row_id)).filter(Boolean),
  };
}

function summarizeExecutionScopeFalsePositiveDiagnostics({
  executionEntryDataset = null,
  executionScopeInference = null,
} = {}) {
  const datasetRows = executionEntryDataset && Array.isArray(executionEntryDataset.rows) ? executionEntryDataset.rows : [];
  const inferenceSummary = executionScopeInference && executionScopeInference.summary && typeof executionScopeInference.summary === "object"
    ? executionScopeInference.summary
    : (executionScopeInference || {});
  const inferenceRows = executionScopeInference && Array.isArray(executionScopeInference.rows) ? executionScopeInference.rows : [];
  const topGroup = Array.isArray(inferenceSummary.top_false_positive_groups) ? inferenceSummary.top_false_positive_groups[0] : null;
  if (!topGroup || !normalizeText(topGroup.key)) {
    return {
      summary: {
        status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_EMPTY",
        top_false_positive_group: null,
        top_false_positive_rows_n: 0,
      },
      rows: [],
    };
  }

  const parsedGroup = parseGroupKey(topGroup.key);
  const rowMap = buildRowMap(datasetRows);
  const groupInferenceRows = inferenceRows.filter((row) => (
    normalizeText(row.actual_scope) === parsedGroup.actual_scope
    && normalizeText(row.pred_class) === parsedGroup.pred_class
    && normalizeText(row.source) === parsedGroup.source
    && normalizeText(row.event) === parsedGroup.event
    && normalizeText(row.market) === parsedGroup.market
  ));
  const groupRows = groupInferenceRows.map((row) => rowMap.get(row.row_id)).filter(Boolean);
  const reference = pickReferenceRows({ parsedGroup, inferenceRows, rowMap });
  const topSharedFeatures = summarizeSharedFeatures(groupRows).slice(0, 6);
  const referenceSharedFeatures = summarizeSharedFeatures(reference.rows).slice(0, 4);
  const topMeaningfulSharedFeature = pickTopMeaningfulSharedFeature(topSharedFeatures);
  const topMeaningfulReferenceFeature = pickTopMeaningfulSharedFeature(referenceSharedFeatures);
  const topContextProfiles = summarizeContextProfiles(groupRows);
  const groupProfile = summarizeNumericProfile(groupRows);
  const referenceProfile = summarizeNumericProfile(reference.rows);

  return {
    summary: {
      status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY",
      top_false_positive_group: topGroup.key,
      top_false_positive_rows_n: toNum(topGroup.rows_n),
      pred_class: parsedGroup.pred_class,
      actual_scope: parsedGroup.actual_scope,
      source: parsedGroup.source,
      event: parsedGroup.event,
      market: parsedGroup.market,
      top_shared_feature: topMeaningfulSharedFeature
        ? `${topMeaningfulSharedFeature.path}=${topMeaningfulSharedFeature.value}`
        : null,
      top_shared_features: topSharedFeatures,
      top_context_profile: topContextProfiles[0] ? topContextProfiles[0].key : null,
      top_context_profiles: topContextProfiles,
      reference_group_mode: reference.mode,
      reference_rows_n: referenceProfile.rows_n,
      reference_top_shared_feature: topMeaningfulReferenceFeature
        ? `${topMeaningfulReferenceFeature.path}=${topMeaningfulReferenceFeature.value}`
        : null,
      group_signal_to_intent_p50_ms: groupProfile.signal_to_intent_p50_ms,
      group_created_to_fill_p50_ms: groupProfile.created_to_fill_p50_ms,
      reference_signal_to_intent_p50_ms: referenceProfile.signal_to_intent_p50_ms,
      reference_created_to_fill_p50_ms: referenceProfile.created_to_fill_p50_ms,
    },
    rows: groupInferenceRows.map((row) => ({
      row_id: row.row_id,
      actual_scope: row.actual_scope,
      pred_class: row.pred_class,
      market: row.market,
      source: row.source,
      event: row.event,
      pred_class_prob: row.pred_class_prob,
    })),
  };
}

module.exports = {
  summarizeExecutionScopeFalsePositiveDiagnostics,
};
