#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getV2Doc, queryV2DocsByField } = require("../src/v2/storage");
const { buildLineageContract } = require("./lib/v2-promotion-lineage-contract");

const OUTPUT_FILENAME = "promotion-collector-inputs.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function parseIsoMs(value) {
  const time = Date.parse(String(value || "").trim());
  return Number.isFinite(time) ? time : null;
}

function sortRowsByTimestamp(rows = [], candidateFields = ["created_at", "snapshot_at", "observed_at"], descending = true) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((left, right) => {
    const leftMs = candidateFields.map((field) => parseIsoMs(left && left[field])).find((v) => v != null) ?? 0;
    const rightMs = candidateFields.map((field) => parseIsoMs(right && right[field])).find((v) => v != null) ?? 0;
    return descending ? (rightMs - leftMs) : (leftMs - rightMs);
  });
}

function pickLatest(rows = [], candidateFields) {
  return sortRowsByTimestamp(rows, candidateFields)[0] || null;
}

function parseJsonOrNull(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  return JSON.parse(text);
}

function recentCutoffIso({ now = Date.now(), recentWindowHours }) {
  return new Date(now - (recentWindowHours * 60 * 60 * 1000)).toISOString();
}

function resolveSelectorConfig(env = process.env) {
  const positionCycleId = trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  if (!positionCycleId) throw new Error("V2_PROMOTION_SELECT_POSITION_CYCLE_ID_REQUIRED");
  const queryLimit = parsePositiveInt(env.V2_PROMOTION_SELECT_QUERY_LIMIT, 25, { min: 5, max: 100 });
  const recentWindowHours = parsePositiveInt(env.V2_PROMOTION_SELECT_RECENT_WINDOW_HOURS, 168, { min: 1, max: 24 * 30 });
  return Object.freeze({
    positionCycleId,
    nativeSignalIntentId: trimOrNull(env.V2_PROMOTION_SELECT_NATIVE_SIGNAL_INTENT_ID),
    nativeDecisionId: trimOrNull(env.V2_PROMOTION_SELECT_NATIVE_DECISION_ID),
    nativeProposalId: trimOrNull(env.V2_PROMOTION_SELECT_NATIVE_PROPOSAL_ID),
    nativeFeatureSnapshotId: trimOrNull(env.V2_PROMOTION_SELECT_NATIVE_FEATURE_SNAPSHOT_ID),
    nativeMlEvidenceId: trimOrNull(env.V2_PROMOTION_SELECT_NATIVE_ML_EVIDENCE_ID),
    shadowProposalId: trimOrNull(env.V2_PROMOTION_SELECT_SHADOW_PROPOSAL_ID),
    shadowDecisionId: trimOrNull(env.V2_PROMOTION_SELECT_SHADOW_DECISION_ID),
    liveProposalId: trimOrNull(env.V2_PROMOTION_SELECT_LIVE_PROPOSAL_ID),
    liveDecisionId: trimOrNull(env.V2_PROMOTION_SELECT_LIVE_DECISION_ID),
    webhookSignalIntentId: trimOrNull(env.V2_PROMOTION_SELECT_WEBHOOK_SIGNAL_INTENT_ID),
    webhookDecisionId: trimOrNull(env.V2_PROMOTION_SELECT_WEBHOOK_DECISION_ID),
    label: trimOrNull(env.V2_PROMOTION_SELECT_LABEL),
    sourceModeLabel: trimOrNull(env.V2_PROMOTION_SELECT_SOURCE_MODE_LABEL),
    shadowLiveLabel: trimOrNull(env.V2_PROMOTION_SELECT_SHADOW_LIVE_LABEL),
    exchangeStateJson: trimOrNull(env.V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON),
    queryLimit,
    recentWindowHours,
    recentCutoffAt: recentCutoffIso({ recentWindowHours }),
  });
}

async function requireDoc({ db = null, env = process.env, collectionKey, docId, reason }) {
  const result = await getV2Doc({ db, env, collectionKey, docId });
  if (!result.ok || !result.doc) throw new Error(reason || `${collectionKey}_DOC_REQUIRED`);
  return result.doc;
}

