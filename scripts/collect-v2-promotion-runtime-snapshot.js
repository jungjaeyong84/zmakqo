#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getV2Doc, queryV2DocsByField } = require("../src/v2/storage");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId } = require("../src/v2/contracts");
const { evaluateOpenClawExecutionSeparation } = require("../src/v2/openclawExecutionSeparationAudit");
const { persistOpenClawExecutionAudit } = require("../src/v2/openclawExecutionAuditLedger");
const { __test: replayGateTest } = require("../src/v2/replayGate");

const SNAPSHOT_FILENAME = "promotion-runtime-snapshot.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

const TERMINAL_STAGES = new Set(["EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);

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

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function countBy(items = [], mapper) {
  const counts = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = trimOrNull(mapper(item));
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.freeze(counts);
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

function parseJsonOrNull(value, reason = "V2_PROMOTION_COLLECT_JSON_INVALID") {
  const text = trimOrNull(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(reason);
  }
}

function assertFieldEquals({ doc, field, expected, reason }) {
  if (trimOrNull(doc && doc[field]) !== trimOrNull(expected)) {
    throw new Error(reason);
  }
}

function resolveCollectorConfig(env = process.env) {
  const positionCycleId = trimOrNull(env.V2_PROMOTION_COLLECT_POSITION_CYCLE_ID);
  if (!positionCycleId) throw new Error("V2_PROMOTION_COLLECT_POSITION_CYCLE_ID_REQUIRED");
  const shadowProposalId = trimOrNull(env.V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID);
  if (!shadowProposalId) throw new Error("V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID_REQUIRED");
  const webhookSignalIntentId = trimOrNull(env.V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID);
  if (!webhookSignalIntentId) throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID_REQUIRED");
  const webhookDecisionId = trimOrNull(env.V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID);
  if (!webhookDecisionId) throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID_REQUIRED");
  return Object.freeze({
    label: trimOrNull(env.V2_PROMOTION_COLLECT_LABEL) || positionCycleId,
    positionCycleId,
    nativeSignalIntentId: trimOrNull(env.V2_PROMOTION_COLLECT_NATIVE_SIGNAL_INTENT_ID),
    nativeFeatureSnapshotId: trimOrNull(env.V2_PROMOTION_COLLECT_NATIVE_FEATURE_SNAPSHOT_ID),
    nativeProposalId: trimOrNull(env.V2_PROMOTION_COLLECT_NATIVE_PROPOSAL_ID),
    nativeMlEvidenceId: trimOrNull(env.V2_PROMOTION_COLLECT_NATIVE_ML_EVIDENCE_ID),
    nativeDecisionId: trimOrNull(env.V2_PROMOTION_COLLECT_NATIVE_DECISION_ID),
    shadowProposalId,
    shadowDecisionId: trimOrNull(env.V2_PROMOTION_COLLECT_SHADOW_DECISION_ID),
    liveProposalId: trimOrNull(env.V2_PROMOTION_COLLECT_LIVE_PROPOSAL_ID),
    liveDecisionId: trimOrNull(env.V2_PROMOTION_COLLECT_LIVE_DECISION_ID),
    webhookSignalIntentId,
    webhookDecisionId,
    exchangeState: parseJsonOrNull(env.V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON, "V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON_INVALID"),
    sourceModeLabel: trimOrNull(env.V2_PROMOTION_COLLECT_SOURCE_MODE_LABEL) || "SOURCE_MODE_PAIR",
    shadowLiveLabel: trimOrNull(env.V2_PROMOTION_COLLECT_SHADOW_LIVE_LABEL) || "SHADOW_LIVE_PAIR",
    selectorMeta: parseJsonOrNull(env.V2_PROMOTION_COLLECT_SELECTOR_META_JSON, "V2_PROMOTION_COLLECT_SELECTOR_META_JSON_INVALID"),
    queryBudget: Object.freeze({
      transitionsLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_TRANSITIONS_LIMIT, 50, { max: 200 }),
      outboxesLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_OUTBOXES_LIMIT, 50, { max: 200 }),
      repairRequestsLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_REPAIR_REQUESTS_LIMIT, 20, { max: 100 }),
      repairExecutionLedgersLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_REPAIR_EXECUTION_LEDGERS_LIMIT, 20, { max: 100 }),
      linkedDocLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_LINKED_DOC_LIMIT, 20, { max: 50 }),
    }),
  });
}

