"use strict";

const fs = require("fs");
const { normalizePreparedOverride } = require("./selfEvolutionPreparedOverride");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoMs(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function resolveCandidateRows(candidateChangeSet = null) {
  const raw = unwrapRawReport(candidateChangeSet) || {};
  return Array.isArray(raw.rows) ? raw.rows : [];
}

function findCandidateRow(candidateChangeSet = null, candidateId = null) {
  const target = String(candidateId || "").trim();
  if (!target) return null;
  return resolveCandidateRows(candidateChangeSet)
    .find((row) => String(row && row.candidate_id || "").trim() === target) || null;
}

function deriveCanonicalPolicyRecommendation({ candidateChangeSet = null, stageAutopilot = null } = {}) {
  const stage = unwrapRawReport(stageAutopilot) || {};
  const stageRows = Array.isArray(stage.stage_rows) ? stage.stage_rows : [];
  const canonicalStage = stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "SOURCE_MODE")
    || stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "CANONICAL_POLICY")
    || null;
  const stageCandidateId = String(canonicalStage && canonicalStage.candidate_id || "").trim() || null;
  if (stageCandidateId) {
    const candidateRow = findCandidateRow(candidateChangeSet, stageCandidateId);
    if (
      candidateRow
      && String(candidateRow.canonical_migration_class || "").trim().toUpperCase() === "PINE_THRESHOLD"
      && String(candidateRow.target_deploy_unit || "").trim().toUpperCase() === "SERVER_SETTINGS"
    ) {
      return {
        candidate_id: stageCandidateId,
        display_candidate_id: String(candidateRow.display_candidate_id || candidateRow.candidate_id || "").trim() || null,
        canonical_migration_class: String(candidateRow.canonical_migration_class || "").trim().toUpperCase() || null,
        target_deploy_unit: String(candidateRow.target_deploy_unit || "").trim().toUpperCase() || null,
        stage_state: String(canonicalStage.machine_state || "").trim().toUpperCase() || null,
        stage_reason: String(canonicalStage.reason || "").trim() || null,
        stage_signature: String(canonicalStage.signature || "").trim() || null,
      };
    }
  }
  const candidateRows = resolveCandidateRows(candidateChangeSet);
  const fallback = candidateRows.find((row) =>
    row
    && String(row.canonical_migration_class || "").trim().toUpperCase() === "PINE_THRESHOLD"
    && String(row.target_deploy_unit || "").trim().toUpperCase() === "SERVER_SETTINGS"
    && row.ready_for_auto_apply === true
    && row.memory_blocked !== true
  ) || null;
  if (!fallback) return null;
  return {
    candidate_id: String(fallback.candidate_id || "").trim() || null,
    display_candidate_id: String(fallback.display_candidate_id || fallback.candidate_id || "").trim() || null,
    canonical_migration_class: "PINE_THRESHOLD",
    target_deploy_unit: "SERVER_SETTINGS",
    stage_state: null,
    stage_reason: null,
    stage_signature: null,
  };
}

function latestWeeklyRow(weeklyHistory = null) {
  const rows = Array.isArray(weeklyHistory && weeklyHistory.weeks) ? weeklyHistory.weeks : [];
  return rows.length ? rows[rows.length - 1] : null;
}

function fileExists(pathValue) {
  const filePath = String(pathValue || "").trim();
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
}