async function listDocs({ db = null, env = process.env, collectionKey, field, value, limit = 25 }) {
  const result = await queryV2DocsByField({ db, env, collectionKey, field, value, limit });
  return Array.isArray(result.rows) ? result.rows : [];
}

function assertRowsWithinBudget({ rows, limit, reason }) {
  if (!Array.isArray(rows)) return;
  if (rows.length >= limit) {
    throw new Error(reason);
  }
}

function assertRecentEnough({ row, timestampField = "created_at", cutoffAt, reason }) {
  const cutoffMs = parseIsoMs(cutoffAt);
  if (cutoffMs == null) return;
  const rowMs = parseIsoMs(row && row[timestampField]);
  if (rowMs == null || rowMs < cutoffMs) {
    throw new Error(reason);
  }
}

function chooseByPredicate(rows, predicate, timestampFields) {
  return pickLatest(
    (Array.isArray(rows) ? rows : []).filter((row) => {
      try {
        return predicate(row);
      } catch (_) {
        return false;
      }
    }),
    timestampFields
  );
}

function matchesSignalIntentContext(candidate, targetIntent) {
  if (!candidate || !targetIntent) return false;
  if (trimOrNull(candidate.signal_source_mode) !== "WEBHOOK_ASSISTED") return false;
  return trimOrNull(candidate.symbol) === trimOrNull(targetIntent.symbol)
    && trimOrNull(candidate.side) === trimOrNull(targetIntent.side);
}

function matchesShadowProposalContext(candidate, targetIntent, nativeProposal) {
  if (!candidate || !targetIntent) return false;
  if (trimOrNull(candidate.decision_mode) !== "SHADOW") return false;
  if (trimOrNull(candidate.symbol) !== trimOrNull(targetIntent.symbol)) return false;
  if (trimOrNull(candidate.side) !== trimOrNull(targetIntent.side)) return false;
  const targetTimeframe = trimOrNull(nativeProposal && nativeProposal.timeframe);
  if (targetTimeframe && trimOrNull(candidate.timeframe) !== targetTimeframe) return false;
  return true;
}

function matchesNativeProposalContext(candidate, targetIntent) {
  if (!candidate || !targetIntent) return false;
  if (trimOrNull(candidate.signal_intent_id) !== trimOrNull(targetIntent.signal_intent_id)) return false;
  if (trimOrNull(candidate.symbol) !== trimOrNull(targetIntent.symbol)) return false;
  if (trimOrNull(candidate.side) !== trimOrNull(targetIntent.side)) return false;
  return true;
}

function assertFieldEquals({ doc, field, expected, reason }) {
  if (trimOrNull(doc && doc[field]) !== trimOrNull(expected)) {
    throw new Error(reason);
  }
}

function validateNativeLinkedContext({
  nativeSignalIntentId,
  nativeSignalIntent,
  nativeFeatureSnapshot,
  nativeProposal,
  nativeMlEvidence,
  nativeDecision,
}) {
  assertFieldEquals({
    doc: nativeFeatureSnapshot,
    field: "signal_intent_id",
    expected: nativeSignalIntentId,
    reason: "V2_PROMOTION_SELECT_NATIVE_FEATURE_SNAPSHOT_LINKAGE_MISMATCH",
  });
  assertFieldEquals({
    doc: nativeProposal,
    field: "signal_intent_id",
    expected: nativeSignalIntentId,
    reason: "V2_PROMOTION_SELECT_NATIVE_PROPOSAL_LINKAGE_MISMATCH",
  });
  assertFieldEquals({
    doc: nativeMlEvidence,
    field: "signal_intent_id",
    expected: nativeSignalIntentId,
    reason: "V2_PROMOTION_SELECT_NATIVE_ML_EVIDENCE_LINKAGE_MISMATCH",
  });
  assertFieldEquals({
    doc: nativeDecision,
    field: "signal_intent_id",
    expected: nativeSignalIntentId,
    reason: "V2_PROMOTION_SELECT_NATIVE_DECISION_LINKAGE_MISMATCH",
  });

  if (!matchesNativeProposalContext(nativeProposal, nativeSignalIntent)) {
    throw new Error("V2_PROMOTION_SELECT_NATIVE_PROPOSAL_CONTEXT_MISMATCH");
  }
}

