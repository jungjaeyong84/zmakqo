"use strict";

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
  const canonicalProvenance = unwrapRawReport(reports.canonicalProvenance) || {};
  const serverPrimaryCanary = unwrapRawReport(reports.serverPrimaryCanary) || {};
  const bundleActivation = unwrapRawReport(reports.bundleActivation) || {};
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
  const canonicalProvenanceSummary = canonicalProvenance.summary && typeof canonicalProvenance.summary === "object" ? canonicalProvenance.summary : {};
  const serverPrimaryCanarySummary = serverPrimaryCanary.summary && typeof serverPrimaryCanary.summary === "object" ? serverPrimaryCanary.summary : {};
  const bundleActivationSummary = bundleActivation.summary && typeof bundleActivation.summary === "object" ? bundleActivation.summary : {};
  const candidateSummary = candidates.summary && typeof candidates.summary === "object" ? candidates.summary : {};
  const replaySummary = replay.summary && typeof replay.summary === "object" ? replay.summary : {};
  const memorySummary = memory.summary && typeof memory.summary === "object" ? memory.summary : {};
  const weightSummary = weightTuning.summary && typeof weightTuning.summary === "object" ? weightTuning.summary : {};
  const expectedCycleId = readCycleId(objectiveSupervisor)
    || readCycleId(candidates)
    || readCycleId(replay)
    || readCycleId(canary)
    || readCycleId(canonicalParity)
    || readCycleId(canonicalProvenance)
    || readCycleId(serverPrimaryCanary)
    || readCycleId(bundleActivation)
    || readCycleId(deployment)
    || readCycleId(deploymentPlan)
    || readCycleId(stageAutopilot)
    || readCycleId(weightTuning)
    || readCycleId(memory)
    || readCycleId(codexPatch);
  const authorityLoopLabel = String(codexPatch.owner || "").trim().toUpperCase() === "CODEX_CLAUDE_ENSEMBLE"
    ? "AUTHORITY_ENSEMBLE"
    : "CODEX_PATCH_ENGINE";
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
      loop: "CANONICAL_PROVENANCE",
      fresh: artifacts.canonicalProvenance && artifacts.canonicalProvenance.fresh === true,
      cycle_id: readCycleId(canonicalProvenance),
      status: Number(canonicalProvenanceSummary.complete_n || 0) > 0
        ? "PASS"
        : (Number(canonicalProvenanceSummary.eligible_n || 0) > 0 ? "HOLD" : "N/A"),
      reason: `complete=${canonicalProvenanceSummary.complete_n ?? 0}/${canonicalProvenanceSummary.eligible_n ?? 0} / source_decision=${canonicalProvenanceSummary.with_actual_source_decision_n ?? canonicalProvenanceSummary.actual_source_decision_n ?? 0} / bundle=${canonicalProvenanceSummary.with_bundle_version_n ?? canonicalProvenanceSummary.bundle_version_n ?? 0}`,
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
      loop: "BUNDLE_ACTIVATION",
      fresh: artifacts.bundleActivation && artifacts.bundleActivation.fresh === true,
      cycle_id: readCycleId(bundleActivation),
      status: bundleActivationSummary.activation_confirmed === true
        ? "PASS"
        : (bundleActivationSummary.activation_pending === true ? "HOLD" : "N/A"),
      reason: `engine=${bundleActivationSummary.engine_bundle_loaded ? "YES" : "NO"} / policy=${bundleActivationSummary.policy_bundle_loaded ? "YES" : "NO"} / data=${bundleActivationSummary.market_data_flow_ok ? "YES" : "NO"} / decision=${bundleActivationSummary.first_decision_seen ? "YES" : "NO"} / reason=${bundleActivationSummary.activation_reason || "N/A"}`,
    },
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
      reason: `target=${deploymentPlanSummary.recommended_target_candidate_id || deploymentPlanSummary.target_candidate_id || "N/A"} / origin=${deploymentPlanSummary.applied_origin_candidate_id || deploymentPlanSummary.prepared_origin_candidate_id || "N/A"} / manual=${deploymentPlanSummary.manual_step_required ? "YES" : "NO"} / file=${deploymentPlanSummary.prepared_file_path || deploymentPlanSummary.latest_generated_file_path || "N/A"}`,
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
      status: Number(memorySummary.blocked_candidate_n || 0) > 0 ? "BLOCK" : "PASS",
      reason: Number(memorySummary.blocked_candidate_n || 0) > 0
        ? `blocked=${memorySummary.blocked_candidate_n ?? 0} / ids=${blockedCandidateIds.slice(0, 3).join("|") || "N/A"}`
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
  const cycleIdAbsent = expectedCycleId
    ? rows
      .filter((row) => row.fresh === true && !row.cycle_id)
      .filter((row) => !(stageAutopilotOptional && row.loop === "STAGE_AUTOPILOT"))
      .map((row) => row.loop)
    : [];
  const blockers = [];
  if (objectiveReason) blockers.push(objectiveReason);
  if (Number(canonicalParitySummary.source_parity_mismatch_n || 0) > 0) blockers.push("SELF_EVOLUTION_CANONICAL_SOURCE_MISMATCH");
  if (Number(serverPrimaryCanarySummary.server_primary_executed_n || 0) > 0 && serverPrimaryCanarySummary.apply_pass === false) {
    blockers.push("SELF_EVOLUTION_SERVER_PRIMARY_CANARY_BLOCK");
  }
  if (bundleActivationSummary.activation_pending === true) blockers.push("SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING");
  blockers.push(...deploymentBlockers);
  if (deploymentPlanSummary.authority_bypass_active === true) blockers.push("SELF_EVOLUTION_AUTHORITY_BYPASS");
  if (Number(memorySummary.blocked_candidate_n || 0) > 0) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK_PRESENT");
  if (cycleMismatches.length) blockers.push("SELF_EVOLUTION_CYCLE_MISMATCH");
  if (cycleIdAbsent.length) blockers.push("SELF_EVOLUTION_CYCLE_ID_ABSENT");
  const uniqueBlockers = Array.from(new Set(blockers.filter(Boolean)));

  let overallStatus = "HEALTHY";
  if (deploymentPlanStatus === "APPLIED_ACTIVE_AUTHORITY_BYPASS") overallStatus = "APPLIED_ACTIVE_AUTHORITY_BYPASS";
  else if (deploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION_AUTHORITY_BYPASS") overallStatus = "APPLIED_PENDING_BUNDLE_ACTIVATION_AUTHORITY_BYPASS";
  else if (deploymentPlanStatus === "APPLIED_ACTIVE") overallStatus = "APPLIED_ACTIVE";
  else if (deploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION") overallStatus = "APPLIED_PENDING_BUNDLE_ACTIVATION";
  else if (deploymentPlanStatus === "APPLIED_CONFIRMED_AUTHORITY_BYPASS") overallStatus = "APPLIED_CONFIRMED_AUTHORITY_BYPASS";
  else if (deploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS") overallStatus = "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS";
  else if (deploymentPlanStatus === "APPLIED_CONFIRMED") overallStatus = "APPLIED_CONFIRMED";
  else if (deploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION") overallStatus = "APPLIED_PENDING_SIGNAL_CONFIRMATION";
  else if (deploymentPlanSummary.manual_step_required === true) overallStatus = "READY_FOR_MANUAL_PASTE";
  else if (staleArtifacts.length || cycleMismatches.length || cycleIdAbsent.length) overallStatus = "BLOCKED";
  else if (uniqueBlockers.length || canarySummary.apply_pass === false || deploymentSummary.deploy_pass === false) overallStatus = "DEGRADED";

  return {
    summary: {
      cycle_id: expectedCycleId,
      overall_status: overallStatus,
      stale_artifact_n: staleArtifacts.length,
      stale_artifacts: staleArtifacts,
      cycle_consistent: cycleMismatches.length === 0,
      cycle_mismatch_n: cycleMismatches.length,
      cycle_mismatches: cycleMismatches,
      cycle_id_absent_n: cycleIdAbsent.length,
      cycle_id_absent_loops: cycleIdAbsent,
      critical_blocker_n: uniqueBlockers.length,
      critical_blockers: uniqueBlockers.slice(0, 10),
      promotion_path_ready: deploymentSummary.deploy_pass === true,
      manual_paste_ready: deploymentPlanSummary.manual_step_required === true,
      applied_confirmed: deploymentPlanStatus === "APPLIED_CONFIRMED" || deploymentPlanStatus === "APPLIED_CONFIRMED_AUTHORITY_BYPASS" || deploymentPlanStatus === "APPLIED_ACTIVE" || deploymentPlanStatus === "APPLIED_ACTIVE_AUTHORITY_BYPASS",
      applied_pending_signal_confirmation: deploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION" || deploymentPlanStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS",
      applied_pending_bundle_activation: deploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION" || deploymentPlanStatus === "APPLIED_PENDING_BUNDLE_ACTIVATION_AUTHORITY_BYPASS",
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
