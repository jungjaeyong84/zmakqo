"use strict";

const fs = require("fs");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toIsoOrNull(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readJsonlRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function scoreSourceFeedRowRichness(row = {}) {
  const features = row && row.features_json && typeof row.features_json === "object"
    ? row.features_json
    : {};
  const criticalFields = [
    "market_quality_score",
    "spread_bps",
    "funding_rate",
    "btc_1h_trend",
    "mtf_1h_direction",
    "feature_lineage_source",
    "signal_price",
    "stop_price",
    "target_price",
  ];
  let score = 0;
  for (const field of criticalFields) {
    if (features[field] !== null && features[field] !== undefined && features[field] !== "") score += 1;
  }
  return score;
}

function toUpperOrNull(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildSourceFeedSemanticFingerprint(row = {}) {
  const features = row && row.features_json && typeof row.features_json === "object"
    ? row.features_json
    : {};
  return JSON.stringify({
    event: toUpperOrNull(row && row.event),
    event_intent: toUpperOrNull(row && row.event_intent),
    side: toUpperOrNull(row && row.side),
    exchange: toUpperOrNull(row && row.exchange),
    tf: trimOrNull(row && row.tf),
    reason: trimOrNull(row && row.reason),
    setup_type: toUpperOrNull(features.setup_type),
    trigger_type: toUpperOrNull(features.trigger_type),
    entry_grade: toUpperOrNull(features.entry_grade),
    source_band: toUpperOrNull(features.source_band),
    market_state: toUpperOrNull(features.market_state),
    htf_bias: toUpperOrNull(features.htf_bias),
    risk_mode: toUpperOrNull(features.risk_mode),
    edge_cohort: toUpperOrNull(features.edge_cohort),
    structural_regime: toUpperOrNull(features.structural_regime),
    opportunity_score: toNumberOrNull(features.opportunity_score),
    confidence: toNumberOrNull(features.confidence),
    setup_quality_score: toNumberOrNull(features.setup_quality_score),
    structure_alignment: toNumberOrNull(features.structure_alignment),
    htf_alignment_score: toNumberOrNull(features.htf_alignment_score),
    market_quality_score: toNumberOrNull(features.market_quality_score),
    spread_bps: toNumberOrNull(features.spread_bps),
    funding_rate: toNumberOrNull(features.funding_rate),
    btc_1h_trend: toUpperOrNull(features.btc_1h_trend),
    mtf_1h_direction: toUpperOrNull(features.mtf_1h_direction),
    feature_lineage_source: toUpperOrNull(features.feature_lineage_source),
    rr: toNumberOrNull(features.rr),
    signal_price: toNumberOrNull(features.signal_price),
    stop_price: toNumberOrNull(features.stop_price),
    target_price: toNumberOrNull(features.target_price),
  });
}

function shouldReplaceSourceFeedRow(currentRow = {}, nextRow = {}) {
  const currentFingerprint = buildSourceFeedSemanticFingerprint(currentRow);
  const nextFingerprint = buildSourceFeedSemanticFingerprint(nextRow);
  if (currentFingerprint !== nextFingerprint) return true;
  const currentScore = scoreSourceFeedRowRichness(currentRow);
  const nextScore = scoreSourceFeedRowRichness(nextRow);
  if (nextScore !== currentScore) return nextScore > currentScore;
  const currentFeatures = currentRow && currentRow.features_json && typeof currentRow.features_json === "object"
    ? currentRow.features_json
    : {};
  const nextFeatures = nextRow && nextRow.features_json && typeof nextRow.features_json === "object"
    ? nextRow.features_json
    : {};
  return Object.keys(nextFeatures).length > Object.keys(currentFeatures).length;
}

function filterImportableV3SourceSignals(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row && row.reason || "").trim() === "V2_SERVER_NATIVE_GENERATOR")
    .filter((row) => String(row && row.event_intent || "").trim() === "ENTRY")
    .filter((row) => String(row && row.exchange || "").trim().toUpperCase() === "BINANCEFUT")
    .sort((a, b) => String(a && a.created_at || "").localeCompare(String(b && b.created_at || "")));
}

function appendV3SourceFeedRows(feedPath, rows = []) {
  const existingRows = readJsonlRows(feedPath);
  const rowMap = new Map();
  const orderedIds = [];
  for (const row of existingRows) {
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId || rowMap.has(signalId)) continue;
    orderedIds.push(signalId);
    rowMap.set(signalId, row);
  }
  let appended = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId) continue;
    if (!rowMap.has(signalId)) {
      orderedIds.push(signalId);
      rowMap.set(signalId, row);
      appended += 1;
      continue;
    }
    const currentRow = rowMap.get(signalId);
    if (shouldReplaceSourceFeedRow(currentRow, row)) {
      rowMap.set(signalId, row);
      appended += 1;
    }
  }
  if (appended > 0) {
    const payloads = orderedIds.map((signalId) => JSON.stringify(rowMap.get(signalId)));
    fs.writeFileSync(feedPath, payloads.length ? `${payloads.join("\n")}\n` : "");
  }
  return appended;
}