function validateShadowProposalContext({ shadowProposal, nativeSignalIntent, nativeProposal }) {
  if (!matchesShadowProposalContext(shadowProposal, nativeSignalIntent, nativeProposal)) {
    throw new Error("V2_PROMOTION_SELECT_SHADOW_PROPOSAL_CONTEXT_MISMATCH");
  }
}

function validateWebhookContext({
  webhookSignalIntent,
  webhookDecision,
  nativeSignalIntent,
  nativeDecision,
}) {
  if (!matchesSignalIntentContext(webhookSignalIntent, nativeSignalIntent)) {
    throw new Error("V2_PROMOTION_SELECT_WEBHOOK_SIGNAL_INTENT_CONTEXT_MISMATCH");
  }
  assertFieldEquals({
    doc: webhookDecision,
    field: "signal_intent_id",
    expected: webhookSignalIntent.signal_intent_id,
    reason: "V2_PROMOTION_SELECT_WEBHOOK_DECISION_LINKAGE_MISMATCH",
  });
  const nativePolicyScope = trimOrNull(nativeDecision && nativeDecision.policy_scope);
  const webhookPolicyScope = trimOrNull(webhookDecision && webhookDecision.policy_scope);
  if (nativePolicyScope && webhookPolicyScope && nativePolicyScope !== webhookPolicyScope) {
    throw new Error("V2_PROMOTION_SELECT_WEBHOOK_POLICY_SCOPE_MISMATCH");
  }
}

function buildSelectorMeta({
  cfg,
  positionCycle,
  nativeSignalIntent,
  nativeDecision,
  nativeFeatureSnapshot,
  nativeProposal,
  nativeMlEvidence,
  shadowProposal,
  webhookSignalIntent,
  webhookDecision,
}) {
  const selectorMeta = {
    selected_at: new Date().toISOString(),
    position_cycle_id: cfg.positionCycleId,
    position_cycle_created_at: trimOrNull(positionCycle && positionCycle.created_at),
    native_signal_intent_id: nativeSignalIntent.signal_intent_id,
    native_decision_id: nativeDecision.openclaw_decision_id,
    native_feature_snapshot_id: nativeFeatureSnapshot.feature_snapshot_id,
    native_proposal_id: nativeProposal.ml_ai_signal_proposal_id,
    native_ml_evidence_id: nativeMlEvidence.decision_id,
    shadow_proposal_id: shadowProposal.ml_ai_signal_proposal_id,
    webhook_signal_intent_id: webhookSignalIntent.signal_intent_id,
    webhook_decision_id: webhookDecision.openclaw_decision_id,
    query_budget: Object.freeze({
      query_limit: cfg.queryLimit,
      recent_window_hours: cfg.recentWindowHours,
      recent_cutoff_at: cfg.recentCutoffAt,
    }),
    alignment_checks: Object.freeze({
      symbol_match: trimOrNull(webhookSignalIntent.symbol) === trimOrNull(nativeSignalIntent.symbol),
      side_match: trimOrNull(webhookSignalIntent.side) === trimOrNull(nativeSignalIntent.side),
      timeframe_match: trimOrNull(shadowProposal.timeframe) === trimOrNull(nativeProposal.timeframe),
      native_policy_scope: trimOrNull(nativeDecision.policy_scope),
      webhook_policy_scope: trimOrNull(webhookDecision.policy_scope),
      policy_scope_match: trimOrNull(nativeDecision.policy_scope) === trimOrNull(webhookDecision.policy_scope),
    }),
  };
  return Object.freeze({
    ...selectorMeta,
    lineage_contract: buildLineageContract(selectorMeta),
  });
}