function extractPineStrategyId(pathValue) {
  const filePath = String(pathValue || "").trim();
  if (!filePath || !fileExists(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const match = raw.match(/STRATEGY_ID\s*=\s*\"([^\"]+)\"/);
    return match ? String(match[1] || "").trim() || null : null;
  } catch (_err) {
    return null;
  }
}

function deriveEngineBundleId(strategyId = null) {
  const normalized = String(strategyId || "").trim();
  return normalized ? `strategy:${normalized}` : null;
}

function buildEngineBundle({
  strategyId = null,
  bundleId = null,
  loaded = false,
  ready = false,
  source = null,
} = {}) {
  const normalizedStrategyId = String(strategyId || "").trim() || null;
  const normalizedBundleId = String(bundleId || deriveEngineBundleId(normalizedStrategyId) || "").trim() || null;
  return {
    deploy_unit: "ENGINE_BUNDLE",
    bundle_id: normalizedBundleId,
    strategy_id: normalizedStrategyId,
    loaded: loaded === true,
    ready: ready === true,
    source: String(source || "").trim() || null,
  };
}

function buildPolicyBundle({
  bundleId = null,
  thresholdBundleSignature = null,
  sourceModeSignature = null,
  loaded = false,
  source = null,
  stagedCandidateId = null,
  stagedSignature = null,
  stageState = null,
  stageReason = null,
} = {}) {
  return {
    deploy_unit: "POLICY_BUNDLE",
    bundle_id: String(bundleId || "").trim() || null,
    threshold_bundle_signature: String(thresholdBundleSignature || "").trim() || null,
    source_mode_signature: String(sourceModeSignature || "").trim() || null,
    loaded: loaded === true,
    source: String(source || "").trim() || null,
    staged_candidate_id: String(stagedCandidateId || "").trim() || null,
    staged_signature: String(stagedSignature || "").trim() || null,
    stage_state: String(stageState || "").trim().toUpperCase() || null,
    stage_reason: String(stageReason || "").trim() || null,
  };
}

function buildShadowPine({
  preparedFilePath = null,
  latestGeneratedFilePath = null,
  rollbackSourceFilePath = null,
  preparedStrategyId = null,
} = {}) {
  return {
    layer: "PINE_SHADOW",
    prepared_file_path: String(preparedFilePath || "").trim() || null,
    latest_generated_file_path: String(latestGeneratedFilePath || "").trim() || null,
    rollback_source_file_path: String(rollbackSourceFilePath || "").trim() || null,
    prepared_strategy_id: String(preparedStrategyId || "").trim() || null,
  };
}

function deriveDeployUnits({
  prepared = {},
  manualPaste = {},
  bundleActivationSummary = {},
  canonicalPolicyRecommendation = null,
  rollbackFilePath = null,
} = {}) {
  const rollbackSourceFilePath = String(rollbackFilePath || prepared.rollback_source_file_path || "").trim() || null;
  const rollbackStrategyId = extractPineStrategyId(rollbackSourceFilePath);
  const preparedEngineBundle = buildEngineBundle({
    strategyId: prepared.prepared_strategy_id,
    loaded: manualPaste.acknowledged === true
      && !!prepared.prepared_strategy_id
      && manualPaste.applied_strategy_id === prepared.prepared_strategy_id,
    ready: prepared.prepared_stage_ready === true,
    source: prepared.override_active === true ? "PREPARED_OVERRIDE" : "PINE_STAGE",
  });
  const activeEngineBundle = buildEngineBundle({
    strategyId: manualPaste.applied_strategy_id,
    bundleId: bundleActivationSummary.engine_bundle_id,
    loaded: bundleActivationSummary.engine_bundle_loaded === true,
    ready: manualPaste.acknowledged === true || bundleActivationSummary.engine_bundle_loaded === true,
    source: bundleActivationSummary.engine_bundle_loaded === true
      ? "BUNDLE_ACTIVATION"
      : (manualPaste.acknowledged === true ? "MANUAL_ACK" : null),
  });
  const preparedPolicyBundle = buildPolicyBundle({
    bundleId: bundleActivationSummary.policy_bundle_id,
    thresholdBundleSignature: bundleActivationSummary.threshold_bundle_signature,
    sourceModeSignature: bundleActivationSummary.source_mode_signature,
    loaded: bundleActivationSummary.policy_bundle_loaded === true,
    source: canonicalPolicyRecommendation ? "CANONICAL_POLICY_STAGE" : "BUNDLE_ACTIVATION",
    stagedCandidateId: canonicalPolicyRecommendation && canonicalPolicyRecommendation.candidate_id,
    stagedSignature: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_signature,
    stageState: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_state,
    stageReason: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_reason,
  });
  const activePolicyBundle = buildPolicyBundle({
    bundleId: bundleActivationSummary.policy_bundle_id,
    thresholdBundleSignature: bundleActivationSummary.threshold_bundle_signature,
    sourceModeSignature: bundleActivationSummary.source_mode_signature,
    loaded: bundleActivationSummary.policy_bundle_loaded === true,
    source: "BUNDLE_ACTIVATION",
  });
  const rollbackEngineBundle = buildEngineBundle({
    strategyId: rollbackStrategyId,
    bundleId: rollbackStrategyId ? deriveEngineBundleId(rollbackStrategyId) : (rollbackSourceFilePath ? `file:${rollbackSourceFilePath}` : null),
    ready: !!rollbackSourceFilePath,
    loaded: false,
    source: rollbackSourceFilePath ? "ROLLBACK_SOURCE_FILE" : null,
  });
  const shadowPine = buildShadowPine({
    preparedFilePath: prepared.prepared_file_path,
    latestGeneratedFilePath: prepared.latest_generated_file_path,
    rollbackSourceFilePath,
    preparedStrategyId: prepared.prepared_strategy_id,
  });
  return {
    deploy_unit_primary: "ENGINE_POLICY_BUNDLE",
    deploy_units: ["ENGINE_BUNDLE", "POLICY_BUNDLE"],
    prepared_engine_bundle: preparedEngineBundle,
    active_engine_bundle: activeEngineBundle,
    rollback_engine_bundle: rollbackEngineBundle,
    prepared_policy_bundle: preparedPolicyBundle,
    active_policy_bundle: activePolicyBundle,
    shadow_pine: shadowPine,
  };
}

function findPreparedPaths({ stageAutopilot = null, weeklyHistory = null, targetCandidateId = null, rollbackFilePath = null, preparedOverride = null } = {}) {
  const stage = unwrapRawReport(stageAutopilot) || {};
  const stageRows = Array.isArray(stage.stage_rows) ? stage.stage_rows : [];
  const pineStage = stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "PINE") || {};
  const historyRows = Array.isArray(weeklyHistory && weeklyHistory.weeks) ? weeklyHistory.weeks.slice() : [];
  let matchedHistory = null;
  if (rollbackFilePath) {
    matchedHistory = [...historyRows].reverse().find((row) =>
      String(row && row.rollback_source_file_path || "").trim() === String(rollbackFilePath || "").trim()
    ) || null;
  } else if (targetCandidateId) {
    matchedHistory = [...historyRows].reverse().find((row) =>
      String(row && row.recommended_patch_id || "").trim() === String(targetCandidateId || "").trim()
    ) || null;
  }
  const latestHistory = matchedHistory || latestWeeklyRow(weeklyHistory) || {};
  const currentVisualPreparedFilePath = String(pineStage.current_source_file_path || "").trim() || null;
  const currentVisualStrategyId = String(pineStage.current_strategy_id || "").trim() || null;
  const preparedFilePath = String(currentVisualPreparedFilePath || pineStage.prepared_file_path || latestHistory.created_file_path || "").trim() || null;
  const latestGeneratedFilePath = String(pineStage.latest_generated_file_path || latestHistory.latest_generated_file_path || "").trim() || null;
  const resolved = {
    prepared_file_path: preparedFilePath,
    prepared_strategy_id: String(
      currentVisualStrategyId
      || pineStage.prepared_strategy_id
      || latestHistory.created_strategy_id
      || extractPineStrategyId(preparedFilePath || latestGeneratedFilePath)
      || ""
    ).trim() || null,
    latest_generated_file_path: latestGeneratedFilePath,
    rollback_source_file_path: String(pineStage.rollback_source_file_path || latestHistory.rollback_source_file_path || "").trim() || null,
    prepared_candidate_signature: String(pineStage.signature || pineStage.candidate_signature || "").trim() || null,
    prepared_display_candidate_id: String(pineStage.display_signature || latestHistory.display_recommended_patch_id || "").trim() || null,
    prepared_stage_ready: pineStage.machine_state === "READY",
    prepared_reason: String(pineStage.reason || "").trim() || null,
    source_week_key: String(latestHistory.week_key || "").trim() || null,
    source_recommended_patch_id: String(latestHistory.recommended_patch_id || "").trim() || null,
  };
  const override = normalizePreparedOverride(preparedOverride);
  const overrideSuppressedReason = override.active
    && (
      (currentVisualStrategyId && override.prepared_strategy_id && override.prepared_strategy_id !== currentVisualStrategyId)
      || (currentVisualPreparedFilePath && override.prepared_file_path && override.prepared_file_path !== currentVisualPreparedFilePath)
    )
    ? "CURRENT_VISUAL_PINE_MISMATCH"
    : null;
  if (!override.active || overrideSuppressedReason) {
    return {
      ...resolved,
      override_active: false,
      override_source: overrideSuppressedReason ? "SUPPRESSED_MANUAL" : null,
      override_suppressed_reason: overrideSuppressedReason,
    };
  }
  return {
    ...resolved,
    prepared_file_path: override.prepared_file_path || resolved.prepared_file_path,
    prepared_strategy_id: override.prepared_strategy_id || resolved.prepared_strategy_id,
    latest_generated_file_path: override.latest_generated_file_path || resolved.latest_generated_file_path,
    prepared_candidate_signature: override.target_candidate_id || resolved.prepared_candidate_signature,
    prepared_display_candidate_id: override.display_candidate_id || resolved.prepared_display_candidate_id,
    prepared_stage_ready: override.prepared_stage_ready === true,
    prepared_reason: override.prepared_reason || resolved.prepared_reason,
    override_active: true,
    override_source: override.override_source || null,
    override_suppressed_reason: null,
  };
}

function deriveMarketScope(rows = [], targetCandidateId = null, openWave = 1) {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) =>
    String(row && row.candidate_id || "").trim() === String(targetCandidateId || "").trim()
    && String(row && row.market || "").trim().toUpperCase() !== "ALL"
  );
  const openRows = scoped.filter((row) => (toNum(row && row.wave) || 99) <= openWave);
  return {
    rows: openRows.map((row) => ({
      market: String(row.market || "").trim().toUpperCase() || "UNKNOWN",
      wave: toNum(row.wave),
      canary_verdict: String(row.canary_verdict || "").trim().toUpperCase() || "BLOCK",
      current_stage: String(row.current_stage || "").trim().toUpperCase() || "SHADOW",
      blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
    })),
    total_n: openRows.length,
    ready_n: openRows.filter((row) => String(row.canary_verdict || "").trim().toUpperCase() === "READY").length,
    blocked_n: openRows.filter((row) => String(row.canary_verdict || "").trim().toUpperCase() !== "READY").length,
  };
}

