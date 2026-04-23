"use strict";

const crypto = require("crypto");
const {
  V2_EXCHANGE,
  V2_EXIT_STAGES,
  V2_TRANSITION_EVENTS,
  V2_HEALTH_STATUSES,
  V2_POSITION_CYCLE_STATUSES,
  V2_ALERT_TYPES,
  V2_SIGNAL_SOURCE_MODES,
  V2_DECISION_MODES,
  V2_SIGNAL_DECISION_STATUSES,
  V2_ML_AI_PROPOSAL_VERDICTS,
  V2_RISK_BANDS,
  V2_WATCHDOG_ISSUE_CODES,
  V2_REPAIR_ACTIONS,
  V2_REPAIR_EXECUTION_STATUSES,
} = require("./constants");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function hash12(payload) {
  return crypto.createHash("sha1").update(String(payload || "")).digest("hex").slice(0, 12);
}

function validateRequiredString(name, value) {
  const text = trimOrNull(value);
  if (!text) throw new Error(`${name}_REQUIRED`);
  return text;
}

function validateEnum(name, value, allowed) {
  const normalized = upper(value);
  if (!allowed.includes(normalized)) {
    throw new Error(`${name}_INVALID`);
  }
  return normalized;
}

function buildPositionCycleId({
  exchange = V2_EXCHANGE,
  symbol,
  entryEventId,
  positionSide,
} = {}) {
  const ex = validateRequiredString("exchange", upper(exchange));
  const sym = validateRequiredString("symbol", upper(symbol));
  const entry = validateRequiredString("entry_event_id", entryEventId);
  const side = validateRequiredString("position_side", upper(positionSide));
  return `PCY__${ex}__${sym}__${side}__${hash12(entry)}`;
}

function buildCanonicalTransitionId({
  positionCycleId,
  transitionEvent,
  sourceFillId,
} = {}) {
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  const event = validateEnum("transition_event", transitionEvent, V2_TRANSITION_EVENTS);
  const fillId = validateRequiredString("source_fill_id", sourceFillId);
  return `CETV2__${cycleId}__${event}__${hash12(fillId)}`;
}

function buildProtectionRuntimeId({ positionCycleId } = {}) {
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  return `PRTV2__${cycleId}`;
}

function buildExitRuntimeProjectionId({ positionCycleId } = {}) {
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  return `ERPv2__${cycleId}`;
}

function buildTradeAlertOutboxId({
  canonicalTransitionId,
  alertType,
} = {}) {
  const transitionId = validateRequiredString("canonical_transition_id", canonicalTransitionId);
  const type = validateEnum("alert_type", alertType, V2_ALERT_TYPES);
  return `TAOV2__${type}__${transitionId}`;
}

function buildSignalIntentId({
  signalLineageId,
  signalSourceMode,
  symbol,
  side,
} = {}) {
  const lineageId = validateRequiredString("signal_lineage_id", signalLineageId);
  const sourceMode = validateEnum("signal_source_mode", signalSourceMode, V2_SIGNAL_SOURCE_MODES);
  const sym = validateRequiredString("symbol", upper(symbol));
  const normalizedSide = validateRequiredString("side", upper(side));
  return `SIGINTV2__${sourceMode}__${sym}__${normalizedSide}__${hash12(lineageId)}`;
}

function buildFeatureSnapshotId({
  signalIntentId,
  schemaVersion,
  snapshotAt,
} = {}) {
  const intentId = validateRequiredString("signal_intent_id", signalIntentId);
  const version = validateRequiredString("feature_schema_version", schemaVersion);
  const at = validateRequiredString("snapshot_at", snapshotAt);
  return `FSV2__${hash12(`${intentId}__${version}__${at}`)}`;
}

function buildMlAiSignalProposalId({
  signalIntentId,
  decisionMode,
  proposalVerdict,
} = {}) {
  const intentId = validateRequiredString("signal_intent_id", signalIntentId);
  const mode = validateEnum("decision_mode", decisionMode, V2_DECISION_MODES);
  const verdict = validateEnum("proposal_verdict", proposalVerdict, V2_ML_AI_PROPOSAL_VERDICTS);
  return `MSPV2__${mode}__${verdict}__${hash12(intentId)}`;
}

function buildMlAiEvidenceDecisionId({
  signalIntentId,
  decisionMode,
  modelVersion,
} = {}) {
  const intentId = validateRequiredString("signal_intent_id", signalIntentId);
  const mode = validateEnum("decision_mode", decisionMode, V2_DECISION_MODES);
  const version = validateRequiredString("model_version", modelVersion);
  return `MLAIV2__${mode}__${hash12(`${intentId}__${version}`)}`;
}