async function resolveLatestLinkedDoc({
  db = null,
  env = process.env,
  collectionKey,
  field,
  value,
  explicitDocId = null,
  limit = 20,
  timestampFields = null,
  missingReason,
} = {}) {
  if (trimOrNull(explicitDocId)) {
    return requireDoc({ db, env, collectionKey, docId: explicitDocId, reason: missingReason });
  }
  const queryLimit = parsePositiveInt(limit, 20, { min: 1, max: 100 });
  const rows = await listDocs({ db, env, collectionKey, field, value, limit: queryLimit });
  assertRowsWithinBudget({
    rows,
    limit: queryLimit,
    reason: `${missingReason || `${collectionKey}_LINKED_DOC_REQUIRED`}_QUERY_LIMIT_REACHED`,
  });
  const doc = pickLatest(rows, timestampFields || ["created_at", "snapshot_at"]);
  if (!doc) throw new Error(missingReason || `${collectionKey}_LINKED_DOC_REQUIRED`);
  return doc;
}

async function selectCollectorInputs({ db = null, env = process.env } = {}) {
  const cfg = resolveSelectorConfig(env);
  const positionCycle = await requireDoc({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: cfg.positionCycleId,
    reason: "V2_PROMOTION_SELECT_POSITION_CYCLE_NOT_FOUND",
  });
  assertRecentEnough({
    row: positionCycle,
    timestampField: "created_at",
    cutoffAt: cfg.recentCutoffAt,
    reason: "V2_PROMOTION_SELECT_POSITION_CYCLE_OUTSIDE_RECENT_WINDOW",
  });

  const nativeSignalIntentId = cfg.nativeSignalIntentId || trimOrNull(positionCycle.signal_intent_id);
  if (!nativeSignalIntentId) throw new Error("V2_PROMOTION_SELECT_NATIVE_SIGNAL_INTENT_ID_MISSING");
  const nativeDecisionId = cfg.nativeDecisionId || trimOrNull(positionCycle.openclaw_decision_id) || cfg.liveDecisionId;
  if (!nativeDecisionId) throw new Error("V2_PROMOTION_SELECT_NATIVE_DECISION_ID_MISSING");

  const nativeSignalIntent = await requireDoc({
    db,
    env,
    collectionKey: "SIGNAL_INTENTS",
    docId: nativeSignalIntentId,
    reason: "V2_PROMOTION_SELECT_NATIVE_SIGNAL_INTENT_NOT_FOUND",
  });
  const nativeDecision = await requireDoc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISIONS",
    docId: nativeDecisionId,
    reason: "V2_PROMOTION_SELECT_NATIVE_DECISION_NOT_FOUND",
  });
  const nativeFeatureSnapshot = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "FEATURE_SNAPSHOTS",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeFeatureSnapshotId,
    limit: cfg.queryLimit,
    timestampFields: ["snapshot_at"],
    missingReason: "V2_PROMOTION_SELECT_NATIVE_FEATURE_SNAPSHOT_NOT_FOUND",
  });
  const nativeProposal = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "ML_AI_SIGNAL_PROPOSALS",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeProposalId || cfg.liveProposalId,
    limit: cfg.queryLimit,
    timestampFields: ["created_at"],
    missingReason: "V2_PROMOTION_SELECT_NATIVE_PROPOSAL_NOT_FOUND",
  });
  const nativeMlEvidence = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "ML_AI_EVIDENCE_LEDGER",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeMlEvidenceId,
    limit: cfg.queryLimit,
    timestampFields: ["created_at"],
    missingReason: "V2_PROMOTION_SELECT_NATIVE_ML_EVIDENCE_NOT_FOUND",
  });
  validateNativeLinkedContext({
    nativeSignalIntentId,
    nativeSignalIntent,
    nativeFeatureSnapshot,
    nativeProposal,
    nativeMlEvidence,
    nativeDecision,
  });

  const shadowProposal = trimOrNull(cfg.shadowProposalId)
    ? await requireDoc({
        db,
        env,
        collectionKey: "ML_AI_SIGNAL_PROPOSALS",
        docId: cfg.shadowProposalId,
        reason: "V2_PROMOTION_SELECT_SHADOW_PROPOSAL_NOT_FOUND",
      })
    : (() => null)();
  const shadowProposalRows = shadowProposal ? [] : await listDocs({
    db,
    env,
    collectionKey: "ML_AI_SIGNAL_PROPOSALS",
    field: "symbol",
    value: nativeSignalIntent.symbol,
    limit: cfg.queryLimit,
  });
  assertRowsWithinBudget({
    rows: shadowProposalRows,
    limit: cfg.queryLimit,
    reason: "V2_PROMOTION_SELECT_SHADOW_PROPOSAL_QUERY_LIMIT_REACHED",
  });
  const resolvedShadowProposal = shadowProposal || chooseByPredicate(
    shadowProposalRows,
    (row) => matchesShadowProposalContext(row, nativeSignalIntent, nativeProposal),
    ["created_at"]
  );
  if (!resolvedShadowProposal) throw new Error("V2_PROMOTION_SELECT_SHADOW_PROPOSAL_NOT_FOUND");
  validateShadowProposalContext({
    shadowProposal: resolvedShadowProposal,
    nativeSignalIntent,
    nativeProposal,
  });

  const webhookSignalIntent = trimOrNull(cfg.webhookSignalIntentId)
    ? await requireDoc({
        db,
        env,
        collectionKey: "SIGNAL_INTENTS",
        docId: cfg.webhookSignalIntentId,
        reason: "V2_PROMOTION_SELECT_WEBHOOK_SIGNAL_INTENT_NOT_FOUND",
      })
    : (() => null)();
  const webhookSignalIntentRows = webhookSignalIntent ? [] : await listDocs({
    db,
    env,
    collectionKey: "SIGNAL_INTENTS",
    field: "symbol",
    value: nativeSignalIntent.symbol,
    limit: cfg.queryLimit,
  });
  assertRowsWithinBudget({
    rows: webhookSignalIntentRows,
    limit: cfg.queryLimit,
    reason: "V2_PROMOTION_SELECT_WEBHOOK_SIGNAL_INTENT_QUERY_LIMIT_REACHED",
  });
  const resolvedWebhookSignalIntent = webhookSignalIntent || chooseByPredicate(
    webhookSignalIntentRows,
    (row) => matchesSignalIntentContext(row, nativeSignalIntent),
    ["created_at"]
  );
  if (!resolvedWebhookSignalIntent) throw new Error("V2_PROMOTION_SELECT_WEBHOOK_SIGNAL_INTENT_NOT_FOUND");

  const webhookDecision = trimOrNull(cfg.webhookDecisionId)
    ? await requireDoc({
        db,
        env,
        collectionKey: "OPENCLAW_DECISIONS",
        docId: cfg.webhookDecisionId,
        reason: "V2_PROMOTION_SELECT_WEBHOOK_DECISION_NOT_FOUND",
      })
    : null;
  const webhookDecisionRows = webhookDecision ? [] : await listDocs({
    db,
    env,
    collectionKey: "OPENCLAW_DECISIONS",
    field: "signal_intent_id",
    value: resolvedWebhookSignalIntent.signal_intent_id,
    limit: cfg.queryLimit,
  });
  assertRowsWithinBudget({
    rows: webhookDecisionRows,
    limit: cfg.queryLimit,
    reason: "V2_PROMOTION_SELECT_WEBHOOK_DECISION_QUERY_LIMIT_REACHED",
  });
  const resolvedWebhookDecision = webhookDecision || pickLatest(
    webhookDecisionRows,
    ["created_at"]
  );
  if (!resolvedWebhookDecision) throw new Error("V2_PROMOTION_SELECT_WEBHOOK_DECISION_NOT_FOUND");
  validateWebhookContext({
    webhookSignalIntent: resolvedWebhookSignalIntent,
    webhookDecision: resolvedWebhookDecision,
    nativeSignalIntent,
    nativeDecision,
  });

  const selectorMeta = buildSelectorMeta({
    cfg,
    positionCycle,
    nativeSignalIntent,
    nativeDecision,
    nativeFeatureSnapshot,
    nativeProposal,
    nativeMlEvidence,
    shadowProposal: resolvedShadowProposal,
    webhookSignalIntent: resolvedWebhookSignalIntent,
    webhookDecision: resolvedWebhookDecision,
  });

  const collectorEnv = Object.freeze({
    V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: cfg.positionCycleId,
    V2_PROMOTION_COLLECT_NATIVE_SIGNAL_INTENT_ID: nativeSignalIntent.signal_intent_id,
    V2_PROMOTION_COLLECT_NATIVE_FEATURE_SNAPSHOT_ID: nativeFeatureSnapshot.feature_snapshot_id,
    V2_PROMOTION_COLLECT_NATIVE_PROPOSAL_ID: nativeProposal.ml_ai_signal_proposal_id,
    V2_PROMOTION_COLLECT_NATIVE_ML_EVIDENCE_ID: nativeMlEvidence.decision_id,
    V2_PROMOTION_COLLECT_NATIVE_DECISION_ID: nativeDecision.openclaw_decision_id,
    V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: resolvedShadowProposal.ml_ai_signal_proposal_id,
    V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: resolvedWebhookSignalIntent.signal_intent_id,
    V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: resolvedWebhookDecision.openclaw_decision_id,
    ...(cfg.shadowDecisionId ? { V2_PROMOTION_COLLECT_SHADOW_DECISION_ID: cfg.shadowDecisionId } : {}),
    ...(cfg.liveProposalId ? { V2_PROMOTION_COLLECT_LIVE_PROPOSAL_ID: cfg.liveProposalId } : {}),
    ...(cfg.liveDecisionId ? { V2_PROMOTION_COLLECT_LIVE_DECISION_ID: cfg.liveDecisionId } : {}),
    ...(cfg.label ? { V2_PROMOTION_COLLECT_LABEL: cfg.label } : {}),
    ...(cfg.sourceModeLabel ? { V2_PROMOTION_COLLECT_SOURCE_MODE_LABEL: cfg.sourceModeLabel } : {}),
    ...(cfg.shadowLiveLabel ? { V2_PROMOTION_COLLECT_SHADOW_LIVE_LABEL: cfg.shadowLiveLabel } : {}),
    ...(cfg.exchangeStateJson ? { V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON: cfg.exchangeStateJson } : {}),
    V2_PROMOTION_COLLECT_SELECTOR_META_JSON: JSON.stringify(selectorMeta),
  });

  return Object.freeze({
    ok: true,
    reason: "V2_PROMOTION_COLLECTOR_INPUTS_SELECTED",
    selectorMeta,
    collectorEnv,
  });
}

async function main(env = process.env, db = null) {
  const artifactDir = resolveArtifactDir(env);
  const selected = await selectCollectorInputs({ db, env });
  ensureDir(artifactDir);
  writeJson(path.join(artifactDir, OUTPUT_FILENAME), selected);
  console.log(JSON.stringify({
    ok: true,
    reason: selected.reason,
    artifact_dir: artifactDir,
    output_file: path.join(artifactDir, OUTPUT_FILENAME),
    selector_meta: selected.selectorMeta,
  }));
  return selected;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("SELECT_V2_PROMOTION_RUNTIME_INPUTS_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    selectCollectorInputs,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      resolveArtifactDir,
      resolveSelectorConfig,
      parseJsonOrNull,
      parseIsoMs,
      sortRowsByTimestamp,
      pickLatest,
      chooseByPredicate,
      matchesSignalIntentContext,
      matchesShadowProposalContext,
      matchesNativeProposalContext,
      validateNativeLinkedContext,
      validateShadowProposalContext,
      validateWebhookContext,
      buildSelectorMeta,
    },
  };
}
