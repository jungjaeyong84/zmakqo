"use strict";

const fs = require("fs");

function pickString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function fileExists(pathValue) {
  const filePath = pickString(pathValue);
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
}

function extractPineStrategyId(pathValue) {
  const filePath = pickString(pathValue);
  if (!filePath || !fileExists(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const match = raw.match(/STRATEGY_ID\s*=\s*\"([^\"]+)\"/);
    return match ? pickString(match[1]) : null;
  } catch (_err) {
    return null;
  }
}

function normalizePreparedOverride(raw = null) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw.raw && typeof raw.raw === "object" ? raw.raw : raw)
    : {};
  const preparedFilePath = pickString(src.prepared_file_path || src.applied_file_path);
  const latestGeneratedFilePath = pickString(src.latest_generated_file_path);
  const preparedStrategyId = pickString(src.prepared_strategy_id)
    || extractPineStrategyId(preparedFilePath)
    || extractPineStrategyId(latestGeneratedFilePath);
  const active = src.enabled !== false
    && !!preparedFilePath
    && !!preparedStrategyId
    && fileExists(preparedFilePath);
  return {
    active,
    prepared_file_path: preparedFilePath,
    latest_generated_file_path: latestGeneratedFilePath,
    prepared_strategy_id: preparedStrategyId,
    target_candidate_id: pickString(src.target_candidate_id),
    display_candidate_id: pickString(src.display_candidate_id),
    prepared_stage_ready: src.prepared_stage_ready !== false && active,
    ready_for_manual_paste: src.ready_for_manual_paste !== false && active,
    prepared_reason: pickString(src.prepared_reason) || (active ? "MANUAL_PREPARED_OVERRIDE" : null),
    override_source: pickString(src.override_source) || (active ? "MANUAL" : null),
    created_at_kst: pickString(src.created_at_kst),
    created_at_iso: pickString(src.created_at_iso),
  };
}

module.exports = {
  fileExists,
  extractPineStrategyId,
  normalizePreparedOverride,
};
