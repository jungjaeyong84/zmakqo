#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getV2Doc, queryV2DocsByField } = require("../src/v2/storage");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId, buildOpenClawWorldStateId } = require("../src/v2/contracts");
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
const REQUIRED_COLLECTED_RUNTIME_CHAIN_CHECK_IDS = Object.freeze([
  "COLLECTED_POSITION_CYCLE_ID_PRESENT",
  "COLLECTED_ENTRY_EVENT_ID_PRESENT",
  "COLLECTED_PROJECTION_POSITION_CYCLE_MATCH",
  "COLLECTED_PROJECTION_STAGE_PRESENT",
  "COLLECTED_PROTECTION_RUNTIME_POSITION_CYCLE_MATCH",
  "COLLECTED_PROTECTION_HEALTH_STATUS_PRESENT",
  "COLLECTED_ACTIVE_OR_TERMINAL_PROTECTION_STATUS_VALID",
  "COLLECTED_TRANSITIONS_POSITION_CYCLE_MATCH",
  "COLLECTED_TRANSITIONS_ENTRY_EVENT_MATCH",
  "COLLECTED_TRANSITIONS_EXCHANGE_EVIDENCE_PRESENT",
  "COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT",
  "COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT",
  "COLLECTED_OUTBOX_TRANSITION_LINKS_COMPLETE",
  "COLLECTED_OUTBOX_POSITION_CYCLE_MATCH",
  "REPLAY_GATE_EPISODE_VALID",
]);

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

function hasExchangeEvidenceSnapshot(snapshot) {
  const row = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!row) return false;
  return !!(
    trimOrNull(row.evidence_kind) &&
    trimOrNull(row.observed_at) &&
    (trimOrNull(row.source_fill_id) || trimOrNull(row.source_order_id)) &&
    Object.prototype.hasOwnProperty.call(row, "raw_payload")
  );
}

function isTerminalTransitionEvent(event) {
  return ["SL_HIT", "TRAIL_HIT", "EXTERNAL_CLOSE_SYNC", "MANUAL_CLOSE_SYNC"].includes(upper(event));
}

function isStopTerminalTransitionEvent(event) {
  return ["SL_HIT", "TRAIL_HIT"].includes(upper(event));
}

function pushRuntimeChainCheck(checks, id, ok, detail = null) {
  checks.push(Object.freeze({
    id,
    ok: ok === true,
    detail: detail && typeof detail === "object" ? Object.freeze({ ...detail }) : null,
  }));
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
      openclawPermitLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_OPENCLAW_PERMIT_LIMIT, 20, { max: 50 }),
      openclawOutcomeLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_OPENCLAW_OUTCOME_LIMIT, 20, { max: 50 }),
      openclawLearnerLimit: parsePositiveInt(env.V2_PROMOTION_COLLECT_OPENCLAW_LEARNER_LIMIT, 20, { max: 50 }),
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