function validateSelectorMeta({ selectorMeta, cfg }) {
  if (!selectorMeta) return;
  assertFieldEquals({
    doc: selectorMeta,
    field: "position_cycle_id",
    expected: cfg.positionCycleId,
    reason: "V2_PROMOTION_COLLECT_SELECTOR_META_POSITION_CYCLE_MISMATCH",
  });
  const checks = selectorMeta && selectorMeta.alignment_checks && typeof selectorMeta.alignment_checks === "object"
    ? selectorMeta.alignment_checks
    : null;
  if (!checks) {
    throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_ALIGNMENT_CHECKS_REQUIRED");
  }
  if (checks.symbol_match !== true) throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_SYMBOL_MISMATCH");
  if (checks.side_match !== true) throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_SIDE_MISMATCH");
  if (checks.timeframe_match !== true) throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_TIMEFRAME_MISMATCH");
  if (checks.policy_scope_match !== true) throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_POLICY_SCOPE_MISMATCH");
}

async function requireDoc({ db = null, env = process.env, collectionKey, docId, reason }) {
  const result = await getV2Doc({ db, env, collectionKey, docId });
  if (!result.ok || !result.doc) throw new Error(reason || `${collectionKey}_DOC_REQUIRED`);
  return result.doc;
}

async function listDocs({ db = null, env = process.env, collectionKey, field, value, limit = 50 }) {
  const result = await queryV2DocsByField({ db, env, collectionKey, field, value, limit });
  return Array.isArray(result.rows) ? result.rows : [];
}