function buildOpenClawDecisionId({
  signalIntentId,
  decisionMode,
  recommendedAction,
} = {}) {
  const intentId = validateRequiredString("signal_intent_id", signalIntentId);
  const mode = validateEnum("decision_mode", decisionMode, V2_DECISION_MODES);
  const action = validateRequiredString("recommended_action", upper(recommendedAction));
  return `OCDV2__${mode}__${action}__${hash12(intentId)}`;
}

function buildOpenClawExecutionAuditId({
  auditId,
} = {}) {
  return validateRequiredString("audit_id", auditId);
}

function buildOpenClawWorldStateId({
  worldStateHash,
} = {}) {
  const hash = validateRequiredString("world_state_hash", worldStateHash);
  return `OCWSV2__${hash12(hash)}`;
}

function buildOpenClawExecutionPermitId({
  openclawDecisionId,
  worldStateHash,
  issuedAt,
} = {}) {
  const decisionId = validateRequiredString("openclaw_decision_id", openclawDecisionId);
  const hash = validateRequiredString("world_state_hash", worldStateHash);
  const at = validateRequiredString("issued_at", issuedAt);
  return `OCEPV2__${hash12(`${decisionId}__${hash}__${at}`)}`;
}

function buildOpenClawOutcomeAdjudicationId({
  openclawDecisionId,
  positionCycleId,
  adjudicatedAt,
} = {}) {
  const decisionId = validateRequiredString("openclaw_decision_id", openclawDecisionId);
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  const at = validateRequiredString("adjudicated_at", adjudicatedAt);
  return `OCOADJV2__${hash12(`${decisionId}__${cycleId}__${at}`)}`;
}

function buildOpenClawLearnerShadowEvaluationId({
  sourceAdjudicationId,
  evaluatedAt,
} = {}) {
  const adjudicationId = validateRequiredString("openclaw_outcome_adjudication_id", sourceAdjudicationId);
  const at = validateRequiredString("evaluated_at", evaluatedAt);
  return `OCLSEV2__${hash12(`${adjudicationId}__${at}`)}`;
}

function buildTrailObservationId({
  positionCycleId,
  observedAt,
  watermarkPrice,
} = {}) {
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  const at = validateRequiredString("observed_at", observedAt);
  const watermark = validateRequiredString("watermark_price", String(toNumberOrNull(watermarkPrice)));
  return `TROBSV2__${hash12(`${cycleId}__${at}__${watermark}`)}`;
}

function buildRepairRequestId({
  positionCycleId,
  issueCode,
} = {}) {
  const cycleId = validateRequiredString("position_cycle_id", positionCycleId);
  const issue = validateEnum("issue_code", issueCode, V2_WATCHDOG_ISSUE_CODES);
  return `RQRV2__${issue}__${hash12(cycleId)}`;
}

function buildRepairExecutionLedgerId({
  exitRepairRequestId,
  executionStatus,
  recordedAt,
} = {}) {
  const requestId = validateRequiredString("exit_repair_request_id", exitRepairRequestId);
  const status = validateEnum("execution_status", executionStatus, V2_REPAIR_EXECUTION_STATUSES);
  const at = validateRequiredString("recorded_at", recordedAt);
  return `RQLEDGERV2__${status}__${hash12(`${requestId}__${at}`)}`;
}