function buildOpenClawSupremeControlPlaneSummary({
  worldState = null,
  executionPermits = [],
  outcomeAdjudications = [],
  learnerShadowEvaluations = [],
  expectedOpenClawDecisionId = null,
  expectedPositionCycleId = null,
} = {}) {
  const permits = Array.isArray(executionPermits) ? executionPermits : [];
  const adjudications = Array.isArray(outcomeAdjudications) ? outcomeAdjudications : [];
  const learnerRows = Array.isArray(learnerShadowEvaluations) ? learnerShadowEvaluations : [];
  const expectedDecisionId = trimOrNull(expectedOpenClawDecisionId);
  const expectedCycleId = trimOrNull(expectedPositionCycleId);
  const expectedWorldStateHash = trimOrNull(worldState && worldState.world_state_hash);
  const adjudicationIds = new Set(adjudications.map((row) => trimOrNull(row && row.openclaw_outcome_adjudication_id)).filter(Boolean));
  const permitLineageMatches = permits.filter((row) => {
    const decisionOk = !expectedDecisionId || trimOrNull(row && row.openclaw_decision_id) === expectedDecisionId;
    const worldOk = !expectedWorldStateHash || trimOrNull(row && row.world_state_hash) === expectedWorldStateHash;
    return decisionOk && worldOk;
  }).length;
  const outcomeLineageMatches = adjudications.filter((row) => {
    const decisionOk = !expectedDecisionId || trimOrNull(row && row.openclaw_decision_id) === expectedDecisionId;
    const cycleOk = !expectedCycleId || trimOrNull(row && row.position_cycle_id) === expectedCycleId;
    return decisionOk && cycleOk;
  }).length;
  const learnerLineageMatches = learnerRows.filter((row) => {
    const decisionOk = !expectedDecisionId || trimOrNull(row && row.openclaw_decision_id) === expectedDecisionId;
    const cycleOk = !expectedCycleId || trimOrNull(row && row.position_cycle_id) === expectedCycleId;
    const sourceOk = adjudicationIds.has(trimOrNull(row && row.openclaw_outcome_adjudication_id));
    return decisionOk && cycleOk && sourceOk;
  }).length;
  const validationPassCount = permits.filter((row) => upper(row && row.permit_status) === "ISSUED" && trimOrNull(row && row.world_state_hash)).length;
  const liveAppliedCount = learnerRows.filter((row) => row && row.shadow_only === false).length;
  const shadowOnlyCount = learnerRows.filter((row) => row && row.shadow_only === true).length;
  const lineageBlockers = [];
  if (expectedDecisionId && permitLineageMatches < permits.length) lineageBlockers.push("OPENCLAW_PERMIT_DECISION_OR_WORLD_STATE_LINEAGE_MISMATCH");
  if (expectedCycleId && outcomeLineageMatches < adjudications.length) lineageBlockers.push("OPENCLAW_OUTCOME_POSITION_OR_DECISION_LINEAGE_MISMATCH");
  if (learnerRows.length && learnerLineageMatches < learnerRows.length) lineageBlockers.push("OPENCLAW_LEARNER_OUTCOME_LINEAGE_MISMATCH");
  const blockers = [];
  if (!worldState || !trimOrNull(worldState.world_state_hash)) blockers.push("OPENCLAW_WORLD_STATE_REQUIRED");
  if (!permits.length) blockers.push("OPENCLAW_EXECUTION_PERMIT_REQUIRED");
  if (permits.length && validationPassCount < permits.length) blockers.push("OPENCLAW_EXECUTION_PERMIT_VALIDATION_REQUIRED");
  if (!adjudications.length) blockers.push("OPENCLAW_OUTCOME_ADJUDICATION_REQUIRED");
  if (!learnerRows.length) blockers.push("OPENCLAW_LEARNER_SHADOW_EVALUATION_REQUIRED");
  if (liveAppliedCount > 0) blockers.push("OPENCLAW_LEARNER_LIVE_APPLICATION_FORBIDDEN");
  blockers.push(...lineageBlockers);
  return Object.freeze({
    ok: blockers.length === 0,
    world_state_n: worldState ? 1 : 0,
    latest_world_state_hash: trimOrNull(worldState && worldState.world_state_hash),
    execution_permit_n: permits.length,
    permit_validation_pass_n: validationPassCount,
    permit_validation_fail_n: Math.max(permits.length - validationPassCount, 0),
    outcome_adjudication_n: adjudications.length,
    outcome_unadjudicated_n: adjudications.length > 0 ? 0 : 1,
    learner_shadow_summary: Object.freeze({
      ok: learnerRows.length > 0 && shadowOnlyCount === learnerRows.length && liveAppliedCount === 0,
      evaluation_n: learnerRows.length,
      shadow_only_n: shadowOnlyCount,
      live_applied_n: liveAppliedCount,
      stale_evaluation_n: 0,
      blockers: learnerRows.length > 0 && shadowOnlyCount === learnerRows.length && liveAppliedCount === 0
        ? []
        : ["OPENCLAW_LEARNER_SHADOW_ONLY_REQUIRED"],
    }),
    lineage_consistency_summary: Object.freeze({
      ok: lineageBlockers.length === 0,
      expected_openclaw_decision_id: expectedDecisionId,
      expected_position_cycle_id: expectedCycleId,
      expected_world_state_hash: expectedWorldStateHash,
      permit_lineage_match_n: permitLineageMatches,
      permit_lineage_mismatch_n: Math.max(permits.length - permitLineageMatches, 0),
      outcome_lineage_match_n: outcomeLineageMatches,
      outcome_lineage_mismatch_n: Math.max(adjudications.length - outcomeLineageMatches, 0),
      learner_lineage_match_n: learnerLineageMatches,
      learner_lineage_mismatch_n: Math.max(learnerRows.length - learnerLineageMatches, 0),
      blockers: Object.freeze(lineageBlockers),
    }),
    blockers: Object.freeze(blockers),
  });
}

