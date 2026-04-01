"use strict";

const {
  normalizePlanStatus,
  isAppliedConfirmedLike,
  isAppliedPendingSignalConfirmationLike,
  isAppliedPendingBundleActivationLike,
} = require("./selfEvolutionPlanStatus");

const DERIVED_LOOP_KEYS = new Set([
  "DROP_VALIDATION",
  "PROVISIONAL_REALIZED_OUTCOME",
  "OVERRIDE_AUTHORITY",
  "EXECUTION_QUALITY",
  "REVERSE_POLICY",
  "MARKET_OBJECTIVE_SCORE",
  "SERVER_VS_PINE_DELTA",
  "OPENCLAW_AUTONOMY_CONTRACT",
  "OBJECTIVE_RECOVERY_GOVERNOR",
  "OBJECTIVE_RECOVERY_EFFECT",
]);

const CYCLE_ID_OPTIONAL_LOOPS = new Set([
  "SERVER_SIGNAL_AUTHORITY",
  "SERVER_SIGNAL_QUALITY",
  "SERVER_SIGNAL_RUNTIME",
  "SERVER_SIGNAL_CUTOVER",
]);

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readCycleId(report = null) {
  const raw = unwrapRawReport(report) || {};
  const cycleId = String(raw.cycle_id || raw.generation_id || "").trim();
  return cycleId || null;
}