function resolveV3SourceFeedSinceIso({
  checkpoint = null,
  now = new Date(),
  lookbackMinutes = 180,
  overlapMinutes = 15,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("V3_SOURCE_FEED_NOW_INVALID");
  const checkpointIso = toIsoOrNull(checkpoint && checkpoint.last_fetched_created_at);
  const overlapMs = Math.max(0, Number(overlapMinutes) || 0) * 60 * 1000;
  if (checkpointIso) {
    const checkpointMs = new Date(checkpointIso).getTime();
    return new Date(Math.max(0, checkpointMs - overlapMs)).toISOString();
  }
  const lookbackMs = Math.max(1, Number(lookbackMinutes) || 180) * 60 * 1000;
  return new Date(Math.max(0, nowMs - lookbackMs)).toISOString();
}

function buildV3SourceFeedCheckpoint({
  previousCheckpoint = null,
  fetchedRows = [],
  importedRows = [],
  now = new Date(),
  lookbackMinutes = 180,
  overlapMinutes = 15,
} = {}) {
  let lastFetchedCreatedAt = toIsoOrNull(previousCheckpoint && previousCheckpoint.last_fetched_created_at);
  let lastImportedCreatedAt = toIsoOrNull(previousCheckpoint && previousCheckpoint.last_imported_created_at);

  for (const row of Array.isArray(fetchedRows) ? fetchedRows : []) {
    const createdAt = toIsoOrNull(row && row.created_at);
    if (createdAt && (!lastFetchedCreatedAt || createdAt > lastFetchedCreatedAt)) {
      lastFetchedCreatedAt = createdAt;
    }
  }
  for (const row of Array.isArray(importedRows) ? importedRows : []) {
    const createdAt = toIsoOrNull(row && row.created_at);
    if (createdAt && (!lastImportedCreatedAt || createdAt > lastImportedCreatedAt)) {
      lastImportedCreatedAt = createdAt;
    }
  }

  return Object.freeze({
    generated_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    last_fetched_created_at: lastFetchedCreatedAt,
    last_imported_created_at: lastImportedCreatedAt,
    fetched_row_n: Array.isArray(fetchedRows) ? fetchedRows.length : 0,
    imported_row_n: Array.isArray(importedRows) ? importedRows.length : 0,
    lookback_minutes: Math.max(1, Number(lookbackMinutes) || 180),
    overlap_minutes: Math.max(0, Number(overlapMinutes) || 0),
  });
}

function resolveAdaptiveKlineLimit({
  checkpoint = null,
  now = new Date(),
  intervalMs,
  fallbackLimit,
  minHistoryBars = 260,
  maxLimit = 1500,
} = {}) {
  const normalizedNow = now instanceof Date ? now : new Date(now);
  const nowMs = normalizedNow.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("V3_SOURCE_KLINE_LIMIT_NOW_INVALID");
  const baseLimit = Math.max(1, Math.trunc(Number(fallbackLimit) || 260));
  const historyBars = Math.max(1, Math.trunc(Number(minHistoryBars) || 260));
  const hardCap = Math.max(historyBars, Math.trunc(Number(maxLimit) || 1500));
  const stepMs = Math.max(60 * 1000, Math.trunc(Number(intervalMs) || 0));
  const checkpointIso = toIsoOrNull(
    checkpoint && (checkpoint.last_imported_created_at || checkpoint.last_fetched_created_at)
  );
  if (!checkpointIso) return Math.min(hardCap, Math.max(baseLimit, historyBars));
  const checkpointMs = new Date(checkpointIso).getTime();
  if (!Number.isFinite(checkpointMs)) return Math.min(hardCap, Math.max(baseLimit, historyBars));
  const downtimeMs = Math.max(0, nowMs - checkpointMs);
  const catchupBars = Math.ceil(downtimeMs / stepMs);
  return Math.min(hardCap, Math.max(baseLimit, historyBars + catchupBars));
}

module.exports = Object.freeze({
  readJsonlRows,
  readJsonSafe,
  filterImportableV3SourceSignals,
  appendV3SourceFeedRows,
  resolveV3SourceFeedSinceIso,
  buildV3SourceFeedCheckpoint,
  resolveAdaptiveKlineLimit,
  __test: {
    buildSourceFeedSemanticFingerprint,
    scoreSourceFeedRowRichness,
    shouldReplaceSourceFeedRow,
    resolveAdaptiveKlineLimit,
  },
});