function assertRowsWithinBudget({ rows, limit, reason }) {
  if (!Array.isArray(rows)) return;
  if (rows.length >= limit) {
    throw new Error(reason);
  }
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
  const queryLimit = parsePositiveInt(limit, 20, { max: 50 });
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

function validateCollectedContext({
  cfg,
  positionCycle,
  projection,
  protectionRuntime,
  signalIntent,
  nativeDecision,
  nativeProposal,
  shadowProposal,
  webhookSignalIntent,
  webhookDecision,
  selectorMeta,
}) {
  assertFieldEquals({
    doc: positionCycle,
    field: "position_cycle_id",
    expected: cfg.positionCycleId,
    reason: "V2_PROMOTION_COLLECT_POSITION_CYCLE_CONTEXT_MISMATCH",
  });
  assertFieldEquals({
    doc: projection,
    field: "position_cycle_id",
    expected: cfg.positionCycleId,
    reason: "V2_PROMOTION_COLLECT_PROJECTION_POSITION_CYCLE_MISMATCH",
  });
  assertFieldEquals({
    doc: protectionRuntime,
    field: "position_cycle_id",
    expected: cfg.positionCycleId,
    reason: "V2_PROMOTION_COLLECT_PROTECTION_RUNTIME_POSITION_CYCLE_MISMATCH",
  });
  assertFieldEquals({
    doc: positionCycle,
    field: "signal_intent_id",
    expected: signalIntent.signal_intent_id,
    reason: "V2_PROMOTION_COLLECT_POSITION_CYCLE_SIGNAL_INTENT_MISMATCH",
  });
  assertFieldEquals({
    doc: positionCycle,
    field: "openclaw_decision_id",
    expected: nativeDecision.openclaw_decision_id,
    reason: "V2_PROMOTION_COLLECT_POSITION_CYCLE_DECISION_MISMATCH",
  });
  if (trimOrNull(shadowProposal.decision_mode) !== "SHADOW") {
    throw new Error("V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_MODE_MISMATCH");
  }
  if (trimOrNull(shadowProposal.symbol) !== trimOrNull(signalIntent.symbol)) {
    throw new Error("V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_SYMBOL_MISMATCH");
  }
  if (trimOrNull(shadowProposal.side) !== trimOrNull(signalIntent.side)) {
    throw new Error("V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_SIDE_MISMATCH");
  }
  if (trimOrNull(shadowProposal.timeframe) !== trimOrNull(nativeProposal.timeframe)) {
    throw new Error("V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_TIMEFRAME_MISMATCH");
  }
  if (trimOrNull(webhookSignalIntent.signal_source_mode) !== "WEBHOOK_ASSISTED") {
    throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_SOURCE_MODE_MISMATCH");
  }
  if (trimOrNull(webhookSignalIntent.symbol) !== trimOrNull(signalIntent.symbol)) {
    throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_SYMBOL_MISMATCH");
  }
  if (trimOrNull(webhookSignalIntent.side) !== trimOrNull(signalIntent.side)) {
    throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_SIDE_MISMATCH");
  }
  assertFieldEquals({
    doc: webhookDecision,
    field: "signal_intent_id",
    expected: webhookSignalIntent.signal_intent_id,
    reason: "V2_PROMOTION_COLLECT_WEBHOOK_DECISION_LINKAGE_MISMATCH",
  });
  const nativePolicyScope = trimOrNull(nativeDecision.policy_scope);
  const webhookPolicyScope = trimOrNull(webhookDecision.policy_scope);
  if (nativePolicyScope && webhookPolicyScope && nativePolicyScope !== webhookPolicyScope) {
    throw new Error("V2_PROMOTION_COLLECT_WEBHOOK_POLICY_SCOPE_MISMATCH");
  }
  if (selectorMeta) {
    if (trimOrNull(selectorMeta.native_signal_intent_id) && trimOrNull(selectorMeta.native_signal_intent_id) !== trimOrNull(signalIntent.signal_intent_id)) {
      throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_NATIVE_SIGNAL_INTENT_MISMATCH");
    }
    if (trimOrNull(selectorMeta.native_decision_id) && trimOrNull(selectorMeta.native_decision_id) !== trimOrNull(nativeDecision.openclaw_decision_id)) {
      throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_NATIVE_DECISION_MISMATCH");
    }
    if (trimOrNull(selectorMeta.shadow_proposal_id) && trimOrNull(selectorMeta.shadow_proposal_id) !== trimOrNull(shadowProposal.ml_ai_signal_proposal_id)) {
      throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_SHADOW_PROPOSAL_MISMATCH");
    }
    if (trimOrNull(selectorMeta.webhook_signal_intent_id) && trimOrNull(selectorMeta.webhook_signal_intent_id) !== trimOrNull(webhookSignalIntent.signal_intent_id)) {
      throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_WEBHOOK_SIGNAL_INTENT_MISMATCH");
    }
    if (trimOrNull(selectorMeta.webhook_decision_id) && trimOrNull(selectorMeta.webhook_decision_id) !== trimOrNull(webhookDecision.openclaw_decision_id)) {
      throw new Error("V2_PROMOTION_COLLECT_SELECTOR_META_WEBHOOK_DECISION_MISMATCH");
    }
  }
}

function buildWatchdogSnapshot({
  projection,
  transitions,
  repairRequests,
  exchangeState = null,
} = {}) {
  const issueCodes = new Set(
    (Array.isArray(repairRequests) ? repairRequests : [])
      .map((row) => upper(row && row.issue_code))
      .filter(Boolean)
  );
  const latestTransition = Array.isArray(transitions) && transitions.length > 0
    ? transitions[transitions.length - 1]
    : null;
  const stage = upper(projection && projection.stage);
  const latestTransitionStage = upper(latestTransition && latestTransition.next_stage);
  const latestTransitionTerminal = TERMINAL_STAGES.has(latestTransitionStage);
  const hasExchangePosition = exchangeState && typeof exchangeState === "object"
    ? exchangeState.has_active_position === true
    : null;

  if (TERMINAL_STAGES.has(stage)) {
    if (hasExchangePosition === true) {
      issueCodes.add("TERMINAL_STAGE_WITH_ACTIVE_POSITION");
    }
  } else {
    if (latestTransitionTerminal && latestTransitionStage !== stage) {
      issueCodes.add("TERMINAL_PROJECTION_MISMATCH");
    }
    if (hasExchangePosition === false && latestTransitionTerminal !== true) {
      issueCodes.add("TERMINAL_TRANSITION_MISSING");
    }
  }

  return Object.freeze({
    issueCodes: Array.from(issueCodes),
    repairRequests: Array.isArray(repairRequests) ? repairRequests : [],
    latestTransition: latestTransition || null,
    exchangeState: exchangeState && typeof exchangeState === "object"
      ? { has_active_position: exchangeState.has_active_position === true }
      : null,
  });
}

function buildAlertRetrySummary(outboxes = []) {
  const rows = Array.isArray(outboxes) ? outboxes : [];
  const failedRows = rows.filter((row) => upper(row && row.status) === "FAILED");
  const sentRows = rows.filter((row) => upper(row && row.status) === "SENT");
  const pendingRows = rows.filter((row) => upper(row && row.status) === "PENDING");
  const retryableFailedRows = failedRows.filter((row) => upper(row && row.last_reason_family) === "TRANSPORT");
  const terminalFailedRows = failedRows.filter((row) => upper(row && row.last_reason_family) !== "TRANSPORT");
  const latestFailed = pickLatest(failedRows, ["last_attempt_at", "sent_at", "created_at"]);
  return Object.freeze({
    outbox_n: rows.length,
    failed_n: failedRows.length,
    sent_n: sentRows.length,
    pending_n: pendingRows.length,
    retryable_failed_n: retryableFailedRows.length,
    terminal_failed_n: terminalFailedRows.length,
    family_counts: countBy(failedRows, (row) => upper(row && row.last_reason_family) || "UNKNOWN"),
    retry_policy_counts: countBy(failedRows, (row) => upper(row && row.retry_policy_code) || "ALERT_POLICY_UNKNOWN"),
    runbook_ref_counts: Object.freeze((() => {
      const flat = [];
      for (const row of failedRows) {
        for (const ref of Array.isArray(row && row.runbook_refs) ? row.runbook_refs : []) {
          flat.push(ref);
        }
      }
      return countBy(flat, (value) => upper(value));
    })()),
    latest_failed: latestFailed
      ? Object.freeze({
          alert_outbox_id: trimOrNull(latestFailed.alert_outbox_id),
          last_reason: trimOrNull(latestFailed.last_reason),
          last_reason_family: upper(latestFailed.last_reason_family) || "UNKNOWN",
          retry_policy_code: upper(latestFailed.retry_policy_code) || "ALERT_POLICY_UNKNOWN",
          runbook_refs: Array.isArray(latestFailed.runbook_refs) ? latestFailed.runbook_refs.map((ref) => upper(ref)).filter(Boolean) : [],
          last_attempt_at: trimOrNull(latestFailed.last_attempt_at),
        })
      : null,
  });
}

function buildRepairEvidenceSummary({ repairRequests = [], repairExecutionLedgers = [] } = {}) {
  const requests = Array.isArray(repairRequests) ? repairRequests : [];
  const ledgers = Array.isArray(repairExecutionLedgers) ? repairExecutionLedgers : [];
  const completionLedgers = ledgers.filter((row) => {
    const status = upper(row && row.execution_status);
    return status === "COMPLETED_SUCCESS" || status === "COMPLETED_FAILED";
  });
  const completionWithEvidence = completionLedgers.filter((row) => {
    const result = row && row.result_snapshot && typeof row.result_snapshot === "object"
      ? row.result_snapshot
      : null;
    return result && result.repair_evidence_summary && typeof result.repair_evidence_summary === "object";
  });
  const runbookRefs = [];
  const orderEvidence = [];
  let completedSuccessCount = 0;
  let completedFailedCount = 0;

  for (const ledger of completionLedgers) {
    const status = upper(ledger && ledger.execution_status);
    if (status === "COMPLETED_SUCCESS") completedSuccessCount += 1;
    if (status === "COMPLETED_FAILED") completedFailedCount += 1;
    const result = ledger && ledger.result_snapshot && typeof ledger.result_snapshot === "object"
      ? ledger.result_snapshot
      : {};
    const evidence = result.repair_evidence_summary && typeof result.repair_evidence_summary === "object"
      ? result.repair_evidence_summary
      : null;
    for (const ref of Array.isArray(result.runbook_refs) ? result.runbook_refs : []) {
      const normalized = upper(ref);
      if (normalized) runbookRefs.push(normalized);
    }
    for (const ref of Array.isArray(evidence && evidence.runbook_refs) ? evidence.runbook_refs : []) {
      const normalized = upper(ref);
      if (normalized) runbookRefs.push(normalized);
    }
    for (const item of Array.isArray(evidence && evidence.order_evidence) ? evidence.order_evidence : []) {
      if (item && typeof item === "object") orderEvidence.push(item);
    }
  }

  const latestCompletion = pickLatest(completionWithEvidence, ["recorded_at", "created_at"]);
  const latestResult = latestCompletion && latestCompletion.result_snapshot && typeof latestCompletion.result_snapshot === "object"
    ? latestCompletion.result_snapshot
    : null;
  const latestEvidence = latestResult && latestResult.repair_evidence_summary && typeof latestResult.repair_evidence_summary === "object"
    ? latestResult.repair_evidence_summary
    : null;
  const missingCompletionEvidenceCount = Math.max(completionLedgers.length - completionWithEvidence.length, 0);
  return Object.freeze({
    ok: missingCompletionEvidenceCount === 0 && (requests.length === 0 || completionWithEvidence.length > 0),
    repair_request_n: requests.length,
    repair_execution_ledger_n: ledgers.length,
    completion_ledger_n: completionLedgers.length,
    completion_evidence_n: completionWithEvidence.length,
    completed_success_n: completedSuccessCount,
    completed_failed_n: completedFailedCount,
    missing_completion_evidence_n: missingCompletionEvidenceCount,
    runbook_refs: Object.freeze(Array.from(new Set(runbookRefs))),
    order_evidence_n: orderEvidence.length,
    latest_completion: latestCompletion
      ? Object.freeze({
          repair_execution_ledger_id: trimOrNull(latestCompletion.repair_execution_ledger_id),
          exit_repair_request_id: trimOrNull(latestCompletion.exit_repair_request_id),
          execution_status: upper(latestCompletion.execution_status),
          issue_code: upper(latestCompletion.issue_code),
          command_type: upper(latestCompletion.command_type),
          recorded_at: trimOrNull(latestCompletion.recorded_at),
          repair_evidence_summary: latestEvidence,
        })
      : null,
  });
}

function buildCollectedRuntimeChainAudit(episode) {
  const row = replayGateTest.validateEpisode(episode);
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  return Object.freeze({
    ok: row.pass === true,
    check_n: 1,
    fail_n: blockers.length,
    failed_check_ids: blockers.slice(),
    source: "V2_PROMOTION_RUNTIME_COLLECTOR",
    scope: "COLLECTED_RUNTIME_EPISODE_CHAIN",
  });
}

async function collectRuntimeSnapshot({ db = null, env = process.env } = {}) {
  const cfg = resolveCollectorConfig(env);
  validateSelectorMeta({ selectorMeta: cfg.selectorMeta, cfg });
  const positionCycle = await requireDoc({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: cfg.positionCycleId,
    reason: "V2_PROMOTION_COLLECT_POSITION_CYCLE_NOT_FOUND",
  });
  const projection = await requireDoc({
    db,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    docId: buildExitRuntimeProjectionId({ positionCycleId: cfg.positionCycleId }),
    reason: "V2_PROMOTION_COLLECT_PROJECTION_NOT_FOUND",
  });
  const protectionRuntime = await requireDoc({
    db,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: buildProtectionRuntimeId({ positionCycleId: cfg.positionCycleId }),
    reason: "V2_PROMOTION_COLLECT_PROTECTION_RUNTIME_NOT_FOUND",
  });

  const transitions = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "CANONICAL_EXIT_TRANSITIONS",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.transitionsLimit,
    }),
    ["created_at"],
    false
  );
  assertRowsWithinBudget({
    rows: transitions,
    limit: cfg.queryBudget.transitionsLimit,
    reason: "V2_PROMOTION_COLLECT_TRANSITIONS_QUERY_LIMIT_REACHED",
  });
  const outboxes = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "TRADE_ALERT_OUTBOX",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.outboxesLimit,
    }),
    ["sent_at", "created_at"],
    false
  );
  assertRowsWithinBudget({
    rows: outboxes,
    limit: cfg.queryBudget.outboxesLimit,
    reason: "V2_PROMOTION_COLLECT_OUTBOXES_QUERY_LIMIT_REACHED",
  });
  const repairRequests = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "REPAIR_REQUESTS",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.repairRequestsLimit,
    }),
    ["created_at"],
    false
  );
  assertRowsWithinBudget({
    rows: repairRequests,
    limit: cfg.queryBudget.repairRequestsLimit,
    reason: "V2_PROMOTION_COLLECT_REPAIR_REQUESTS_QUERY_LIMIT_REACHED",
  });
  const repairExecutionLedgers = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "REPAIR_EXECUTION_LEDGER",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.repairExecutionLedgersLimit,
    }),
    ["recorded_at", "created_at"],
    false
  );
  assertRowsWithinBudget({
    rows: repairExecutionLedgers,
    limit: cfg.queryBudget.repairExecutionLedgersLimit,
    reason: "V2_PROMOTION_COLLECT_REPAIR_EXECUTION_LEDGERS_QUERY_LIMIT_REACHED",
  });

  const nativeSignalIntentId = cfg.nativeSignalIntentId || trimOrNull(positionCycle.signal_intent_id);
  if (!nativeSignalIntentId) throw new Error("V2_PROMOTION_COLLECT_NATIVE_SIGNAL_INTENT_ID_MISSING");
  const nativeDecisionId = cfg.nativeDecisionId || trimOrNull(positionCycle.openclaw_decision_id) || cfg.liveDecisionId;
  if (!nativeDecisionId) throw new Error("V2_PROMOTION_COLLECT_NATIVE_DECISION_ID_MISSING");

  const signalIntent = await requireDoc({
    db,
    env,
    collectionKey: "SIGNAL_INTENTS",
    docId: nativeSignalIntentId,
    reason: "V2_PROMOTION_COLLECT_NATIVE_SIGNAL_INTENT_NOT_FOUND",
  });
  const featureSnapshot = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "FEATURE_SNAPSHOTS",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeFeatureSnapshotId,
    limit: cfg.queryBudget.linkedDocLimit,
    timestampFields: ["snapshot_at"],
    missingReason: "V2_PROMOTION_COLLECT_NATIVE_FEATURE_SNAPSHOT_NOT_FOUND",
  });
  const nativeProposal = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "ML_AI_SIGNAL_PROPOSALS",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeProposalId || cfg.liveProposalId,
    limit: cfg.queryBudget.linkedDocLimit,
    timestampFields: ["created_at"],
    missingReason: "V2_PROMOTION_COLLECT_NATIVE_PROPOSAL_NOT_FOUND",
  });
  const mlAiEvidence = await resolveLatestLinkedDoc({
    db,
    env,
    collectionKey: "ML_AI_EVIDENCE_LEDGER",
    field: "signal_intent_id",
    value: nativeSignalIntentId,
    explicitDocId: cfg.nativeMlEvidenceId,
    limit: cfg.queryBudget.linkedDocLimit,
    timestampFields: ["created_at"],
    missingReason: "V2_PROMOTION_COLLECT_NATIVE_ML_EVIDENCE_NOT_FOUND",
  });
  const nativeDecision = await requireDoc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISIONS",
    docId: nativeDecisionId,
    reason: "V2_PROMOTION_COLLECT_NATIVE_DECISION_NOT_FOUND",
  });

  const shadowProposal = await requireDoc({
    db,
    env,
    collectionKey: "ML_AI_SIGNAL_PROPOSALS",
    docId: cfg.shadowProposalId,
    reason: "V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_NOT_FOUND",
  });
  const liveProposal = cfg.liveProposalId
    ? await requireDoc({
        db,
        env,
        collectionKey: "ML_AI_SIGNAL_PROPOSALS",
        docId: cfg.liveProposalId,
        reason: "V2_PROMOTION_COLLECT_LIVE_PROPOSAL_NOT_FOUND",
      })
    : nativeProposal;
  const shadowDecision = cfg.shadowDecisionId
    ? await requireDoc({
        db,
        env,
        collectionKey: "OPENCLAW_DECISIONS",
        docId: cfg.shadowDecisionId,
        reason: "V2_PROMOTION_COLLECT_SHADOW_DECISION_NOT_FOUND",
      })
    : null;
  const liveDecision = cfg.liveDecisionId
    ? await requireDoc({
        db,
        env,
        collectionKey: "OPENCLAW_DECISIONS",
        docId: cfg.liveDecisionId,
        reason: "V2_PROMOTION_COLLECT_LIVE_DECISION_NOT_FOUND",
      })
    : nativeDecision;

  const webhookSignalIntent = await requireDoc({
    db,
    env,
    collectionKey: "SIGNAL_INTENTS",
    docId: cfg.webhookSignalIntentId,
    reason: "V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_NOT_FOUND",
  });
  const webhookDecision = await requireDoc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISIONS",
    docId: cfg.webhookDecisionId,
    reason: "V2_PROMOTION_COLLECT_WEBHOOK_DECISION_NOT_FOUND",
  });

  validateCollectedContext({
    cfg,
    positionCycle,
    projection,
    protectionRuntime,
    signalIntent,
    nativeDecision,
    nativeProposal,
    shadowProposal,
    webhookSignalIntent,
    webhookDecision,
    selectorMeta: cfg.selectorMeta,
  });

  const watchdog = buildWatchdogSnapshot({
    projection,
    transitions,
    repairRequests,
    exchangeState: cfg.exchangeState,
  });
  const alertRetrySummary = buildAlertRetrySummary(outboxes);
  const repairEvidenceSummary = buildRepairEvidenceSummary({
    repairRequests,
    repairExecutionLedgers,
  });
  const openclawExecutionSeparationAudit = evaluateOpenClawExecutionSeparation({
    bundle: {
      signalIntent,
      openclawDecision: nativeDecision,
      strategyFilterResult: {
        filter_name: nativeDecision.strategy_filter_name,
        verdict: nativeDecision.strategy_filter_verdict,
        reason: nativeDecision.strategy_filter_reason,
      },
    },
  });
  const openclawExecutionAuditLedgerWrite = await persistOpenClawExecutionAudit({
    db,
    env,
    audit: openclawExecutionSeparationAudit,
    positionCycleId: cfg.positionCycleId,
    source: "PROMOTION_RUNTIME_COLLECTOR",
    artifactRunId: cfg.positionCycleId,
  });
  const episode = Object.freeze({
    label: cfg.label,
    positionCycle: positionCycle,
    transitions: transitions,
    projection: projection,
    outboxes: outboxes,
    watchdog,
    signalIntent: signalIntent,
    featureSnapshot: featureSnapshot,
    mlAiSignalProposal: nativeProposal,
    mlAiEvidence: mlAiEvidence,
    openclawDecision: nativeDecision,
    protectionRuntime: protectionRuntime,
  });
  const runtimeChainAudit = buildCollectedRuntimeChainAudit(episode);

  return Object.freeze({
    snapshotMeta: Object.freeze({
      source: "V2_FIRESTORE_COLLECTOR",
      collected_at: new Date().toISOString(),
      position_cycle_id: cfg.positionCycleId,
      native_signal_intent_id: nativeSignalIntentId,
      native_openclaw_decision_id: nativeDecisionId,
      protection_runtime_id: protectionRuntime.protection_runtime_id || null,
      labels: Object.freeze({
        replay: cfg.label,
        shadow_live: cfg.shadowLiveLabel,
        source_mode: cfg.sourceModeLabel,
      }),
      query_budget: Object.freeze({
        limits: cfg.queryBudget,
        counts: Object.freeze({
          transitions: transitions.length,
          outboxes: outboxes.length,
          repair_requests: repairRequests.length,
          repair_execution_ledgers: repairExecutionLedgers.length,
        }),
      }),
      alert_retry_summary: alertRetrySummary,
      repair_evidence_summary: repairEvidenceSummary,
      openclaw_execution_separation_audits: Object.freeze([openclawExecutionSeparationAudit]),
      runtime_chain_audits: Object.freeze([runtimeChainAudit]),
      openclaw_execution_audit_ledger_write: Object.freeze({
        ok: openclawExecutionAuditLedgerWrite.ok === true,
        skipped: openclawExecutionAuditLedgerWrite.skipped === true,
        reason: openclawExecutionAuditLedgerWrite.reason,
        collection_key: openclawExecutionAuditLedgerWrite.persisted ? openclawExecutionAuditLedgerWrite.persisted.collectionKey : null,
        doc_id: openclawExecutionAuditLedgerWrite.persisted ? openclawExecutionAuditLedgerWrite.persisted.docId : openclawExecutionAuditLedgerWrite.doc.openclaw_execution_audit_id,
      }),
      selector_meta: cfg.selectorMeta,
    }),
    episodes: [episode],
    shadowLivePairs: [{
      label: cfg.shadowLiveLabel,
      shadowProposal: shadowProposal,
      liveProposal: liveProposal,
      shadowDecision: shadowDecision,
      liveDecision: liveDecision,
    }],
    sourceModePairs: [{
      label: cfg.sourceModeLabel,
      webhookBundle: {
        signalIntent: webhookSignalIntent,
        openclawDecision: webhookDecision,
      },
      nativeBundle: {
        signalIntent: signalIntent,
        openclawDecision: nativeDecision,
        mlAiSignalProposal: nativeProposal,
      },
    }],
  });
}