function deriveManualPasteAck({ manualPasteAck = null, prepared = {}, targetCandidateId = null } = {}) {
  const ack = unwrapRawReport(manualPasteAck) || {};
  const acknowledged = ack.acknowledged === true;
  const ackPreparedFilePath = String(ack.prepared_file_path || ack.applied_file_path || "").trim() || null;
  const ackLatestGeneratedFilePath = String(ack.latest_generated_file_path || "").trim() || null;
  const ackCandidateSignature = String(ack.candidate_signature || ack.target_candidate_id || "").trim() || null;
  const ackTargetCandidateId = String(ack.target_candidate_id || "").trim() || null;
  const ackAppliedStrategyId = String(ack.applied_strategy_id || "").trim() || null;
  const fileMatched = Boolean(
    (ackPreparedFilePath && prepared.prepared_file_path && ackPreparedFilePath === prepared.prepared_file_path)
    || (ackLatestGeneratedFilePath && prepared.latest_generated_file_path && ackLatestGeneratedFilePath === prepared.latest_generated_file_path)
  );
  const candidateMatched = Boolean(
    (ackCandidateSignature && prepared.prepared_candidate_signature && ackCandidateSignature === prepared.prepared_candidate_signature)
    || (ackTargetCandidateId && targetCandidateId && ackTargetCandidateId === targetCandidateId)
  );
  const strategyMatched = Boolean(
    ackAppliedStrategyId
    && prepared.prepared_strategy_id
    && ackAppliedStrategyId === prepared.prepared_strategy_id
  );
  const strategyMismatch = Boolean(
    ackAppliedStrategyId
    && prepared.prepared_strategy_id
    && ackAppliedStrategyId !== prepared.prepared_strategy_id
  );
  const preparedFileStillExists = fileExists(ackPreparedFilePath || prepared.prepared_file_path);
  const matched = acknowledged
    && preparedFileStillExists
    && !strategyMismatch
    && (strategyMatched || fileMatched || candidateMatched);
  return {
    acknowledged: matched,
    acknowledged_at_kst: String(ack.acknowledged_at_kst || "").trim() || null,
    acknowledged_at_iso: String(ack.acknowledged_at_iso || "").trim() || null,
    prepared_file_path: ackPreparedFilePath,
    latest_generated_file_path: ackLatestGeneratedFilePath,
    candidate_signature: ackCandidateSignature,
    target_candidate_id: ackTargetCandidateId,
    applied_strategy_id: ackAppliedStrategyId,
    prepared_strategy_id: prepared.prepared_strategy_id || null,
    strategy_mismatch: strategyMismatch,
    live_signal_confirmed: ack.live_signal_confirmed === true,
    live_signal_confirmation_pending: ack.live_signal_confirmation_pending === true,
    confirmed_signal_id: String(ack.confirmed_signal_id || "").trim() || null,
    confirmed_signal_created_at: String(ack.confirmed_signal_created_at || "").trim() || null,
    confirmed_signal_event: String(ack.confirmed_signal_event || "").trim().toUpperCase() || null,
    confirmation_status: matched ? "APPLIED_PENDING_BUNDLE_ACTIVATION" : "N/A",
  };
}