function buildPositionCycleDoc({
  exchange = V2_EXCHANGE,
  symbol,
  entryEventId,
  entryOrderId,
  entryFillGroupId,
  entryIntentId = null,
  signalIntentId = null,
  openclawDecisionId = null,
  positionSide,
  entryPrice,
  entryQtyAbs,
  status = "ACTIVE",
  createdAt = null,
} = {}) {
  const cycleId = buildPositionCycleId({ exchange, symbol, entryEventId, positionSide });
  return {
    position_cycle_id: cycleId,
    exchange: upper(exchange),
    symbol: upper(symbol),
    entry_event_id: validateRequiredString("entry_event_id", entryEventId),
    entry_order_id: validateRequiredString("entry_order_id", entryOrderId),
    entry_fill_group_id: validateRequiredString("entry_fill_group_id", entryFillGroupId),
    entry_intent_id: trimOrNull(entryIntentId),
    signal_intent_id: trimOrNull(signalIntentId),
    openclaw_decision_id: trimOrNull(openclawDecisionId),
    position_side: validateRequiredString("position_side", upper(positionSide)),
    entry_price: toNumberOrNull(entryPrice),
    entry_qty_abs: toNumberOrNull(entryQtyAbs),
    status: validateEnum("status", status, V2_POSITION_CYCLE_STATUSES),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildCanonicalExitTransitionDoc({
  positionCycleId,
  transitionEvent,
  previousStage,
  nextStage,
  sourceFillId,
  sourceOrderId,
  entryEventId,
  ledgerPatch = null,
  sourceExchangeEvidence = null,
  createdAt = null,
} = {}) {
  const transitionId = buildCanonicalTransitionId({ positionCycleId, transitionEvent, sourceFillId });
  return {
    canonical_transition_id: transitionId,
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    transition_event: validateEnum("transition_event", transitionEvent, V2_TRANSITION_EVENTS),
    previous_stage: validateEnum("previous_stage", previousStage, V2_EXIT_STAGES),
    next_stage: validateEnum("next_stage", nextStage, V2_EXIT_STAGES),
    source_fill_id: validateRequiredString("source_fill_id", sourceFillId),
    source_order_id: validateRequiredString("source_order_id", sourceOrderId),
    entry_event_id: validateRequiredString("entry_event_id", entryEventId),
    ledger_patch: cloneJson(ledgerPatch) || {},
    source_exchange_evidence: cloneJson(sourceExchangeEvidence),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildProtectionRuntimeDoc({
  positionCycleId,
  slOrderId,
  tp1OrderId,
  nativeStopPrice,
  nativeTp1Price,
  nativeRefreshStatus,
  lastRefreshAt = null,
  lastGapMs = null,
  healthStatus = "HEALTHY",
  slOrderStatus = null,
  tp1OrderStatus = null,
  runtimeWriteReason = null,
  placementIssueCodes = [],
  placementAttemptId = null,
  placementRetryId = null,
  placementStartedAt = null,
  placementFinishedAt = null,
  slAckAt = null,
  tp1AckAt = null,
  lastExchangeEvidence = null,
  lastEvidenceObservedAt = null,
} = {}) {
  return {
    protection_runtime_id: buildProtectionRuntimeId({ positionCycleId }),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    sl_order_id: trimOrNull(slOrderId),
    tp1_order_id: trimOrNull(tp1OrderId),
    native_stop_price: toNumberOrNull(nativeStopPrice),
    native_tp1_price: toNumberOrNull(nativeTp1Price),
    native_refresh_status: validateRequiredString("native_refresh_status", upper(nativeRefreshStatus)),
    last_refresh_at: trimOrNull(lastRefreshAt) || new Date().toISOString(),
    last_gap_ms: toNumberOrNull(lastGapMs),
    health_status: validateEnum("health_status", healthStatus, V2_HEALTH_STATUSES),
    sl_order_status: trimOrNull(slOrderStatus),
    tp1_order_status: trimOrNull(tp1OrderStatus),
    runtime_write_reason: trimOrNull(runtimeWriteReason),
    placement_issue_codes: Array.isArray(placementIssueCodes)
      ? placementIssueCodes.map((code) => validateRequiredString("placement_issue_code", upper(code)))
      : [],
    placement_attempt_id: trimOrNull(placementAttemptId),
    placement_retry_id: trimOrNull(placementRetryId),
    placement_started_at: trimOrNull(placementStartedAt),
    placement_finished_at: trimOrNull(placementFinishedAt),
    sl_ack_at: trimOrNull(slAckAt),
    tp1_ack_at: trimOrNull(tp1AckAt),
    last_exchange_evidence: cloneJson(lastExchangeEvidence),
    last_evidence_observed_at: trimOrNull(lastEvidenceObservedAt),
  };
}

function buildExitRuntimeProjectionDoc({
  positionCycleId,
  stage,
  tp1Done,
  trailActive,
  entryQtyAbs,
  tp1TargetPrice = null,
  tp1TargetQtyAbs,
  tp1FilledQtyAbs,
  runnerRemainingQtyAbs,
  runnerFloorStop,
  trailStopByR,
  chosenStopSource,
  chosenStopPrice,
  finalEffectiveStop,
  nativeStopPrice,
  healthStatus = "HEALTHY",
} = {}) {
  return {
    exit_runtime_projection_id: buildExitRuntimeProjectionId({ positionCycleId }),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    stage: validateEnum("stage", stage, V2_EXIT_STAGES),
    tp1_done: tp1Done === true,
    trail_active: trailActive === true,
    entry_qty_abs: toNumberOrNull(entryQtyAbs),
    tp1_target_price: toNumberOrNull(tp1TargetPrice),
    tp1_target_qty_abs: toNumberOrNull(tp1TargetQtyAbs),
    tp1_filled_qty_abs: toNumberOrNull(tp1FilledQtyAbs),
    runner_remaining_qty_abs: toNumberOrNull(runnerRemainingQtyAbs),
    runner_floor_stop: toNumberOrNull(runnerFloorStop),
    trail_stop_by_r: toNumberOrNull(trailStopByR),
    chosen_stop_source: validateRequiredString("chosen_stop_source", upper(chosenStopSource)),
    chosen_stop_price: toNumberOrNull(chosenStopPrice),
    final_effective_stop: toNumberOrNull(finalEffectiveStop),
    native_stop_price: toNumberOrNull(nativeStopPrice),
    health_status: validateEnum("health_status", healthStatus, V2_HEALTH_STATUSES),
  };
}

function buildTradeAlertOutboxDoc({
  canonicalTransitionId,
  positionCycleId,
  alertType,
  status = "PENDING",
  attemptCount = 1,
  lastReason = null,
  sentAt = null,
  lastAttemptAt = null,
  lastReasonFamily = null,
  retryPolicyCode = null,
  runbookRefs = [],
} = {}) {
  return {
    alert_outbox_id: buildTradeAlertOutboxId({ canonicalTransitionId, alertType }),
    canonical_transition_id: validateRequiredString("canonical_transition_id", canonicalTransitionId),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    alert_type: validateEnum("alert_type", alertType, V2_ALERT_TYPES),
    status: validateRequiredString("status", upper(status)),
    attempt_count: Math.max(0, Number(attemptCount) || 0),
    last_reason: trimOrNull(lastReason),
    sent_at: trimOrNull(sentAt),
    last_attempt_at: trimOrNull(lastAttemptAt),
    last_reason_family: trimOrNull(lastReasonFamily),
    retry_policy_code: trimOrNull(retryPolicyCode),
    runbook_refs: Array.isArray(runbookRefs)
      ? runbookRefs.map((ref) => validateRequiredString("runbook_ref", upper(ref)))
      : [],
  };
}

function buildSignalIntentDoc({
  signalSourceMode,
  signalLineageId,
  symbol,
  side,
  qualityScore,
  budgetCheckResult,
  minOrderCheckResult,
  decisionStatus,
  createdAt = null,
} = {}) {
  const signalIntentId = buildSignalIntentId({
    signalLineageId,
    signalSourceMode,
    symbol,
    side,
  });
  return {
    signal_intent_id: signalIntentId,
    signal_source_mode: validateEnum("signal_source_mode", signalSourceMode, V2_SIGNAL_SOURCE_MODES),
    signal_lineage_id: validateRequiredString("signal_lineage_id", signalLineageId),
    symbol: validateRequiredString("symbol", upper(symbol)),
    side: validateRequiredString("side", upper(side)),
    quality_score: toNumberOrNull(qualityScore),
    budget_check_result: validateRequiredString("budget_check_result", upper(budgetCheckResult)),
    min_order_check_result: validateRequiredString("min_order_check_result", upper(minOrderCheckResult)),
    decision_status: validateEnum("decision_status", decisionStatus, V2_SIGNAL_DECISION_STATUSES),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildFeatureSnapshotDoc({
  signalIntentId,
  signalSourceMode,
  symbol,
  side,
  timeframe,
  schemaVersion,
  featureVectorHash,
  featureValues,
  marketRegime = null,
  snapshotAt = null,
} = {}) {
  const at = trimOrNull(snapshotAt) || new Date().toISOString();
  const features = cloneJson(featureValues);
  if (!features || typeof features !== "object" || Array.isArray(features) || !Object.keys(features).length) {
    throw new Error("feature_values_REQUIRED");
  }
  return {
    feature_snapshot_id: buildFeatureSnapshotId({
      signalIntentId,
      schemaVersion,
      snapshotAt: at,
    }),
    signal_intent_id: validateRequiredString("signal_intent_id", signalIntentId),
    signal_source_mode: validateEnum("signal_source_mode", signalSourceMode, V2_SIGNAL_SOURCE_MODES),
    symbol: validateRequiredString("symbol", upper(symbol)),
    side: validateRequiredString("side", upper(side)),
    timeframe: validateRequiredString("timeframe", upper(timeframe)),
    feature_schema_version: validateRequiredString("feature_schema_version", schemaVersion),
    feature_vector_hash: validateRequiredString("feature_vector_hash", featureVectorHash),
    feature_values: features,
    market_regime: trimOrNull(marketRegime),
    snapshot_at: at,
  };
}

function buildMlAiSignalProposalDoc({
  signalIntentId,
  featureSnapshotId,
  signalSourceMode,
  symbol,
  side,
  timeframe,
  decisionMode,
  proposalVerdict,
  qualityScore,
  rankScore,
  sizeRatio,
  riskBand,
  strategyFilterName,
  strategyFilterVerdict,
  rationaleSummary,
  setupType = null,
  signalScore = null,
  expectedNetRAfterCost = null,
  createdAt = null,
} = {}) {
  return {
    ml_ai_signal_proposal_id: buildMlAiSignalProposalId({
      signalIntentId,
      decisionMode,
      proposalVerdict,
    }),
    signal_intent_id: validateRequiredString("signal_intent_id", signalIntentId),
    feature_snapshot_id: validateRequiredString("feature_snapshot_id", featureSnapshotId),
    signal_source_mode: validateEnum("signal_source_mode", signalSourceMode, V2_SIGNAL_SOURCE_MODES),
    symbol: validateRequiredString("symbol", upper(symbol)),
    side: validateRequiredString("side", upper(side)),
    timeframe: validateRequiredString("timeframe", upper(timeframe)),
    decision_mode: validateEnum("decision_mode", decisionMode, V2_DECISION_MODES),
    proposal_verdict: validateEnum("proposal_verdict", proposalVerdict, V2_ML_AI_PROPOSAL_VERDICTS),
    quality_score: toNumberOrNull(qualityScore),
    rank_score: toNumberOrNull(rankScore),
    size_ratio: toNumberOrNull(sizeRatio),
    risk_band: validateEnum("risk_band", riskBand, V2_RISK_BANDS),
    strategy_filter_name: validateRequiredString("strategy_filter_name", upper(strategyFilterName)),
    strategy_filter_verdict: validateRequiredString("strategy_filter_verdict", upper(strategyFilterVerdict)),
    setup_type: trimOrNull(upper(setupType)),
    signal_score: toNumberOrNull(signalScore),
    expected_net_r_after_cost: toNumberOrNull(expectedNetRAfterCost),
    rationale_summary: validateRequiredString("rationale_summary", rationaleSummary),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildMlAiEvidenceLedgerDoc({
  signalIntentId,
  featureSnapshotId,
  featureSchemaVersion,
  decisionMode,
  featuresHash,
  modelVersion,
  decisionSummary,
  recommendedAction,
  createdAt = null,
} = {}) {
  return {
    decision_id: buildMlAiEvidenceDecisionId({
      signalIntentId,
      decisionMode,
      modelVersion,
    }),
    signal_intent_id: validateRequiredString("signal_intent_id", signalIntentId),
    feature_snapshot_id: validateRequiredString("feature_snapshot_id", featureSnapshotId),
    feature_schema_version: validateRequiredString("feature_schema_version", featureSchemaVersion),
    decision_mode: validateEnum("decision_mode", decisionMode, V2_DECISION_MODES),
    features_hash: validateRequiredString("features_hash", featuresHash),
    model_version: validateRequiredString("model_version", modelVersion),
    decision_summary: validateRequiredString("decision_summary", decisionSummary),
    recommended_action: validateRequiredString("recommended_action", upper(recommendedAction)),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildOpenClawDecisionDoc({
  signalIntentId,
  decisionMode,
  recommendedAction,
  approved,
  rationaleSummary,
  policyScope,
  strategyFilterResult,
  canonicalEvidenceSummary = null,
  mlAiEvidenceDecisionId = null,
  createdAt = null,
} = {}) {
  const filter = strategyFilterResult && typeof strategyFilterResult === "object" ? strategyFilterResult : null;
  if (!filter) throw new Error("strategy_filter_result_REQUIRED");
  return {
    openclaw_decision_id: buildOpenClawDecisionId({
      signalIntentId,
      decisionMode,
      recommendedAction,
    }),
    signal_intent_id: validateRequiredString("signal_intent_id", signalIntentId),
    decision_mode: validateEnum("decision_mode", decisionMode, V2_DECISION_MODES),
    recommended_action: validateRequiredString("recommended_action", upper(recommendedAction)),
    approved: approved === true,
    rationale_summary: validateRequiredString("rationale_summary", rationaleSummary),
    policy_scope: validateRequiredString("policy_scope", upper(policyScope)),
    strategy_filter_name: validateRequiredString("strategy_filter_name", upper(filter.filter_name)),
    strategy_filter_verdict: validateRequiredString("strategy_filter_verdict", upper(filter.verdict)),
    strategy_filter_reason: validateRequiredString("strategy_filter_reason", upper(filter.reason)),
    canonical_evidence_summary: cloneJson(canonicalEvidenceSummary) || {},
    ml_ai_evidence_decision_id: trimOrNull(mlAiEvidenceDecisionId),
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildOpenClawExecutionAuditDoc({
  audit,
  positionCycleId = null,
  source = "PROMOTION_RUNTIME_COLLECTOR",
  artifactRunId = null,
  recordedAt = null,
} = {}) {
  const row = audit && typeof audit === "object" ? audit : null;
  if (!row) throw new Error("openclaw_execution_audit_REQUIRED");
  const auditId = buildOpenClawExecutionAuditId({ auditId: row.audit_id });
  const failedCheckIds = Array.isArray(row.failed_check_ids) ? row.failed_check_ids.map((id) => validateRequiredString("failed_check_id", id)) : [];
  return {
    openclaw_execution_audit_id: auditId,
    audit_id: auditId,
    signal_intent_id: validateRequiredString("signal_intent_id", row.signal_intent_id),
    openclaw_decision_id: validateRequiredString("openclaw_decision_id", row.openclaw_decision_id),
    openclaw_decision_bundle_hash: trimOrNull(row.openclaw_decision_bundle_hash),
    position_cycle_id: trimOrNull(positionCycleId),
    decision_mode: validateEnum("decision_mode", row.decision_mode, V2_DECISION_MODES),
    deterministic_route_status: validateRequiredString("deterministic_route_status", upper(row.deterministic_route_status)),
    execution_kernel_status: validateRequiredString("execution_kernel_status", upper(row.execution_kernel_status)),
    ok: row.ok === true,
    check_n: toNumberOrNull(row.check_n),
    fail_n: toNumberOrNull(row.fail_n),
    failed_check_ids: failedCheckIds,
    source: validateRequiredString("source", upper(source)),
    artifact_run_id: trimOrNull(artifactRunId),
    audit_snapshot: cloneJson(row) || {},
    recorded_at: trimOrNull(recordedAt) || new Date().toISOString(),
  };
}

function buildOpenClawWorldStateDoc({
  worldStateHash,
  generatedAt = null,
  exchange = V2_EXCHANGE,
  mode = "CANARY",
  marketState = null,
  positionState = null,
  protectionState = null,
  riskState = null,
  runtimeState = null,
  canaryState = null,
  configState = null,
  costState = null,
  sourceRefs = null,
} = {}) {
  const hash = validateRequiredString("world_state_hash", worldStateHash);
  return {
    openclaw_world_state_id: buildOpenClawWorldStateId({ worldStateHash: hash }),
    world_state_hash: hash,
    generated_at: trimOrNull(generatedAt) || new Date().toISOString(),
    exchange: validateRequiredString("exchange", upper(exchange)),
    mode: validateEnum("mode", mode, V2_DECISION_MODES),
    market_state: cloneJson(marketState) || {},
    position_state: cloneJson(positionState) || {},
    protection_state: cloneJson(protectionState) || {},
    risk_state: cloneJson(riskState) || {},
    runtime_state: cloneJson(runtimeState) || {},
    canary_state: cloneJson(canaryState) || {},
    config_state: cloneJson(configState) || {},
    cost_state: cloneJson(costState) || {},
    source_refs: cloneJson(sourceRefs) || {},
    schema_version: 1,
  };
}

function buildOpenClawExecutionPermitDoc({
  openclawDecisionId,
  signalIntentId,
  worldStateHash,
  decisionMode,
  symbol,
  side,
  recommendedAction,
  permitStatus = "ISSUED",
  sizingCap = null,
  riskBudget = null,
  exitContract = null,
  approvalReason,
  issuedAt = null,
  expiresAt,
  source = "OPENCLAW_SUPREME_CONTROL_PLANE",
} = {}) {
  const issued = trimOrNull(issuedAt) || new Date().toISOString();
  return {
    openclaw_execution_permit_id: buildOpenClawExecutionPermitId({
      openclawDecisionId,
      worldStateHash,
      issuedAt: issued,
    }),
    openclaw_decision_id: validateRequiredString("openclaw_decision_id", openclawDecisionId),
    signal_intent_id: validateRequiredString("signal_intent_id", signalIntentId),
    world_state_hash: validateRequiredString("world_state_hash", worldStateHash),
    decision_mode: validateEnum("decision_mode", decisionMode, V2_DECISION_MODES),
    symbol: validateRequiredString("symbol", upper(symbol)),
    side: validateRequiredString("side", upper(side)),
    recommended_action: validateRequiredString("recommended_action", upper(recommendedAction)),
    permit_status: validateRequiredString("permit_status", upper(permitStatus)),
    sizing_cap: cloneJson(sizingCap) || {},
    risk_budget: cloneJson(riskBudget) || {},
    exit_contract: cloneJson(exitContract) || {},
    approval_reason: validateRequiredString("approval_reason", approvalReason),
    issued_at: issued,
    expires_at: validateRequiredString("expires_at", expiresAt),
    source: validateRequiredString("source", upper(source)),
    schema_version: 1,
  };
}

function buildOpenClawOutcomeAdjudicationDoc({
  openclawDecisionId,
  signalIntentId,
  positionCycleId,
  adjudicationLabel,
  adjudicationFamily,
  realizedExitEvent = null,
  realizedPnl = null,
  executionOk = null,
  protectionOk = null,
  modelOk = null,
  evidence = null,
  source = "OPENCLAW_OUTCOME_ADJUDICATOR",
  adjudicatedAt = null,
} = {}) {
  const at = trimOrNull(adjudicatedAt) || new Date().toISOString();
  return {
    openclaw_outcome_adjudication_id: buildOpenClawOutcomeAdjudicationId({
      openclawDecisionId,
      positionCycleId,
      adjudicatedAt: at,
    }),
    openclaw_decision_id: validateRequiredString("openclaw_decision_id", openclawDecisionId),
    signal_intent_id: trimOrNull(signalIntentId),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    adjudication_label: validateRequiredString("adjudication_label", upper(adjudicationLabel)),
    adjudication_family: validateRequiredString("adjudication_family", upper(adjudicationFamily)),
    realized_exit_event: trimOrNull(upper(realizedExitEvent)),
    realized_pnl: toNumberOrNull(realizedPnl),
    execution_ok: executionOk === null || executionOk === undefined ? null : executionOk === true,
    protection_ok: protectionOk === null || protectionOk === undefined ? null : protectionOk === true,
    model_ok: modelOk === null || modelOk === undefined ? null : modelOk === true,
    evidence: cloneJson(evidence) || {},
    source: validateRequiredString("source", upper(source)),
    adjudicated_at: at,
    schema_version: 1,
  };
}

function buildOpenClawLearnerShadowEvaluationDoc({
  sourceAdjudicationId,
  openclawDecisionId,
  positionCycleId,
  learnerVersion = "openclaw-shadow-learner-v1",
  shadowOnly = true,
  proposedAction,
  proposedPolicyPatch = null,
  confidence = null,
  reasonTrace = [],
  evaluatedAt = null,
} = {}) {
  const at = trimOrNull(evaluatedAt) || new Date().toISOString();
  return {
    openclaw_learner_shadow_evaluation_id: buildOpenClawLearnerShadowEvaluationId({
      sourceAdjudicationId,
      evaluatedAt: at,
    }),
    openclaw_outcome_adjudication_id: validateRequiredString("openclaw_outcome_adjudication_id", sourceAdjudicationId),
    openclaw_decision_id: validateRequiredString("openclaw_decision_id", openclawDecisionId),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    learner_version: validateRequiredString("learner_version", learnerVersion),
    shadow_only: shadowOnly !== false,
    proposed_action: validateRequiredString("proposed_action", upper(proposedAction)),
    proposed_policy_patch: cloneJson(proposedPolicyPatch) || {},
    confidence: toNumberOrNull(confidence),
    reason_trace: Array.isArray(reasonTrace)
      ? reasonTrace.map((reason) => validateRequiredString("reason_trace", upper(reason)))
      : [],
    evaluated_at: at,
    schema_version: 1,
  };
}

function buildTrailObservationDoc({
  positionCycleId,
  stage,
  marketPrice,
  watermarkPrice,
  runnerFloorStop,
  trailStopByR,
  chosenStopSource,
  chosenStopPrice,
  finalEffectiveStop,
  nativeStopPrice,
  issueCodes = [],
  observedAt = null,
} = {}) {
  const at = trimOrNull(observedAt) || new Date().toISOString();
  return {
    trail_observation_id: buildTrailObservationId({
      positionCycleId,
      observedAt: at,
      watermarkPrice,
    }),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    stage: validateEnum("stage", stage, V2_EXIT_STAGES),
    market_price: toNumberOrNull(marketPrice),
    watermark_price: toNumberOrNull(watermarkPrice),
    runner_floor_stop: toNumberOrNull(runnerFloorStop),
    trail_stop_by_r: toNumberOrNull(trailStopByR),
    chosen_stop_source: validateRequiredString("chosen_stop_source", upper(chosenStopSource)),
    chosen_stop_price: toNumberOrNull(chosenStopPrice),
    final_effective_stop: toNumberOrNull(finalEffectiveStop),
    native_stop_price: toNumberOrNull(nativeStopPrice),
    issue_codes: Array.isArray(issueCodes) ? issueCodes.map((code) => validateRequiredString("issue_code", upper(code))) : [],
    observed_at: at,
  };
}

function buildRepairRequestDoc({
  positionCycleId,
  stage,
  issueCode,
  healthStatus,
  requestedAction,
  detail = null,
  status = "PENDING",
  createdAt = null,
} = {}) {
  return {
    exit_repair_request_id: buildRepairRequestId({ positionCycleId, issueCode }),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    stage: validateEnum("stage", stage, V2_EXIT_STAGES),
    issue_code: validateEnum("issue_code", issueCode, V2_WATCHDOG_ISSUE_CODES),
    health_status: validateEnum("health_status", healthStatus, V2_HEALTH_STATUSES),
    requested_action: validateEnum("requested_action", requestedAction, V2_REPAIR_ACTIONS),
    status: validateRequiredString("status", upper(status)),
    detail: cloneJson(detail) || {},
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  };
}

function buildRepairExecutionLedgerDoc({
  exitRepairRequestId,
  positionCycleId,
  issueCode,
  requestedAction,
  executionStatus,
  delegatedToService = null,
  requestedByService = null,
  commandType = null,
  skipReason = null,
  commandSnapshot = null,
  attemptMeta = null,
  resultSnapshot = null,
  recordedAt = null,
} = {}) {
  const at = trimOrNull(recordedAt) || new Date().toISOString();
  return {
    repair_execution_ledger_id: buildRepairExecutionLedgerId({
      exitRepairRequestId,
      executionStatus,
      recordedAt: at,
    }),
    exit_repair_request_id: validateRequiredString("exit_repair_request_id", exitRepairRequestId),
    position_cycle_id: validateRequiredString("position_cycle_id", positionCycleId),
    issue_code: validateEnum("issue_code", issueCode, V2_WATCHDOG_ISSUE_CODES),
    requested_action: validateEnum("requested_action", requestedAction, V2_REPAIR_ACTIONS),
    execution_status: validateEnum("execution_status", executionStatus, V2_REPAIR_EXECUTION_STATUSES),
    delegated_to_service: trimOrNull(delegatedToService),
    requested_by_service: trimOrNull(requestedByService),
    command_type: trimOrNull(commandType),
    skip_reason: trimOrNull(skipReason),
    command_snapshot: cloneJson(commandSnapshot) || null,
    attempt_meta: cloneJson(attemptMeta) || null,
    result_snapshot: cloneJson(resultSnapshot) || null,
    recorded_at: at,
  };
}

module.exports = {
  buildPositionCycleId,
  buildCanonicalTransitionId,
  buildProtectionRuntimeId,
  buildExitRuntimeProjectionId,
  buildTradeAlertOutboxId,
  buildSignalIntentId,
  buildFeatureSnapshotId,
  buildMlAiSignalProposalId,
  buildMlAiEvidenceDecisionId,
  buildOpenClawDecisionId,
  buildOpenClawExecutionAuditId,
  buildOpenClawWorldStateId,
  buildOpenClawExecutionPermitId,
  buildOpenClawOutcomeAdjudicationId,
  buildOpenClawLearnerShadowEvaluationId,
  buildTrailObservationId,
  buildRepairRequestId,
  buildRepairExecutionLedgerId,
  buildPositionCycleDoc,
  buildCanonicalExitTransitionDoc,
  buildProtectionRuntimeDoc,
  buildExitRuntimeProjectionDoc,
  buildTradeAlertOutboxDoc,
  buildSignalIntentDoc,
  buildFeatureSnapshotDoc,
  buildMlAiSignalProposalDoc,
  buildMlAiEvidenceLedgerDoc,
  buildOpenClawDecisionDoc,
  buildOpenClawExecutionAuditDoc,
  buildOpenClawWorldStateDoc,
  buildOpenClawExecutionPermitDoc,
  buildOpenClawOutcomeAdjudicationDoc,
  buildOpenClawLearnerShadowEvaluationDoc,
  buildTrailObservationDoc,
  buildRepairRequestDoc,
  buildRepairExecutionLedgerDoc,
  __test: {
    validateRequiredString,
    validateEnum,
    hash12,
  },
};
