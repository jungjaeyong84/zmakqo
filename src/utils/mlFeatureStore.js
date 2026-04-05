"use strict";

const { buildArtifactVersion } = require("./mlArtifactVersion");

const ML_FEATURE_STORE_SCHEMA_VERSION = "2026-04-05.v1";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readRows(value) {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value.rows) ? value.rows : [];
}

function classifyFeatureValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number" && Number.isFinite(value)) return "NUMERIC";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return "NUMERIC";
    const upper = trimmed.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return "BOOLEAN";
    return "CATEGORICAL";
  }
  return "OBJECT";
}

function buildMlFeatureStore(value = null) {
  const rows = readRows(value);
  const featureStats = new Map();
  const rowIndex = [];

  for (const row of rows) {
    const features = row && row.features && typeof row.features === "object" && !Array.isArray(row.features)
      ? row.features
      : {};
    rowIndex.push({
      row_id: String(row && row.row_id || "").trim() || null,
      market: String(row && row.context && row.context.market || "").trim().toUpperCase() || null,
      tf: String(row && row.context && row.context.tf || "").trim() || null,
      event: String(row && row.context && row.context.event || "").trim().toUpperCase() || null,
      source_row_type: String(row && row.context && row.context.source_row_type || "").trim().toUpperCase() || null,
      feature_keys_n: Object.keys(features).length,
    });

    for (const [key, rawValue] of Object.entries(features)) {
      const kind = classifyFeatureValue(rawValue);
      if (!kind) continue;
      if (!featureStats.has(key)) {
        featureStats.set(key, {
          key,
          presence_n: 0,
          numeric_n: 0,
          boolean_n: 0,
          categorical_n: 0,
          object_n: 0,
        });
      }
      const stat = featureStats.get(key);
      stat.presence_n += 1;
      if (kind === "NUMERIC") stat.numeric_n += 1;
      else if (kind === "BOOLEAN") stat.boolean_n += 1;
      else if (kind === "CATEGORICAL") stat.categorical_n += 1;
      else stat.object_n += 1;
    }
  }

  const featureCatalog = Array.from(featureStats.values())
    .map((item) => ({
      ...item,
      dominant_type:
        item.numeric_n >= item.boolean_n && item.numeric_n >= item.categorical_n && item.numeric_n >= item.object_n ? "NUMERIC"
          : item.boolean_n >= item.categorical_n && item.boolean_n >= item.object_n ? "BOOLEAN"
            : item.categorical_n >= item.object_n ? "CATEGORICAL"
              : "OBJECT",
    }))
    .sort((a, b) => (b.presence_n - a.presence_n) || a.key.localeCompare(b.key));

  const version = buildArtifactVersion({
    artifactType: "ML_FEATURE_STORE",
    schemaVersion: ML_FEATURE_STORE_SCHEMA_VERSION,
    sourceMode: value && value.source_mode,
    sourceCycleId: value && value.source_cycle_id,
    window: value && value.source_window,
    rows: rowIndex.map((row) => ({ row_id: row.row_id })),
  });

  return {
    schema_version: ML_FEATURE_STORE_SCHEMA_VERSION,
    source_schema_version: String(value && value.schema_version || "").trim() || null,
    source_cycle_id: String(value && value.source_cycle_id || "").trim() || null,
    source_dataset_version_id: String(value && value.dataset_version && value.dataset_version.version_id || "").trim() || null,
    feature_store_version: version,
    summary: {
      rows_n: rows.length,
      feature_keys_n: featureCatalog.length,
      numeric_feature_keys_n: featureCatalog.filter((item) => item.dominant_type === "NUMERIC").length,
      boolean_feature_keys_n: featureCatalog.filter((item) => item.dominant_type === "BOOLEAN").length,
      categorical_feature_keys_n: featureCatalog.filter((item) => item.dominant_type === "CATEGORICAL").length,
      object_feature_keys_n: featureCatalog.filter((item) => item.dominant_type === "OBJECT").length,
      dense_row_n: rowIndex.filter((row) => (toNum(row.feature_keys_n) || 0) > 0).length,
      sparse_row_n: rowIndex.filter((row) => (toNum(row.feature_keys_n) || 0) === 0).length,
      status: rows.length > 0 && featureCatalog.length > 0 ? "FEATURE_STORE_READY" : "FEATURE_STORE_EMPTY",
      schema_version: ML_FEATURE_STORE_SCHEMA_VERSION,
      version_id: version.version_id,
    },
    feature_catalog: featureCatalog,
    row_index: rowIndex,
  };
}

module.exports = {
  ML_FEATURE_STORE_SCHEMA_VERSION,
  buildMlFeatureStore,
};
