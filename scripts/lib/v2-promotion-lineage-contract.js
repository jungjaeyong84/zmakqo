#!/usr/bin/env node
"use strict";

const crypto = require("crypto");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = sortKeysDeep(value[key]);
    return acc;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function buildSelectorLineagePayload(selectorMeta) {
  const row = normalizeObject(selectorMeta);
  if (!row) return null;
  return Object.freeze({
    position_cycle_id: trimOrNull(row.position_cycle_id),
    position_cycle_created_at: trimOrNull(row.position_cycle_created_at),
    native_signal_intent_id: trimOrNull(row.native_signal_intent_id),
    native_decision_id: trimOrNull(row.native_decision_id),
    native_feature_snapshot_id: trimOrNull(row.native_feature_snapshot_id),
    native_proposal_id: trimOrNull(row.native_proposal_id),
    native_ml_evidence_id: trimOrNull(row.native_ml_evidence_id),
    shadow_proposal_id: trimOrNull(row.shadow_proposal_id),
    webhook_signal_intent_id: trimOrNull(row.webhook_signal_intent_id),
    webhook_decision_id: trimOrNull(row.webhook_decision_id),
    query_budget: Object.freeze({
      query_limit: normalizeNumber(row.query_budget && row.query_budget.query_limit),
      recent_window_hours: normalizeNumber(row.query_budget && row.query_budget.recent_window_hours),
      recent_cutoff_at: trimOrNull(row.query_budget && row.query_budget.recent_cutoff_at),
    }),
    alignment_checks: Object.freeze({
      symbol_match: row.alignment_checks && row.alignment_checks.symbol_match === true,
      side_match: row.alignment_checks && row.alignment_checks.side_match === true,
      timeframe_match: row.alignment_checks && row.alignment_checks.timeframe_match === true,
      native_policy_scope: trimOrNull(row.alignment_checks && row.alignment_checks.native_policy_scope),
      webhook_policy_scope: trimOrNull(row.alignment_checks && row.alignment_checks.webhook_policy_scope),
      policy_scope_match: row.alignment_checks && row.alignment_checks.policy_scope_match === true,
    }),
  });
}

function buildLineageContract(selectorMeta) {
  const payload = buildSelectorLineagePayload(selectorMeta);
  if (!payload) return null;
  const canonicalJson = stableJson(payload);
  return Object.freeze({
    version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
    hash: sha256(canonicalJson),
    canonical_json: canonicalJson,
  });
}

function hasLineageContract(value) {
  const row = normalizeObject(value);
  return !!(
    row &&
    trimOrNull(row.version) &&
    trimOrNull(row.hash)
  );
}

function contractsMatch(left, right) {
  if (!hasLineageContract(left) || !hasLineageContract(right)) return false;
  return trimOrNull(left.version) === trimOrNull(right.version)
    && trimOrNull(left.hash) === trimOrNull(right.hash);
}

module.exports = {
  trimOrNull,
  normalizeNumber,
  normalizeObject,
  sortKeysDeep,
  stableJson,
  sha256,
  buildSelectorLineagePayload,
  buildLineageContract,
  hasLineageContract,
  contractsMatch,
};
