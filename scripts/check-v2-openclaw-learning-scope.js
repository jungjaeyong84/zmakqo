#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATASET_PATH = path.join(REPO_ROOT, "ops", "daily", "best_self_evolution_dataset_latest.json");
const REQUIRED_SCOPE = "V2_ONLY_OPENCLAW";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveDatasetPath(env = process.env) {
  return String(env.V2_OPENCLAW_LEARNING_SCOPE_DATASET || DEFAULT_DATASET_PATH).trim() || DEFAULT_DATASET_PATH;
}

function asFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object" && !Array.isArray(row.features_json)) return row.features_json;
  return {};
}

function rowHasV2OpenClawEvidence(row) {
  const evidence = row && row.openclaw_learning_evidence && typeof row.openclaw_learning_evidence === "object"
    ? row.openclaw_learning_evidence
    : {};
  return evidence.has_v2_openclaw_learning_evidence === true;
}

function findLegacyLeaks(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const features = asFeatures(row);
    const mappingVersion = String(features._event_mapping_version || "").trim().toLowerCase();
    const strategyId = String(features.strategy_id || "").trim().toLowerCase();
    const claudeEnabled = features.ai_claude_enabled === true || features.ai_signal && features.ai_signal.ai_claude_enabled === true;
    const newsProvider = String(features.news_provider || features.ai_signal && features.ai_signal.news_provider || "").trim().toLowerCase();
    return (
      mappingVersion === "v1"
      || strategyId.startsWith("donbeolja_v6")
      || claudeEnabled
      || ["openai_web", "news", "claude"].includes(newsProvider)
    );
  });
}

function evaluateOpenClawLearningScope(dataset = {}) {
  const summary = dataset && dataset.summary && typeof dataset.summary === "object" ? dataset.summary : {};
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const blockers = [];
  const scope = String(summary.learning_scope || "").trim().toUpperCase();
  if (scope !== REQUIRED_SCOPE) blockers.push("OPENCLAW_LEARNING_SCOPE_NOT_V2_ONLY");
  if (summary.v1_learning_blocked !== true) blockers.push("OPENCLAW_V1_LEARNING_NOT_BLOCKED");

  const rowsMissingEvidence = rows.filter((row) => !rowHasV2OpenClawEvidence(row));
  if (rowsMissingEvidence.length > 0) blockers.push("OPENCLAW_LEARNING_ROW_MISSING_V2_EVIDENCE");

  const legacyLeaks = findLegacyLeaks(rows);
  if (legacyLeaks.length > 0) blockers.push("OPENCLAW_LEARNING_LEGACY_FEATURE_LEAK");

  return {
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_OPENCLAW_LEARNING_SCOPE_PASS" : "V2_OPENCLAW_LEARNING_SCOPE_BLOCKED",
    blockers,
    required_learning_scope: REQUIRED_SCOPE,
    learning_scope: scope || null,
    v1_learning_blocked: summary.v1_learning_blocked === true,
    rows_n: rows.length,
    filtered_out_v1_or_unscoped_n: Number(summary.filtered_out_v1_or_unscoped_n || 0),
    rows_missing_v2_openclaw_evidence_n: rowsMissingEvidence.length,
    legacy_feature_leak_n: legacyLeaks.length,
    sample_missing_evidence: rowsMissingEvidence.slice(0, 5).map((row) => ({
      signal_id: row && row.signal_id || null,
      market: row && row.market || null,
      event: row && row.event || null,
    })),
    sample_legacy_leak: legacyLeaks.slice(0, 5).map((row) => ({
      signal_id: row && row.signal_id || null,
      market: row && row.market || null,
      event: row && row.event || null,
    })),
  };
}

function main() {
  const datasetPath = resolveDatasetPath();
  const dataset = readJson(datasetPath);
  const result = {
    ...evaluateOpenClawLearningScope(dataset),
    dataset_path: datasetPath,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_OPENCLAW_LEARNING_SCOPE_CHECK_FAILED",
      error: err && err.message ? err.message : String(err),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  evaluateOpenClawLearningScope,
  findLegacyLeaks,
  rowHasV2OpenClawEvidence,
  resolveDatasetPath,
};