async function main(env = process.env, db = null) {
  const artifactDir = resolveArtifactDir(env);
  const snapshot = await collectRuntimeSnapshot({ db, env });
  ensureDir(artifactDir);
  const outputFile = path.join(artifactDir, SNAPSHOT_FILENAME);
  writeJson(outputFile, snapshot);
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_RUNTIME_SNAPSHOT_COLLECTED",
    artifact_dir: artifactDir,
    snapshot_file: outputFile,
    episode_n: snapshot.episodes.length,
    shadow_live_pair_n: snapshot.shadowLivePairs.length,
    source_mode_pair_n: snapshot.sourceModePairs.length,
  }));
}

if (require.main === module) {
  main(process.env).catch((error) => {
    console.error("COLLECT_V2_PROMOTION_RUNTIME_SNAPSHOT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    collectRuntimeSnapshot,
    __test: {
      trimOrNull,
      resolveArtifactDir,
      resolveCollectorConfig,
      parseJsonOrNull,
      assertFieldEquals,
      validateSelectorMeta,
      validateCollectedContext,
      buildWatchdogSnapshot,
      buildAlertRetrySummary,
      buildRepairEvidenceSummary,
      buildCollectedRuntimeChainAudit,
      countBy,
      sortRowsByTimestamp,
      pickLatest,
    },
  };
}
