"use strict";

const crypto = require("crypto");

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function buildArtifactVersion({ artifactType, schemaVersion, sourceMode = null, sourceCycleId = null, window = null, rows = [] } = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const rowIds = normalizedRows
    .map((row) => String(row && (row.row_id || row.intent_id || row.feature_row_id || row.id) || "").trim())
    .filter(Boolean)
    .sort();
  const manifest = {
    artifact_type: String(artifactType || "UNKNOWN").trim().toUpperCase(),
    schema_version: String(schemaVersion || "").trim() || null,
    source_mode: String(sourceMode || "").trim().toUpperCase() || null,
    source_cycle_id: String(sourceCycleId || "").trim() || null,
    window: window && typeof window === "object" ? {
      from_ms: Number.isFinite(Number(window.fromMs)) ? Number(window.fromMs) : (Number.isFinite(Number(window.from_ms)) ? Number(window.from_ms) : null),
      to_ms: Number.isFinite(Number(window.toMs)) ? Number(window.toMs) : (Number.isFinite(Number(window.to_ms)) ? Number(window.to_ms) : null),
      source: String(window.source || "").trim().toUpperCase() || null,
    } : null,
    row_count: rowIds.length,
    row_id_sha1: sha1(stableStringify(rowIds)),
  };
  const versionId = sha1(stableStringify(manifest)).slice(0, 16);
  return {
    manifest,
    version_id: `${manifest.artifact_type || "ARTIFACT"}__${versionId}`,
  };
}

module.exports = {
  stableStringify,
  sha1,
  buildArtifactVersion,
};