function deriveLiveSignalConfirmation({ signalsCache = null, manualPaste = null } = {}) {
  const docs = Array.isArray(signalsCache && signalsCache.docs) ? signalsCache.docs : [];
  const appliedStrategyId = String(manualPaste && manualPaste.applied_strategy_id || "").trim() || null;
  if (manualPaste && manualPaste.acknowledged === true && manualPaste.live_signal_confirmed === true && appliedStrategyId) {
    return {
      confirmed: true,
      pending: false,
      signal_id: String(manualPaste.confirmed_signal_id || "").trim() || null,
      created_at: String(manualPaste.confirmed_signal_created_at || "").trim() || null,
      strategy_id: appliedStrategyId,
      event: String(manualPaste.confirmed_signal_event || "").trim().toUpperCase() || null,
    };
  }
  const ackMs = parseIsoMs(manualPaste && manualPaste.acknowledged_at_iso);
  if (!(manualPaste && manualPaste.acknowledged) || !appliedStrategyId || !docs.length) {
    return {
      confirmed: false,
      pending: Boolean(manualPaste && manualPaste.acknowledged),
      signal_id: null,
      created_at: null,
      strategy_id: appliedStrategyId,
      event: null,
    };
  }
  const match = docs.find((row) => {
    const event = String(
      row && (row.event || row.signal_event || (row.features_json && row.features_json.event) || "")
    ).trim().toUpperCase();
    if (!(event === "LONG" || event === "SHORT")) return false;
    const strategyId = String(
      row && (
        row.strategy_id
        || (row.features_json && row.features_json.strategy_id)
        || (row.features && row.features.strategy_id)
        || ""
      )
    ).trim();
    if (strategyId !== appliedStrategyId) return false;
    const createdMs = parseIsoMs(row && row.created_at);
    if (ackMs != null && createdMs != null && createdMs < ackMs) return false;
    return true;
  }) || null;
  return {
    confirmed: !!match,
    pending: !!manualPaste.acknowledged && !match,
    signal_id: match ? String(match.signal_id || match.id || match.doc_id || "").trim() || null : null,
    created_at: match ? String(match.created_at || "").trim() || null : null,
    strategy_id: appliedStrategyId,
    event: match ? String(match.event || match.signal_event || (match.features_json && match.features_json.event) || "").trim().toUpperCase() || null : null,
  };
}

function deriveBundleActivationSummary(bundleActivation = null) {
  const raw = unwrapRawReport(bundleActivation) || {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!bundleActivation,
    engine_bundle_loaded: summary.engine_bundle_loaded === true,
    policy_bundle_loaded: summary.policy_bundle_loaded === true,
    market_data_flow_ok: summary.market_data_flow_ok === true,
    first_decision_seen: summary.first_decision_seen === true,
    first_decision_kind: String(summary.first_decision_kind || "").trim().toUpperCase() || null,
    first_decision_id: String(summary.first_decision_id || "").trim() || null,
    first_decision_created_at: String(summary.first_decision_created_at || "").trim() || null,
    first_decision_event: String(summary.first_decision_event || "").trim().toUpperCase() || null,
    confirmation_timeout_minutes: toNum(summary.confirmation_timeout_minutes),
    confirmation_deadline_iso: String(summary.confirmation_deadline_iso || "").trim() || null,
    confirmation_deadline_kst: String(summary.confirmation_deadline_kst || "").trim() || null,
    timeout_elapsed: summary.timeout_elapsed === true,
    activation_confirmed: summary.activation_confirmed === true,
    activation_pending: summary.activation_pending === true,
    activation_status: String(summary.activation_status || "").trim().toUpperCase() || null,
    activation_reason: String(summary.activation_reason || "").trim().toUpperCase() || null,
    probe_pass: summary.probe_pass === true,
    probe_status: String(summary.probe_status || "").trim().toUpperCase() || null,
    probe_reason: String(summary.probe_reason || "").trim().toUpperCase() || null,
    confirmation_timed_out: summary.confirmation_timed_out === true,
    engine_bundle_id: String(summary.engine_bundle_id || "").trim() || null,
    policy_bundle_id: String(summary.policy_bundle_id || "").trim() || null,
    threshold_bundle_signature: String(summary.threshold_bundle_signature || "").trim() || null,
    source_mode_signature: String(summary.source_mode_signature || "").trim() || null,
  };
}