function deriveLoopMonitor({ artifacts = {}, reports = {} } = {}) {
  const objectiveSupervisor = unwrapRawReport(reports.objectiveSupervisor) || {};
  const stageAutopilot = unwrapRawReport(reports.stageAutopilot) || {};
  const candidates = unwrapRawReport(reports.candidates) || {};
  const replay = unwrapRawReport(reports.replay) || {};
  const canary = unwrapRawReport(reports.canary) || {};
  const canonicalParity = unwrapRawReport(reports.canonicalParity) || {};
  const serverSignalAuthority = unwrapRawReport(reports.serverSignalAuthority) || {};
  const serverSignalQuality = unwrapRawReport(reports.serverSignalQuality) || {};
  const serverSignalRuntime = unwrapRawReport(reports.serverSignalRuntime) || {};
  const serverSignalCutoverReadiness = unwrapRawReport(reports.serverSignalCutoverReadiness) || {};
  const dropValidation = unwrapRawReport(reports.dropValidation) || {};
  const provisionalRealizedOutcome = unwrapRawReport(reports.provisionalRealizedOutcome) || {};
  const overrideAuthority = unwrapRawReport(reports.overrideAuthority) || {};
  const executionQuality = unwrapRawReport(reports.executionQuality) || {};
  const reversePolicy = unwrapRawReport(reports.reversePolicy) || {};
  const marketObjectiveScore = unwrapRawReport(reports.marketObjectiveScore) || {};
  const serverVsPinePerformanceDelta = unwrapRawReport(reports.serverVsPinePerformanceDelta) || {};
  const canonicalProvenance = unwrapRawReport(reports.canonicalProvenance) || {};
  const serverPrimaryCanary = unwrapRawReport(reports.serverPrimaryCanary) || {};
  const serverPrimaryAcceptanceWatch = unwrapRawReport(reports.serverPrimaryAcceptanceWatch) || {};
  const pineShadowDrift = unwrapRawReport(reports.pineShadowDrift) || {};
  const deploymentProbe = unwrapRawReport(reports.deploymentProbe) || {};
  const bundleActivation = unwrapRawReport(reports.bundleActivation) || {};
  const openclawAutonomyContract = unwrapRawReport(reports.openclawAutonomyContract) || {};
  const objectiveRecoveryGovernor = unwrapRawReport(reports.objectiveRecoveryGovernor) || {};
  const objectiveRecoveryEffect = unwrapRawReport(reports.objectiveRecoveryEffect) || {};
  const deployment = unwrapRawReport(reports.deployment) || {};
  const deploymentPlan = unwrapRawReport(reports.deploymentPlan) || {};
  const weightTuning = unwrapRawReport(reports.weightTuning) || {};
  const memory = unwrapRawReport(reports.memory) || {};
  const codexPatch = unwrapRawReport(reports.codexPatch) || {};

  const objectiveReason = String(objectiveSupervisor.reason || "").trim() || null;
  const evaluationScope = String(objectiveSupervisor.evaluation_scope || "").trim().toUpperCase() || "STANDALONE";
  const stageAutopilotOptional = evaluationScope !== "STANDALONE";
  const deploymentSummary = deployment.summary && typeof deployment.summary === "object" ? deployment.summary : {};
  const deploymentBlockers = Array.isArray(deploymentSummary.blockers) ? deploymentSummary.blockers.filter(Boolean) : [];
  const deploymentPlanSummary = deploymentPlan.summary && typeof deploymentPlan.summary === "object" ? deploymentPlan.summary : {};
  const deploymentPlanStatus = String(deploymentPlanSummary.plan_status || "N/A").trim().toUpperCase() || "N/A";
  const canarySummary = canary.summary && typeof canary.summary === "object" ? canary.summary : {};
  const canonicalParitySummary = canonicalParity.summary && typeof canonicalParity.summary === "object" ? canonicalParity.summary : {};
  const serverSignalAuthoritySummary = serverSignalAuthority.summary && typeof serverSignalAuthority.summary === "object" ? serverSignalAuthority.summary : {};
  const serverSignalQualitySummary = serverSignalQuality.summary && typeof serverSignalQuality.summary === "object" ? serverSignalQuality.summary : {};
  const serverSignalRuntimeSummary = serverSignalRuntime.summary && typeof serverSignalRuntime.summary === "object" ? serverSignalRuntime.summary : {};
  const serverSignalCutoverSummary = serverSignalCutoverReadiness.summary && typeof serverSignalCutoverReadiness.summary === "object" ? serverSignalCutoverReadiness.summary : {};
  const dropValidationSummary = dropValidation.summary && typeof dropValidation.summary === "object" ? dropValidation.summary : {};
  const provisionalRealizedOutcomeSummary = provisionalRealizedOutcome.summary && typeof provisionalRealizedOutcome.summary === "object"
    ? provisionalRealizedOutcome.summary
    : {};
  const overrideAuthoritySummary = overrideAuthority.summary && typeof overrideAuthority.summary === "object"
    ? overrideAuthority.summary
    : {};
  const executionQualitySummary = executionQuality.summary && typeof executionQuality.summary === "object"
    ? executionQuality.summary
    : {};
  const reversePolicySummary = reversePolicy.summary && typeof reversePolicy.summary === "object"
    ? reversePolicy.summary
    : {};
  const marketObjectiveScoreSummary = marketObjectiveScore.summary && typeof marketObjectiveScore.summary === "object" ? marketObjectiveScore.summary : {};
  const serverVsPinePerformanceDeltaSummary = serverVsPinePerformanceDelta.summary && typeof serverVsPinePerformanceDelta.summary === "object"
    ? serverVsPinePerformanceDelta.summary
    : {};
  const canonicalProvenanceSummary = canonicalProvenance.summary && typeof canonicalProvenance.summary === "object" ? canonicalProvenance.summary : {};
  const canonicalProvenanceEligible = canonicalProvenanceSummary.post_cutover_engine_eligible_n != null
    ? canonicalProvenanceSummary.post_cutover_engine_eligible_n
    : (canonicalProvenanceSummary.eligible_n || 0);
  const canonicalProvenanceComplete = canonicalProvenanceSummary.post_cutover_complete_n != null
    ? canonicalProvenanceSummary.post_cutover_complete_n
    : (canonicalProvenanceSummary.complete_n || 0);
  const canonicalProvenanceSourceDecision = canonicalProvenanceSummary.post_cutover_with_actual_source_decision_n != null
    ? canonicalProvenanceSummary.post_cutover_with_actual_source_decision_n
    : (canonicalProvenanceSummary.with_actual_source_decision_n ?? canonicalProvenanceSummary.actual_source_decision_n ?? 0);
  const canonicalProvenanceBundle = canonicalProvenanceSummary.post_cutover_with_bundle_version_n != null
    ? canonicalProvenanceSummary.post_cutover_with_bundle_version_n
    : (canonicalProvenanceSummary.with_bundle_version_n ?? canonicalProvenanceSummary.bundle_version_n ?? 0);
  const canonicalProvenanceStatus = String(canonicalProvenanceSummary.post_cutover_status || "").trim().toUpperCase();
  const serverPrimaryCanarySummary = serverPrimaryCanary.summary && typeof serverPrimaryCanary.summary === "object" ? serverPrimaryCanary.summary : {};
  const serverPrimaryAcceptanceSummary = serverPrimaryAcceptanceWatch.summary && typeof serverPrimaryAcceptanceWatch.summary === "object" ? serverPrimaryAcceptanceWatch.summary : {};
  const pineShadowDriftSummary = pineShadowDrift.summary && typeof pineShadowDrift.summary === "object" ? pineShadowDrift.summary : {};
  const deploymentProbeSummary = deploymentProbe.summary && typeof deploymentProbe.summary === "object" ? deploymentProbe.summary : {};
  const bundleActivationSummary = bundleActivation.summary && typeof bundleActivation.summary === "object" ? bundleActivation.summary : {};
  const autonomyContractSummary = openclawAutonomyContract.summary && typeof openclawAutonomyContract.summary === "object" ? openclawAutonomyContract.summary : {};
  const objectiveRecoveryGovernorSummary = objectiveRecoveryGovernor.summary && typeof objectiveRecoveryGovernor.summary === "object" ? objectiveRecoveryGovernor.summary : {};
  const objectiveRecoveryEffectSummary = objectiveRecoveryEffect.summary && typeof objectiveRecoveryEffect.summary === "object" ? objectiveRecoveryEffect.summary : {};
  const candidateSummary = candidates.summary && typeof candidates.summary === "object" ? candidates.summary : {};
  const replaySummary = replay.summary && typeof replay.summary === "object" ? replay.summary : {};
  const memorySummary = memory.summary && typeof memory.summary === "object" ? memory.summary : {};
  const weightSummary = weightTuning.summary && typeof weightTuning.summary === "object" ? weightTuning.summary : {};
  const expectedCycleId = readCycleId(objectiveSupervisor)
    || readCycleId(candidates)
    || readCycleId(replay)
    || readCycleId(canary)
    || readCycleId(canonicalParity)
    || readCycleId(serverSignalAuthority)
    || readCycleId(serverSignalQuality)
    || readCycleId(serverSignalRuntime)
    || readCycleId(serverSignalCutoverReadiness)
    || readCycleId(dropValidation)
    || readCycleId(provisionalRealizedOutcome)
    || readCycleId(overrideAuthority)
    || readCycleId(executionQuality)
    || readCycleId(reversePolicy)
    || readCycleId(marketObjectiveScore)
    || readCycleId(serverVsPinePerformanceDelta)
    || readCycleId(canonicalProvenance)
    || readCycleId(serverPrimaryCanary)
    || readCycleId(serverPrimaryAcceptanceWatch)
    || readCycleId(pineShadowDrift)
    || readCycleId(deploymentProbe)
    || readCycleId(bundleActivation)
    || readCycleId(openclawAutonomyContract)
    || readCycleId(objectiveRecoveryGovernor)
    || readCycleId(objectiveRecoveryEffect)
    || readCycleId(deployment)
    || readCycleId(deploymentPlan)
    || readCycleId(stageAutopilot)
    || readCycleId(weightTuning)
    || readCycleId(memory)
    || readCycleId(codexPatch);
  const authorityLoopLabel = String(codexPatch.owner || "").trim().toUpperCase() === "CODEX_CLAUDE_ENSEMBLE"
    ? "AUTHORITY_ENSEMBLE"
    : "CODEX_PATCH_ENGINE";
  const hasObjectiveRecoveryEffect = Boolean(
    (artifacts.objectiveRecoveryEffect && (artifacts.objectiveRecoveryEffect.exists === true || artifacts.objectiveRecoveryEffect.data != null))
    || objectiveRecoveryEffect.summary
  );
  const stageAutopilotCycleId = readCycleId(stageAutopilot);
  const stageAutopilotPending = Boolean(
    stageAutopilotOptional
    && expectedCycleId
    && stageAutopilotCycleId
    && stageAutopilotCycleId !== expectedCycleId
  );
  const blockedCandidateIds = Array.isArray(memorySummary.blocked_candidate_ids)
    ? memorySummary.blocked_candidate_ids.filter(Boolean)
    : [];
  const governorMemoryBlocked = objectiveRecoveryGovernorSummary.memory_blocked === true
    || objectiveRecoveryGovernorSummary.target_memory_blocked === true;
  const unrelatedMemoryBlockedIds = Array.isArray(objectiveRecoveryGovernorSummary.unrelated_memory_blocked_candidate_ids)
    ? objectiveRecoveryGovernorSummary.unrelated_memory_blocked_candidate_ids.filter(Boolean)
    : [];

  const rows = [
    {
      loop: "OBJECTIVE_SUPERVISOR",
      fresh: artifacts.objectiveSupervisor && artifacts.objectiveSupervisor.fresh === true,
      cycle_id: readCycleId(objectiveSupervisor),
      status: String(objectiveSupervisor.verdict || "N/A").trim().toUpperCase() || "N/A",
      reason: objectiveReason || "N/A",
    },
    {
      loop: "CANDIDATES",
      fresh: artifacts.candidates && artifacts.candidates.fresh === true,
      cycle_id: readCycleId(candidates),
      status: Number(candidateSummary.ready_n || 0) > 0 ? "READY" : "HOLD",
      reason: `top=${candidateSummary.top_candidate_id || "N/A"} / blocked=${candidateSummary.blocked_n ?? 0} / memory=${candidateSummary.memory_blocked_n ?? 0}`,
    },
    {
      loop: "REPLAY",
      fresh: artifacts.replay && artifacts.replay.fresh === true,
      cycle_id: readCycleId(replay),
      status: Number(replaySummary.pass_n || 0) > 0 ? "PASS" : "HOLD",
      reason: `best=${replaySummary.best_candidate_id || "N/A"} / pass=${replaySummary.pass_n ?? 0} / block=${replaySummary.block_n ?? 0}`,
    },
    {
      loop: "CANARY",
      fresh: artifacts.canary && artifacts.canary.fresh === true,
      cycle_id: readCycleId(canary),
      status: canarySummary.apply_pass === true ? "PASS" : "BLOCK",
      reason: `open_wave=${canarySummary.open_wave ?? "N/A"} / scale=${canarySummary.scale_allowed ? "YES" : "NO"} / blocked=${canarySummary.blocked_n ?? 0}`,
    },
    {
      loop: "CANONICAL_PARITY",
      fresh: artifacts.canonicalParity && artifacts.canonicalParity.fresh === true,
      cycle_id: readCycleId(canonicalParity),
      status: Number(canonicalParitySummary.source_parity_mismatch_n || 0) > 0
        ? "BLOCK"
        : (Number(canonicalParitySummary.shadow_observed_n || 0) > 0 ? "PASS" : "HOLD"),
      reason: `source=${canonicalParitySummary.source_parity_mismatch_n ?? 0} / downstream=${canonicalParitySummary.final_downstream_mismatch_n ?? 0} / ev=${canonicalParitySummary.by_actual_drop_reason_family && Array.isArray(canonicalParitySummary.by_actual_drop_reason_family) ? ((canonicalParitySummary.by_actual_drop_reason_family.find((row) => row.key === "EV_POLICY") || {}).count ?? 0) : "N/A"}`,
    },
    {
      loop: "SERVER_SIGNAL_AUTHORITY",
      fresh: artifacts.serverSignalAuthority && artifacts.serverSignalAuthority.fresh === true,
      cycle_id: readCycleId(serverSignalAuthority),
      status: String(serverSignalAuthoritySummary.drift_status || "N/A").trim().toUpperCase() === "PARITY_DRIFT"
        ? "WARN"
        : (String(serverSignalAuthoritySummary.drift_status || "N/A").trim().toUpperCase() === "PARITY_STABLE"
        ? "PASS"
        : (Number(serverSignalAuthoritySummary.authoritative_server_24h_n || 0) > 0 ? "HOLD" : "N/A")),
      reason: `server_24h=${serverSignalAuthoritySummary.authoritative_server_24h_n ?? 0} / shadow_24h=${serverSignalAuthoritySummary.pine_shadow_24h_n ?? 0} / mismatch=${serverSignalAuthoritySummary.parity_mismatch_n ?? 0} / mode=${serverSignalAuthoritySummary.source_mode || "N/A"}`,
    },
    {
      loop: "SERVER_SIGNAL_QUALITY",
      fresh: artifacts.serverSignalQuality && artifacts.serverSignalQuality.fresh === true,
      cycle_id: readCycleId(serverSignalQuality),
      status: String(serverSignalQualitySummary.quality_status || "N/A").trim().toUpperCase() === "OK"
        ? "PASS"
        : (/WATCH|NOT_REACHING_EXECUTION|FILL_SHORT/.test(String(serverSignalQualitySummary.quality_status || "N/A").trim().toUpperCase()) ? "WARN" : "N/A"),
      reason: `entry=${serverSignalQualitySummary.authoritative_entry_signal_24h_n ?? 0} / intent=${serverSignalQualitySummary.order_intent_24h_n ?? 0} / fill=${serverSignalQualitySummary.fill_24h_n ?? 0} / quality=${serverSignalQualitySummary.quality_status || "N/A"}`,
    },
    {
      loop: "SERVER_SIGNAL_RUNTIME",
      fresh: artifacts.serverSignalRuntime && artifacts.serverSignalRuntime.fresh === true,
      cycle_id: readCycleId(serverSignalRuntime),
      status: String(serverSignalRuntimeSummary.runtime_status || "N/A").trim().toUpperCase() === "READY"
        ? "PASS"
        : (String(serverSignalRuntimeSummary.runtime_status || "N/A").trim().toUpperCase() === "HOLD" ? "WARN" : "N/A"),
      reason: `source_mode=${serverSignalRuntimeSummary.canonical_engine_source_mode || "N/A"} / tf=${serverSignalRuntimeSummary.exec_tf || "N/A"} / markets=${serverSignalRuntimeSummary.market_count ?? 0} / transition=${serverSignalRuntimeSummary.pine_shadow_transition_status || "N/A"} ${serverSignalRuntimeSummary.pine_shadow_transition_progress_pct != null ? `(${serverSignalRuntimeSummary.pine_shadow_transition_progress_pct}%)` : ""}`,
    },
    {
      loop: "SERVER_SIGNAL_CUTOVER",
      fresh: artifacts.serverSignalCutoverReadiness && artifacts.serverSignalCutoverReadiness.fresh === true,
      cycle_id: readCycleId(serverSignalCutoverReadiness),
      status: serverSignalCutoverSummary.promotion_ready === true
        ? "READY"
        : (String(serverSignalCutoverSummary.readiness_status || "N/A").trim().toUpperCase().includes("ACTIVE") ? "PASS" : "WARN"),
      reason: `status=${serverSignalCutoverSummary.readiness_status || "N/A"} / source_mode=${serverSignalCutoverSummary.source_mode || "N/A"} / blockers=${Array.isArray(serverSignalCutoverSummary.blockers) && serverSignalCutoverSummary.blockers.length ? serverSignalCutoverSummary.blockers.join("|") : "none"}`,
    },
    {
      loop: "DROP_VALIDATION",
      fresh: artifacts.dropValidation && artifacts.dropValidation.fresh === true,
      cycle_id: readCycleId(dropValidation),
      status: String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "ACTIONABLE_RESCUE_REVIEW"
        ? "WARN"
        : (String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "KEEP_DROP_CONFIRMED"
        ? "PASS"
        : (String(dropValidationSummary.status || "N/A").trim().toUpperCase() ? "HOLD" : "N/A")),
      reason: `recent=${dropValidationSummary.recent_drop_n ?? 0} / matured=${dropValidationSummary.matured_reason_n ?? 0} / dominant=${dropValidationSummary.dominant_family || "N/A"}:${dropValidationSummary.dominant_verdict || "N/A"} / rescue=${dropValidationSummary.top_rescue_family || "N/A"}:${dropValidationSummary.top_rescue_reason || "N/A"}:${dropValidationSummary.top_rescue_market || "N/A"}`,
    },
    {
      loop: "PROVISIONAL_REALIZED_OUTCOME",
      fresh: artifacts.provisionalRealizedOutcome && artifacts.provisionalRealizedOutcome.fresh === true,
      cycle_id: readCycleId(provisionalRealizedOutcome),
      status: String(provisionalRealizedOutcomeSummary.status || "").trim().toUpperCase() === "PROVISIONAL_ACTIVE"
        ? "WARN"
        : (Number(provisionalRealizedOutcomeSummary.final_realized_n || 0) > 0 ? "PASS" : "HOLD"),
      reason: `final=${provisionalRealizedOutcomeSummary.final_realized_n ?? 0} / provisional=${provisionalRealizedOutcomeSummary.provisional_realized_n ?? 0} / effective=${provisionalRealizedOutcomeSummary.effective_realized_n ?? 0} / top=${provisionalRealizedOutcomeSummary.top_provisional_market || "N/A"}`,
    },
    {
      loop: "OVERRIDE_AUTHORITY",
      fresh: artifacts.overrideAuthority && artifacts.overrideAuthority.fresh === true,
      cycle_id: readCycleId(overrideAuthority),
      status: String(overrideAuthoritySummary.status || "").trim().toUpperCase() === "BOUNDED_AUTHORITY_ACTIVE" ? "PASS" : "HOLD",
      reason: `max_markets=${overrideAuthoritySummary.max_market_overrides_per_cycle ?? "N/A"} / risk=${overrideAuthoritySummary.risk_override_enabled === true ? "ALLOW" : "BLOCK"} / top=${Array.isArray(overrideAuthoritySummary.top_priority_markets) && overrideAuthoritySummary.top_priority_markets.length ? overrideAuthoritySummary.top_priority_markets.map((row) => row.market).join("|") : "N/A"}`,
    },
    {
      loop: "EXECUTION_QUALITY",
      fresh: artifacts.executionQuality && artifacts.executionQuality.fresh === true,
      cycle_id: readCycleId(executionQuality),
      status: String(executionQualitySummary.status || "").trim().toUpperCase() === "EXECUTION_QUALITY_STABLE"
        ? "PASS"
        : (String(executionQualitySummary.status || "").trim().toUpperCase() ? "WARN" : "N/A"),
      reason: `latency_p95=${executionQualitySummary.created_to_fill_p95_ms ?? "N/A"} / slippage_p95=${executionQualitySummary.adverse_slippage_p95_bps ?? "N/A"} / partial=${executionQualitySummary.partial_fill_rate_pct ?? "N/A"} / top=${executionQualitySummary.top_latency_market || executionQualitySummary.top_slippage_market || executionQualitySummary.top_partial_market || "N/A"}`,
    },
    {
      loop: "REVERSE_POLICY",
      fresh: artifacts.reversePolicy && artifacts.reversePolicy.fresh === true,
      cycle_id: readCycleId(reversePolicy),
      status: String(reversePolicySummary.status || "").trim().toUpperCase() === "REVERSE_POLICY_STABLE"
        ? "PASS"
        : (String(reversePolicySummary.status || "").trim().toUpperCase() ? "WARN" : "N/A"),
      reason: `drops=${reversePolicySummary.reverse_drop_n ?? 0} / revive=${reversePolicySummary.reverse_revive_n ?? 0} / rate=${reversePolicySummary.reverse_revive_rate != null ? reversePolicySummary.reverse_revive_rate : "N/A"} / top=${reversePolicySummary.top_watch_market || "N/A"}:${reversePolicySummary.top_watch_reason || "N/A"}:${reversePolicySummary.top_watch_action || "N/A"}`,
    },
    {
      loop: "SERVER_VS_PINE_DELTA",
      fresh: artifacts.serverVsPinePerformanceDelta && artifacts.serverVsPinePerformanceDelta.fresh === true,
      cycle_id: readCycleId(serverVsPinePerformanceDelta),
      status: String(serverVsPinePerformanceDeltaSummary.status || "").trim().toUpperCase() === "SERVER_EDGE_STABLE"
        ? "PASS"
        : (String(serverVsPinePerformanceDeltaSummary.status || "").trim().toUpperCase() === "SHADOW_GAP_REVIEW" ? "WARN" : "HOLD"),
      reason: `shadow_gap=${serverVsPinePerformanceDeltaSummary.top_shadow_gap_market || "N/A"} / edge=${serverVsPinePerformanceDeltaSummary.top_server_edge_market || "N/A"} / delta=${serverVsPinePerformanceDeltaSummary.avg_active_delta_score != null ? serverVsPinePerformanceDeltaSummary.avg_active_delta_score : "N/A"} / mismatch=${serverVsPinePerformanceDeltaSummary.parity_mismatch_n ?? 0}`,
    },
    {
      loop: "CANONICAL_PROVENANCE",
      fresh: artifacts.canonicalProvenance && artifacts.canonicalProvenance.fresh === true,
      cycle_id: readCycleId(canonicalProvenance),
      status: canonicalProvenanceStatus === "NO_ENGINE_ROWS_AFTER_CUTOVER"
        ? "N/A"
        : Number(canonicalProvenanceComplete || 0) > 0
        ? "PASS"
        : (Number(canonicalProvenanceEligible || 0) > 0 ? "HOLD" : "N/A"),
      reason: canonicalProvenanceStatus === "NO_ENGINE_ROWS_AFTER_CUTOVER"
        ? `cutover=${canonicalProvenanceSummary.cutover_reference_source || "N/A"} / eligible=0`
        : `complete=${canonicalProvenanceComplete ?? 0}/${canonicalProvenanceEligible ?? 0} / source_decision=${canonicalProvenanceSourceDecision ?? 0} / bundle=${canonicalProvenanceBundle ?? 0}`,
    },
    {
      loop: "SERVER_PRIMARY_CANARY",
      fresh: artifacts.serverPrimaryCanary && artifacts.serverPrimaryCanary.fresh === true,
      cycle_id: readCycleId(serverPrimaryCanary),
      status: Number(serverPrimaryCanarySummary.server_primary_executed_n || 0) > 0
        ? (serverPrimaryCanarySummary.apply_pass === true ? "PASS" : "BLOCK")
        : "N/A",
      reason: `executed=${serverPrimaryCanarySummary.server_primary_executed_n ?? 0} / disagreement=${serverPrimaryCanarySummary.pine_shadow_disagreement_n ?? 0}/${serverPrimaryCanarySummary.pine_shadow_observed_n ?? 0} / rollback=${serverPrimaryCanarySummary.rollback_trigger_n ?? 0}`,
    },
    {
      loop: "SERVER_PRIMARY_ACCEPTANCE_WATCH",
      fresh: artifacts.serverPrimaryAcceptanceWatch && artifacts.serverPrimaryAcceptanceWatch.fresh === true,
      cycle_id: readCycleId(serverPrimaryAcceptanceWatch),
      status: String(serverPrimaryAcceptanceSummary.phase_d_status || "N/A").trim().toUpperCase() === "READY"
        ? "PASS"
        : (String(serverPrimaryAcceptanceSummary.phase_d_status || "N/A").trim().toUpperCase() === "BLOCK"
        ? "BLOCK"
        : (String(serverPrimaryAcceptanceSummary.phase_d_status || "N/A").trim().toUpperCase() === "PENDING" ? "HOLD" : "N/A")),
      reason: `executed=${serverPrimaryAcceptanceSummary.executed_n ?? 0}/${serverPrimaryAcceptanceSummary.min_executed_n ?? "N/A"} / disagreement=${serverPrimaryAcceptanceSummary.disagreement_rate ?? "N/A"}<=${serverPrimaryAcceptanceSummary.max_disagreement_rate ?? "N/A"} / rollback=${serverPrimaryAcceptanceSummary.rollback_trigger_n ?? 0}<=${serverPrimaryAcceptanceSummary.max_rollback_trigger_n ?? "N/A"} / ${serverPrimaryAcceptanceSummary.phase_d_reason || "N/A"}`,
    },
    {
      loop: "PINE_SHADOW_DRIFT",
      fresh: artifacts.pineShadowDrift && artifacts.pineShadowDrift.fresh === true,
      cycle_id: readCycleId(pineShadowDrift),
      status: Number(pineShadowDriftSummary.observed_n || 0) > 0
        ? (Number(pineShadowDriftSummary.drift_n || 0) > 0 ? "WARN" : "PASS")
        : "N/A",
      reason: `audit_only=${pineShadowDriftSummary.audit_only ? "YES" : "NO"} / drift=${pineShadowDriftSummary.drift_n ?? 0}/${pineShadowDriftSummary.observed_n ?? 0} / top=${pineShadowDriftSummary.top_drift_market || "N/A"}`,
    },
    {
      loop: "DEPLOYMENT_PROBE",
      fresh: artifacts.deploymentProbe && artifacts.deploymentProbe.fresh === true,
      cycle_id: readCycleId(deploymentProbe),
      status: deploymentProbeSummary.probe_pass === true
        ? "PASS"
        : (deploymentProbeSummary.acknowledged === true ? "HOLD" : "N/A"),
      reason: `engine=${deploymentProbeSummary.engine_bundle_loaded ? "YES" : "NO"} / policy=${deploymentProbeSummary.policy_bundle_loaded ? "YES" : "NO"} / data=${deploymentProbeSummary.market_data_flow_ok ? "YES" : "NO"} / probe=${deploymentProbeSummary.probe_status || "N/A"}`,
    },
    {
      loop: "BUNDLE_ACTIVATION",
      fresh: artifacts.bundleActivation && artifacts.bundleActivation.fresh === true,
      cycle_id: readCycleId(bundleActivation),
      status: bundleActivationSummary.activation_status === "TIMEOUT"
        ? "TIMEOUT"
        : (bundleActivationSummary.activation_confirmed === true
        ? "PASS"
        : (bundleActivationSummary.activation_pending === true ? "HOLD" : "N/A")),
      reason: `engine=${bundleActivationSummary.engine_bundle_loaded ? "YES" : "NO"} / policy=${bundleActivationSummary.policy_bundle_loaded ? "YES" : "NO"} / data=${bundleActivationSummary.market_data_flow_ok ? "YES" : "NO"} / probe=${bundleActivationSummary.probe_pass ? "YES" : "NO"} / decision=${bundleActivationSummary.first_decision_seen ? "YES" : "NO"} / reason=${bundleActivationSummary.activation_reason || "N/A"}`,
    },
    {
      loop: "OPENCLAW_AUTONOMY_CONTRACT",
      fresh: artifacts.openclawAutonomyContract && artifacts.openclawAutonomyContract.fresh === true,
      cycle_id: readCycleId(openclawAutonomyContract),
      status: String(autonomyContractSummary.ops_status || "N/A").trim().toUpperCase() || "N/A",
      reason: `goal=${autonomyContractSummary.goal_state || "N/A"} / authority=${autonomyContractSummary.authority_state || "N/A"} / phase_d=${autonomyContractSummary.phase_d_status || "N/A"}`,
    },
    {
      loop: "OBJECTIVE_RECOVERY_GOVERNOR",
      fresh: artifacts.objectiveRecoveryGovernor && artifacts.objectiveRecoveryGovernor.fresh === true,
      cycle_id: readCycleId(objectiveRecoveryGovernor),
      status: String(objectiveRecoveryGovernorSummary.governor_status || "N/A").trim().toUpperCase() === "RECOVERY_PROMOTION_READY"
        ? "READY"
        : (String(objectiveRecoveryGovernorSummary.governor_status || "N/A").trim().toUpperCase() === "OBJECTIVE_ON_TRACK"
        ? "PASS"
        : (/BLOCKED/.test(String(objectiveRecoveryGovernorSummary.governor_status || "")) ? "BLOCK" : "HOLD")),
      reason: `candidate=${objectiveRecoveryGovernorSummary.target_candidate_id || "N/A"} / degraded=${objectiveRecoveryGovernorSummary.degraded_authority_eligible ? "YES" : "NO"} / ${objectiveRecoveryGovernorSummary.governor_reason || "N/A"}`,
    },
    ...(hasObjectiveRecoveryEffect ? [{
      loop: "OBJECTIVE_RECOVERY_EFFECT",
      fresh: artifacts.objectiveRecoveryEffect && artifacts.objectiveRecoveryEffect.fresh === true,
      cycle_id: readCycleId(objectiveRecoveryEffect),
      status: String(objectiveRecoveryEffectSummary.tracking_status || "N/A").trim().toUpperCase() === "PROJECTED_OBJECTIVE_ON_TRACK"
        ? "PASS"
        : (String(objectiveRecoveryEffectSummary.tracking_status || "N/A").trim().toUpperCase() === "PARTIAL_RECOVERY_ONLY"
        ? "WARN"
        : (/MISSING|NO_RECOVERY_TARGET|NO_OBJECTIVE_IMPROVEMENT/.test(String(objectiveRecoveryEffectSummary.tracking_status || "").trim().toUpperCase()) ? "BLOCK" : "N/A")),
      reason: `target=${objectiveRecoveryEffectSummary.target_candidate_id || "N/A"} / delta=${objectiveRecoveryEffectSummary.target_candidate_objective_delta != null ? objectiveRecoveryEffectSummary.target_candidate_objective_delta : "N/A"} / projected=${objectiveRecoveryEffectSummary.projected_objective_score != null ? objectiveRecoveryEffectSummary.projected_objective_score : "N/A"} / gap=${objectiveRecoveryEffectSummary.gap_closure_rate != null ? objectiveRecoveryEffectSummary.gap_closure_rate : "N/A"} / higher_delta=${objectiveRecoveryEffectSummary.higher_delta_candidate_id || "none"}`,
    }] : []),
    {
      loop: "DEPLOYMENT_GUARDS",
      fresh: artifacts.deployment && artifacts.deployment.fresh === true,
      cycle_id: readCycleId(deployment),
      status: deploymentSummary.deploy_pass === true ? "PASS" : (deploymentBlockers.length ? "BLOCK" : "HOLD"),
      reason: deploymentBlockers.length ? deploymentBlockers.join("|") : "none",
    },
    {
      loop: "DEPLOYMENT_PLAN",
      fresh: artifacts.deploymentPlan && artifacts.deploymentPlan.fresh === true,
      cycle_id: readCycleId(deploymentPlan),
      status: deploymentPlanStatus,
      reason: `target=${deploymentPlanSummary.recommended_target_candidate_id || deploymentPlanSummary.target_candidate_id || "N/A"} / origin=${deploymentPlanSummary.applied_origin_candidate_id || deploymentPlanSummary.prepared_origin_candidate_id || "N/A"} / manual=${deploymentPlanSummary.manual_step_required ? "YES" : "NO"} / engine=${deploymentPlanSummary.prepared_engine_bundle_id || deploymentPlanSummary.active_engine_bundle_id || "N/A"} / policy=${deploymentPlanSummary.prepared_policy_bundle_id || deploymentPlanSummary.active_policy_bundle_id || "N/A"} / shadow=${deploymentPlanSummary.prepared_file_path || deploymentPlanSummary.latest_generated_file_path || "N/A"}`,
    },
    {
      loop: "STAGE_AUTOPILOT",
      fresh: artifacts.stageAutopilot && artifacts.stageAutopilot.fresh === true,
      cycle_id: stageAutopilotPending ? null : stageAutopilotCycleId,
      source_cycle_id: stageAutopilotPending ? stageAutopilotCycleId : null,
      status: stageAutopilotPending ? "PENDING" : (String(stageAutopilot.objective_verdict || "N/A").trim().toUpperCase() || "N/A"),
      reason: stageAutopilotPending
        ? `post_stage_pending / latest=${stageAutopilotCycleId}`
        : `actions=${Array.isArray(stageAutopilot.actions) ? stageAutopilot.actions.length : 0}`,
    },
    {
      loop: "WEIGHT_TUNING",
      fresh: artifacts.weightTuning && artifacts.weightTuning.fresh === true,
      cycle_id: readCycleId(weightTuning),
      status: weightSummary.autonomous_defer === true
        ? "DEFERRED"
        : (String(weightSummary.advisory_mode || "N/A").trim().toUpperCase() || "N/A"),
      reason: weightSummary.autonomous_defer === true
        ? `suggestions=${weightSummary.suggestion_n ?? 0} / defer=${weightSummary.defer_reason || "N/A"} / eta_w=${weightSummary.memory_defer_remaining_weeks_min != null ? weightSummary.memory_defer_remaining_weeks_min : "N/A"}`
        : `suggestions=${weightSummary.suggestion_n ?? 0} / canary_blocked=${weightSummary.canary_blocked ? "YES" : "NO"}`,
    },
    {
      loop: "MEMORY_LEDGER",
      fresh: artifacts.memory && artifacts.memory.fresh === true,
      cycle_id: readCycleId(memory),
      status: governorMemoryBlocked
        ? "BLOCK"
        : (Number(memorySummary.blocked_candidate_n || 0) > 0 ? "WARN" : "PASS"),
      reason: governorMemoryBlocked
        ? `target_blocked=YES / reason=${objectiveRecoveryGovernorSummary.target_memory_block_reason || "N/A"} / ids=${blockedCandidateIds.slice(0, 3).join("|") || "N/A"}`
        : Number(memorySummary.blocked_candidate_n || 0) > 0
        ? `target_blocked=NO / blocked=${memorySummary.blocked_candidate_n ?? 0} / ids=${unrelatedMemoryBlockedIds.slice(0, 3).join("|") || blockedCandidateIds.slice(0, 3).join("|") || "N/A"}`
        : `blocked=0 / top_failed=${memorySummary.top_failed_candidate_id || "N/A"}`,
    },
    {
      loop: authorityLoopLabel,
      fresh: artifacts.codexPatch && artifacts.codexPatch.fresh === true,
      cycle_id: readCycleId(codexPatch),
      status: String(codexPatch.verdict || "N/A").trim().toUpperCase() || "N/A",
      reason: `candidate=${codexPatch.recommended_candidate_id || "N/A"} / rollback=${codexPatch.recommended_rollback_file_path || "N/A"}`,
    },
  ];

  const staleArtifacts = rows
    .filter((row) => row.fresh !== true)
    .filter((row) => !(stageAutopilotOptional && row.loop === "STAGE_AUTOPILOT"))
    .map((row) => row.loop);
  const cycleMismatches = expectedCycleId
    ? rows
      .filter((row) => row.cycle_id && row.cycle_id !== expectedCycleId)
      .filter((row) => !(stageAutopilotOptional && row.loop === "STAGE_AUTOPILOT"))
      .map((row) => ({ loop: row.loop, cycle_id: row.cycle_id }))
    : [];
  const coreCycleMismatches = cycleMismatches.filter((row) => !DERIVED_LOOP_KEYS.has(row.loop));
  const derivedCycleMismatches = cycleMismatches.filter((row) => DERIVED_LOOP_KEYS.has(row.loop));
  const cycleIdAbsent = expectedCycleId
    ? rows
      .filter((row) => row.fresh === true && !row.cycle_id)
      .filter((row) => !CYCLE_ID_OPTIONAL_LOOPS.has(row.loop))
      .filter((row) => !(stageAutopilotOptional && row.loop === "STAGE_AUTOPILOT"))
      .map((row) => row.loop)
    : [];
  const coreCycleIdAbsent = cycleIdAbsent.filter((loop) => !DERIVED_LOOP_KEYS.has(loop));
  const derivedCycleIdAbsent = cycleIdAbsent.filter((loop) => DERIVED_LOOP_KEYS.has(loop));
  const blockers = [];
  if (objectiveReason) blockers.push(objectiveReason);
  if (Number(canonicalParitySummary.source_parity_mismatch_n || 0) > 0) blockers.push("SELF_EVOLUTION_CANONICAL_SOURCE_MISMATCH");
  if (String(serverSignalAuthoritySummary.drift_status || "").trim().toUpperCase() === "PARITY_DRIFT") blockers.push("SERVER_SIGNAL_PARITY_DRIFT");
  if (/NOT_REACHING_EXECUTION/.test(String(serverSignalQualitySummary.quality_status || "").trim().toUpperCase())) blockers.push("SERVER_SIGNAL_EXECUTION_GAP");
  if (String(serverSignalRuntimeSummary.runtime_status || "").trim().toUpperCase() === "HOLD") blockers.push("SERVER_SIGNAL_RUNTIME_HOLD");
  if (serverSignalCutoverSummary.promotion_ready !== true && toNum(serverSignalRuntimeSummary.market_count) > 0) blockers.push("SERVER_SIGNAL_CUTOVER_NOT_READY");
  if (String(serverPrimaryAcceptanceSummary.phase_d_status || "").trim().toUpperCase() === "BLOCK") blockers.push("SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_BLOCK");
  if (Number(serverPrimaryCanarySummary.server_primary_executed_n || 0) > 0 && serverPrimaryCanarySummary.apply_pass === false) {
    blockers.push("SELF_EVOLUTION_SERVER_PRIMARY_CANARY_BLOCK");
  }
  if (bundleActivationSummary.activation_pending === true) blockers.push("SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING");
  if (bundleActivationSummary.activation_status === "TIMEOUT") blockers.push("SELF_EVOLUTION_DEPLOYMENT_CONFIRM_TIMEOUT");
  blockers.push(...deploymentBlockers);
  if (
    deploymentPlanSummary.external_authority_pending === true
    || String(deploymentPlanSummary.authority_state || "").trim().toUpperCase() === "PENDING"
    || deploymentPlanSummary.authority_bypass_active === true
  ) blockers.push("SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING");
  if (governorMemoryBlocked) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK_PRESENT");
  if (coreCycleMismatches.length) blockers.push("SELF_EVOLUTION_CYCLE_MISMATCH");
  if (coreCycleIdAbsent.length) blockers.push("SELF_EVOLUTION_CYCLE_ID_ABSENT");
  const uniqueBlockers = Array.from(new Set(blockers.filter(Boolean)));

  let overallStatus = "HEALTHY";
  const normalizedDeploymentPlanStatus = normalizePlanStatus(deploymentPlanStatus);
  if (normalizedDeploymentPlanStatus === "APPLIED_ACTIVE_PENDING_AUTHORITY") overallStatus = "APPLIED_ACTIVE_PENDING_AUTHORITY";
  else if (normalizedDeploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY") overallStatus = "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY";
  else if (normalizedDeploymentPlanStatus === "APPLIED_ACTIVE") overallStatus = "APPLIED_ACTIVE";
  else if (normalizedDeploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION") overallStatus = "APPLIED_PENDING_BUNDLE_ACTIVATION";
  else if (normalizedDeploymentPlanStatus === "APPLIED_BUNDLE_ACTIVATION_TIMEOUT_PENDING_AUTHORITY") overallStatus = "APPLIED_BUNDLE_ACTIVATION_TIMEOUT_PENDING_AUTHORITY";
  else if (normalizedDeploymentPlanStatus === "APPLIED_BUNDLE_ACTIVATION_TIMEOUT") overallStatus = "APPLIED_BUNDLE_ACTIVATION_TIMEOUT";
  else if (normalizedDeploymentPlanStatus === "APPLIED_CONFIRMED_PENDING_AUTHORITY") overallStatus = "APPLIED_CONFIRMED_PENDING_AUTHORITY";
  else if (normalizedDeploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION_PENDING_AUTHORITY") overallStatus = "APPLIED_PENDING_SIGNAL_CONFIRMATION_PENDING_AUTHORITY";
  else if (normalizedDeploymentPlanStatus === "APPLIED_CONFIRMED") overallStatus = "APPLIED_CONFIRMED";
  else if (normalizedDeploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION") overallStatus = "APPLIED_PENDING_SIGNAL_CONFIRMATION";
  else if (deploymentPlanSummary.manual_step_required === true) overallStatus = "READY_FOR_MANUAL_PASTE";
  else if (staleArtifacts.length || coreCycleMismatches.length || coreCycleIdAbsent.length) overallStatus = "BLOCKED";
  else if (uniqueBlockers.length || canarySummary.apply_pass === false || deploymentSummary.deploy_pass === false) overallStatus = "DEGRADED";

  return {
    summary: {
      cycle_id: expectedCycleId,
      overall_status: overallStatus,
      stale_artifact_n: staleArtifacts.length,
      stale_artifacts: staleArtifacts,
      cycle_consistent: cycleMismatches.length === 0,
      core_cycle_consistent: coreCycleMismatches.length === 0 && coreCycleIdAbsent.length === 0,
      cycle_mismatch_n: cycleMismatches.length,
      cycle_mismatches: cycleMismatches,
      core_cycle_mismatch_n: coreCycleMismatches.length,
      core_cycle_mismatches: coreCycleMismatches,
      derived_cycle_mismatch_n: derivedCycleMismatches.length,
      derived_cycle_mismatches: derivedCycleMismatches,
      cycle_id_absent_n: cycleIdAbsent.length,
      cycle_id_absent_loops: cycleIdAbsent,
      core_cycle_id_absent_n: coreCycleIdAbsent.length,
      core_cycle_id_absent_loops: coreCycleIdAbsent,
      derived_cycle_id_absent_n: derivedCycleIdAbsent.length,
      derived_cycle_id_absent_loops: derivedCycleIdAbsent,
      critical_blocker_n: uniqueBlockers.length,
      critical_blockers: uniqueBlockers.slice(0, 10),
      server_signal_drift_status: serverSignalAuthoritySummary.drift_status || null,
      server_signal_parity_mismatch_rate: toNum(serverSignalAuthoritySummary.parity_mismatch_rate),
      server_signal_quality_status: serverSignalQualitySummary.quality_status || null,
      server_signal_runtime_status: serverSignalRuntimeSummary.runtime_status || null,
      server_signal_runtime_exec_tf: serverSignalRuntimeSummary.exec_tf || null,
      server_signal_runtime_market_count: toNum(serverSignalRuntimeSummary.market_count),
      server_signal_cutover_status: serverSignalCutoverSummary.readiness_status || null,
      server_signal_cutover_ready: serverSignalCutoverSummary.promotion_ready === true,
      server_signal_cutover_blockers: Array.isArray(serverSignalCutoverSummary.blockers) ? serverSignalCutoverSummary.blockers.slice(0, 6) : [],
      drop_validation_status: dropValidationSummary.status || null,
      drop_validation_top_rescue_family: dropValidationSummary.top_rescue_family || null,
      drop_validation_top_rescue_reason: dropValidationSummary.top_rescue_reason || null,
      drop_validation_top_rescue_market: dropValidationSummary.top_rescue_market || null,
      drop_validation_top_rescue_avg_horizon_pnl_quote_proxy: toNum(dropValidationSummary.top_rescue_avg_horizon_pnl_quote_proxy),
      drop_validation_top_watch_markets: Array.isArray(dropValidationSummary.top_watch_markets)
        ? dropValidationSummary.top_watch_markets.slice(0, 6).map((row) => String(row && row.market || "").trim().toUpperCase()).filter(Boolean)
        : [],
      provisional_realized_outcome_status: provisionalRealizedOutcomeSummary.status || null,
      provisional_realized_final_n: toNum(provisionalRealizedOutcomeSummary.final_realized_n) || 0,
      provisional_realized_provisional_n: toNum(provisionalRealizedOutcomeSummary.provisional_realized_n) || 0,
      provisional_realized_effective_n: toNum(provisionalRealizedOutcomeSummary.effective_realized_n) || 0,
      provisional_realized_top_market: provisionalRealizedOutcomeSummary.top_provisional_market || null,
      override_authority_status: overrideAuthoritySummary.status || null,
      override_authority_max_market_overrides_per_cycle: toNum(overrideAuthoritySummary.max_market_overrides_per_cycle) || 0,
      override_authority_risk_override_enabled: overrideAuthoritySummary.risk_override_enabled === true,
      override_authority_top_markets: Array.isArray(overrideAuthoritySummary.top_priority_markets)
        ? overrideAuthoritySummary.top_priority_markets.map((row) => String(row && row.market || "").trim().toUpperCase()).filter(Boolean)
        : [],
      execution_quality_status: executionQualitySummary.status || null,
      execution_quality_created_to_fill_p95_ms: toNum(executionQualitySummary.created_to_fill_p95_ms),
      execution_quality_adverse_slippage_p95_bps: toNum(executionQualitySummary.adverse_slippage_p95_bps),
      execution_quality_partial_fill_rate_pct: toNum(executionQualitySummary.partial_fill_rate_pct),
      execution_quality_top_latency_market: executionQualitySummary.top_latency_market || null,
      execution_quality_top_slippage_market: executionQualitySummary.top_slippage_market || null,
      execution_quality_top_partial_market: executionQualitySummary.top_partial_market || null,
      execution_quality_review_reasons: Array.isArray(executionQualitySummary.review_reasons)
        ? executionQualitySummary.review_reasons.slice(0, 6)
        : [],
      reverse_policy_status: reversePolicySummary.status || null,
      reverse_policy_drop_n: toNum(reversePolicySummary.reverse_drop_n),
      reverse_policy_revive_n: toNum(reversePolicySummary.reverse_revive_n),
      reverse_policy_revive_rate: toNum(reversePolicySummary.reverse_revive_rate),
      reverse_policy_top_watch_market: reversePolicySummary.top_watch_market || null,
      reverse_policy_top_watch_reason: reversePolicySummary.top_watch_reason || null,
      reverse_policy_top_watch_action: reversePolicySummary.top_watch_action || null,
      market_objective_status: marketObjectiveScoreSummary.status || null,
      market_objective_top_recovery_market: marketObjectiveScoreSummary.top_recovery_market || null,
      market_objective_top_drag_market: marketObjectiveScoreSummary.top_drag_market || null,
      market_objective_top_recovery_avg_horizon_pnl_quote_proxy: toNum(marketObjectiveScoreSummary.top_recovery_avg_horizon_pnl_quote_proxy),
      server_vs_pine_delta_status: serverVsPinePerformanceDeltaSummary.status || null,
      server_vs_pine_delta_top_shadow_gap_market: serverVsPinePerformanceDeltaSummary.top_shadow_gap_market || null,
      server_vs_pine_delta_top_server_edge_market: serverVsPinePerformanceDeltaSummary.top_server_edge_market || null,
      server_vs_pine_delta_avg_active_delta_score: toNum(serverVsPinePerformanceDeltaSummary.avg_active_delta_score),
      server_signal_entry_24h_n: toNum(serverSignalQualitySummary.authoritative_entry_signal_24h_n),
      server_signal_intent_24h_n: toNum(serverSignalQualitySummary.order_intent_24h_n),
      server_signal_fill_24h_n: toNum(serverSignalQualitySummary.fill_24h_n),
      promotion_path_ready: deploymentSummary.deploy_pass === true,
      manual_paste_ready: deploymentPlanSummary.manual_step_required === true,
      applied_confirmed: isAppliedConfirmedLike(deploymentPlanStatus),
      applied_pending_signal_confirmation: isAppliedPendingSignalConfirmationLike(deploymentPlanStatus),
      applied_pending_bundle_activation: isAppliedPendingBundleActivationLike(deploymentPlanStatus),
      ready_candidate_id: deploymentPlanSummary.recommended_target_candidate_id || deploymentPlanSummary.target_candidate_id || deploymentSummary.target_candidate_id || null,
      canary_open_wave: toNum(canarySummary.open_wave) || null,
      loop_n: rows.length,
      fresh_loop_n: rows.filter((row) => row.fresh === true).length,
    },
    rows,
  };
}

module.exports = {
  deriveLoopMonitor,
  unwrapRawReport,
};