function buildCollectedRuntimeChainAudit(episode) {
  const row = replayGateTest.validateEpisode(episode);
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  const positionCycle = episode && episode.positionCycle && typeof episode.positionCycle === "object"
    ? episode.positionCycle
    : null;
  const projection = episode && episode.projection && typeof episode.projection === "object"
    ? episode.projection
    : null;
  const protectionRuntime = episode && episode.protectionRuntime && typeof episode.protectionRuntime === "object"
    ? episode.protectionRuntime
    : null;
  const transitions = Array.isArray(episode && episode.transitions) ? episode.transitions : [];
  const outboxes = Array.isArray(episode && episode.outboxes) ? episode.outboxes : [];
  const cycleId = trimOrNull(positionCycle && positionCycle.position_cycle_id);
  const entryEventId = trimOrNull(positionCycle && positionCycle.entry_event_id);
  const projectionStage = upper(projection && projection.stage);
  const projectionHealth = upper(projection && projection.health_status);
  const positionStatus = upper(positionCycle && positionCycle.status);
  const protectionHealth = upper(protectionRuntime && protectionRuntime.health_status);
  const terminalProjection = TERMINAL_STAGES.has(projectionStage) || projectionHealth === "TERMINAL_EXITED";
  const transitionIds = new Set(transitions.map((item) => trimOrNull(item && item.canonical_transition_id)).filter(Boolean));
  const outboxTransitionIds = new Set(outboxes.map((item) => trimOrNull(item && item.canonical_transition_id)).filter(Boolean));
  const checks = [];

  pushRuntimeChainCheck(checks, "COLLECTED_POSITION_CYCLE_ID_PRESENT", !!cycleId, { actual: cycleId });
  pushRuntimeChainCheck(checks, "COLLECTED_ENTRY_EVENT_ID_PRESENT", !!entryEventId, { actual: entryEventId });
  pushRuntimeChainCheck(checks, "COLLECTED_PROJECTION_POSITION_CYCLE_MATCH", !!projection && trimOrNull(projection.position_cycle_id) === cycleId, {
    expected: cycleId,
    actual: trimOrNull(projection && projection.position_cycle_id),
  });
  pushRuntimeChainCheck(checks, "COLLECTED_PROJECTION_STAGE_PRESENT", !!projectionStage, { actual: projectionStage });
  pushRuntimeChainCheck(checks, "COLLECTED_PROTECTION_RUNTIME_POSITION_CYCLE_MATCH", !!protectionRuntime && trimOrNull(protectionRuntime.position_cycle_id) === cycleId, {
    expected: cycleId,
    actual: trimOrNull(protectionRuntime && protectionRuntime.position_cycle_id),
  });
  pushRuntimeChainCheck(checks, "COLLECTED_PROTECTION_HEALTH_STATUS_PRESENT", !!protectionHealth, { actual: protectionHealth });
  pushRuntimeChainCheck(checks, "COLLECTED_ACTIVE_OR_TERMINAL_PROTECTION_STATUS_VALID", terminalProjection
    ? protectionHealth === "TERMINAL_EXITED"
    : positionStatus === "ACTIVE_PROTECTED" && protectionHealth === "HEALTHY", {
      position_status: positionStatus,
      projection_stage: projectionStage,
      projection_health_status: projectionHealth,
      protection_health_status: protectionHealth,
    });
  pushRuntimeChainCheck(checks, "COLLECTED_TRANSITIONS_POSITION_CYCLE_MATCH", transitions.every((item) => trimOrNull(item && item.position_cycle_id) === cycleId), {
    transition_n: transitions.length,
  });
  pushRuntimeChainCheck(checks, "COLLECTED_TRANSITIONS_ENTRY_EVENT_MATCH", transitions.every((item) => trimOrNull(item && item.entry_event_id) === entryEventId), {
    transition_n: transitions.length,
  });
  pushRuntimeChainCheck(checks, "COLLECTED_TRANSITIONS_EXCHANGE_EVIDENCE_PRESENT", transitions.every((item) => hasExchangeEvidenceSnapshot(item && item.source_exchange_evidence)), {
    transition_n: transitions.length,
  });
  const terminalTransitions = transitions.filter((item) => isTerminalTransitionEvent(item && item.transition_event));
  const stopTerminalTransitions = transitions.filter((item) => isStopTerminalTransitionEvent(item && item.transition_event));
  pushRuntimeChainCheck(
    checks,
    "COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT",
    terminalTransitions.every((item) => replayGateTest.hasTerminalFullExitEvidence(item && item.source_exchange_evidence)),
    {
      terminal_transition_n: terminalTransitions.length,
      terminal_full_exit_evidence_n: terminalTransitions.filter((item) => replayGateTest.hasTerminalFullExitEvidence(item && item.source_exchange_evidence)).length,
    }
  );
  pushRuntimeChainCheck(
    checks,
    "COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT",
    stopTerminalTransitions.every((item) => replayGateTest.hasStopFillEvidence({ snapshot: item && item.source_exchange_evidence })),
    {
      stop_terminal_transition_n: stopTerminalTransitions.length,
      stop_terminal_fill_evidence_n: stopTerminalTransitions.filter((item) => replayGateTest.hasStopFillEvidence({ snapshot: item && item.source_exchange_evidence })).length,
    }
  );
  pushRuntimeChainCheck(checks, "COLLECTED_OUTBOX_TRANSITION_LINKS_COMPLETE", transitions.every((item) => outboxTransitionIds.has(trimOrNull(item && item.canonical_transition_id)))
    && outboxes.every((item) => transitionIds.has(trimOrNull(item && item.canonical_transition_id))), {
      transition_n: transitions.length,
      outbox_n: outboxes.length,
    });
  pushRuntimeChainCheck(checks, "COLLECTED_OUTBOX_POSITION_CYCLE_MATCH", outboxes.every((item) => trimOrNull(item && item.position_cycle_id) === cycleId), {
    outbox_n: outboxes.length,
  });
  pushRuntimeChainCheck(checks, "REPLAY_GATE_EPISODE_VALID", row.pass === true, {
    replay_blockers: blockers.slice(),
  });

  const failedChecks = checks.filter((check) => check.ok !== true);
  return Object.freeze({
    ok: failedChecks.length === 0,
    check_n: checks.length,
    fail_n: failedChecks.length,
    check_ids: Object.freeze(checks.map((check) => check.id)),
    passed_check_ids: Object.freeze(checks.filter((check) => check.ok === true).map((check) => check.id)),
    failed_check_ids: Object.freeze(failedChecks.map((check) => check.id)),
    replay_blockers: Object.freeze(blockers.slice()),
    checks: Object.freeze(checks),
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
  const executionPermits = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "OPENCLAW_EXECUTION_PERMITS",
      field: "openclaw_decision_id",
      value: nativeDecisionId,
      limit: cfg.queryBudget.openclawPermitLimit,
    }),
    ["issued_at"],
    false
  );
  assertRowsWithinBudget({
    rows: executionPermits,
    limit: cfg.queryBudget.openclawPermitLimit,
    reason: "V2_PROMOTION_COLLECT_OPENCLAW_PERMITS_QUERY_LIMIT_REACHED",
  });
  const latestPermit = pickLatest(executionPermits, ["issued_at"]);
  const worldState = latestPermit && trimOrNull(latestPermit.world_state_hash)
    ? await requireDoc({
        db,
        env,
        collectionKey: "OPENCLAW_WORLD_STATES",
        docId: buildOpenClawWorldStateId({ worldStateHash: latestPermit.world_state_hash }),
        reason: "V2_PROMOTION_COLLECT_OPENCLAW_WORLD_STATE_NOT_FOUND",
      }).catch(() => null)
    : null;
  const outcomeAdjudications = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.openclawOutcomeLimit,
    }),
    ["adjudicated_at"],
    false
  );
  assertRowsWithinBudget({
    rows: outcomeAdjudications,
    limit: cfg.queryBudget.openclawOutcomeLimit,
    reason: "V2_PROMOTION_COLLECT_OPENCLAW_OUTCOMES_QUERY_LIMIT_REACHED",
  });
  const learnerShadowEvaluations = sortRowsByTimestamp(
    await listDocs({
      db,
      env,
      collectionKey: "OPENCLAW_LEARNER_SHADOW_EVALUATIONS",
      field: "position_cycle_id",
      value: cfg.positionCycleId,
      limit: cfg.queryBudget.openclawLearnerLimit,
    }),
    ["evaluated_at"],
    false
  );
  assertRowsWithinBudget({
    rows: learnerShadowEvaluations,
    limit: cfg.queryBudget.openclawLearnerLimit,
    reason: "V2_PROMOTION_COLLECT_OPENCLAW_LEARNER_QUERY_LIMIT_REACHED",
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
  const openclawSupremeControlPlaneSummary = buildOpenClawSupremeControlPlaneSummary({
    worldState,
    executionPermits,
    outcomeAdjudications,
    learnerShadowEvaluations,
    expectedOpenClawDecisionId: nativeDecisionId,
    expectedPositionCycleId: cfg.positionCycleId,
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
          openclaw_execution_permits: executionPermits.length,
          openclaw_outcome_adjudications: outcomeAdjudications.length,
          openclaw_learner_shadow_evaluations: learnerShadowEvaluations.length,
        }),
      }),
      alert_retry_summary: alertRetrySummary,
      repair_evidence_summary: repairEvidenceSummary,
      openclaw_supreme_control_plane_summary: openclawSupremeControlPlaneSummary,
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
      buildOpenClawSupremeControlPlaneSummary,
      buildCollectedRuntimeChainAudit,
      REQUIRED_COLLECTED_RUNTIME_CHAIN_CHECK_IDS,
      countBy,
      sortRowsByTimestamp,
      pickLatest,
    },
  };
}