function deriveDeploymentPlan({
  objectiveSupervisor = null,
  changeControl = null,
  codexPatchReview = null,
  deploymentGuards = null,
  candidateChangeSet = null,
  canaryReport = null,
  stageAutopilot = null,
  weeklyHistory = null,
  manualPasteAck = null,
  signalsCache = null,
  bundleActivation = null,
  preparedOverride = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const change = unwrapRawReport(changeControl) || {};
  const codex = unwrapRawReport(codexPatchReview) || {};
  const guards = unwrapRawReport(deploymentGuards) || {};
  const guardSummary = guards.summary && typeof guards.summary === "object" ? guards.summary : {};
  const canary = unwrapRawReport(canaryReport) || {};
  const canarySummary = canary.summary && typeof canary.summary === "object" ? canary.summary : {};
  const canaryRows = Array.isArray(canary.rows) ? canary.rows : [];

  const promotion = supervisor.promotion && typeof supervisor.promotion === "object"
    ? supervisor.promotion
    : (change.auto_promotion && typeof change.auto_promotion === "object" ? change.auto_promotion : {});
  const rollback = supervisor.rollback && typeof supervisor.rollback === "object"
    ? supervisor.rollback
    : (change.auto_rollback && typeof change.auto_rollback === "object" ? change.auto_rollback : {});
  const targetCandidateId = String(guardSummary.target_candidate_id || promotion.candidate_id || "").trim() || null;
  const displayCandidateId = String(promotion.display_candidate_id || targetCandidateId || "").trim() || null;
  const rollbackFilePath = String(rollback.rollback_file_path || "").trim() || null;
  const codexVerdict = String(codex.verdict || "HOLD").trim().toUpperCase();
  const codexCandidateId = String(codex.recommended_candidate_id || "").trim() || null;
  const codexRollbackPath = String(codex.recommended_rollback_file_path || "").trim() || null;
  const recoveryPromotion = promotion.ready === true && promotion.recovery_mode === true;
  const openWave = toNum(guardSummary.canary_open_wave) || toNum(canarySummary.open_wave) || 1;
  const canonicalPolicyRecommendation = deriveCanonicalPolicyRecommendation({
    candidateChangeSet,
    stageAutopilot,
  });
  const prepared = findPreparedPaths({
    stageAutopilot,
    weeklyHistory,
    targetCandidateId,
    rollbackFilePath,
    preparedOverride,
  });
  const manualPaste = deriveManualPasteAck({
    manualPasteAck,
    prepared,
    targetCandidateId,
  });
  const liveSignalConfirmation = deriveLiveSignalConfirmation({
    signalsCache,
    manualPaste,
  });
  const bundleActivationSummaryBase = deriveBundleActivationSummary(bundleActivation);
  const bundleActivationSummary = bundleActivationSummaryBase.available
    ? bundleActivationSummaryBase
    : {
      ...bundleActivationSummaryBase,
      engine_bundle_loaded: manualPaste.acknowledged === true,
      policy_bundle_loaded: false,
      market_data_flow_ok: liveSignalConfirmation.confirmed === true,
      first_decision_seen: liveSignalConfirmation.confirmed === true,
      first_decision_kind: liveSignalConfirmation.confirmed === true ? "SIGNAL" : null,
      first_decision_id: liveSignalConfirmation.signal_id || null,
      first_decision_created_at: liveSignalConfirmation.created_at || null,
      first_decision_event: liveSignalConfirmation.event || null,
      activation_confirmed: liveSignalConfirmation.confirmed === true,
      activation_pending: manualPaste.acknowledged === true && liveSignalConfirmation.confirmed !== true,
      activation_status: liveSignalConfirmation.confirmed === true
        ? "ACTIVE_BY_FIRST_DECISION"
        : (manualPaste.acknowledged === true ? "PENDING" : null),
      activation_reason: liveSignalConfirmation.confirmed === true
        ? "FIRST_DECISION_SEEN"
        : (manualPaste.acknowledged === true ? "BUNDLE_ACTIVATION_REPORT_PENDING" : null),
    };
  const marketScope = deriveMarketScope(canaryRows, targetCandidateId, openWave);
  const preparedOriginCandidateId = String(prepared.prepared_candidate_signature || "").trim() || null;
  const appliedOriginCandidateId = String(
    manualPaste.target_candidate_id
    || manualPaste.candidate_signature
    || preparedOriginCandidateId
    || ""
  ).trim() || null;
  const appliedOriginDisplayCandidateId = String(
    (appliedOriginCandidateId && preparedOriginCandidateId && appliedOriginCandidateId === preparedOriginCandidateId
      ? prepared.prepared_display_candidate_id
      : null)
    || appliedOriginCandidateId
    || ""
  ).trim() || null;

  const promotionAuthorityPass = (
    codexVerdict === "PROMOTE"
    && (!codexCandidateId || codexCandidateId === targetCandidateId)
  ) || recoveryPromotion;
  const promotionPreparePass = promotion.ready === true
    && guardSummary.deploy_pass === true
    && promotionAuthorityPass;
  const rollbackPreparePass = rollback.ready === true
    && !!rollbackFilePath
    && codexVerdict === "ROLLBACK"
    && (!codexRollbackPath || codexRollbackPath === rollbackFilePath);
  const prioritizeRecoveryPromotion = Boolean(
    promotion.ready === true
    && recoveryPromotion
    && codexVerdict === "PROMOTE"
    && promotionPreparePass
  );
  const dryPrepareEligible = promotionPreparePass
    && prepared.prepared_stage_ready !== true
    && String(prepared.prepared_reason || "").trim().toUpperCase() === "DAILY_NO_TRADE_ACTIVITY";
  const overrideReadyForManualPaste = prepared.override_active === true
    && prepared.prepared_stage_ready === true
    && !!prepared.prepared_file_path
    && !!prepared.prepared_strategy_id
    && manualPaste.acknowledged !== true;
  const readyForManualPaste = (
    promotionPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.prepared_file_path || !!prepared.latest_generated_file_path)
  ) || overrideReadyForManualPaste;
  const readyForManualRollback = rollbackPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.rollback_source_file_path || !!rollbackFilePath);
  const changeControlRelevant = promotion.ready === true || rollback.ready === true;
  const appliedAuthorityApproved = Boolean(
    codexVerdict === "PROMOTE"
    && (
      !appliedOriginCandidateId
      || !codexCandidateId
      || codexCandidateId === appliedOriginCandidateId
    )
  );
  const rollbackAuthorityApproved = Boolean(rollbackPreparePass);
  const authorityApproved = appliedAuthorityApproved || rollbackAuthorityApproved;
  const preparedStrategyApplied = Boolean(
    prepared.prepared_stage_ready === true
    && (
      (prepared.prepared_strategy_id
        && manualPaste.applied_strategy_id
        && manualPaste.applied_strategy_id === prepared.prepared_strategy_id)
      || manualPaste.acknowledged === true
    )
  );
  const authorityRequired = Boolean(
    prepared.override_active === true || preparedStrategyApplied || promotion.ready === true || rollback.ready === true
  );
  const authorityBypassActive = Boolean(
    (prepared.override_active === true || preparedStrategyApplied)
    && (manualPaste.acknowledged === true || liveSignalConfirmation.confirmed === true)
    && !authorityApproved
  );
  const externalAuthorityPending = Boolean(
    authorityRequired
    && !authorityApproved
    && (manualPaste.acknowledged === true || bundleActivationSummary.activation_confirmed === true || preparedStrategyApplied)
  );
  const authorityState = !authorityRequired
    ? "NOT_REQUIRED"
    : (authorityApproved ? "APPROVED" : (externalAuthorityPending ? "PENDING" : "REQUIRED"));
  const runtimeActivationSatisfied = Boolean(
    bundleActivationSummary.activation_confirmed === true
    || (
      bundleActivationSummary.activation_pending !== true
      && bundleActivationSummary.engine_bundle_loaded === true
      && bundleActivationSummary.policy_bundle_loaded === true
      && bundleActivationSummary.market_data_flow_ok === true
      && bundleActivationSummary.probe_pass === true
      && bundleActivationSummary.first_decision_seen === true
    )
  );
  const deployUnits = deriveDeployUnits({
    prepared,
    manualPaste,
    bundleActivationSummary,
    canonicalPolicyRecommendation,
    rollbackFilePath,
  });

  let planStatus = "HOLD";
  if (prioritizeRecoveryPromotion && readyForManualPaste) planStatus = "READY_FOR_MANUAL_PASTE";
  else if (prioritizeRecoveryPromotion && promotionPreparePass) planStatus = dryPrepareEligible ? "PREPARE_PROMOTION_DRY" : "PREPARE_PROMOTION";
  else if (readyForManualRollback) planStatus = "READY_FOR_MANUAL_ROLLBACK";
  else if (rollbackPreparePass) planStatus = "PREPARE_ROLLBACK";
  else if (bundleActivationSummary.activation_status === "TIMEOUT") {
    planStatus = externalAuthorityPending
      ? "APPLIED_BUNDLE_ACTIVATION_TIMEOUT_PENDING_AUTHORITY"
      : "APPLIED_BUNDLE_ACTIVATION_TIMEOUT";
  }
  else if (runtimeActivationSatisfied) planStatus = externalAuthorityPending ? "APPLIED_ACTIVE_PENDING_AUTHORITY" : "APPLIED_ACTIVE";
  else if (manualPaste.acknowledged) planStatus = externalAuthorityPending ? "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY" : "APPLIED_PENDING_BUNDLE_ACTIVATION";
  else if (readyForManualPaste) planStatus = "READY_FOR_MANUAL_PASTE";
  else if (promotionPreparePass) planStatus = dryPrepareEligible ? "PREPARE_PROMOTION_DRY" : "PREPARE_PROMOTION";

  const blockers = [];
  if (planStatus === "HOLD" && Array.isArray(guardSummary.blockers)) blockers.push(...guardSummary.blockers);
  if (changeControlRelevant && codexVerdict === "HOLD" && !recoveryPromotion) blockers.push("CODEX_ACTION_NOT_APPROVED");
  if (externalAuthorityPending || authorityBypassActive) blockers.push("EXTERNAL_AUTHORITY_PENDING");
  if (bundleActivationSummary.activation_status === "TIMEOUT") blockers.push("DEPLOYMENT_CONFIRM_TIMEOUT");
  if (promotionPreparePass && !readyForManualPaste && !dryPrepareEligible) blockers.push("PINE_PREPARE_PENDING");
  if (dryPrepareEligible) blockers.push("DRY_PREPARE_ONLY");
  if (rollbackPreparePass && !readyForManualRollback) blockers.push("ROLLBACK_PREPARE_PENDING");

  const checklist = rollbackPreparePass
    ? [
      `rollback target ${rollbackFilePath || "N/A"} 를 latest alias로 연결`,
      "TradingView Pine 편집기에 rollback source를 붙여넣기",
      "현재 활성 심볼/시간대가 rollback target과 일치하는지 확인",
      "붙여넣기 후 alert 재설정 여부 확인",
    ]
    : (bundleActivationSummary.activation_confirmed
      ? [
        `bundle activation ${bundleActivationSummary.activation_status || "ACTIVE"} / ${bundleActivationSummary.activation_reason || "N/A"}`,
        `engine ${bundleActivationSummary.engine_bundle_id || "N/A"} / policy ${bundleActivationSummary.policy_bundle_id || "N/A"}`,
        `first decision ${bundleActivationSummary.first_decision_kind || "N/A"} / ${bundleActivationSummary.first_decision_id || "N/A"}`,
      ]
      : (bundleActivationSummary.activation_status === "TIMEOUT"
        ? [
          `bundle activation ${bundleActivationSummary.activation_status || "TIMEOUT"} / ${bundleActivationSummary.activation_reason || "N/A"}`,
          `engine ${bundleActivationSummary.engine_bundle_id || "N/A"} / policy ${bundleActivationSummary.policy_bundle_id || "N/A"}`,
          `deadline ${bundleActivationSummary.confirmation_deadline_kst || "N/A"} / probe ${bundleActivationSummary.probe_status || "N/A"}`,
        ]
      : (manualPaste.acknowledged
      ? [
        `applied candidate ${displayCandidateId || targetCandidateId || "N/A"} 의 bundle activation proof를 확인`,
        `engine bundle ${manualPaste.applied_strategy_id || "N/A"} / deadline ${bundleActivationSummary.confirmation_deadline_kst || "N/A"}`,
        "post-apply signal probe와 signals/drops cache가 market_data_flow_ok를 충족하는지 점검",
      ]
      : [
      `candidate ${displayCandidateId || targetCandidateId || "N/A"} generated file을 latest alias와 비교`,
      `wave ${openWave} 범위 시장(${marketScope.rows.map((row) => row.market).join(", ") || "N/A"})만 적용`,
      "TradingView Pine 편집기에 prepared/generated file을 붙여넣기",
      "붙여넣기 후 webhook alert가 기존 LONG/SHORT 메인 이벤트만 가리키는지 확인",
    ])));

  const nextActions = [];
  if (dryPrepareEligible) {
    nextActions.push("거래가 없는 날에도 prepared/generated Pine 파일 경로를 유지하고 다음 거래 세션 전에 수동 반영 준비");
  }
  if (String(prepared.prepared_reason || "").trim().toUpperCase() === "DAILY_NO_TRADE_ACTIVITY") {
    nextActions.push("DAILY_NO_TRADE_ACTIVITY 해소 전까지 dry-prepare 상태로 유지하고 거래 재개 시 prepared artifact 재검증");
  }
  if (changeControlRelevant && codexVerdict === "HOLD" && !recoveryPromotion) {
    nextActions.push("Codex 승인 또는 rollback 결론이 나올 때까지 change-control 상태를 재평가");
  }
  if (marketScope.blocked_n > 0) {
    nextActions.push("blocked market canary를 먼저 해소해 open wave 전체를 READY 상태로 맞춤");
  }
  if (prepared.override_active === true) {
    nextActions.push("manual prepared override가 활성화되어 있으므로 TradingView 반영 후 첫 LONG/SHORT 실신호로 신규 strategy_id를 확인");
  }
  if (promotionPreparePass && !readyForManualPaste && !dryPrepareEligible) {
    nextActions.push("PINE stage가 prepared file을 생성할 때까지 stage_autopilot 결과를 재확인");
  }
  if (rollbackPreparePass && !readyForManualRollback) {
    nextActions.push("rollback source file 경로를 준비한 뒤 manual rollback handoff를 생성");
  }
  if (manualPaste.acknowledged) {
    nextActions.push("bundle activation proof가 ACTIVE가 될 때까지 APPLIED_PENDING_BUNDLE_ACTIVATION 상태를 유지");
  }
  if (bundleActivationSummary.activation_status === "TIMEOUT") {
    nextActions.push("deployment probe 또는 first decision 근거 없이 confirmation deadline을 초과했으므로 timeout 상태로 유지");
    nextActions.push("engine/policy bundle load와 market_data_flow/probe_pass를 재검증한 뒤 필요하면 rollback 또는 재배포");
  }
  if (authorityBypassActive) {
    nextActions.push("bundle은 활성화됐지만 외부 권위는 아직 미승인 상태이므로 authority_state=PENDING 으로 추적");
  }
  if (bundleActivationSummary.activation_confirmed) {
    nextActions.length = 0;
    if (authorityBypassActive) {
      nextActions.push("engine/policy bundle은 ACTIVE지만 external authority는 PENDING 상태이므로 applied origin과 recommended target을 분리 추적");
    }
  }

  return {
    summary: {
      plan_status: planStatus,
      target_candidate_id: targetCandidateId,
      recommended_target_candidate_id: String(
        canonicalPolicyRecommendation && canonicalPolicyRecommendation.candidate_id
        || targetCandidateId
        || ""
      ).trim() || null,
      display_candidate_id: String(
        canonicalPolicyRecommendation && canonicalPolicyRecommendation.display_candidate_id
        || displayCandidateId
        || ""
      ).trim() || null,
      deploy_guard_target_candidate_id: targetCandidateId,
      recommended_target_migration_class: canonicalPolicyRecommendation && canonicalPolicyRecommendation.canonical_migration_class || null,
      recommended_target_deploy_unit: canonicalPolicyRecommendation && canonicalPolicyRecommendation.target_deploy_unit || null,
      recommended_target_stage_state: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_state || null,
      recommended_target_stage_reason: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_reason || null,
      recommended_target_stage_signature: canonicalPolicyRecommendation && canonicalPolicyRecommendation.stage_signature || null,
      applied_origin_candidate_id: appliedOriginCandidateId,
      applied_origin_display_candidate_id: appliedOriginDisplayCandidateId,
      prepared_origin_candidate_id: preparedOriginCandidateId,
      prepared_origin_display_candidate_id: prepared.prepared_display_candidate_id || null,
      rollback_file_path: rollbackFilePath,
      prepare_pass: promotionPreparePass || rollbackPreparePass || overrideReadyForManualPaste,
      dry_prepare_available: dryPrepareEligible,
      ready_for_manual_paste: (!manualPaste.acknowledged) && (readyForManualPaste || readyForManualRollback),
      manual_step_required: (!manualPaste.acknowledged) && (planStatus === "READY_FOR_MANUAL_PASTE" || planStatus === "READY_FOR_MANUAL_ROLLBACK"),
      manual_paste_acknowledged: manualPaste.acknowledged,
      live_signal_confirmation_pending: manualPaste.acknowledged === true
        && bundleActivationSummary.activation_confirmed !== true
        && bundleActivationSummary.first_decision_seen !== true,
      live_signal_confirmed: bundleActivationSummary.first_decision_seen === true,
      engine_bundle_loaded: bundleActivationSummary.engine_bundle_loaded,
      policy_bundle_loaded: bundleActivationSummary.policy_bundle_loaded,
      market_data_flow_ok: bundleActivationSummary.market_data_flow_ok,
      probe_pass: bundleActivationSummary.probe_pass === true,
      probe_status: bundleActivationSummary.probe_status || null,
      probe_reason: bundleActivationSummary.probe_reason || null,
      first_decision_seen: bundleActivationSummary.first_decision_seen,
      first_decision_kind: bundleActivationSummary.first_decision_kind,
      activation_confirmed: bundleActivationSummary.activation_confirmed,
      activation_pending: bundleActivationSummary.activation_pending,
      activation_status: bundleActivationSummary.activation_status,
      activation_reason: bundleActivationSummary.activation_reason,
      confirmation_timed_out: bundleActivationSummary.confirmation_timed_out === true,
      confirmation_timeout_minutes: bundleActivationSummary.confirmation_timeout_minutes,
      confirmation_deadline_iso: bundleActivationSummary.confirmation_deadline_iso,
      confirmation_deadline_kst: bundleActivationSummary.confirmation_deadline_kst,
      engine_bundle_id: bundleActivationSummary.engine_bundle_id,
      policy_bundle_id: bundleActivationSummary.policy_bundle_id,
      threshold_bundle_signature: bundleActivationSummary.threshold_bundle_signature,
      source_mode_signature: bundleActivationSummary.source_mode_signature,
      deploy_unit_primary: deployUnits.deploy_unit_primary,
      deploy_units: deployUnits.deploy_units,
      prepared_engine_bundle_id: deployUnits.prepared_engine_bundle.bundle_id,
      active_engine_bundle_id: deployUnits.active_engine_bundle.bundle_id,
      rollback_engine_bundle_id: deployUnits.rollback_engine_bundle.bundle_id,
      prepared_policy_bundle_id: deployUnits.prepared_policy_bundle.bundle_id,
      active_policy_bundle_id: deployUnits.active_policy_bundle.bundle_id,
      prepared_engine_bundle: deployUnits.prepared_engine_bundle,
      active_engine_bundle: deployUnits.active_engine_bundle,
      rollback_engine_bundle: deployUnits.rollback_engine_bundle,
      prepared_policy_bundle: deployUnits.prepared_policy_bundle,
      active_policy_bundle: deployUnits.active_policy_bundle,
      shadow_pine: deployUnits.shadow_pine,
      open_wave: openWave,
      target_wave: openWave,
      market_scope_n: marketScope.total_n,
      market_scope_ready_n: marketScope.ready_n,
      market_scope_blocked_n: marketScope.blocked_n,
      prepared_file_path: prepared.prepared_file_path,
      prepared_strategy_id: prepared.prepared_strategy_id,
      latest_generated_file_path: prepared.latest_generated_file_path,
      rollback_source_file_path: prepared.rollback_source_file_path,
      prepared_stage_ready: prepared.prepared_stage_ready,
      prepared_override_active: prepared.override_active === true,
      prepared_override_source: prepared.override_source || null,
      prepared_override_suppressed_reason: prepared.override_suppressed_reason || null,
      source_week_key: prepared.source_week_key,
      applied_strategy_id: manualPaste.applied_strategy_id,
      manual_paste_acknowledged_at_kst: manualPaste.acknowledged_at_kst,
      manual_paste_acknowledged_at_iso: manualPaste.acknowledged_at_iso,
      confirmed_signal_id: bundleActivationSummary.first_decision_id || liveSignalConfirmation.signal_id,
      confirmed_signal_created_at: bundleActivationSummary.first_decision_created_at || liveSignalConfirmation.created_at,
      codex_verdict: codexVerdict,
      authority_required: authorityRequired,
      authority_approved: authorityApproved,
      authority_state: authorityState,
      external_authority_pending: externalAuthorityPending,
      authority_bypass_active: false,
      blockers: Array.from(new Set(blockers.filter(Boolean))),
      next_actions: Array.from(new Set(nextActions.filter(Boolean))),
    },
    rows: marketScope.rows,
    handoff: {
      checklist,
      authority_state: authorityState,
      external_authority_pending: externalAuthorityPending,
      authority_bypass_active: false,
      deploy_unit_primary: deployUnits.deploy_unit_primary,
      deploy_units: deployUnits.deploy_units,
      prepared_engine_bundle: deployUnits.prepared_engine_bundle,
      prepared_policy_bundle: deployUnits.prepared_policy_bundle,
      rollback_engine_bundle: deployUnits.rollback_engine_bundle,
      shadow_pine: deployUnits.shadow_pine,
      prepared_file_path: prepared.prepared_file_path,
      prepared_strategy_id: prepared.prepared_strategy_id,
      latest_generated_file_path: prepared.latest_generated_file_path,
      rollback_source_file_path: prepared.rollback_source_file_path,
      candidate_signature: prepared.prepared_candidate_signature || targetCandidateId,
      applied_origin_candidate_id: appliedOriginCandidateId,
      prepared_reason: prepared.prepared_reason,
      prepared_override_suppressed_reason: prepared.override_suppressed_reason || null,
      dry_prepare: dryPrepareEligible,
      next_actions: Array.from(new Set(nextActions.filter(Boolean))),
    },
  };
}

module.exports = {
  deriveDeploymentPlan,
  unwrapRawReport,
};
