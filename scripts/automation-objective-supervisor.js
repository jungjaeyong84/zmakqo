#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveBestFebtTuningContract, deriveBestFebtMarketContracts, buildSelfEvolutionPolicySpec } = require("./lib/best-febt-supervisor");
const {
  deriveDatasetObjectiveScore,
  deriveMarketObjectiveScores,
  deriveMarketConcentrationDiagnostics,
  deriveCanonicalParityDiagnostics,
  deriveCanonicalProvenanceDiagnostics,
  deriveServerPrimaryCanaryDiagnostics,
  derivePineShadowDriftDiagnostics,
  deriveAttribution,
} = require("../src/utils/bestSelfEvolutionAnalysis");
const { buildMemoryLedger } = require("../src/utils/bestSelfEvolutionMemoryLedger");
const { deriveDeploymentGuards } = require("../src/utils/bestSelfEvolutionDeploymentGuards");
const { deriveDeploymentPlan } = require("../src/utils/bestSelfEvolutionDeploymentPlan");
const { deriveLoopMonitor } = require("../src/utils/bestSelfEvolutionLoopMonitor");
const { deriveWeightTuningPlan } = require("../src/utils/bestSelfEvolutionWeightTuning");
const { summarizeProvisionalRealizedOutcome } = require("../src/utils/provisionalRealizedOutcome");
const { summarizeOpenclawOverrideAuthority } = require("../src/utils/openclawOverrideAuthority");
const { summarizeExecutionQuality } = require("../src/utils/executionQuality");
const { summarizeReversePolicy } = require("../src/utils/reversePolicy");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { resolveMarketStateSummary } = require("../src/utils/marketStateSummary");
const { resolveStatPhysFeatures } = require("../src/utils/statPhysFeatures");
const { normalizePreparedOverride } = require("../src/utils/selfEvolutionPreparedOverride");
const { normalizePlanStatus } = require("../src/utils/selfEvolutionPlanStatus");
const { resolveSelfEvolutionRuntimeState } = require("../src/utils/selfEvolutionRuntimeState");
const {
  buildOpenClawMarketRegimeRows,
  buildOpenClawMarketRegimeSummary,
} = require("../src/utils/openclawMarketRegimeBoard");

loadLocalEnv();

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}

const GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
const CHANGE_CONTROL_LATEST_PATH = resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json");
const CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json");
const ML_LATEST_PATH = path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json");
const EV_LATEST_PATH = resolveLatestArtifactPath("ev_composite_threshold_tune_latest.json", "ev_tp1_threshold_tune_latest.json");
const WAIT_LATEST_PATH = path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json");
const FEBT_PHASE0_LATEST_PATH = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json");
const SELF_EVOLUTION_DATASET_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
const SELF_EVOLUTION_OBJECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
const SELF_EVOLUTION_MARKET_OBJECTIVE_SCORE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const SELF_EVOLUTION_SERVER_VS_PINE_PERFORMANCE_DELTA_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json");
const SELF_EVOLUTION_EXPLORATION_BUDGET_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
const SELF_EVOLUTION_SERVER_MARKET_CAPITAL_ALLOCATOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");
const SELF_EVOLUTION_SERVER_MARKET_QUARANTINE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json");
const SELF_EVOLUTION_EXPLORATION_PROPOSAL_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_proposal_latest.json");
const SELF_EVOLUTION_EXPLORATION_APPLY_CANDIDATE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_apply_candidate_latest.json");
const SELF_EVOLUTION_CHANGE_RESULT_ATTRIBUTION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_change_result_attribution_latest.json");
const SELF_EVOLUTION_ATTRIBUTION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_attribution_latest.json");
const SELF_EVOLUTION_CANDIDATES_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json");
const SELF_EVOLUTION_REPLAY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json");
const SELF_EVOLUTION_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json");
const SELF_EVOLUTION_CANONICAL_PARITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");
const SELF_EVOLUTION_SERVER_SIGNAL_AUTHORITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json");
const SELF_EVOLUTION_SERVER_SIGNAL_QUALITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json");
const SELF_EVOLUTION_SERVER_SIGNAL_CUTOVER_READINESS_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json");
const SELF_EVOLUTION_DROP_VALIDATION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json");
const SELF_EVOLUTION_PROVISIONAL_REALIZED_OUTCOME_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_provisional_realized_outcome_latest.json");
const SELF_EVOLUTION_OVERRIDE_AUTHORITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_override_authority_latest.json");
const SELF_EVOLUTION_EXECUTION_QUALITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const SELF_EVOLUTION_REVERSE_POLICY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
const SELF_EVOLUTION_SERVER_PRIMARY_LEARNING_EPOCH_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");
const SELF_EVOLUTION_INITIAL_SIGNAL_QUALITY_CONTRACT_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_initial_signal_quality_contract_latest.json");
const SELF_EVOLUTION_EXIT_TRAILING_CONTRACT_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exit_trailing_contract_latest.json");
const SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_COMPARISON_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_comparison_latest.json");
const SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_GOVERNOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_governor_latest.json");
const SELF_EVOLUTION_CANONICAL_PROVENANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.json");
const SELF_EVOLUTION_SERVER_PRIMARY_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json");
const SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_WATCH_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json");
const SELF_EVOLUTION_PINE_SHADOW_DRIFT_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_pine_shadow_drift_latest.json");
const CURRENT_VERSION_PINE_SYNC_LATEST_PATH = path.join(OPS_DAILY_DIR, "current_version_pine_sync_latest.json");
const SELF_EVOLUTION_DEPLOYMENT_PROBE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_probe_latest.json");
const SELF_EVOLUTION_BUNDLE_ACTIVATION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json");
const SELF_EVOLUTION_OPENCLAW_AUTONOMY_CONTRACT_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json");
const SELF_EVOLUTION_OBJECTIVE_RECOVERY_GOVERNOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json");
const SELF_EVOLUTION_OBJECTIVE_RECOVERY_EFFECT_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.json");
const SELF_EVOLUTION_EV_GATE_RESCUE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_rescue_latest.json");
const SELF_EVOLUTION_MEMORY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json");
const WEEKLY_PINE_HISTORY_PATH = path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json");
const CODEX_PATCH_LATEST_PATH = selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json");
const STAGE_AUTOPILOT_LATEST_PATH = path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json");
const RETROSPECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json");
const SELF_EVOLUTION_MANUAL_PASTE_ACK_LATEST_PATH = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json");
const SELF_EVOLUTION_PREPARED_OVERRIDE_PATH = path.join(OPS_RUNTIME_DIR, "self_evolution_prepared_override.json");
const SIGNALS_CACHE_LATEST_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const SELF_EVOLUTION_REPORT_LATEST_JSON = selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json");
const SELF_EVOLUTION_REPORT_LATEST_MD = selfEvolutionSnapshotLatestPath("objective_supervisor_latest.md");
const FRESHNESS_HOURS = Object.freeze({
  governance: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_GOVERNANCE_MAX_AGE_HOURS || 30)),
  changeControl: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_CHANGE_CONTROL_MAX_AGE_HOURS || 36)),
  canary: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_CANARY_MAX_AGE_HOURS || 12)),
  ml: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_ML_MAX_AGE_HOURS || 12)),
  ev: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_EV_MAX_AGE_HOURS || 24)),
  wait: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_WAIT_MAX_AGE_HOURS || 144)),
  phase0: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_FEBT_PHASE0_MAX_AGE_HOURS || 36)),
  selfEvolutionDataset: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_DATASET_MAX_AGE_HOURS || 36)),
  selfEvolutionObjective: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OBJECTIVE_MAX_AGE_HOURS || 36)),
  selfEvolutionMarketObjectiveScore: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_MARKET_OBJECTIVE_SCORE_MAX_AGE_HOURS || 36)),
  selfEvolutionServerVsPinePerformanceDelta: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_VS_PINE_PERFORMANCE_DELTA_MAX_AGE_HOURS || 36)),
  selfEvolutionExplorationBudget: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EXPLORATION_BUDGET_MAX_AGE_HOURS || 36)),
  selfEvolutionServerMarketCapitalAllocator: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_MARKET_CAPITAL_ALLOCATOR_MAX_AGE_HOURS || 36)),
  selfEvolutionServerMarketQuarantine: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_MARKET_QUARANTINE_MAX_AGE_HOURS || 36)),
  selfEvolutionExplorationProposal: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EXPLORATION_PROPOSAL_MAX_AGE_HOURS || 36)),
  selfEvolutionExplorationApplyCandidate: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EXPLORATION_APPLY_CANDIDATE_MAX_AGE_HOURS || 36)),
  selfEvolutionChangeResultAttribution: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CHANGE_RESULT_ATTRIBUTION_MAX_AGE_HOURS || 36)),
  selfEvolutionAttribution: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_ATTRIBUTION_MAX_AGE_HOURS || 36)),
  selfEvolutionCandidates: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANDIDATES_MAX_AGE_HOURS || 36)),
  selfEvolutionReplay: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_REPLAY_MAX_AGE_HOURS || 36)),
  selfEvolutionCanary: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANARY_MAX_AGE_HOURS || 36)),
  selfEvolutionCanonicalParity: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANONICAL_PARITY_MAX_AGE_HOURS || 36)),
  selfEvolutionServerSignalAuthority: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_SIGNAL_AUTHORITY_MAX_AGE_HOURS || 36)),
  selfEvolutionServerSignalQuality: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_SIGNAL_QUALITY_MAX_AGE_HOURS || 36)),
  selfEvolutionServerSignalCutoverReadiness: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_SIGNAL_CUTOVER_MAX_AGE_HOURS || 36)),
  selfEvolutionDropValidation: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_DROP_VALIDATION_MAX_AGE_HOURS || 36)),
  selfEvolutionProvisionalRealizedOutcome: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_PROVISIONAL_REALIZED_OUTCOME_MAX_AGE_HOURS || 36)),
  selfEvolutionOverrideAuthority: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OVERRIDE_AUTHORITY_MAX_AGE_HOURS || 36)),
  selfEvolutionExecutionQuality: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EXECUTION_QUALITY_MAX_AGE_HOURS || 36)),
  selfEvolutionReversePolicy: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_REVERSE_POLICY_MAX_AGE_HOURS || 36)),
  selfEvolutionServerPrimaryLearningEpoch: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_PRIMARY_LEARNING_EPOCH_MAX_AGE_HOURS || 36)),
  selfEvolutionInitialSignalQualityContract: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_INITIAL_SIGNAL_QUALITY_CONTRACT_MAX_AGE_HOURS || 36)),
  selfEvolutionExitTrailingContract: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EXIT_TRAILING_CONTRACT_MAX_AGE_HOURS || 36)),
  selfEvolutionServerNativeHtfModeComparison: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_COMPARISON_MAX_AGE_HOURS || 36)),
  selfEvolutionServerNativeHtfModeGovernor: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_GOVERNOR_MAX_AGE_HOURS || 36)),
  selfEvolutionCanonicalProvenance: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANONICAL_PROVENANCE_MAX_AGE_HOURS || 36)),
  selfEvolutionServerPrimaryCanary: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_PRIMARY_CANARY_MAX_AGE_HOURS || 36)),
  selfEvolutionServerPrimaryAcceptanceWatch: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_WATCH_MAX_AGE_HOURS || 36)),
  selfEvolutionPineShadowDrift: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_PINE_SHADOW_DRIFT_MAX_AGE_HOURS || 36)),
  currentVersionPineSync: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_CURRENT_VERSION_PINE_SYNC_MAX_AGE_HOURS || 24)),
  selfEvolutionBundleActivation: Math.max(6, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_BUNDLE_ACTIVATION_MAX_AGE_HOURS || 24)),
  selfEvolutionOpenclawAutonomyContract: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OPENCLAW_AUTONOMY_CONTRACT_MAX_AGE_HOURS || 36)),
  selfEvolutionObjectiveRecoveryGovernor: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OBJECTIVE_RECOVERY_GOVERNOR_MAX_AGE_HOURS || 36)),
  selfEvolutionObjectiveRecoveryEffect: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OBJECTIVE_RECOVERY_EFFECT_MAX_AGE_HOURS || 36)),
  selfEvolutionEvGateRescue: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_EV_GATE_RESCUE_MAX_AGE_HOURS || 36)),
  selfEvolutionMemory: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_MEMORY_MAX_AGE_HOURS || 72)),
  weeklyPineHistory: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_WEEKLY_PINE_HISTORY_MAX_AGE_HOURS || 240)),
  codex: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_CODEX_MAX_AGE_HOURS || 48)),
  stageAutopilot: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_STAGE_AUTOPILOT_MAX_AGE_HOURS || 12)),
  retrospective: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_RETROSPECTIVE_MAX_AGE_HOURS || 30)),
});

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedNum(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function signedPct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  const text = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : ""}${text}%`;
}

function renderSummaryLine(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row) => `${row.key} ${row.count}`)
    .join(" / ") || "N/A";
}

function renderCoverageLine(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row) => `${row.key} ${row.with_febt_n}/${row.eligible_n} (${pct(row.coverage_rate)})`)
    .join(" / ") || "N/A";
}

function parseArtifactTimestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.endsWith(" KST")
    ? `${raw.slice(0, -4).replace(" ", "T")}+09:00`
    : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function extractArtifactGeneratedAtMs(data) {
  const raw = data && data.raw && typeof data.raw === "object" ? data.raw : data;
  const display = data && data.display && typeof data.display === "object" ? data.display : null;
  return (
    parseArtifactTimestampMs(raw && (raw.generated_at_kst || raw.generated_at))
    || parseArtifactTimestampMs(display && (display.generated_at_kst || display.generated_at))
    || null
  );
}

function resolveDisplayCandidateId(candidateId, changeControl = null) {
  const raw = String(candidateId || "").trim();
  if (!raw) return null;
  const display = String(
    changeControl
    && changeControl.auto_promotion
    && changeControl.auto_promotion.display_candidate_id
    || ""
  ).trim();
  if (
    display
    && String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id || "").trim() === raw
  ) return display;
  return raw;
}

function readArtifact(name, filePath, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) {
    return { name, filePath, data: null, exists: false, fresh: false, ageHours: null };
  }
  try {
    const st = fs.statSync(filePath);
    const generatedAtMs = extractArtifactGeneratedAtMs(data);
    const referenceMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Number(st.mtimeMs || 0);
    const ageHours = (Date.now() - referenceMs) / (60 * 60 * 1000);
    return {
      name,
      filePath,
      data,
      exists: true,
      ageHours,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
    };
  } catch (_err) {
    return { name, filePath, data, exists: true, fresh: false, ageHours: null };
  }
}

function unwrapArtifactPayload(artifact = null) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return artifact;
  if (artifact.raw && typeof artifact.raw === "object" && !Array.isArray(artifact.raw)) return artifact.raw;
  if (artifact.display && typeof artifact.display === "object" && !Array.isArray(artifact.display)) return artifact.display;
  return artifact;
}

function readCycleId(value = null) {
  const raw = value && value.raw && typeof value.raw === "object" ? value.raw : value;
  const cycleId = String(raw && (raw.cycle_id || raw.generation_id) || "").trim();
  return cycleId || null;
}

const SELF_EVOLUTION_STAGE_KEYS = Object.freeze({
  SEED: ["dataset"],
  INTEGRATED: ["dataset", "objective", "provisionalRealizedOutcome", "overrideAuthority", "executionQuality", "reversePolicy", "marketObjectiveScore", "serverVsPinePerformanceDelta", "explorationBudget", "explorationProposal", "explorationApplyCandidate", "attribution", "candidates", "replay", "canary", "canonicalParity", "canonicalProvenance", "serverPrimaryCanary", "serverPrimaryAcceptanceWatch", "pineShadowDrift", "deploymentProbe", "bundleActivation", "openclawAutonomyContract", "objectiveRecoveryGovernor", "objectiveRecoveryEffect", "memory", "codex"],
  FINAL: ["dataset", "objective", "provisionalRealizedOutcome", "overrideAuthority", "executionQuality", "reversePolicy", "marketObjectiveScore", "serverVsPinePerformanceDelta", "explorationBudget", "explorationProposal", "explorationApplyCandidate", "attribution", "candidates", "replay", "canary", "canonicalParity", "canonicalProvenance", "serverPrimaryCanary", "serverPrimaryAcceptanceWatch", "pineShadowDrift", "deploymentProbe", "bundleActivation", "openclawAutonomyContract", "objectiveRecoveryGovernor", "objectiveRecoveryEffect", "memory", "codex"],
  STANDALONE: ["dataset", "objective", "provisionalRealizedOutcome", "overrideAuthority", "executionQuality", "reversePolicy", "marketObjectiveScore", "serverVsPinePerformanceDelta", "explorationBudget", "explorationProposal", "explorationApplyCandidate", "attribution", "candidates", "replay", "canary", "canonicalParity", "canonicalProvenance", "serverPrimaryCanary", "serverPrimaryAcceptanceWatch", "pineShadowDrift", "deploymentProbe", "bundleActivation", "openclawAutonomyContract", "objectiveRecoveryGovernor", "objectiveRecoveryEffect", "memory", "codex", "stageAutopilot"],
});

const SELF_EVOLUTION_DERIVED_CYCLE_KEYS = new Set([
  "marketObjectiveScore",
  "provisionalRealizedOutcome",
  "overrideAuthority",
  "executionQuality",
  "reversePolicy",
  "serverVsPinePerformanceDelta",
  "explorationBudget",
  "explorationProposal",
  "explorationApplyCandidate",
  "openclawAutonomyContract",
  "objectiveRecoveryGovernor",
  "objectiveRecoveryEffect",
]);

function summarizeSelfEvolutionArtifactCycles({ artifacts = {}, stage = "STANDALONE", preferredCycleId = null } = {}) {
  const normalizedStage = String(stage || "STANDALONE").trim().toUpperCase();
  const keys = SELF_EVOLUTION_STAGE_KEYS[normalizedStage] || SELF_EVOLUTION_STAGE_KEYS.STANDALONE;
  const coreKeys = keys.filter((key) => !SELF_EVOLUTION_DERIVED_CYCLE_KEYS.has(key));
  const derivedKeys = keys.filter((key) => SELF_EVOLUTION_DERIVED_CYCLE_KEYS.has(key));
  const rows = keys.map((key) => {
    const artifact = artifacts[key] || {};
    const exists = artifact.exists === true || artifact.data != null;
    return {
      key,
      exists,
      fresh: artifact.fresh === true,
      cycle_id: readCycleId(artifact.data),
    };
  });
  const availableWithCycle = rows.filter((row) => row.exists && row.cycle_id);
  const cycleCounts = availableWithCycle.reduce((acc, row) => {
    acc[row.cycle_id] = (acc[row.cycle_id] || 0) + 1;
    return acc;
  }, {});
  const dominantCycleId = Object.entries(cycleCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
    .map((row) => row[0])[0] || null;
  const expectedCycleId = String(preferredCycleId || "").trim() || dominantCycleId || null;
  const missingKeys = rows.filter((row) => !row.exists).map((row) => row.key);
  const cycleMismatches = expectedCycleId
    ? rows.filter((row) => row.exists && row.cycle_id && row.cycle_id !== expectedCycleId).map((row) => ({ key: row.key, cycle_id: row.cycle_id }))
    : [];
  const cycleIdAbsentKeys = expectedCycleId
    ? rows.filter((row) => row.exists && row.fresh === true && !row.cycle_id).map((row) => row.key)
    : [];
  const coreMissingKeys = missingKeys.filter((key) => coreKeys.includes(key));
  const derivedMissingKeys = missingKeys.filter((key) => derivedKeys.includes(key));
  const coreCycleMismatches = cycleMismatches.filter((row) => coreKeys.includes(row.key));
  const derivedCycleMismatches = cycleMismatches.filter((row) => derivedKeys.includes(row.key));
  const coreCycleIdAbsentKeys = cycleIdAbsentKeys.filter((key) => coreKeys.includes(key));
  const derivedCycleIdAbsentKeys = cycleIdAbsentKeys.filter((key) => derivedKeys.includes(key));
  return {
    available: rows.some((row) => row.exists),
    stage: normalizedStage,
    expected_cycle_id: expectedCycleId,
    required_keys: keys.slice(),
    core_required_keys: coreKeys,
    derived_keys: derivedKeys,
    available_n: rows.filter((row) => row.exists).length,
    missing_key_n: missingKeys.length,
    missing_keys: missingKeys,
    core_missing_key_n: coreMissingKeys.length,
    core_missing_keys: coreMissingKeys,
    derived_missing_key_n: derivedMissingKeys.length,
    derived_missing_keys: derivedMissingKeys,
    cycle_consistent: missingKeys.length === 0 && cycleMismatches.length === 0 && cycleIdAbsentKeys.length === 0,
    core_cycle_consistent: coreMissingKeys.length === 0 && coreCycleMismatches.length === 0 && coreCycleIdAbsentKeys.length === 0,
    cycle_mismatch_n: cycleMismatches.length,
    cycle_mismatches: cycleMismatches,
    core_cycle_mismatch_n: coreCycleMismatches.length,
    core_cycle_mismatches: coreCycleMismatches,
    derived_cycle_mismatch_n: derivedCycleMismatches.length,
    derived_cycle_mismatches: derivedCycleMismatches,
    cycle_id_absent_n: cycleIdAbsentKeys.length,
    cycle_id_absent_keys: cycleIdAbsentKeys,
    core_cycle_id_absent_n: coreCycleIdAbsentKeys.length,
    core_cycle_id_absent_keys: coreCycleIdAbsentKeys,
    derived_cycle_id_absent_n: derivedCycleIdAbsentKeys.length,
    derived_cycle_id_absent_keys: derivedCycleIdAbsentKeys,
    rows,
  };
}

function summarizeRetrospective(retrospective = null) {
  const source = unwrapArtifactPayload(retrospective);
  const activePeriods = Array.isArray(source && source.active_periods)
    ? source.active_periods.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
    : ["DAILY"];
  const periods = source && source.periods && typeof source.periods === "object"
    ? source.periods
    : {};
  const daily = periods.DAILY || null;
  const weekly = periods.WEEKLY || null;
  const monthly = periods.MONTHLY || null;
  const buildRow = (row) => ({
    verdict: String(row && row.objective && row.objective.verdict || "N/A"),
    pass: row && row.objective ? row.objective.pass === true : null,
    executed_n: toNum(row && row.objective && row.objective.executed_n),
    realized_n: toNum(row && row.objective && row.objective.realized_n),
    net_pnl_quote: toNum(row && row.realized_trades && row.realized_trades.net_pnl_quote),
    failed_checks: Array.isArray(row && row.objective && row.objective.failed_checks) ? row.objective.failed_checks : [],
  });
  const dailyRow = buildRow(daily);
  const weeklyRow = buildRow(weekly);
  const monthlyRow = buildRow(monthly);
  const activePeriodSet = new Set(activePeriods);
  const scopedRows = [];
  if (activePeriodSet.has("DAILY")) scopedRows.push(dailyRow);
  if (activePeriodSet.has("WEEKLY")) scopedRows.push(weeklyRow);
  if (activePeriodSet.has("MONTHLY")) scopedRows.push(monthlyRow);
  return {
    available: !!source,
    active_periods: activePeriods,
    daily: dailyRow,
    weekly: weeklyRow,
    monthly: monthlyRow,
    any_fail: scopedRows.some((row) => row.pass === false),
    daily_no_trade: activePeriodSet.has("DAILY") && dailyRow.failed_checks.includes("NO_TRADE_ACTIVITY"),
    daily_zero_idle: activePeriodSet.has("DAILY") && dailyRow.failed_checks.includes("ZERO_KRW_IDLE"),
    daily_scope_no_trade: activePeriodSet.has("DAILY") && dailyRow.failed_checks.includes("NO_TRADE_ACTIVITY"),
    daily_scope_zero_idle: activePeriodSet.has("DAILY") && dailyRow.failed_checks.includes("ZERO_KRW_IDLE"),
    any_no_trade: scopedRows.some((row) => row.failed_checks.includes("NO_TRADE_ACTIVITY")),
    any_zero_idle: scopedRows.some((row) => row.failed_checks.includes("ZERO_KRW_IDLE")),
  };
}

function weightedAvg(rows = [], field, weightField = "executed_n") {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => Number(row && row[weightField] || 0) > 0 && Number.isFinite(toNum(row && row[field])));
  if (!scoped.length) return null;
  const totalWeight = scoped.reduce((acc, row) => acc + Number(row[weightField] || 0), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return scoped.reduce((acc, row) => acc + (Number(row[field] || 0) * Number(row[weightField] || 0)), 0) / totalWeight;
}

function summarizeGovernancePhysics(governance = null) {
  const current = governance && governance.current && typeof governance.current === "object" ? governance.current : {};
  const byTier = current && current.pine_follow_through && current.pine_follow_through.by_tier && typeof current.pine_follow_through.by_tier === "object"
    ? current.pine_follow_through.by_tier
    : {};
  const rows = [byTier.EARLY, byTier.CORE].filter(Boolean);
  const executedN = rows.length
    ? rows.reduce((acc, row) => acc + Number(row && row.executed_n || 0), 0)
    : toNum(current && current.overall && current.overall.executed_n);
  const summary = rows.length ? {
    entropy: weightedAvg(rows, "avg_entropy_score"),
    coherence: weightedAvg(rows, "avg_coherence_score"),
    transitionRisk: weightedAvg(rows, "avg_transition_risk"),
    fieldAlignment: weightedAvg(rows, "avg_field_alignment"),
    domainWallDensity: weightedAvg(rows, "avg_domain_wall_density"),
    susceptibility: weightedAvg(rows, "avg_susceptibility"),
    freeEnergy: weightedAvg(rows, "avg_free_energy"),
  } : {
    entropy: toNum(current && current.overall && current.overall.avg_entropy_score),
    coherence: toNum(current && current.overall && current.overall.avg_coherence_score),
    transitionRisk: toNum(current && current.overall && current.overall.avg_transition_risk),
    fieldAlignment: toNum(current && current.overall && current.overall.avg_field_alignment),
    domainWallDensity: toNum(current && current.overall && current.overall.avg_domain_wall_density),
    susceptibility: toNum(current && current.overall && current.overall.avg_susceptibility),
    freeEnergy: toNum(current && current.overall && current.overall.avg_free_energy),
  };
  const resolved = resolveStatPhysFeatures({
    sp_entropy_score: summary.entropy,
    sp_coherence_score: summary.coherence,
    sp_transition_risk: summary.transitionRisk,
    sp_field_alignment: summary.fieldAlignment,
    sp_domain_wall_density: summary.domainWallDensity,
    sp_susceptibility: summary.susceptibility,
    sp_free_energy: summary.freeEnergy,
  });
  const marketState = resolveMarketStateSummary({
    sp_entropy_score: summary.entropy,
    sp_coherence_score: summary.coherence,
    sp_transition_risk: summary.transitionRisk,
    sp_field_alignment: summary.fieldAlignment,
    sp_domain_wall_density: summary.domainWallDensity,
    sp_susceptibility: summary.susceptibility,
    sp_free_energy: summary.freeEnergy,
  });
  const available = [
    summary.entropy,
    summary.coherence,
    summary.transitionRisk,
    summary.fieldAlignment,
    summary.domainWallDensity,
    summary.susceptibility,
    summary.freeEnergy,
  ].some((v) => Number.isFinite(v));
  let blockReason = null;
  if (resolved.state === "CRITICAL" && Number(executedN || 0) >= 4) blockReason = "STAT_PHYSICS_CRITICAL";
  else if (resolved.state === "DISORDERED" && Number(executedN || 0) >= 8) blockReason = "STAT_PHYSICS_DISORDERED";
  return {
    available,
    executed_n: Number.isFinite(Number(executedN)) ? Number(executedN) : null,
    state: resolved.state || null,
    display_state: resolved.display_state,
    entropy: summary.entropy,
    coherence: summary.coherence,
    transition_risk: summary.transitionRisk,
    field_alignment: summary.fieldAlignment,
    domain_wall_density: summary.domainWallDensity,
    susceptibility: summary.susceptibility,
    free_energy: summary.freeEnergy,
    block_reason: blockReason,
    action: marketState.physicsAction || "ALLOW",
    qty_scale: Number.isFinite(Number(marketState.physicsQtyScale)) ? Number(marketState.physicsQtyScale) : null,
    wait_assist: marketState.waitAssist === true,
    wait_hard: marketState.waitHard === true,
  };
}

function topBreakdownValue(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0] || {};
  const value = row.value != null ? row.value : row.key;
  const text = String(value || "").trim();
  return text || null;
}

function summarizeFebtByTier(byTier = {}) {
  const rows = Object.values(byTier || {}).filter((row) => row && typeof row === "object");
  const executed = rows.reduce((acc, row) => acc + Number(row.executed_n || 0), 0);
  const calcOk = rows.reduce((acc, row) => acc + Number(row.febt_calc_ok_n || 0), 0);
  const phaseKnown = rows.reduce((acc, row) => acc + Number(row.febt_phase_known_n || 0), 0);
  const fire = rows.reduce((acc, row) => acc + Number(row.febt_fire_n || 0), 0);
  const late = rows.reduce((acc, row) => acc + Number(row.febt_late_n || 0), 0);
  const voidN = rows.reduce((acc, row) => acc + Number(row.febt_void_n || 0), 0);
  const missing = rows.reduce((acc, row) => acc + Number(row.febt_payload_missing_n || 0), 0);
  const disagreement = rows.reduce((acc, row) => acc + Number(row.febt_disagreement_n || 0), 0);
  const fallbackLegacy = rows.reduce((acc, row) => acc + Number(row.febt_fallback_legacy_n || 0), 0);
  return {
    executed,
    calc_ok_rate: executed > 0 ? (calcOk / executed) : null,
    phase_known: phaseKnown,
    fire,
    late,
    void_n: voidN,
    disagreement,
    fallback_legacy: fallbackLegacy,
    missing_rate: executed > 0 ? (missing / executed) : null,
  };
}

function summarizeSelfEvolutionDataset(dataset = null) {
  const summary = dataset && dataset.summary && typeof dataset.summary === "object"
    ? dataset.summary
    : {};
  return {
    available: !!dataset,
    rows_n: toNum(summary.rows_n) || 0,
    executed_n: toNum(summary.executed_n) || 0,
    drop_n: toNum(summary.drop_n) || 0,
    missed_n: toNum(summary.missed_n) || 0,
    fallback_n: toNum(summary.fallback_n) || 0,
    rejected_n: toNum(summary.rejected_n) || 0,
    partial_n: toNum(summary.partial_n) || 0,
    realized_n: toNum(summary.realized_n) || 0,
    features_coverage_rate: toNum(summary.features_coverage_rate),
    febt_coverage_rate: toNum(summary.febt_coverage_rate),
    febt_eligible_n: toNum(summary.febt_eligible_n) || 0,
    febt_coverage_rate_eligible: toNum(summary.febt_coverage_rate_eligible),
    febt_active_eligible_n: toNum(summary.febt_active_eligible_n) || 0,
    febt_coverage_rate_active_eligible: toNum(summary.febt_coverage_rate_active_eligible),
    febt_active_missing_n: toNum(summary.febt_active_missing_n) || 0,
    active_entry_n: toNum(summary.active_entry_n) || 0,
    legacy_entry_n: toNum(summary.legacy_entry_n) || 0,
    active_entry_family_counts: Array.isArray(summary.active_entry_family_counts) ? summary.active_entry_family_counts : [],
    avg_realized_ret_net: toNum(summary.avg_realized_ret_net),
    avg_realized_pnl_quote: toNum(summary.avg_realized_pnl_quote),
    avg_hold_minutes: toNum(summary.avg_hold_minutes),
    entry_pending_total_n: toNum(summary.entry_pending_total_n) || 0,
    entry_executed_null_realized_n: toNum(summary.entry_executed_null_realized_n) || 0,
    entry_fallback_pending_n: toNum(summary.entry_fallback_pending_n) || 0,
    entry_fallback_payload_missing_n: toNum(summary.entry_fallback_payload_missing_n) || 0,
    entry_fallback_payload_missing_linked_n: toNum(summary.entry_fallback_payload_missing_linked_n) || 0,
    entry_fallback_pending_active_n: toNum(summary.entry_fallback_pending_active_n) || 0,
    entry_fallback_pending_active_by_family: Array.isArray(summary.entry_fallback_pending_active_by_family)
      ? summary.entry_fallback_pending_active_by_family
      : [],
    entry_exit_present_unlabeled_n: toNum(summary.entry_exit_present_unlabeled_n) || 0,
    entry_open_pending_n: toNum(summary.entry_open_pending_n) || 0,
    entry_link_missing_n: toNum(summary.entry_link_missing_n) || 0,
  };
}

function summarizeSelfEvolutionObjective(report = null) {
  const global = report && report.global_objective_score && typeof report.global_objective_score === "object"
    ? report.global_objective_score
    : {};
  const markets = Array.isArray(report && report.market_objective_scores) ? report.market_objective_scores : [];
  const concentration = report && report.market_concentration && typeof report.market_concentration === "object"
    ? report.market_concentration
    : deriveMarketConcentrationDiagnostics({
      globalObjectiveScore: global.objective_score,
      marketObjectiveScores: markets,
    });
  return {
    available: !!report,
    objective_score: toNum(global.objective_score),
    profit_score: toNum(global.components && global.components.profit_score),
    count_score: toNum(global.components && global.components.count_score),
    replacement_score: toNum(global.components && global.components.replacement_score),
    tp1_score: toNum(global.components && global.components.tp1_score),
    drawdown_penalty: toNum(global.components && global.components.drawdown_penalty),
    latency_penalty: toNum(global.components && global.components.latency_penalty),
    instability_penalty: toNum(global.components && global.components.instability_penalty),
    count_floor_pass: global.constraints && typeof global.constraints.count_floor_pass === "boolean" ? global.constraints.count_floor_pass : null,
    replacement_floor_pass: global.constraints && typeof global.constraints.replacement_floor_pass === "boolean" ? global.constraints.replacement_floor_pass : null,
    latency_budget_pass: global.constraints && typeof global.constraints.latency_budget_pass === "boolean" ? global.constraints.latency_budget_pass : null,
    cohort_scope: String(global.snapshot && global.snapshot.cohort_scope || "").trim() || null,
    rows_n: toNum(global.snapshot && global.snapshot.rows_n),
    executed_n: toNum(global.snapshot && global.snapshot.executed_n),
    strict_executed_n: toNum(global.snapshot && global.snapshot.strict_executed_n),
    partial_n: toNum(global.snapshot && global.snapshot.partial_n),
    fallback_n: toNum(global.snapshot && global.snapshot.fallback_n),
    realized_n: toNum(global.snapshot && global.snapshot.realized_n),
    fire_n: toNum(global.snapshot && global.snapshot.fire_n),
    fire_win_rate: toNum(global.snapshot && global.snapshot.fire_win_rate),
    tp1_first_rate: toNum(global.snapshot && global.snapshot.tp1_first_rate),
    win_rate: toNum(global.snapshot && global.snapshot.win_rate),
    avg_realized_ret_net: toNum(global.snapshot && global.snapshot.avg_realized_ret_net),
    missing_rate: toNum(global.snapshot && global.snapshot.missing_rate),
    projected_count_ratio_global: toNum(global.snapshot && global.snapshot.projected_count_ratio_global),
    projected_replacement_ratio: toNum(global.snapshot && global.snapshot.projected_replacement_ratio),
    top_market: markets[0] || null,
    bottom_market: markets.length ? markets[markets.length - 1] : null,
    market_concentration: concentration,
    market_objective_scores: markets,
  };
}

function summarizeSelfEvolutionMarketObjectiveScore(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.by_market) ? report.by_market : [];
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    global_objective_score: toNum(summary.global_objective_score),
    market_n: toNum(summary.market_n) || 0,
    active_market_n: toNum(summary.active_market_n) || 0,
    concentration_flag: summary.concentration_flag === true,
    dominant_negative_market: summary.dominant_negative_market && typeof summary.dominant_negative_market === "object"
      ? summary.dominant_negative_market
      : null,
    dominant_negative_share: toNum(summary.dominant_negative_share),
    top_positive_market: String(summary.top_positive_market || "").trim().toUpperCase() || null,
    top_positive_objective_score: toNum(summary.top_positive_objective_score),
    top_drag_market: String(summary.top_drag_market || "").trim().toUpperCase() || null,
    top_drag_objective_score: toNum(summary.top_drag_objective_score),
    top_recovery_market: String(summary.top_recovery_market || "").trim().toUpperCase() || null,
    top_recovery_objective_score: toNum(summary.top_recovery_objective_score),
    top_recovery_drop_action: String(summary.top_recovery_drop_action || "").trim().toUpperCase() || null,
    top_recovery_drop_reason: String(summary.top_recovery_drop_reason || "").trim().toUpperCase() || null,
    top_recovery_avg_horizon_pnl_quote_proxy: toNum(summary.top_recovery_avg_horizon_pnl_quote_proxy),
    runtime_exec_tf: String(summary.runtime_exec_tf || "").trim() || null,
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
    by_market: rows,
  };
}

function summarizeSelfEvolutionServerVsPinePerformanceDelta(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.by_market) ? report.by_market : [];
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    active_market_n: toNum(summary.active_market_n) || 0,
    parity_mismatch_rate: toNum(summary.parity_mismatch_rate),
    parity_mismatch_n: toNum(summary.parity_mismatch_n) || 0,
    authoritative_server_24h_n: toNum(summary.authoritative_server_24h_n) || 0,
    pine_shadow_24h_n: toNum(summary.pine_shadow_24h_n) || 0,
    authoritative_entry_signal_24h_n: toNum(summary.authoritative_entry_signal_24h_n) || 0,
    order_intent_24h_n: toNum(summary.order_intent_24h_n) || 0,
    fill_24h_n: toNum(summary.fill_24h_n) || 0,
    avg_active_delta_score: toNum(summary.avg_active_delta_score),
    top_server_edge_market: String(summary.top_server_edge_market || "").trim().toUpperCase() || null,
    top_server_edge_score: toNum(summary.top_server_edge_score),
    top_shadow_gap_market: String(summary.top_shadow_gap_market || "").trim().toUpperCase() || null,
    top_shadow_gap_score: toNum(summary.top_shadow_gap_score),
    top_shadow_gap_reason: String(summary.top_shadow_gap_reason || "").trim().toUpperCase() || null,
    top_shadow_gap_action: String(summary.top_shadow_gap_action || "").trim().toUpperCase() || null,
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
    by_market: rows,
  };
}

function summarizeSelfEvolutionOverrideAuthority(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    max_market_overrides_per_cycle: toNum(summary.max_market_overrides_per_cycle),
    risk_override_enabled: summary.risk_override_enabled === true,
    top_priority_markets: Array.isArray(summary.top_priority_markets) ? summary.top_priority_markets : [],
    execution_quality_penalty_markets: Array.isArray(summary.execution_quality_penalty_markets) ? summary.execution_quality_penalty_markets : [],
    reverse_policy_penalty_markets: Array.isArray(summary.reverse_policy_penalty_markets) ? summary.reverse_policy_penalty_markets : [],
  };
}

function summarizeSelfEvolutionExecutionQuality(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object"
    ? raw.summary
    : summarizeExecutionQuality();
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    created_to_fill_p95_ms: toNum(summary.created_to_fill_p95_ms),
    adverse_slippage_p95_bps: toNum(summary.adverse_slippage_p95_bps),
    partial_fill_rate_pct: toNum(summary.partial_fill_rate_pct),
    webhook_to_fill_p95_ms: toNum(summary.webhook_to_fill_p95_ms),
    top_latency_market: String(summary.top_latency_market || "").trim().toUpperCase() || null,
    top_slippage_market: String(summary.top_slippage_market || "").trim().toUpperCase() || null,
    top_partial_market: String(summary.top_partial_market || "").trim().toUpperCase() || null,
    review_reasons: Array.isArray(summary.review_reasons) ? summary.review_reasons : [],
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
  };
}

function summarizeSelfEvolutionReversePolicy(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object"
    ? raw.summary
    : summarizeReversePolicy();
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    reverse_drop_n: toNum(summary.reverse_drop_n) || 0,
    reverse_blocked_n: toNum(summary.reverse_blocked_n) || 0,
    reverse_cooldown_n: toNum(summary.reverse_cooldown_n) || 0,
    reverse_revive_n: toNum(summary.reverse_revive_n) || 0,
    reverse_revive_rate: toNum(summary.reverse_revive_rate),
    top_watch_market: String(summary.top_watch_market || "").trim().toUpperCase() || null,
    top_watch_reason: String(summary.top_watch_reason || "").trim().toUpperCase() || null,
    top_watch_action: String(summary.top_watch_action || "").trim().toUpperCase() || null,
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
  };
}

function summarizeSelfEvolutionServerPrimaryLearningEpoch(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    learning_focus: String(summary.learning_focus || "").trim().toUpperCase() || null,
    active: summary.active === true,
    age_days: toNum(summary.age_days),
    learning_window_days: toNum(summary.learning_window_days),
    penalty_weight: toNum(summary.penalty_weight),
    sample_weight: toNum(summary.sample_weight),
    exploration_boost: toNum(summary.exploration_boost),
    realized_sample_floor_scale: toNum(summary.realized_sample_floor_scale),
    source_mode: String(summary.source_mode || "").trim().toUpperCase() || null,
  };
}

function summarizeSelfEvolutionExplorationBudget(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    production_slot_n: toNum(summary.production_slot_n),
    exploration_slot_n: toNum(summary.exploration_slot_n),
    production_markets: Array.isArray(summary.production_markets) ? summary.production_markets : [],
    exploration_markets: Array.isArray(summary.exploration_markets) ? summary.exploration_markets : [],
    deferred_penalty_markets: Array.isArray(summary.deferred_penalty_markets) ? summary.deferred_penalty_markets : [],
    top_production_market: String(summary.top_production_market || "").trim().toUpperCase() || null,
    top_exploration_market: String(summary.top_exploration_market || "").trim().toUpperCase() || null,
  };
}

function summarizeSelfEvolutionExplorationProposal(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    proposal_n: toNum(summary.proposal_n) || 0,
    top_market: String(summary.top_market || "").trim().toUpperCase() || null,
    top_stage: String(summary.top_stage || "").trim().toUpperCase() || null,
    top_action: String(summary.top_action || "").trim().toUpperCase() || null,
    proposals: Array.isArray(summary.proposals) ? summary.proposals : [],
  };
}

function summarizeSelfEvolutionExplorationApplyCandidate(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    candidate_n: toNum(summary.candidate_n) || 0,
    manual_confirm_required: summary.manual_confirm_required === true,
    auto_apply_allowed: summary.auto_apply_allowed === true,
    max_market_apply_per_cycle: toNum(summary.max_market_apply_per_cycle) || 0,
    top_market: String(summary.top_market || "").trim().toUpperCase() || null,
    top_stage: String(summary.top_stage || "").trim().toUpperCase() || null,
    top_action: String(summary.top_action || "").trim().toUpperCase() || null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    candidates: Array.isArray(summary.candidates) ? summary.candidates : [],
  };
}

function summarizeSelfEvolutionChangeResultAttribution(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    tracked_change_n: toNum(summary.tracked_change_n) || 0,
    evaluated_24h_n: toNum(summary.evaluated_24h_n) || 0,
    evaluated_72h_n: toNum(summary.evaluated_72h_n) || 0,
    partial_window_n: toNum(summary.partial_window_n) || 0,
    pending_window_n: toNum(summary.pending_window_n) || 0,
    top_positive_change: summary.top_positive_change && typeof summary.top_positive_change === "object" ? summary.top_positive_change : null,
    top_adverse_change: summary.top_adverse_change && typeof summary.top_adverse_change === "object" ? summary.top_adverse_change : null,
    top_pending_change: summary.top_pending_change && typeof summary.top_pending_change === "object" ? summary.top_pending_change : null,
    top_watch_changes: Array.isArray(summary.top_watch_changes) ? summary.top_watch_changes : [],
  };
}

function summarizeSelfEvolutionExplorationBudget(report = null) {
  const raw = report && typeof report === "object"
    ? ((report.raw && typeof report.raw === "object") ? report.raw : report)
    : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    production_slot_n: toNum(summary.production_slot_n),
    exploration_slot_n: toNum(summary.exploration_slot_n),
    production_markets: Array.isArray(summary.production_markets) ? summary.production_markets : [],
    exploration_markets: Array.isArray(summary.exploration_markets) ? summary.exploration_markets : [],
    deferred_penalty_markets: Array.isArray(summary.deferred_penalty_markets) ? summary.deferred_penalty_markets : [],
    top_production_market: String(summary.top_production_market || "").trim().toUpperCase() || null,
    top_exploration_market: String(summary.top_exploration_market || "").trim().toUpperCase() || null,
  };
}

function resolveSelfEvolutionRealizedMinSample() {
  const configured = toNum(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_REALIZED_MIN_SAMPLE);
  return Number.isFinite(configured) && configured > 0 ? configured : 8;
}

function resolveGovernanceRealizedMinSample(governance = null, objective = null) {
  const configured = toNum(process.env.OBJECTIVE_SUPERVISOR_GOVERNANCE_REALIZED_MIN_SAMPLE);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const objectiveCfg = governance && governance.objective && typeof governance.objective === "object"
    ? governance.objective
    : {};
  const configuredMin = toNum(objectiveCfg.realized_min_sample);
  if (Number.isFinite(configuredMin) && configuredMin > 0) return configuredMin;
  const objectiveMin = toNum(objective && objective.realized_min_sample);
  if (Number.isFinite(objectiveMin) && objectiveMin > 0) return objectiveMin;
  return 8;
}

function normalizeGovernanceFailedChecks(failedChecks = [], { strictEnoughSample = false, effectiveEnoughSample = false } = {}) {
  const rows = Array.isArray(failedChecks) ? failedChecks : [];
  return rows.map((row) => {
    const value = String(row || "").trim().toUpperCase();
    if (value === "INSUFFICIENT_SAMPLE" && strictEnoughSample !== true && effectiveEnoughSample === true) {
      return "STRICT_SAMPLE_ONLY";
    }
    return value;
  }).filter(Boolean);
}

function summarizeSelfEvolutionAttribution(report = null) {
  const attribution = report && report.attribution && typeof report.attribution === "object"
    ? report.attribution
    : {};
  const summary = attribution.summary && typeof attribution.summary === "object" ? attribution.summary : {};
  return {
    available: !!report,
    drop_top_layer: summary.drop_top_layer || null,
    late_loss_top_market: summary.late_loss_top_market || null,
    false_fire_top_market: summary.false_fire_top_market || null,
    missed_recovery_top_reason: summary.missed_recovery_top_reason || null,
    fallback_cost_top_market: summary.fallback_cost_top_market || null,
    drop_attribution: Array.isArray(attribution.drop_attribution) ? attribution.drop_attribution : [],
    late_loss_attribution: Array.isArray(attribution.late_loss_attribution) ? attribution.late_loss_attribution : [],
    false_fire_attribution: Array.isArray(attribution.false_fire_attribution) ? attribution.false_fire_attribution : [],
    missed_recovery_attribution: Array.isArray(attribution.missed_recovery_attribution) ? attribution.missed_recovery_attribution : [],
    fallback_cost_attribution: Array.isArray(attribution.fallback_cost_attribution) ? attribution.fallback_cost_attribution : [],
  };
}

function summarizeSelfEvolutionCandidates(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    ready_n: toNum(summary.ready_n) || 0,
    blocked_n: toNum(summary.blocked_n) || 0,
    by_scope: summary.by_scope && typeof summary.by_scope === "object" ? summary.by_scope : {},
    top_candidate_id: String(summary.top_candidate_id || "").trim() || null,
    top_scope: String(summary.top_scope || "").trim() || null,
    rows,
  };
}

function summarizeSelfEvolutionReplay(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.validations) ? report.validations : [];
  return {
    available: !!report,
    validation_mode: String(report && report.validation_mode || "N/A"),
    total_n: toNum(summary.total_n) || 0,
    pass_n: toNum(summary.pass_n) || 0,
    warn_n: toNum(summary.warn_n) || 0,
    block_n: toNum(summary.block_n) || 0,
    best_candidate_id: String(summary.best_candidate_id || "").trim() || null,
    best_verdict: String(summary.best_verdict || "").trim() || null,
    best_objective_delta: toNum(summary.best_objective_delta),
    validations: rows,
  };
}

function summarizeSelfEvolutionCanary(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    shadow_n: toNum(summary.shadow_n) || 0,
    soft_n: toNum(summary.soft_n) || 0,
    hard_n: toNum(summary.hard_n) || 0,
    ready_n: toNum(summary.ready_n) || 0,
    blocked_n: toNum(summary.blocked_n) || 0,
    rollback_ready_n: toNum(summary.rollback_ready_n) || 0,
    apply_pass: summary.apply_pass === true,
    global_canary_pass: summary.global_canary_pass === true,
    current_open_wave: toNum(summary.current_open_wave) || 1,
    open_wave: toNum(summary.open_wave) || 1,
    scale_allowed: summary.scale_allowed === true,
    scale_block_reason: String(summary.scale_block_reason || "").trim() || null,
    next_wave_candidate: toNum(summary.next_wave_candidate),
    top_ready_market: String(summary.top_ready_market || "").trim() || null,
    top_rollback_market: String(summary.top_rollback_market || "").trim() || null,
    rows,
  };
}

function summarizeSelfEvolutionEvGateRescue(report = null) {
  const raw = report && report.raw && typeof report.raw === "object" ? report.raw : report;
  const byMarket = Array.isArray(raw && raw.by_market) ? raw.by_market : [];
  const overallCf = raw && raw.counterfactual_reason_overall && typeof raw.counterfactual_reason_overall === "object"
    ? raw.counterfactual_reason_overall
    : null;
  const topMarket = byMarket[0] || null;
  return {
    available: !!raw,
    total_drops: toNum(raw && raw.total_live_active_ev_tp1_drops) || 0,
    rescue_count: toNum(raw && raw.rescue_count) || 0,
    hard_drop_count: toNum(raw && raw.hard_drop_count) || 0,
    rescue_rate: toNum(raw && raw.rescue_rate),
    point_pass_lower_fail_count: toNum(raw && raw.point_pass_lower_fail_count) || 0,
    point_fail_count: toNum(raw && raw.point_fail_count) || 0,
    counterfactual_matured_n: toNum(overallCf && overallCf.matured_n),
    counterfactual_tp1_first_rate: toNum(overallCf && overallCf.tp1_first_rate),
    counterfactual_sl_first_rate: toNum(overallCf && overallCf.sl_first_rate),
    counterfactual_horizon_pos_rate: toNum(overallCf && overallCf.horizon_pos_rate),
    counterfactual_avg_horizon_ret_net: toNum(overallCf && overallCf.avg_horizon_ret_net),
    counterfactual_verdict: String(overallCf && overallCf.verdict || "").trim() || null,
    top_market: String(topMarket && topMarket.market || "").trim() || null,
    top_market_rescue_count: toNum(topMarket && topMarket.rescue) || 0,
    top_market_actual_verdict: String(topMarket && topMarket.actual_verdict || "").trim() || null,
    top_market_actual_avg_horizon_ret_net: toNum(topMarket && topMarket.actual_avg_horizon_ret_net),
  };
}

function summarizeSelfEvolutionMemory(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.current_rows) ? report.current_rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    current_n: toNum(summary.current_n) || 0,
    success_n: toNum(summary.success_n) || 0,
    neutral_n: toNum(summary.neutral_n) || 0,
    fail_n: toNum(summary.fail_n) || 0,
    rolled_back_n: toNum(summary.rolled_back_n) || 0,
    blocked_candidate_n: toNum(summary.blocked_candidate_n) || 0,
    blocked_candidate_ids: Array.isArray(summary.blocked_candidate_ids) ? summary.blocked_candidate_ids : [],
    top_success_candidate_id: String(summary.top_success_candidate_id || "").trim() || null,
    top_failed_candidate_id: String(summary.top_failed_candidate_id || "").trim() || null,
    avg_objective_delta: toNum(summary.avg_objective_delta),
    avg_count_delta: toNum(summary.avg_count_delta),
    avg_replacement_delta: toNum(summary.avg_replacement_delta),
    avg_ret_net_delta: toNum(summary.avg_ret_net_delta),
    fingerprint_block_ttl_weeks: toNum(summary.fingerprint_block_ttl_weeks),
    recent_failed_fingerprints: Array.isArray(summary.recent_failed_fingerprints) ? summary.recent_failed_fingerprints : [],
    latest_week_key: String(summary.latest_week_key || "").trim() || null,
    current_rows: rows,
  };
}

function summarizeSelfEvolutionDeployment(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    deploy_pass: summary.deploy_pass === true,
    rollback_only: summary.rollback_only === true,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    root_cause: String(summary.root_cause || "").trim() || null,
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
    replay_verdict: String(summary.replay_verdict || "").trim().toUpperCase() || null,
    canary_open_wave: toNum(summary.canary_open_wave) || 1,
    market_ready_n: toNum(summary.market_ready_n) || 0,
    market_total_n: toNum(summary.market_total_n) || 0,
    memory_blocked_candidate_n: toNum(summary.memory_blocked_candidate_n) || 0,
    rows,
  };
}

function summarizeSelfEvolutionDeploymentPlan(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  const handoff = report && report.handoff && typeof report.handoff === "object" ? report.handoff : {};
  return {
    available: !!report,
    plan_status: String(summary.plan_status || "").trim().toUpperCase() || null,
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    display_candidate_id: String(summary.display_candidate_id || "").trim() || null,
    rollback_file_path: String(summary.rollback_file_path || "").trim() || null,
    prepare_pass: summary.prepare_pass === true,
    ready_for_manual_paste: summary.ready_for_manual_paste === true,
    manual_step_required: summary.manual_step_required === true,
    open_wave: toNum(summary.open_wave) || 1,
    target_wave: toNum(summary.target_wave) || 1,
    market_scope_n: toNum(summary.market_scope_n) || 0,
    market_scope_ready_n: toNum(summary.market_scope_ready_n) || 0,
    market_scope_blocked_n: toNum(summary.market_scope_blocked_n) || 0,
    prepared_file_path: String(summary.prepared_file_path || "").trim() || null,
    prepared_strategy_id: String(summary.prepared_strategy_id || "").trim() || null,
    latest_generated_file_path: String(summary.latest_generated_file_path || "").trim() || null,
    rollback_source_file_path: String(summary.rollback_source_file_path || "").trim() || null,
    prepared_stage_ready: summary.prepared_stage_ready === true,
    prepared_override_active: summary.prepared_override_active === true,
    prepared_override_source: String(summary.prepared_override_source || "").trim() || null,
    source_week_key: String(summary.source_week_key || "").trim() || null,
    applied_strategy_id: String(summary.applied_strategy_id || "").trim() || null,
    manual_paste_acknowledged: summary.manual_paste_acknowledged === true,
    live_signal_confirmation_pending: summary.live_signal_confirmation_pending === true,
    live_signal_confirmed: summary.live_signal_confirmed === true,
    engine_bundle_loaded: summary.engine_bundle_loaded === true,
    policy_bundle_loaded: summary.policy_bundle_loaded === true,
    market_data_flow_ok: summary.market_data_flow_ok === true,
    first_decision_seen: summary.first_decision_seen === true,
    first_decision_kind: String(summary.first_decision_kind || "").trim().toUpperCase() || null,
    activation_confirmed: summary.activation_confirmed === true,
    activation_pending: summary.activation_pending === true,
    activation_status: String(summary.activation_status || "").trim().toUpperCase() || null,
    activation_reason: String(summary.activation_reason || "").trim().toUpperCase() || null,
    confirmation_deadline_kst: String(summary.confirmation_deadline_kst || "").trim() || null,
    confirmed_signal_id: String(summary.confirmed_signal_id || "").trim() || null,
    confirmed_signal_created_at: String(summary.confirmed_signal_created_at || "").trim() || null,
    deploy_unit_primary: String(summary.deploy_unit_primary || "").trim().toUpperCase() || null,
    deploy_units: Array.isArray(summary.deploy_units) ? summary.deploy_units : [],
    prepared_engine_bundle_id: String(
      summary.prepared_engine_bundle_id
      || (summary.prepared_engine_bundle && summary.prepared_engine_bundle.bundle_id)
      || ""
    ).trim() || null,
    active_engine_bundle_id: String(
      summary.active_engine_bundle_id
      || (summary.active_engine_bundle && summary.active_engine_bundle.bundle_id)
      || ""
    ).trim() || null,
    rollback_engine_bundle_id: String(
      summary.rollback_engine_bundle_id
      || (summary.rollback_engine_bundle && summary.rollback_engine_bundle.bundle_id)
      || ""
    ).trim() || null,
    prepared_policy_bundle_id: String(
      summary.prepared_policy_bundle_id
      || (summary.prepared_policy_bundle && summary.prepared_policy_bundle.bundle_id)
      || ""
    ).trim() || null,
    active_policy_bundle_id: String(
      summary.active_policy_bundle_id
      || (summary.active_policy_bundle && summary.active_policy_bundle.bundle_id)
      || ""
    ).trim() || null,
    prepared_engine_bundle: summary.prepared_engine_bundle && typeof summary.prepared_engine_bundle === "object"
      ? summary.prepared_engine_bundle
      : null,
    active_engine_bundle: summary.active_engine_bundle && typeof summary.active_engine_bundle === "object"
      ? summary.active_engine_bundle
      : null,
    rollback_engine_bundle: summary.rollback_engine_bundle && typeof summary.rollback_engine_bundle === "object"
      ? summary.rollback_engine_bundle
      : null,
    prepared_policy_bundle: summary.prepared_policy_bundle && typeof summary.prepared_policy_bundle === "object"
      ? summary.prepared_policy_bundle
      : null,
    active_policy_bundle: summary.active_policy_bundle && typeof summary.active_policy_bundle === "object"
      ? summary.active_policy_bundle
      : null,
    shadow_pine: summary.shadow_pine && typeof summary.shadow_pine === "object"
      ? summary.shadow_pine
      : null,
    codex_verdict: String(summary.codex_verdict || "").trim().toUpperCase() || null,
    authority_required: summary.authority_required === true,
    authority_approved: summary.authority_approved === true,
    authority_state: String(summary.authority_state || "").trim().toUpperCase() || null,
    external_authority_pending: summary.external_authority_pending === true,
    authority_bypass_active: summary.authority_bypass_active === true,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
    rows,
    handoff: {
      checklist: Array.isArray(handoff.checklist) ? handoff.checklist : [],
      deploy_unit_primary: String(handoff.deploy_unit_primary || "").trim().toUpperCase() || null,
      deploy_units: Array.isArray(handoff.deploy_units) ? handoff.deploy_units : [],
      prepared_engine_bundle: handoff.prepared_engine_bundle && typeof handoff.prepared_engine_bundle === "object"
        ? handoff.prepared_engine_bundle
        : null,
      prepared_policy_bundle: handoff.prepared_policy_bundle && typeof handoff.prepared_policy_bundle === "object"
        ? handoff.prepared_policy_bundle
        : null,
      rollback_engine_bundle: handoff.rollback_engine_bundle && typeof handoff.rollback_engine_bundle === "object"
        ? handoff.rollback_engine_bundle
        : null,
      shadow_pine: handoff.shadow_pine && typeof handoff.shadow_pine === "object"
        ? handoff.shadow_pine
        : null,
      prepared_file_path: String(handoff.prepared_file_path || "").trim() || null,
      latest_generated_file_path: String(handoff.latest_generated_file_path || "").trim() || null,
      rollback_source_file_path: String(handoff.rollback_source_file_path || "").trim() || null,
      candidate_signature: String(handoff.candidate_signature || "").trim() || null,
      prepared_reason: String(handoff.prepared_reason || "").trim() || null,
      next_actions: Array.isArray(handoff.next_actions) ? handoff.next_actions : [],
    },
  };
}

function summarizeSelfEvolutionBundleActivation(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    engine_bundle_loaded: summary.engine_bundle_loaded === true,
    policy_bundle_loaded: summary.policy_bundle_loaded === true,
    market_data_flow_ok: summary.market_data_flow_ok === true,
    first_decision_seen: summary.first_decision_seen === true,
    first_decision_kind: String(summary.first_decision_kind || "").trim().toUpperCase() || null,
    activation_confirmed: summary.activation_confirmed === true,
    activation_pending: summary.activation_pending === true,
    activation_status: String(summary.activation_status || "").trim().toUpperCase() || null,
    activation_reason: String(summary.activation_reason || "").trim().toUpperCase() || null,
    confirmation_deadline_kst: String(summary.confirmation_deadline_kst || "").trim() || null,
  };
}

function summarizeSelfEvolutionDeploymentProbe(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    engine_bundle_loaded: summary.engine_bundle_loaded === true,
    policy_bundle_loaded: summary.policy_bundle_loaded === true,
    market_data_flow_ok: summary.market_data_flow_ok === true,
    probe_pass: summary.probe_pass === true,
    probe_status: String(summary.probe_status || "").trim().toUpperCase() || null,
    probe_reason: String(summary.probe_reason || "").trim().toUpperCase() || null,
  };
}

function summarizeSelfEvolutionLoopMonitor(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    cycle_id: String(summary.cycle_id || report && report.cycle_id || "").trim() || null,
    overall_status: String(summary.overall_status || "").trim().toUpperCase() || null,
    stale_artifact_n: toNum(summary.stale_artifact_n) || 0,
    stale_artifacts: Array.isArray(summary.stale_artifacts) ? summary.stale_artifacts : [],
    cycle_consistent: summary.cycle_consistent === true,
    core_cycle_consistent: summary.core_cycle_consistent === true || (summary.core_cycle_consistent === undefined && summary.cycle_consistent === true),
    cycle_mismatch_n: toNum(summary.cycle_mismatch_n) || 0,
    cycle_mismatches: Array.isArray(summary.cycle_mismatches) ? summary.cycle_mismatches : [],
    core_cycle_mismatch_n: toNum(summary.core_cycle_mismatch_n) || 0,
    core_cycle_mismatches: Array.isArray(summary.core_cycle_mismatches) ? summary.core_cycle_mismatches : [],
    derived_cycle_mismatch_n: toNum(summary.derived_cycle_mismatch_n) || 0,
    derived_cycle_mismatches: Array.isArray(summary.derived_cycle_mismatches) ? summary.derived_cycle_mismatches : [],
    critical_blocker_n: toNum(summary.critical_blocker_n) || 0,
    critical_blockers: Array.isArray(summary.critical_blockers) ? summary.critical_blockers : [],
    promotion_path_ready: summary.promotion_path_ready === true,
    manual_paste_ready: summary.manual_paste_ready === true,
    ready_candidate_id: String(summary.ready_candidate_id || "").trim() || null,
    canary_open_wave: toNum(summary.canary_open_wave) || null,
    loop_n: toNum(summary.loop_n) || 0,
    fresh_loop_n: toNum(summary.fresh_loop_n) || 0,
    rows,
  };
}

function summarizeSelfEvolutionServerSignalAuthority(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    authoritative_server_24h_n: toNum(summary.authoritative_server_24h_n) || 0,
    pine_shadow_24h_n: toNum(summary.pine_shadow_24h_n) || 0,
    parity_mismatch_n: toNum(summary.parity_mismatch_n) || 0,
    parity_mismatch_rate: toNum(summary.parity_mismatch_rate),
    source_mode: String(summary.source_mode || "").trim().toUpperCase() || null,
    drift_status: String(summary.drift_status || "").trim().toUpperCase() || null,
    latest_authoritative_signal_at_kst: String(summary.latest_authoritative_signal_at_kst || "").trim() || null,
    latest_shadow_signal_at_kst: String(summary.latest_shadow_signal_at_kst || "").trim() || null,
  };
}

function summarizeSelfEvolutionServerSignalQuality(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    authoritative_entry_signal_24h_n: toNum(summary.authoritative_entry_signal_24h_n) || 0,
    order_intent_24h_n: toNum(summary.order_intent_24h_n) || 0,
    fill_24h_n: toNum(summary.fill_24h_n) || 0,
    trade_24h_n: toNum(summary.trade_24h_n) || 0,
    intent_conversion_rate: toNum(summary.intent_conversion_rate),
    fill_conversion_rate: toNum(summary.fill_conversion_rate),
    latest_authoritative_entry_signal_at_kst: String(summary.latest_authoritative_entry_signal_at_kst || "").trim() || null,
    quality_status: String(summary.quality_status || "").trim().toUpperCase() || null,
    top_mismatch_scope: summary.top_mismatch_scope && typeof summary.top_mismatch_scope === "object" ? summary.top_mismatch_scope : null,
    top_drop_reason_family: summary.top_drop_reason_family && typeof summary.top_drop_reason_family === "object" ? summary.top_drop_reason_family : null,
  };
}

function summarizeSelfEvolutionServerSignalCutoverReadiness(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    promotion_ready: summary.promotion_ready === true,
    already_server_primary: summary.already_server_primary === true,
    readiness_status: String(summary.readiness_status || "").trim().toUpperCase() || null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    source_mode: String(summary.source_mode || "").trim().toUpperCase() || null,
    runtime_exec_tf: String(summary.runtime_exec_tf || "").trim() || null,
    runtime_market_count: toNum(summary.runtime_market_count) || 0,
    entry_24h_n: toNum(summary.entry_24h_n) || 0,
    intent_24h_n: toNum(summary.intent_24h_n) || 0,
    fill_24h_n: toNum(summary.fill_24h_n) || 0,
    dominant_mismatch_family: String(summary.dominant_mismatch_family || "").trim().toUpperCase() || null,
    recommended_action: String(summary.recommended_action || summary.ev_policy_recommended_action || "").trim().toUpperCase() || null,
    ev_policy_top_rescue_market: String(summary.ev_policy_top_rescue_market || "").trim().toUpperCase() || null,
    blocker_actions: Array.isArray(summary.blocker_actions) ? summary.blocker_actions : [],
  };
}

function summarizeSelfEvolutionDropValidation(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const byFamily = Array.isArray(report && report.by_family) ? report.by_family : [];
  const byMarket = Array.isArray(report && report.by_market) ? report.by_market : [];
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    recent_drop_n: toNum(summary.recent_drop_n) || 0,
    matured_reason_n: toNum(summary.matured_reason_n) || 0,
    family_n: toNum(summary.family_n) || 0,
    rescue_family_n: toNum(summary.rescue_family_n) || 0,
    keep_drop_family_n: toNum(summary.keep_drop_family_n) || 0,
    mixed_family_n: toNum(summary.mixed_family_n) || 0,
    dominant_family: String(summary.dominant_family || "").trim().toUpperCase() || null,
    dominant_verdict: String(summary.dominant_verdict || "").trim().toUpperCase() || null,
    top_rescue_family: String(summary.top_rescue_family || "").trim().toUpperCase() || null,
    top_rescue_reason: String(summary.top_rescue_reason || "").trim().toUpperCase() || null,
    top_rescue_market: String(summary.top_rescue_market || "").trim().toUpperCase() || null,
    top_rescue_avg_horizon_ret_net: toNum(summary.top_rescue_avg_horizon_ret_net),
    top_rescue_avg_horizon_pnl_quote_proxy: toNum(summary.top_rescue_avg_horizon_pnl_quote_proxy),
    top_rescue_net_horizon_pnl_quote_proxy_sum: toNum(summary.top_rescue_net_horizon_pnl_quote_proxy_sum),
    proxy_notional_quote: toNum(summary.proxy_notional_quote),
    top_rescue_tp1_first_rate: toNum(summary.top_rescue_tp1_first_rate),
    top_rescue_sl_first_rate: toNum(summary.top_rescue_sl_first_rate),
    recommended_actions: Array.isArray(summary.recommended_actions) ? summary.recommended_actions : [],
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
    by_family: byFamily,
    by_market: byMarket,
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
    top_rescue_markets: Array.isArray(summary.top_rescue_markets) ? summary.top_rescue_markets : [],
    top_keep_drop_markets: Array.isArray(summary.top_keep_drop_markets) ? summary.top_keep_drop_markets : [],
  };
}

function summarizeSelfEvolutionOpenClawAutonomyContract(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const status = report && report.current_status && typeof report.current_status === "object" ? report.current_status : {};
  return {
    available: !!report,
    goal_state: String(summary.goal_state || "").trim().toUpperCase() || null,
    authority_state: String(summary.authority_state || "").trim().toUpperCase() || null,
    phase_d_status: String(summary.phase_d_status || "").trim().toUpperCase() || null,
    ops_status: String(summary.ops_status || "").trim().toUpperCase() || null,
    degraded_authority_enabled: summary.degraded_authority_enabled === true,
    degraded_authority_min_timeout_streak: toNum(summary.degraded_authority_min_timeout_streak) || null,
    objective_score: toNum(status.objective_score),
    monthly_run_rate_krw: toNum(status.monthly_run_rate_krw),
    win_rate: toNum(status.win_rate),
    objective_met: status.objective_met === true,
    recovery_required: status.recovery_required === true,
    authority_pending: status.authority_pending === true,
    phase_d_acceptance_ready: status.phase_d_acceptance_ready === true,
    phase_d_acceptance_reason: String(status.phase_d_acceptance_reason || "").trim().toUpperCase() || null,
    ops_healthy: status.ops_healthy === true,
    scheduler_mode: String(status.scheduler_mode || "").trim().toUpperCase() || null,
    watchdog_verdict: String(status.watchdog_verdict || "").trim().toUpperCase() || null,
  };
}

function summarizeSelfEvolutionServerPrimaryAcceptanceWatch(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    configured_server_primary_markets_n: toNum(summary.configured_server_primary_markets_n) || 0,
    configured_server_primary_markets: Array.isArray(summary.configured_server_primary_markets) ? summary.configured_server_primary_markets : [],
    observed_n: toNum(summary.observed_n) || 0,
    executed_n: toNum(summary.executed_n) || 0,
    realized_n: toNum(summary.realized_n) || 0,
    min_executed_n: toNum(summary.min_executed_n) || null,
    phase_d_ready: summary.phase_d_ready === true,
    phase_d_status: String(summary.phase_d_status || "").trim().toUpperCase() || null,
    phase_d_reason: String(summary.phase_d_reason || "").trim().toUpperCase() || null,
    disagreement_rate: toNum(summary.disagreement_rate),
    rollback_trigger_n: toNum(summary.rollback_trigger_n) || 0,
  };
}

function summarizeSelfEvolutionObjectiveRecoveryGovernor(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    recovery_required: summary.recovery_required === true,
    objective_score: toNum(summary.objective_score),
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    display_candidate_id: String(summary.display_candidate_id || "").trim() || null,
    target_deploy_unit: String(summary.target_deploy_unit || "").trim().toUpperCase() || null,
    target_migration_class: String(summary.target_migration_class || "").trim().toUpperCase() || null,
    replay_pass: summary.replay_pass === true,
    canary_ready: summary.canary_ready === true,
    deployment_guards_pass: summary.deployment_guards_pass === true,
    memory_blocked: summary.memory_blocked === true,
    openclaw_ops_healthy: summary.openclaw_ops_healthy === true,
    phase_d_status: String(summary.phase_d_status || "").trim().toUpperCase() || null,
    phase_d_ready: summary.phase_d_ready === true,
    governor_status: String(summary.governor_status || "").trim().toUpperCase() || null,
    governor_reason: String(summary.governor_reason || "").trim().toUpperCase() || null,
    degraded_authority_enabled: summary.degraded_authority_enabled === true,
    degraded_authority_eligible: summary.degraded_authority_eligible === true,
    degraded_authority_reason: String(summary.degraded_authority_reason || "").trim().toUpperCase() || null,
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
  };
}

function summarizeSelfEvolutionObjectiveRecoveryEffect(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    available: !!report,
    recovery_required: summary.recovery_required === true,
    tracking_status: String(summary.tracking_status || "").trim().toUpperCase() || null,
    tracking_reason: String(summary.tracking_reason || "").trim().toUpperCase() || null,
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    display_candidate_id: String(summary.display_candidate_id || "").trim() || null,
    current_objective_score: toNum(summary.current_objective_score),
    target_candidate_objective_delta: toNum(summary.target_candidate_objective_delta),
    projected_objective_score: toNum(summary.projected_objective_score),
    gap_closed: toNum(summary.gap_closed),
    gap_closure_rate: toNum(summary.gap_closure_rate),
    projected_on_track: summary.projected_on_track === true,
    projected_win_rate: toNum(summary.projected_win_rate),
    projected_avg_ret_net: toNum(summary.projected_avg_ret_net),
    dominant_negative_market: String(summary.dominant_negative_market || "").trim() || null,
    target_market: String(summary.target_market || "").trim() || null,
    target_matches_dominant_negative_market: summary.target_matches_dominant_negative_market === true,
    best_ready_candidate_id: String(summary.best_ready_candidate_id || "").trim() || null,
    best_replay_candidate_id: String(summary.best_replay_candidate_id || "").trim() || null,
    higher_delta_candidate_available: summary.higher_delta_candidate_available === true,
    higher_delta_candidate_id: String(summary.higher_delta_candidate_id || "").trim() || null,
    higher_delta_candidate_hold_reason: String(summary.higher_delta_candidate_hold_reason || "").trim().toUpperCase() || null,
    retrospective_monthly_failed_checks: Array.isArray(summary.retrospective_monthly_failed_checks) ? summary.retrospective_monthly_failed_checks : [],
    retrospective_monthly_top_drop_reason: String(summary.retrospective_monthly_top_drop_reason || "").trim() || null,
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
  };
}

function summarizeCodexAuthority({
  reportVerdict = "HOLD",
  reportReason = "N/A",
  codexReview = null,
  deploymentPlan = null,
} = {}) {
  const review = codexReview && typeof codexReview === "object" ? codexReview : {};
  const plan = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};
  const authorityMode = review.authority_mode || plan.plan_status || review.verdict || "HOLD";
  return {
    owner: String(review.owner || "CODEX").trim() || "CODEX",
    authority_mode: String(authorityMode || "HOLD").trim().toUpperCase(),
    report_verdict: String(reportVerdict || "HOLD").trim().toUpperCase(),
    report_reason: String(reportReason || "N/A"),
    status: String(review.status || "N/A").trim().toUpperCase() || "N/A",
    verdict: String(review.verdict || "HOLD").trim().toUpperCase() || "HOLD",
    recommended_candidate_id: String(review.recommended_candidate_id || plan.target_candidate_id || "").trim() || null,
    display_candidate_id: String(review.display_candidate_id || plan.display_candidate_id || "").trim() || null,
    recommended_rollback_file_path: String(review.recommended_rollback_file_path || plan.rollback_file_path || "").trim() || null,
    confidence: toNum(review.confidence),
    reason: String(review.reason || reportReason || "N/A"),
    manual_step_required: plan.manual_step_required === true,
    ready_for_manual_paste: plan.ready_for_manual_paste === true,
    prepared_stage_ready: plan.prepared_stage_ready === true,
    deploy_unit_primary: plan.deploy_unit_primary || null,
    prepared_engine_bundle_id: plan.prepared_engine_bundle_id || null,
    prepared_policy_bundle_id: plan.prepared_policy_bundle_id || null,
    rollback_engine_bundle_id: plan.rollback_engine_bundle_id || null,
    prepared_file_path: plan.prepared_file_path || null,
    latest_generated_file_path: plan.latest_generated_file_path || null,
    rollback_source_file_path: plan.rollback_source_file_path || null,
    shadow_pine: plan.shadow_pine || null,
    blockers: Array.isArray(plan.blockers) ? plan.blockers : [],
    codex_review_status: String(review.codex_review && review.codex_review.status || "").trim().toUpperCase() || null,
    claude_review_status: String(review.claude_review && review.claude_review.status || "").trim().toUpperCase() || null,
    codex_review_verdict: String(review.codex_review && review.codex_review.verdict || "").trim().toUpperCase() || null,
    claude_review_verdict: String(review.claude_review && review.claude_review.verdict || "").trim().toUpperCase() || null,
  };
}

function pushPlanStep(steps = [], message) {
  const line = String(message || "").trim();
  if (!line) return;
  if (!steps.includes(line)) steps.push(line);
}

function buildSupervisorActionPlan({
  reason = null,
  blockers = [],
  promotionCandidateId = null,
  promotionReplay = null,
  deployment = null,
  deploymentPlan = null,
  governanceEnoughSample = false,
  codexFresh = false,
  stageAutopilotFresh = false,
  retrospective = null,
  canaryDriftContext = null,
  evTunerContext = null,
  selfEvolutionDatasetSummary = null,
} = {}) {
  const steps = [];
  const blockerSet = new Set(Array.isArray(blockers) ? blockers : []);
  const deploymentSummary = deployment && typeof deployment === "object" ? deployment : {};
  const deploymentPlanSummary = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};

  if (blockerSet.has("DAILY_NO_TRADE_ACTIVITY")) {
    const dailyExecuted = retrospective && retrospective.daily && retrospective.daily.executed_n != null
      ? retrospective.daily.executed_n
      : "N/A";
    pushPlanStep(steps, `Run the loop after real trade activity resumes or move the schedule into active trading hours (retrospective daily executed_n=${dailyExecuted}).`);
  }
  if (blockerSet.has("ZERO_KRW_IDLE")) {
    pushPlanStep(steps, "Restore idle KRW balance before expecting new validation trades.");
  }
  if (blockerSet.has("MONTHLY_TARGET_NOT_MET") || blockerSet.has("OBJECTIVE_NOT_MET") || blockerSet.has("RETROSPECTIVE_MONTHLY_FAIL")) {
    pushPlanStep(steps, "Use the current replay/canary-ready candidate set to recover objective performance before promotion.");
  }
  if (blockerSet.has("CANARY_DRIFT")) {
    const ctx = canaryDriftContext && typeof canaryDriftContext === "object" ? canaryDriftContext : {};
    pushPlanStep(
      steps,
      `Resolve filter canary drift before promotion (shadow=${ctx.shadow_drift ?? 0}, golden=${ctx.golden_drift ?? 0}, top=${ctx.primary_label || "N/A"}).`
    );
  }
  if (evTunerContext && evTunerContext.stale === true) {
    pushPlanStep(
      steps,
      `Refresh EV tuner artifact before trusting filter-4 policy again (age_hours=${evTunerContext.age_hours != null ? evTunerContext.age_hours : "N/A"}, observed=${evTunerContext.observed_reason || "N/A"}).`
    );
  }
  const activeFebtGap = selfEvolutionDatasetSummary && selfEvolutionDatasetSummary.febt_active_coverage_gap_by_event
    ? selfEvolutionDatasetSummary.febt_active_coverage_gap_by_event
    : null;
  if (activeFebtGap && Number(activeFebtGap.coverage_gap || 0) >= 0.25) {
    pushPlanStep(
      steps,
      `Investigate active FEBT coverage gap (${activeFebtGap.low_key} ${pct(activeFebtGap.low_coverage_rate)} vs ${activeFebtGap.high_key} ${pct(activeFebtGap.high_coverage_rate)}).`
    );
  }
  if (blockerSet.has("SELF_EVOLUTION_REPLAY_BLOCK") || blockerSet.has("SELF_EVOLUTION_REPLAY_NOT_PASS")) {
    pushPlanStep(
      steps,
      `Resolve replay blockers for ${promotionCandidateId || "the promotion candidate"}: ${Array.isArray(promotionReplay && promotionReplay.blockers) && promotionReplay.blockers.length ? promotionReplay.blockers.join(", ") : "validation_verdict is not PASS"}.`
    );
  }
  if (Array.isArray(deploymentSummary.next_actions)) {
    deploymentSummary.next_actions.forEach((row) => pushPlanStep(steps, row));
  }
  if (deploymentPlanSummary.prepare_pass !== true && Array.isArray(deploymentPlanSummary.next_actions)) {
    deploymentPlanSummary.next_actions.forEach((row) => pushPlanStep(steps, row));
  }
  if ((reason === "CODEX_REVIEW_REQUIRED_PROMOTION" || reason === "CODEX_REVIEW_REQUIRED_ROLLBACK") && !codexFresh) {
    pushPlanStep(steps, "Refresh Codex review for the current cycle before promotion or rollback.");
  }
  if ((reason === "STAGE_AUTOPILOT_REQUIRED_PROMOTION" || reason === "STAGE_AUTOPILOT_REQUIRED_ROLLBACK") && !stageAutopilotFresh) {
    pushPlanStep(steps, "Refresh stage autopilot for the current cycle before promotion or rollback.");
  }
  if (reason === "GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY" && governanceEnoughSample !== true) {
    pushPlanStep(steps, "Wait for more realized governance trades or increase the effective governance sample source.");
  }
  if (!steps.length && reason) {
    pushPlanStep(steps, `Review the blocker '${reason}' and clear the highest-priority gate before the next loop.`);
  }
  return steps;
}

function summarizeCanaryDriftContext(canary = null) {
  const shadow = canary && canary.shadow && canary.shadow.summary && typeof canary.shadow.summary === "object" ? canary.shadow.summary : {};
  const golden = canary && canary.golden && canary.golden.summary && typeof canary.golden.summary === "object" ? canary.golden.summary : {};
  const pickTop = (map = {}) => {
    let chosen = null;
    for (const [key, value] of Object.entries(map || {})) {
      const drift = toNum(value && value.drift) || 0;
      if (!drift) continue;
      if (!chosen || drift > chosen.drift) chosen = { key, drift };
    }
    return chosen;
  };
  const shadowTopMarket = pickTop(shadow.byMarket);
  const shadowTopStage = pickTop(shadow.byStage);
  const goldenTopMarket = pickTop(golden.byMarket);
  const goldenTopStage = pickTop(golden.byStage);
  const shadowStageEntries = Object.entries(shadow.byStage || {});
  const shadowDriftStages = shadowStageEntries
    .filter(([, value]) => (toNum(value && value.drift) || 0) > 0)
    .map(([key]) => String(key || "").trim().toUpperCase())
    .filter(Boolean);
  const shadowNonAiDrift = shadowStageEntries
    .filter(([key]) => String(key || "").trim().toUpperCase() !== "AI")
    .reduce((acc, [, value]) => acc + (toNum(value && value.drift) || 0), 0);
  const primary = goldenTopStage || goldenTopMarket || shadowTopStage || shadowTopMarket;
  return {
    shadow_drift: toNum(shadow.drift) || 0,
    golden_drift: toNum(golden.drift) || 0,
    shadow_ai_only_drift: (toNum(shadow.drift) || 0) > 0 && (toNum(golden.drift) || 0) === 0 && shadowDriftStages.length > 0 && shadowDriftStages.every((key) => key === "AI"),
    shadow_non_ai_drift: shadowNonAiDrift,
    shadow_drift_stages: shadowDriftStages,
    shadow_top_market: shadowTopMarket ? shadowTopMarket.key : null,
    shadow_top_stage: shadowTopStage ? shadowTopStage.key : null,
    golden_top_market: goldenTopMarket ? goldenTopMarket.key : null,
    golden_top_stage: goldenTopStage ? goldenTopStage.key : null,
    primary_label: primary ? `${primary.key}:${primary.drift}` : null,
  };
}

function assessAutonomy({
  blockers = [],
  promotion = null,
  selfEvolutionCycleSummary = null,
  selfEvolutionDeploymentPlanSummary = null,
  selfEvolutionWeightTuning = null,
  selfEvolutionDatasetSummary = null,
  selfEvolutionCandidatesSummary = null,
  selfEvolutionReplaySummary = null,
  selfEvolutionCanarySummary = null,
} = {}) {
  const blockerSet = new Set(Array.isArray(blockers) ? blockers : []);
  const manualGateBlockers = Array.from(blockerSet).filter((item) => /CHANGE_CONTROL|CODEX_REVIEW|STAGE_AUTOPILOT_REQUIRED|MANUAL/i.test(String(item || "")));
  const operationalBlockers = Array.from(blockerSet).filter((item) => /NO_TRADE|ZERO_KRW_IDLE|OBJECTIVE|MONTHLY|WEEKLY|RETROSPECTIVE|CANARY_DRIFT/i.test(String(item || "")));
  const recoveryPromotionReady = promotion && promotion.ready === true && promotion.recovery_mode === true;
  const preparedRecoveryHandoff = selfEvolutionDeploymentPlanSummary && (
    selfEvolutionDeploymentPlanSummary.ready_for_manual_paste === true
    || String(selfEvolutionDeploymentPlanSummary.plan_status || "").trim().toUpperCase() === "READY_FOR_MANUAL_PASTE"
  );
  const operationalAutonomyExceptPine = manualGateBlockers.length
    ? "NO"
    : ((recoveryPromotionReady || preparedRecoveryHandoff || operationalBlockers.length === 0) ? "YES" : "PARTIAL");
  return {
    engine_autonomy: (
      selfEvolutionDatasetSummary
      && selfEvolutionCandidatesSummary
      && selfEvolutionReplaySummary
      && selfEvolutionCanarySummary
    ) ? "YES" : "PARTIAL",
    loop_autonomy: selfEvolutionCycleSummary && selfEvolutionCycleSummary.core_cycle_consistent === true ? "YES" : "PARTIAL",
    operational_autonomy_except_pine: operationalAutonomyExceptPine,
    manual_boundaries: [
      selfEvolutionDeploymentPlanSummary && (
        selfEvolutionDeploymentPlanSummary.manual_step_required
        || selfEvolutionDeploymentPlanSummary.ready_for_manual_paste
      ) ? "TRADINGVIEW_PINE_PASTE" : null,
    ].filter(Boolean),
    autonomous_deferred_paths: [
      selfEvolutionWeightTuning && selfEvolutionWeightTuning.summary && selfEvolutionWeightTuning.summary.autonomous_defer === true
        ? "WEIGHT_TUNING_DEFERRED"
        : null,
    ].filter(Boolean),
    blocker_classes: {
      manual_gates: manualGateBlockers,
      operational_gates: operationalBlockers,
    },
  };
}

function deriveAutonomousRecoveryPromotion({
  promotion = null,
  objective = null,
  retrospectiveSummary = null,
  selfEvolutionObjectiveSummary = null,
  selfEvolutionCandidatesSummary = null,
  selfEvolutionReplaySummary = null,
  selfEvolutionCanarySummary = null,
  selfEvolutionCycleSummary = null,
  memoryBlockedIds = null,
  canaryDriftContext = null,
} = {}) {
  const basePromotion = promotion && typeof promotion === "object" ? promotion : {};
  if (basePromotion.ready === true) return { ...basePromotion, recovery_mode: false };
  const candidateRows = Array.isArray(selfEvolutionCandidatesSummary && selfEvolutionCandidatesSummary.rows)
    ? selfEvolutionCandidatesSummary.rows
    : [];
  const replayRows = Array.isArray(selfEvolutionReplaySummary && selfEvolutionReplaySummary.validations)
    ? selfEvolutionReplaySummary.validations
    : [];
  const isReadyCandidate = (row) => Boolean(
    row
    && row.ready_for_auto_apply === true
    && row.memory_blocked !== true
    && row.failed_fingerprint_repeat !== true
  );
  const bestReadyReplayCandidateId = replayRows
    .map((row) => {
      const candidateId = String(row && row.candidate_id || "").trim() || null;
      const candidateRow = candidateRows.find((candidate) => String(candidate && candidate.candidate_id || "").trim() === candidateId) || null;
      return {
        candidate_id: candidateId,
        ready: isReadyCandidate(candidateRow),
        verdict: String(row && row.validation_verdict || "").trim().toUpperCase() || null,
        delta: toNum(row && row.candidate_objective_delta),
      };
    })
    .filter((row) => row.candidate_id && row.ready && row.verdict === "PASS")
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))[0]?.candidate_id || null;
  const candidateId = String(
    basePromotion.candidate_id
    || bestReadyReplayCandidateId
    || selfEvolutionCandidatesSummary && selfEvolutionCandidatesSummary.top_candidate_id
    || selfEvolutionReplaySummary && selfEvolutionReplaySummary.best_candidate_id
    || ""
  ).trim() || null;
  const blockerIds = memoryBlockedIds instanceof Set ? memoryBlockedIds : new Set();
  const performancePressure = Boolean(
    retrospectiveSummary && (retrospectiveSummary.daily_scope_no_trade || retrospectiveSummary.any_fail)
    || objective && (objective.pass === false || objective.monthly_pass === false)
  );
  const candidateReplayRow = replayRows.find((row) => String(row && row.candidate_id || "").trim() === candidateId) || null;
  const candidateRow = candidateRows.find((row) => String(row && row.candidate_id || "").trim() === candidateId) || null;
  const replayPass = String(
    candidateReplayRow && candidateReplayRow.validation_verdict
    || selfEvolutionReplaySummary && selfEvolutionReplaySummary.best_verdict
    || ""
  ).trim().toUpperCase() === "PASS";
  const replayDelta = toNum(
    candidateReplayRow && candidateReplayRow.candidate_objective_delta
  );
  const canarySafe = selfEvolutionCanarySummary
    && selfEvolutionCanarySummary.apply_pass === true
    && Number(selfEvolutionCanarySummary.ready_n || 0) > 0;
  const objectiveSafe = selfEvolutionObjectiveSummary
    && selfEvolutionObjectiveSummary.count_floor_pass !== false
    && selfEvolutionObjectiveSummary.replacement_floor_pass !== false
    && selfEvolutionObjectiveSummary.latency_budget_pass !== false;
  const cycleSafe = !selfEvolutionCycleSummary || selfEvolutionCycleSummary.core_cycle_consistent !== false;
  const driftSafe = !canaryDriftContext || ((toNum(canaryDriftContext.shadow_drift) || 0) === 0 && (toNum(canaryDriftContext.golden_drift) || 0) === 0);
  const candidateSafe = Boolean(candidateId && isReadyCandidate(candidateRow) && !blockerIds.has(candidateId));
  if (!(performancePressure && replayPass && (replayDelta == null || replayDelta > 0) && canarySafe && objectiveSafe && cycleSafe && driftSafe && candidateSafe)) {
    return { ...basePromotion, recovery_mode: false };
  }
  return {
    ...basePromotion,
    ready: true,
    reason: "AUTONOMOUS_RECOVERY_PROMOTION",
    candidate_id: candidateId,
    streak_current: toNum(basePromotion.streak_current) || 0,
    streak_required: toNum(basePromotion.streak_required) || 0,
    recovery_mode: true,
  };
}

function summarizeEvTunerContext(filterLayers = null) {
  const evLayer = filterLayers && filterLayers.ev_time_value && typeof filterLayers.ev_time_value === "object"
    ? filterLayers.ev_time_value
    : {};
  return {
    stale: String(evLayer.tuner_reason || "").trim().toUpperCase() === "STALE_ARTIFACT",
    age_hours: toNum(evLayer.age_hours),
    observed_reason: String(evLayer.observed_tuner_reason || "").trim() || null,
    policy_source: String(evLayer.policy_source || "").trim() || null,
  };
}

function formatBestFebtMarketContractLine(row = {}) {
  const market = String(row.market || "UNKNOWN");
  const replacement = row.projected_replacement_ratio != null ? pct(row.projected_replacement_ratio) : "N/A";
  const count = row.projected_count_ratio_global != null ? `${Number(row.projected_count_ratio_global).toFixed(2)}x` : "N/A";
  return `${market} ${row.mode || "N/A"} / replacement ${replacement} / count ${count} / fire ${row.fire_n ?? 0} / late ${row.late_n ?? 0} / disagree ${row.disagreement_n ?? 0} / reason ${row.dominant_disagreement_reason || "N/A"}`;
}

function buildFilterLayerSummary({ governance, changeControl, ml, ev, wait, physicsSummary } = {}) {
  const current = governance && governance.current && typeof governance.current === "object" ? governance.current : {};
  const patchCandidates = current && current.pine_stage1_patch_candidates && typeof current.pine_stage1_patch_candidates === "object"
    ? current.pine_stage1_patch_candidates
    : {};
  const leadCandidate = Array.isArray(patchCandidates.candidates) ? patchCandidates.candidates[0] || null : null;
  const featureBreakdown = current
    && current.drop_counterfactual
    && current.drop_counterfactual.feature_breakdown
    && typeof current.drop_counterfactual.feature_breakdown === "object"
      ? current.drop_counterfactual.feature_breakdown
      : {};
  const waitPhysics = physicsSummary && physicsSummary.wait_hard
    ? "HARD"
    : (physicsSummary && physicsSummary.wait_assist ? "ASSIST" : "ALLOW");
  const qualityByTier = current && current.quality && current.quality.by_tier && typeof current.quality.by_tier === "object"
    ? current.quality.by_tier
    : {};
  const febtShadow = summarizeFebtByTier(qualityByTier);
  const evReasonRaw = String(ev && ev.decision_reason || "N/A");
  const evFresh = ev ? ev.fresh !== false : true;
  return {
    integrity: {
      label: "1차 상태/무결성",
      server_mode: String(leadCandidate && leadCandidate.server_stage1_mode || "INTEGRITY_GUARD_ONLY"),
      expectation: String(leadCandidate && leadCandidate.server_stage1_expectation || "N/A"),
      coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass === true),
    },
    entry_quality: {
      label: "2차 진입 품질",
      pine_candidate_verdict: String(patchCandidates.verdict || "N/A"),
      quality_actions: Array.isArray(ml && ml.recommendations && ml.recommendations.QUALITY) ? ml.recommendations.QUALITY.length : 0,
    },
    state_soft_sizing: {
      label: "3차 상태 기반 Soft Sizing",
      ml_action: String(ml && ml.recommendations && ml.recommendations.MARKET && ml.recommendations.MARKET.action || "N/A"),
      physics_action: String(physicsSummary && physicsSummary.action || "ALLOW"),
      qty_scale: Number.isFinite(Number(physicsSummary && physicsSummary.qty_scale)) ? Number(physicsSummary.qty_scale) : null,
      dominant_state: topBreakdownValue(featureBreakdown.market_state),
      dominant_action: topBreakdownValue(featureBreakdown.market_action),
    },
    ev_time_value: {
      label: "4차 EV/시간가치층",
      tuner_reason: evFresh ? evReasonRaw : "STALE_ARTIFACT",
      observed_tuner_reason: evReasonRaw,
      fresh: evFresh,
      age_hours: toNum(ev && ev.age_hours),
      policy_version: evFresh ? topBreakdownValue(featureBreakdown.ev_policy_version) : "STALE_ARTIFACT",
      policy_source: evFresh ? topBreakdownValue(featureBreakdown.ev_policy_source) : "STALE_TUNER_ARTIFACT",
    },
    wait_timing: {
      label: "5차 WAIT 타이밍층",
      tuner_reason: String(wait && wait.reason || "N/A"),
      wait_action: waitPhysics,
      febt_calc_ok_rate: febtShadow.calc_ok_rate,
      febt_phase_known: febtShadow.phase_known,
      febt_fire_n: febtShadow.fire,
      febt_late_n: febtShadow.late,
      febt_void_n: febtShadow.void_n,
      febt_disagreement_n: febtShadow.disagreement,
      febt_fallback_legacy_n: febtShadow.fallback_legacy,
      febt_missing_rate: febtShadow.missing_rate,
    },
  };
}

function buildObjectiveSupervisorTelegramSections(report = {}) {
  const blockersLine = Array.isArray(report.blockers) && report.blockers.length
    ? report.blockers.slice(0, 4).join(", ")
    : "없음";
  const physicsWait = report.physics && report.physics.wait_hard
    ? "HARD"
    : (report.physics && report.physics.wait_assist ? "ASSIST" : "ALLOW");
  return [
    {
      header: "지금 결론",
      lines: [
        `자동화는 지금 '${report.verdict}' 상태입니다. 주된 이유는 '${report.reason}' 입니다.`,
        `현재 차단 사유 ${blockersLine}`,
      ],
    },
    {
      header: "목표 달성 상태",
      lines: [
        `현재 실현 표본 ${report.objective.realized_n ?? "정보 없음"}건, 실행 ${report.objective.executed_n ?? "정보 없음"}건, 월간 예상 수익 ${signedNum(report.objective.monthly_run_rate_krw, 0)} KRW, 목표 ${signedNum(report.objective.min_monthly_net_krw, 0)} KRW`,
      ],
    },
    {
      header: "최근 회고",
      lines: [
        `오늘 ${report.retrospective.daily.verdict}, 실행 ${report.retrospective.daily.executed_n ?? "정보 없음"}건, 실현 ${report.retrospective.daily.realized_n ?? "정보 없음"}건, 손익 ${signedNum(report.retrospective.daily.net_pnl_quote, 0)} KRW`,
        `주간 ${report.retrospective.weekly.verdict} / 월간 ${report.retrospective.monthly.verdict}`,
      ],
    },
    {
      header: "자동 변경 가능 여부",
      lines: [
        `변경 승격 ${report.promotion.ready ? "가능" : "보류"} / 사유 ${report.promotion.reason} / 후보 ${report.promotion.display_candidate_id || report.promotion.candidate_id || "정보 없음"}`,
        `자동 롤백 ${report.rollback.ready ? "가능" : "보류"} / 사유 ${report.rollback.reason}`,
      ],
    },
    {
      header: "안전 장치",
      lines: [
        `검증 ${report.guards.canary_pass ? "정상" : "차단"} / golden drift ${report.guards.canary_golden_drift} / shadow drift ${report.guards.canary_shadow_drift}`,
        `데이터 커버리지 ${report.guards.coverage_pass ? "충분" : "부족"}`,
      ],
    },
    {
      header: "필터 계층",
      lines: [
        `1차 상태/무결성 ${report.filter_layers && report.filter_layers.integrity ? `${report.filter_layers.integrity.server_mode} / coverage ${report.filter_layers.integrity.coverage_pass ? "PASS" : "BLOCK"}` : "N/A"}`,
        `2차 진입 품질 ${report.filter_layers && report.filter_layers.entry_quality ? `candidate ${report.filter_layers.entry_quality.pine_candidate_verdict} / ml quality ${report.filter_layers.entry_quality.quality_actions}` : "N/A"}`,
        `3차 상태 기반 Soft Sizing ${report.filter_layers && report.filter_layers.state_soft_sizing ? `${report.filter_layers.state_soft_sizing.ml_action} / physics ${report.filter_layers.state_soft_sizing.physics_action} / qty ${report.filter_layers.state_soft_sizing.qty_scale != null ? report.filter_layers.state_soft_sizing.qty_scale : "N/A"}` : "N/A"}`,
        `4차 EV/시간가치층 ${report.filter_layers && report.filter_layers.ev_time_value ? `${report.filter_layers.ev_time_value.tuner_reason} / policy ${report.filter_layers.ev_time_value.policy_version || "N/A"} / source ${report.filter_layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
        `5차 WAIT 타이밍층 ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / ${report.filter_layers.wait_timing.wait_action} / FEBT calc ${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known ${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire ${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late ${report.filter_layers.wait_timing.febt_late_n ?? 0} / void ${report.filter_layers.wait_timing.febt_void_n ?? 0} / disagree ${report.filter_layers.wait_timing.febt_disagreement_n ?? 0} / fallback ${report.filter_layers.wait_timing.febt_fallback_legacy_n ?? 0} / missing ${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
      ],
    },
    {
      header: "상태층(시장 물리)",
      lines: [
        `상태 ${report.physics.display_state || "정보 없음"} / action ${report.physics.action || "N/A"} / qty ${report.physics.qty_scale != null ? report.physics.qty_scale : "N/A"} / wait ${physicsWait} / 차단 ${report.physics.block_reason || "없음"}`,
        `entropy ${pct(report.physics.entropy)} / coherence ${pct(report.physics.coherence)} / transition ${pct(report.physics.transition_risk)} / align ${pct(report.physics.field_alignment)} / wall ${pct(report.physics.domain_wall_density)} / free ${pct(report.physics.free_energy)}`,
      ],
    },
    {
      header: "FEBT Phase 0",
      lines: [
        `legacy WAIT coverage ${report.phase0 && report.phase0.legacy_wait_coverage_rate != null ? pct(report.phase0.legacy_wait_coverage_rate) : "N/A"} / observed ${report.phase0 && report.phase0.legacy_wait_observed_chain_n != null ? report.phase0.legacy_wait_observed_chain_n : "N/A"}`,
        `legacy WAIT immediate win ${report.phase0 && report.phase0.immediate_win_rate != null ? pct(report.phase0.immediate_win_rate) : "N/A"} / saved_loss ${report.phase0 && report.phase0.saved_loss_pct != null ? pct(report.phase0.saved_loss_pct) : "N/A"} / missed_gain ${report.phase0 && report.phase0.missed_gain_pct != null ? pct(report.phase0.missed_gain_pct) : "N/A"} / delta ${report.phase0 && report.phase0.saved_loss_minus_missed_gain != null ? signedPct(report.phase0.saved_loss_minus_missed_gain) : "N/A"}`,
        `bridge webhook->fill p95 ${report.phase0 && report.phase0.webhook_to_fill_p95_ms != null ? `${Number(report.phase0.webhook_to_fill_p95_ms).toFixed(0)}ms` : "N/A"} / dup ${report.phase0 && report.phase0.duplicate_count != null ? report.phase0.duplicate_count : "N/A"} / reject ${report.phase0 && report.phase0.reject_count != null ? report.phase0.reject_count : "N/A"} / fresh ${report.phase0 && report.phase0.fresh ? "YES" : "NO"}`,
      ],
    },
    {
      header: "BEST/FEBT 공통 계약",
      lines: [
        `mode ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"} / tightening ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"}`,
        `replacement ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio != null ? pct(report.best_febt_tuning_contract.projected_replacement_ratio) : "N/A"} / count ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? `${Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2)}x` : "N/A"} / net delta ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_net_signal_delta_n != null ? report.best_febt_tuning_contract.projected_net_signal_delta_n : "N/A"}`,
        `fire ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fire_n != null ? report.best_febt_tuning_contract.fire_n : "N/A"} / late ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.late_n != null ? report.best_febt_tuning_contract.late_n : "N/A"} / disagree ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.disagreement_n != null ? report.best_febt_tuning_contract.disagreement_n : "N/A"} / fallback ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fallback_legacy_n != null ? report.best_febt_tuning_contract.fallback_legacy_n : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 정책",
      lines: [
        `master ${report.self_evolution_policy && report.self_evolution_policy.master_spec_path || "N/A"}`,
        `focus ${report.self_evolution_policy && report.self_evolution_policy.current_focus || "N/A"} / docs ${report.self_evolution_policy && Array.isArray(report.self_evolution_policy.linked_paths) ? report.self_evolution_policy.linked_paths.length : 0}`,
      ],
    },
    {
      header: "자기 진화 데이터셋",
      lines: [
        `rows ${report.self_evolution_dataset && report.self_evolution_dataset.rows_n != null ? report.self_evolution_dataset.rows_n : "N/A"} / executed ${report.self_evolution_dataset && report.self_evolution_dataset.executed_n != null ? report.self_evolution_dataset.executed_n : "N/A"} / drop ${report.self_evolution_dataset && report.self_evolution_dataset.drop_n != null ? report.self_evolution_dataset.drop_n : "N/A"} / missed ${report.self_evolution_dataset && report.self_evolution_dataset.missed_n != null ? report.self_evolution_dataset.missed_n : "N/A"}`,
        `fallback ${report.self_evolution_dataset && report.self_evolution_dataset.fallback_n != null ? report.self_evolution_dataset.fallback_n : "N/A"} / rejected ${report.self_evolution_dataset && report.self_evolution_dataset.rejected_n != null ? report.self_evolution_dataset.rejected_n : "N/A"} / partial ${report.self_evolution_dataset && report.self_evolution_dataset.partial_n != null ? report.self_evolution_dataset.partial_n : "N/A"}`,
        `features ${report.self_evolution_dataset && report.self_evolution_dataset.features_coverage_rate != null ? pct(report.self_evolution_dataset.features_coverage_rate) : "N/A"} / FEBT ${report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate != null ? pct(report.self_evolution_dataset.febt_coverage_rate) : "N/A"} / avg_ret ${report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_ret_net != null ? signedPct(report.self_evolution_dataset.avg_realized_ret_net) : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 목적함수",
      lines: [
        `score ${report.self_evolution_objective && report.self_evolution_objective.objective_score != null ? signedNum(report.self_evolution_objective.objective_score, 4) : "N/A"} / count ${report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === false ? "FAIL" : "N/A")} / replacement ${report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === false ? "FAIL" : "N/A")} / latency ${report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === false ? "FAIL" : "N/A")}`,
        `fire win ${report.self_evolution_objective && report.self_evolution_objective.fire_win_rate != null ? pct(report.self_evolution_objective.fire_win_rate) : "N/A"} / tp1 ${report.self_evolution_objective && report.self_evolution_objective.tp1_first_rate != null ? pct(report.self_evolution_objective.tp1_first_rate) : "N/A"} / count ${report.self_evolution_objective && report.self_evolution_objective.projected_count_ratio_global != null ? `${Number(report.self_evolution_objective.projected_count_ratio_global).toFixed(2)}x` : "N/A"} / replacement ${report.self_evolution_objective && report.self_evolution_objective.projected_replacement_ratio != null ? pct(report.self_evolution_objective.projected_replacement_ratio) : "N/A"}`,
        `top ${report.self_evolution_objective && report.self_evolution_objective.top_market ? `${report.self_evolution_objective.top_market.market} ${signedNum(report.self_evolution_objective.top_market.objective_score, 3)}` : "N/A"} / bottom ${report.self_evolution_objective && report.self_evolution_objective.bottom_market ? `${report.self_evolution_objective.bottom_market.market} ${signedNum(report.self_evolution_objective.bottom_market.objective_score, 3)}` : "N/A"}`,
        `dominant drag ${report.self_evolution_objective && report.self_evolution_objective.market_concentration && report.self_evolution_objective.market_concentration.dominant_negative_market ? `${report.self_evolution_objective.market_concentration.dominant_negative_market.market} share ${pct(report.self_evolution_objective.market_concentration.dominant_negative_share)} / ex-bottom ${signedNum(report.self_evolution_objective.market_concentration.objective_score_ex_bottom_market, 3)}` : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 원인분해",
      lines: [
        `drop top layer ${report.self_evolution_attribution && report.self_evolution_attribution.drop_top_layer ? `${report.self_evolution_attribution.drop_top_layer.key} ${report.self_evolution_attribution.drop_top_layer.count}` : "N/A"}`,
        `late loss top market ${report.self_evolution_attribution && report.self_evolution_attribution.late_loss_top_market ? `${report.self_evolution_attribution.late_loss_top_market.key} ${report.self_evolution_attribution.late_loss_top_market.count}` : "N/A"} / false fire ${report.self_evolution_attribution && report.self_evolution_attribution.false_fire_top_market ? `${report.self_evolution_attribution.false_fire_top_market.key} ${report.self_evolution_attribution.false_fire_top_market.count}` : "N/A"}`,
        `missed recovery ${report.self_evolution_attribution && report.self_evolution_attribution.missed_recovery_top_reason ? `${report.self_evolution_attribution.missed_recovery_top_reason.key} ${report.self_evolution_attribution.missed_recovery_top_reason.count}` : "N/A"} / fallback cost ${report.self_evolution_attribution && report.self_evolution_attribution.fallback_cost_top_market ? `${report.self_evolution_attribution.fallback_cost_top_market.key} ${report.self_evolution_attribution.fallback_cost_top_market.count}` : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 후보",
      lines: [
        `total ${report.self_evolution_candidates && report.self_evolution_candidates.total_n != null ? report.self_evolution_candidates.total_n : "N/A"} / ready ${report.self_evolution_candidates && report.self_evolution_candidates.ready_n != null ? report.self_evolution_candidates.ready_n : "N/A"} / blocked ${report.self_evolution_candidates && report.self_evolution_candidates.blocked_n != null ? report.self_evolution_candidates.blocked_n : "N/A"}`,
        `top candidate ${report.self_evolution_candidates && report.self_evolution_candidates.top_candidate_id || "N/A"} / scope ${report.self_evolution_candidates && report.self_evolution_candidates.top_scope || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 리플레이",
      lines: [
        `mode ${report.self_evolution_replay && report.self_evolution_replay.validation_mode || "N/A"} / pass ${report.self_evolution_replay && report.self_evolution_replay.pass_n != null ? report.self_evolution_replay.pass_n : "N/A"} / warn ${report.self_evolution_replay && report.self_evolution_replay.warn_n != null ? report.self_evolution_replay.warn_n : "N/A"} / block ${report.self_evolution_replay && report.self_evolution_replay.block_n != null ? report.self_evolution_replay.block_n : "N/A"}`,
        `best ${report.self_evolution_replay && report.self_evolution_replay.best_candidate_id || "N/A"} / verdict ${report.self_evolution_replay && report.self_evolution_replay.best_verdict || "N/A"} / delta ${report.self_evolution_replay && report.self_evolution_replay.best_objective_delta != null ? signedNum(report.self_evolution_replay.best_objective_delta, 4) : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 canary",
      lines: [
        `total ${report.self_evolution_canary && report.self_evolution_canary.total_n != null ? report.self_evolution_canary.total_n : "N/A"} / shadow ${report.self_evolution_canary && report.self_evolution_canary.shadow_n != null ? report.self_evolution_canary.shadow_n : "N/A"} / soft ${report.self_evolution_canary && report.self_evolution_canary.soft_n != null ? report.self_evolution_canary.soft_n : "N/A"} / hard ${report.self_evolution_canary && report.self_evolution_canary.hard_n != null ? report.self_evolution_canary.hard_n : "N/A"}`,
        `ready ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / blocked ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"} / rollback ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / apply ${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"}`,
        `top ready ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top rollback ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 배포 가드",
      lines: [
        `target ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"} / deploy ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / rollback_only ${report.self_evolution_deployment && report.self_evolution_deployment.rollback_only ? "YES" : "NO"}`,
        `replay ${report.self_evolution_deployment && report.self_evolution_deployment.replay_verdict || "N/A"} / open wave ${report.self_evolution_deployment && report.self_evolution_deployment.canary_open_wave != null ? report.self_evolution_deployment.canary_open_wave : "N/A"} / markets ${report.self_evolution_deployment && report.self_evolution_deployment.market_ready_n != null ? report.self_evolution_deployment.market_ready_n : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_total_n != null ? report.self_evolution_deployment.market_total_n : "N/A"}`,
        `blockers ${report.self_evolution_deployment && Array.isArray(report.self_evolution_deployment.blockers) && report.self_evolution_deployment.blockers.length ? report.self_evolution_deployment.blockers.join("|") : "none"}`,
      ],
    },
    {
      header: "자기 진화 배포 handoff",
      lines: [
        `status ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / prepare ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepare_pass ? "PASS" : "BLOCK"} / manual ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"}`,
        `bundle ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.prepared_engine_bundle_id || report.self_evolution_deployment_plan.active_engine_bundle_id) || "N/A"} / policy ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.prepared_policy_bundle_id || report.self_evolution_deployment_plan.active_policy_bundle_id) || "N/A"} / rollback ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.rollback_engine_bundle_id || report.self_evolution_deployment_plan.rollback_source_file_path) || "N/A"}`,
        `shadow ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 루프 모니터",
      lines: [
        `cycle ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_id || "N/A"} / status ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.overall_status || "N/A"} / consistent ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_consistent ? "YES" : "NO"}`,
        `fresh ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.fresh_loop_n != null ? report.self_evolution_loop_monitor.fresh_loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.loop_n != null ? report.self_evolution_loop_monitor.loop_n : "N/A"} / promotion ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.promotion_path_ready ? "YES" : "NO"} / manual ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.manual_paste_ready ? "YES" : "NO"}`,
        `blockers ${report.self_evolution_loop_monitor && Array.isArray(report.self_evolution_loop_monitor.critical_blockers) && report.self_evolution_loop_monitor.critical_blockers.length ? report.self_evolution_loop_monitor.critical_blockers.join("|") : "none"}`,
      ],
    },
    {
      header: "자기 진화 가중치 튜닝",
      lines: [
        `mode ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.advisory_mode || "N/A"} / suggestion ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.suggestion_n != null ? report.self_evolution_weight_tuning.summary.suggestion_n : "N/A"} / dominant ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.dominant_axis || "N/A"}`,
        `count ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.count_guard_blocked ? "BLOCK" : "PASS"} / memory ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.memory_blocked ? "BLOCK" : "PASS"} / canary ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.canary_blocked ? "BLOCK" : "PASS"}`,
      ],
    },
    {
      header: "자기 진화 메모리",
      lines: [
        `total ${report.self_evolution_memory && report.self_evolution_memory.total_n != null ? report.self_evolution_memory.total_n : "N/A"} / current ${report.self_evolution_memory && report.self_evolution_memory.current_n != null ? report.self_evolution_memory.current_n : "N/A"} / blocked ${report.self_evolution_memory && report.self_evolution_memory.blocked_candidate_n != null ? report.self_evolution_memory.blocked_candidate_n : "N/A"}`,
        `success ${report.self_evolution_memory && report.self_evolution_memory.success_n != null ? report.self_evolution_memory.success_n : "N/A"} / fail ${report.self_evolution_memory && report.self_evolution_memory.fail_n != null ? report.self_evolution_memory.fail_n : "N/A"} / rolled_back ${report.self_evolution_memory && report.self_evolution_memory.rolled_back_n != null ? report.self_evolution_memory.rolled_back_n : "N/A"}`,
        `top success ${report.self_evolution_memory && report.self_evolution_memory.top_success_candidate_id || "N/A"} / top failed ${report.self_evolution_memory && report.self_evolution_memory.top_failed_candidate_id || "N/A"}`,
      ],
    },
    {
      header: "시장별 BEST/FEBT 계약",
      lines: Array.isArray(report.best_febt_market_contracts) && report.best_febt_market_contracts.length
        ? report.best_febt_market_contracts.slice(0, 4).map((row) => formatBestFebtMarketContractLine(row))
        : ["시장별 계약 없음"],
    },
    {
      header: "외부 검토",
      lines: [
        `상태 ${report.codex_review.status} / 결론 ${report.codex_review.verdict} / 사유 ${report.codex_review.reason}`,
      ],
    },
    {
      header: "외부 권한",
      lines: [
        `owner ${report.codex_authority && report.codex_authority.owner || "N/A"} / mode ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / verdict ${report.codex_authority && report.codex_authority.verdict || "N/A"}`,
        `manual ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"} / bundle ${report.codex_authority && report.codex_authority.prepared_engine_bundle_id || "N/A"} / shadow ${report.codex_authority && report.codex_authority.prepared_file_path || report.codex_authority && report.codex_authority.latest_generated_file_path || "N/A"}`,
      ],
    },
    {
      header: "자동 적용 엔진",
      lines: [
        `상태 ${report.stage_autopilot.status} / 목표 판정 ${report.stage_autopilot.objective_verdict}`,
        `이번 실행에서 실제 반영된 변경 ${report.stage_autopilot.action_n}건 / ${(report.stage_autopilot.action_types || []).join(", ") || "없음"}`,
      ],
    },
  ];
}

function clampTelegramLine(line, maxChars = 180) {
  const normalized = String(line || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function buildObjectiveSupervisorTelegramAlertSections(report = {}) {
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actionPlan = Array.isArray(report.action_plan) ? report.action_plan : [];
  const manualBoundaries = Array.isArray(report.autonomy_assessment && report.autonomy_assessment.manual_boundaries)
    ? report.autonomy_assessment.manual_boundaries
    : [];
  const deferredPaths = Array.isArray(report.autonomy_assessment && report.autonomy_assessment.autonomous_deferred_paths)
    ? report.autonomy_assessment.autonomous_deferred_paths
    : [];
  const sections = [
    {
      header: "요약",
      lines: [
        `현재 판단: ${report.verdict || "N/A"}`,
        `핵심 사유: ${report.root_cause || report.reason || "N/A"}`,
      ],
    },
    {
      header: "지금 막는 것",
      lines: [
        blockers.length ? `주요 차단: ${blockers.slice(0, 3).join(", ")}` : "주요 차단: 없음",
        `배포 상태: ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "진행 가능" : "보류"}`,
      ],
    },
    {
      header: "다음 조치",
      lines: [
        actionPlan.length ? actionPlan[0] : "다음 조치: 없음",
        actionPlan.length > 1 ? actionPlan[1] : "추가 조치: 없음",
      ],
    },
    {
      header: "운영 상태",
      lines: [
        `검증 상태: ${report.guards && report.guards.canary_pass ? "정상" : "차단"}`,
        `수동 경계: ${manualBoundaries.length ? manualBoundaries.join(", ") : "없음"} / 보류 경로: ${deferredPaths.length ? deferredPaths.join(", ") : "없음"}`,
      ],
    },
  ];
  return sections.map((section) => ({
    header: section.header,
    lines: (Array.isArray(section.lines) ? section.lines : [])
      .filter(Boolean)
      .slice(0, 2)
      .map((line) => clampTelegramLine(line, 180)),
  }));
}

function evaluateSupervisor({ governance, changeControl, canary, ml, ev, wait, phase0, selfEvolutionDataset, selfEvolutionObjective, selfEvolutionMarketObjectiveScore, selfEvolutionServerVsPinePerformanceDelta, selfEvolutionExplorationBudget, selfEvolutionServerMarketCapitalAllocator, selfEvolutionServerMarketQuarantine, selfEvolutionExplorationProposal, selfEvolutionExplorationApplyCandidate, selfEvolutionChangeResultAttribution, selfEvolutionAttribution, selfEvolutionCandidates, selfEvolutionReplay, selfEvolutionCanary, selfEvolutionCanonicalParity, selfEvolutionServerSignalAuthority, selfEvolutionServerSignalQuality, selfEvolutionServerSignalCutoverReadiness, selfEvolutionDropValidation, selfEvolutionProvisionalRealizedOutcome, selfEvolutionOverrideAuthority, selfEvolutionExecutionQuality, selfEvolutionReversePolicy, selfEvolutionServerPrimaryLearningEpoch, selfEvolutionInitialSignalQualityContract, selfEvolutionExitTrailingContract, selfEvolutionServerNativeHtfModeComparison, selfEvolutionServerNativeHtfModeGovernor, selfEvolutionCanonicalProvenance, selfEvolutionServerPrimaryCanary, selfEvolutionServerPrimaryAcceptanceWatch, selfEvolutionPineShadowDrift, selfEvolutionDeploymentProbe, selfEvolutionBundleActivation, selfEvolutionEvGateRescue, selfEvolutionMemory, selfEvolutionLoopMonitor, selfEvolutionCycleState, codex, stageAutopilot, retrospective, weeklyHistory, manualPasteAck, signalsCache, preparedOverride } = {}) {
  governance = unwrapArtifactPayload(governance);
  retrospective = unwrapArtifactPayload(retrospective);
  const objective = governance && governance.current && governance.current.objective ? governance.current.objective : {};
  const objectiveCfg = governance && governance.objective ? governance.objective : {};
  const promotion = changeControl && changeControl.auto_promotion ? changeControl.auto_promotion : {};
  const rollback = changeControl && changeControl.auto_rollback ? changeControl.auto_rollback : {};
  const canarySummary = canary && canary.shadow && canary.shadow.summary ? canary.shadow.summary : {};
  const canaryGolden = canary && canary.golden && canary.golden.summary ? canary.golden.summary : {};
  const codexVerdict = String(codex && codex.verdict || "HOLD").toUpperCase();
  const codexStatus = String(codex && codex.status || "N/A").toUpperCase();
  const codexCandidateId = String(codex && codex.recommended_candidate_id || "").trim() || null;
  const codexDisplayCandidateId = resolveDisplayCandidateId(codexCandidateId, changeControl);
  const codexRollbackPath = String(codex && codex.recommended_rollback_file_path || "").trim() || null;
  const codexFresh = Boolean(codex && (codex.fresh === true || codexStatus === "FRESH" || codexStatus === "SKIPPED"));
  const codexDisplayStatus = codexStatus === "FAILED"
    ? "FAILED"
    : (codexFresh ? "FRESH" : (codex ? "STALE" : "N/A"));
  const stageAutopilotStatus = String(stageAutopilot && stageAutopilot.status || "").toUpperCase();
  const stageAutopilotFresh = Boolean(stageAutopilot && (stageAutopilot.fresh === true || stageAutopilotStatus === "FRESH"));
  const retrospectiveSummary = summarizeRetrospective(retrospective);
  const physicsSummary = summarizeGovernancePhysics(governance);
  const canaryDriftContext = summarizeCanaryDriftContext(canary);
  const filterLayers = buildFilterLayerSummary({
    governance,
    changeControl,
    ml,
    ev,
    wait,
    physicsSummary,
  });
  const phase0Summary = {
    available: !!phase0,
    fresh: Boolean(phase0 && phase0.fresh === true),
    provider: String(phase0 && phase0.provider || "N/A"),
    tf: String(phase0 && phase0.tf || "N/A"),
    legacy_wait_coverage_rate: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.legacy_wait_coverage_rate),
    legacy_wait_observed_chain_n: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.legacy_wait_observed_chain_n),
    immediate_win_rate: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.immediate_win_rate),
    saved_loss_pct: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.saved_loss_pct),
    missed_gain_pct: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.missed_gain_pct),
    saved_loss_minus_missed_gain: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.saved_loss_minus_missed_gain),
    webhook_to_fill_p95_ms: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.webhook_to_fill_ms && phase0.bridge_latency.webhook_to_fill_ms.p95),
    duplicate_count: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.duplicate_count) || 0,
    reject_count: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.reject_count) || 0,
  };
  const bestFebtTuningContract = deriveBestFebtTuningContract({
    governance,
    objectiveSupervisor: {
      verdict: null,
      filter_layers: filterLayers,
      phase0: phase0Summary,
    },
  });
  const bestFebtMarketContracts = deriveBestFebtMarketContracts({
    governance,
    objectiveSupervisor: {
      verdict: null,
      filter_layers: filterLayers,
      phase0: phase0Summary,
    },
    selfEvolutionDataset,
  });
  const selfEvolutionPolicy = buildSelfEvolutionPolicySpec();
  const selfEvolutionDatasetSummary = summarizeSelfEvolutionDataset(selfEvolutionDataset);
  const selfEvolutionObjectiveSummary = summarizeSelfEvolutionObjective(
    selfEvolutionObjective || {
      global_objective_score: deriveDatasetObjectiveScore({
        dataset: selfEvolutionDataset,
        governance,
        phase0,
        tuningContract: bestFebtTuningContract,
      }),
      market_objective_scores: deriveMarketObjectiveScores({
        dataset: selfEvolutionDataset,
        governance,
        phase0,
        marketContracts: bestFebtMarketContracts,
      }),
    }
  );
  const selfEvolutionAttributionSummary = summarizeSelfEvolutionAttribution(
    selfEvolutionAttribution || {
      attribution: deriveAttribution({ dataset: selfEvolutionDataset }),
    }
  );
  const selfEvolutionCandidatesSummary = summarizeSelfEvolutionCandidates(selfEvolutionCandidates);
  const selfEvolutionReplaySummary = summarizeSelfEvolutionReplay(selfEvolutionReplay);
  const selfEvolutionCanarySummary = summarizeSelfEvolutionCanary(selfEvolutionCanary);
  const selfEvolutionCanonicalParitySummary = deriveCanonicalParityDiagnostics(selfEvolutionCanonicalParity);
  const selfEvolutionServerSignalAuthoritySummary = summarizeSelfEvolutionServerSignalAuthority(selfEvolutionServerSignalAuthority);
  const selfEvolutionServerSignalQualitySummary = summarizeSelfEvolutionServerSignalQuality(selfEvolutionServerSignalQuality);
  const selfEvolutionServerSignalCutoverReadinessSummary = summarizeSelfEvolutionServerSignalCutoverReadiness(selfEvolutionServerSignalCutoverReadiness);
  const selfEvolutionDropValidationSummary = summarizeSelfEvolutionDropValidation(selfEvolutionDropValidation);
  const selfEvolutionProvisionalRealizedOutcomeSummary = summarizeProvisionalRealizedOutcome(selfEvolutionProvisionalRealizedOutcome);
  const selfEvolutionOverrideAuthoritySummary = summarizeSelfEvolutionOverrideAuthority(selfEvolutionOverrideAuthority);
  const selfEvolutionExecutionQualitySummary = summarizeSelfEvolutionExecutionQuality(selfEvolutionExecutionQuality);
  const selfEvolutionReversePolicySummary = summarizeSelfEvolutionReversePolicy(selfEvolutionReversePolicy);
  const selfEvolutionServerPrimaryLearningEpochSummary = summarizeSelfEvolutionServerPrimaryLearningEpoch(selfEvolutionServerPrimaryLearningEpoch);
  const selfEvolutionInitialSignalQualityContractSummary = selfEvolutionInitialSignalQualityContract && selfEvolutionInitialSignalQualityContract.summary && typeof selfEvolutionInitialSignalQualityContract.summary === "object"
    ? selfEvolutionInitialSignalQualityContract.summary
    : {};
  const selfEvolutionExitTrailingContractSummary = selfEvolutionExitTrailingContract && selfEvolutionExitTrailingContract.summary && typeof selfEvolutionExitTrailingContract.summary === "object"
    ? selfEvolutionExitTrailingContract.summary
    : {};
  const selfEvolutionServerNativeHtfModeComparisonSummary = selfEvolutionServerNativeHtfModeComparison && selfEvolutionServerNativeHtfModeComparison.summary && typeof selfEvolutionServerNativeHtfModeComparison.summary === "object"
    ? selfEvolutionServerNativeHtfModeComparison.summary
    : {};
  const selfEvolutionServerNativeHtfModeGovernorSummary = selfEvolutionServerNativeHtfModeGovernor && selfEvolutionServerNativeHtfModeGovernor.summary && typeof selfEvolutionServerNativeHtfModeGovernor.summary === "object"
    ? selfEvolutionServerNativeHtfModeGovernor.summary
    : {};
  const selfEvolutionMarketObjectiveScoreSummary = summarizeSelfEvolutionMarketObjectiveScore(selfEvolutionMarketObjectiveScore);
  const selfEvolutionServerVsPinePerformanceDeltaSummary = summarizeSelfEvolutionServerVsPinePerformanceDelta(selfEvolutionServerVsPinePerformanceDelta);
  const selfEvolutionMarketRegimeBoardRows = buildOpenClawMarketRegimeRows({
    marketObjectiveScore: selfEvolutionMarketObjectiveScore,
    serverVsPinePerformanceDelta: selfEvolutionServerVsPinePerformanceDelta,
    dropValidation: selfEvolutionDropValidation,
    executionQuality: selfEvolutionExecutionQuality,
    reversePolicy: selfEvolutionReversePolicy,
    serverMarketCapitalAllocator: selfEvolutionServerMarketCapitalAllocator,
    serverMarketQuarantine: selfEvolutionServerMarketQuarantine,
  });
  const selfEvolutionMarketRegimeBoardSummary = buildOpenClawMarketRegimeSummary({
    rows: selfEvolutionMarketRegimeBoardRows,
  });
  const selfEvolutionExplorationBudgetSummary = summarizeSelfEvolutionExplorationBudget(selfEvolutionExplorationBudget);
  const selfEvolutionServerMarketCapitalAllocatorSummary = selfEvolutionServerMarketCapitalAllocator && selfEvolutionServerMarketCapitalAllocator.summary && typeof selfEvolutionServerMarketCapitalAllocator.summary === "object" ? selfEvolutionServerMarketCapitalAllocator.summary : {};
  const selfEvolutionServerMarketQuarantineSummary = selfEvolutionServerMarketQuarantine && selfEvolutionServerMarketQuarantine.summary && typeof selfEvolutionServerMarketQuarantine.summary === "object" ? selfEvolutionServerMarketQuarantine.summary : {};
  const selfEvolutionExplorationProposalSummary = summarizeSelfEvolutionExplorationProposal(selfEvolutionExplorationProposal);
  const selfEvolutionExplorationApplyCandidateSummary = summarizeSelfEvolutionExplorationApplyCandidate(selfEvolutionExplorationApplyCandidate);
  const selfEvolutionChangeResultAttributionSummary = summarizeSelfEvolutionChangeResultAttribution(selfEvolutionChangeResultAttribution);
  const selfEvolutionCanonicalProvenanceSummary = deriveCanonicalProvenanceDiagnostics(selfEvolutionCanonicalProvenance);
  const selfEvolutionServerPrimaryCanarySummary = deriveServerPrimaryCanaryDiagnostics(selfEvolutionServerPrimaryCanary);
  const selfEvolutionPineShadowDriftSummary = derivePineShadowDriftDiagnostics(selfEvolutionPineShadowDrift);
  const selfEvolutionDeploymentProbeSummary = summarizeSelfEvolutionDeploymentProbe(selfEvolutionDeploymentProbe);
  const selfEvolutionBundleActivationSummary = summarizeSelfEvolutionBundleActivation(selfEvolutionBundleActivation);
  const selfEvolutionEvGateRescueSummary = summarizeSelfEvolutionEvGateRescue(selfEvolutionEvGateRescue);
  const selfEvolutionMemorySummary = summarizeSelfEvolutionMemory(selfEvolutionMemory);
  const memoryBlockedIds = new Set(selfEvolutionMemorySummary.blocked_candidate_ids || []);
  const evTunerContext = summarizeEvTunerContext(filterLayers);
  const selfEvolutionCycleSummary = selfEvolutionCycleState && typeof selfEvolutionCycleState === "object"
    ? selfEvolutionCycleState
    : {
      available: false,
      cycle_consistent: true,
      core_cycle_consistent: true,
      cycle_mismatch_n: 0,
      core_cycle_mismatch_n: 0,
      derived_cycle_mismatch_n: 0,
      missing_key_n: 0,
      core_missing_key_n: 0,
      derived_missing_key_n: 0,
      cycle_id_absent_n: 0,
      core_cycle_id_absent_n: 0,
      derived_cycle_id_absent_n: 0,
      missing_keys: [],
      core_missing_keys: [],
      derived_missing_keys: [],
      cycle_mismatches: [],
      core_cycle_mismatches: [],
      derived_cycle_mismatches: [],
      cycle_id_absent_keys: [],
      core_cycle_id_absent_keys: [],
      derived_cycle_id_absent_keys: [],
    };
  const effectivePromotion = deriveAutonomousRecoveryPromotion({
    promotion,
    objective,
    retrospectiveSummary,
    selfEvolutionObjectiveSummary,
    selfEvolutionCandidatesSummary,
    selfEvolutionReplaySummary,
    selfEvolutionCanarySummary,
    selfEvolutionCycleSummary,
    memoryBlockedIds,
    canaryDriftContext,
  });
  const selfEvolutionDeploymentReport = deriveDeploymentGuards({
    objectiveSupervisor: {
      guards: {
        canary_pass: Boolean(canary && canarySummary.drift === 0 && canaryGolden.drift === 0),
      },
      promotion: effectivePromotion,
      rollback,
      self_evolution_objective: selfEvolutionObjectiveSummary,
    },
    candidateChangeSet: selfEvolutionCandidates,
    replayReport: selfEvolutionReplay,
    canaryReport: selfEvolutionCanary,
    memoryLedger: selfEvolutionMemory,
    serverPrimaryCanary: selfEvolutionServerPrimaryCanary,
    serverPrimaryAcceptanceWatch: selfEvolutionServerPrimaryAcceptanceWatch,
  });
  const selfEvolutionDeploymentSummary = summarizeSelfEvolutionDeployment(selfEvolutionDeploymentReport);
  const selfEvolutionDeploymentPlanSummary = summarizeSelfEvolutionDeploymentPlan(deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: effectivePromotion,
      rollback,
      self_evolution_deployment: selfEvolutionDeploymentSummary,
    },
    changeControl,
    codexPatchReview: codex,
    deploymentGuards: selfEvolutionDeploymentReport,
    canaryReport: selfEvolutionCanary,
    stageAutopilot,
    weeklyHistory,
    manualPasteAck,
    signalsCache,
    bundleActivation: selfEvolutionBundleActivation,
    preparedOverride,
  }));
  const selfEvolutionWeightTuning = deriveWeightTuningPlan({
    objective: selfEvolutionObjectiveSummary,
    attribution: selfEvolutionAttributionSummary,
    canary: selfEvolutionCanarySummary,
    memoryLedger: selfEvolutionMemorySummary,
  });
  const governanceRealizedMinSample = resolveGovernanceRealizedMinSample(governance, objective);
  const governanceStrictRealizedN = toNum(objective.realized_n) || 0;
  const governanceMonthlySourceRealizedN = toNum(objective.monthly_source_realized_n) || 0;
  const governanceEffectiveRealizedN = Math.max(governanceStrictRealizedN, governanceMonthlySourceRealizedN);
  const governanceStrictSampleReady = objective.enough_sample === true;
  const governanceSampleReady = governanceStrictSampleReady || governanceEffectiveRealizedN >= governanceRealizedMinSample;
  const governanceFailedChecks = normalizeGovernanceFailedChecks(objective.failed_checks, {
    strictEnoughSample: governanceStrictSampleReady,
    effectiveEnoughSample: governanceSampleReady,
  });
  const selfEvolutionRealizedMinSample = resolveSelfEvolutionRealizedMinSample();
  const selfEvolutionEffectiveRealizedN = Math.max(
    Number(selfEvolutionObjectiveSummary.realized_n || 0),
    Number(selfEvolutionProvisionalRealizedOutcomeSummary.effective_realized_n || 0)
  );
  const selfEvolutionSampleReady = selfEvolutionEffectiveRealizedN >= selfEvolutionRealizedMinSample;
  const selfEvolutionLoopMonitorSummary = summarizeSelfEvolutionLoopMonitor(selfEvolutionLoopMonitor);
  const changeControlRelevant = promotion.ready === true || rollback.ready === true;
  const objectiveRecoveryPriorityActive = Boolean(
    (objective && (objective.monthly_pass === false || objective.pass === false))
    || retrospectiveSummary.any_fail
  );

  const blockers = [];
  if (!objective || governanceSampleReady !== true) blockers.push("GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY");
  if (objective && objective.monthly_pass === false) blockers.push("MONTHLY_TARGET_NOT_MET");
  if (objective && objective.pass === false) blockers.push("OBJECTIVE_NOT_MET");
  if (!retrospectiveSummary.available) blockers.push("RETROSPECTIVE_MISSING");
  if (retrospectiveSummary.active_periods.includes("DAILY") && retrospectiveSummary.daily.pass === false) blockers.push("DAILY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.active_periods.includes("WEEKLY") && retrospectiveSummary.weekly.pass === false) blockers.push("WEEKLY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.active_periods.includes("MONTHLY") && retrospectiveSummary.monthly.pass === false) blockers.push("RETROSPECTIVE_MONTHLY_FAIL");
  if (retrospectiveSummary.daily_scope_no_trade) blockers.push("DAILY_NO_TRADE_ACTIVITY");
  if (retrospectiveSummary.daily_scope_zero_idle) blockers.push("ZERO_KRW_IDLE");
  if (
    !canary
    || (canaryDriftContext.golden_drift || 0) > 0
    || ((canaryDriftContext.shadow_drift || 0) > 0 && canaryDriftContext.shadow_ai_only_drift !== true)
  ) blockers.push("CANARY_DRIFT");
  if (changeControlRelevant && (!changeControl || String(changeControl.verdict || "").toUpperCase() === "HOLD")) {
    blockers.push("CHANGE_CONTROL_HOLD");
  }
  if (changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass !== true) blockers.push("COVERAGE_GUARD_BLOCK");
  if (physicsSummary.block_reason) blockers.push(physicsSummary.block_reason);
  if (selfEvolutionObjectiveSummary.count_floor_pass === false) blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (selfEvolutionObjectiveSummary.replacement_floor_pass === false) blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (selfEvolutionObjectiveSummary.latency_budget_pass === false) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");
  if (selfEvolutionCanonicalParitySummary.available && selfEvolutionCanonicalParitySummary.source_quality_pass === false) blockers.push("SELF_EVOLUTION_CANONICAL_SOURCE_MISMATCH");
  if (
    selfEvolutionServerSignalAuthoritySummary.available
    && selfEvolutionServerSignalAuthoritySummary.drift_status === "PARITY_DRIFT"
    && objectiveRecoveryPriorityActive !== true
  ) blockers.push("SERVER_SIGNAL_PARITY_DRIFT");
  if (selfEvolutionServerSignalQualitySummary.available && selfEvolutionServerSignalQualitySummary.quality_status === "SERVER_SIGNAL_NOT_REACHING_EXECUTION") blockers.push("SERVER_SIGNAL_EXECUTION_GAP");
  if (
    selfEvolutionServerSignalCutoverReadinessSummary.available
    && selfEvolutionServerSignalCutoverReadinessSummary.promotion_ready !== true
    && selfEvolutionServerSignalCutoverReadinessSummary.already_server_primary !== true
    && objectiveRecoveryPriorityActive !== true
  ) blockers.push("SERVER_SIGNAL_CUTOVER_NOT_READY");
  const promotionCandidateId = String(effectivePromotion && effectivePromotion.candidate_id || "").trim() || null;
  const promotionReplay = selfEvolutionReplaySummary.validations.find((row) => String(row && row.candidate_id || "").trim() === promotionCandidateId) || null;
  if (promotionReplay && promotionReplay.validation_verdict === "BLOCK") blockers.push("SELF_EVOLUTION_REPLAY_BLOCK");
  if (effectivePromotion.ready === true && selfEvolutionCanarySummary.available && selfEvolutionCanarySummary.apply_pass !== true) blockers.push("SELF_EVOLUTION_CANARY_BLOCK");
  if (selfEvolutionCanarySummary.rollback_ready_n > 0) blockers.push("SELF_EVOLUTION_CANARY_ROLLBACK_READY");
  if (selfEvolutionDeploymentPlanSummary.activation_pending === true) blockers.push("SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING");
  if (selfEvolutionCycleSummary.available && selfEvolutionCycleSummary.core_cycle_consistent === false) blockers.push("SELF_EVOLUTION_ARTIFACT_CYCLE_MISMATCH");
  if (selfEvolutionLoopMonitorSummary.available && selfEvolutionLoopMonitorSummary.core_cycle_consistent === false) blockers.push("SELF_EVOLUTION_LOOP_CYCLE_MISMATCH");
  if (effectivePromotion.ready === true && promotionCandidateId && memoryBlockedIds.has(promotionCandidateId)) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK");
  if (effectivePromotion.ready === true && selfEvolutionDeploymentSummary.deploy_pass !== true) {
    const deployReason = Array.isArray(selfEvolutionDeploymentSummary.blockers) && selfEvolutionDeploymentSummary.blockers.length
      ? selfEvolutionDeploymentSummary.blockers[0]
      : "SELF_EVOLUTION_DEPLOYMENT_BLOCK";
    if (!blockers.includes(deployReason)) blockers.push(deployReason);
  }
  if (
    (effectivePromotion.ready === true || rollback.ready === true)
    && selfEvolutionDeploymentPlanSummary.prepare_pass !== true
    && !(
      selfEvolutionDeploymentPlanSummary.authority_approved === true
      && selfEvolutionDeploymentPlanSummary.external_authority_pending !== true
      && normalizePlanStatus(selfEvolutionDeploymentPlanSummary.plan_status) === "APPLIED_ACTIVE"
    )
  ) {
    blockers.push("SELF_EVOLUTION_DEPLOYMENT_PLAN_BLOCK");
  }
  if (codex && codexStatus === "FAILED" && (effectivePromotion.ready === true || rollback.ready === true)) {
    blockers.push("CODEX_REVIEW_FAILED");
  }
  if ((effectivePromotion.ready === true || rollback.ready === true) && !stageAutopilotFresh) {
    blockers.push("STAGE_AUTOPILOT_STALE");
  }
  const objectiveBlockReason = retrospectiveSummary.daily_scope_no_trade
    ? "DAILY_NO_TRADE_ACTIVITY"
    : retrospectiveSummary.daily_scope_zero_idle
      ? "ZERO_KRW_IDLE"
      : physicsSummary.block_reason
        ? physicsSummary.block_reason
      : selfEvolutionObjectiveSummary.count_floor_pass === false
        ? "SELF_EVOLUTION_COUNT_FLOOR_FAIL"
      : selfEvolutionObjectiveSummary.replacement_floor_pass === false
        ? "SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL"
      : selfEvolutionObjectiveSummary.latency_budget_pass === false
        ? "SELF_EVOLUTION_LATENCY_BUDGET_FAIL"
      : (selfEvolutionCanonicalParitySummary.available && selfEvolutionCanonicalParitySummary.source_quality_pass === false)
        ? "SELF_EVOLUTION_CANONICAL_SOURCE_MISMATCH"
      : (promotionReplay && promotionReplay.validation_verdict === "BLOCK")
        ? "SELF_EVOLUTION_REPLAY_BLOCK"
      : (promotion.ready === true && selfEvolutionCanarySummary.available && selfEvolutionCanarySummary.apply_pass !== true)
        ? "SELF_EVOLUTION_CANARY_BLOCK"
      : selfEvolutionCanarySummary.rollback_ready_n > 0
        ? "SELF_EVOLUTION_CANARY_ROLLBACK_READY"
      : selfEvolutionDeploymentPlanSummary.activation_pending === true
        ? "SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING"
      : (selfEvolutionCycleSummary.available && selfEvolutionCycleSummary.core_cycle_consistent === false)
        ? "SELF_EVOLUTION_ARTIFACT_CYCLE_MISMATCH"
      : (selfEvolutionLoopMonitorSummary.available && selfEvolutionLoopMonitorSummary.core_cycle_consistent === false)
        ? "SELF_EVOLUTION_LOOP_CYCLE_MISMATCH"
      : (promotion.ready === true && promotionCandidateId && memoryBlockedIds.has(promotionCandidateId))
        ? "SELF_EVOLUTION_MEMORY_BLOCK"
      : (promotion.ready === true && selfEvolutionDeploymentSummary.deploy_pass !== true)
        ? ((Array.isArray(selfEvolutionDeploymentSummary.blockers) && selfEvolutionDeploymentSummary.blockers.length)
          ? selfEvolutionDeploymentSummary.blockers[0]
          : "SELF_EVOLUTION_DEPLOYMENT_BLOCK")
      : retrospectiveSummary.any_fail
        ? "RETROSPECTIVE_OBJECTIVE_FAIL"
      : (!objective || governanceSampleReady !== true)
          ? "GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY"
          : (objective && objective.pass === false)
            ? "OBJECTIVE_NOT_MET"
            : null;
  const recoveryModeObjectiveBypassReasons = new Set([
    "DAILY_NO_TRADE_ACTIVITY",
    "OBJECTIVE_NOT_MET",
    "MONTHLY_TARGET_NOT_MET",
    "RETROSPECTIVE_OBJECTIVE_FAIL",
    "DAILY_OBJECTIVE_FAIL",
    "WEEKLY_OBJECTIVE_FAIL",
    "RETROSPECTIVE_MONTHLY_FAIL",
  ]);
  const promotionObjectiveBlockReason = effectivePromotion && effectivePromotion.recovery_mode === true && recoveryModeObjectiveBypassReasons.has(objectiveBlockReason)
    ? null
    : objectiveBlockReason;
  const normalizedDeploymentPlanStatus = normalizePlanStatus(selfEvolutionDeploymentPlanSummary.plan_status);
  const deploymentPlanActiveApproved = Boolean(
    selfEvolutionDeploymentPlanSummary.authority_approved === true
    && selfEvolutionDeploymentPlanSummary.external_authority_pending !== true
    && normalizedDeploymentPlanStatus === "APPLIED_ACTIVE"
  );
  const recoveryPromotionActiveApproved = Boolean(
    effectivePromotion
    && effectivePromotion.ready === true
    && effectivePromotion.recovery_mode === true
    && codex
    && codexFresh
    && codexVerdict === "PROMOTE"
    && deploymentPlanActiveApproved
    && (
      !promotionCandidateId
      || !selfEvolutionDeploymentPlanSummary.target_candidate_id
      || selfEvolutionDeploymentPlanSummary.target_candidate_id === promotionCandidateId
    )
  );
  const recoveryPromotionPreferred = Boolean(
    effectivePromotion
    && effectivePromotion.ready === true
    && effectivePromotion.recovery_mode === true
    && !promotionObjectiveBlockReason
    && codex
    && codexFresh
    && codexVerdict === "PROMOTE"
    && stageAutopilotFresh
    && selfEvolutionDeploymentPlanSummary.prepare_pass === true
  );

  let verdict = "HOLD";
  let reason = "NO_ACTION_READY";
  if (recoveryPromotionActiveApproved) {
    verdict = "HOLD";
    reason = objectiveBlockReason || "OBJECTIVE_RECOVERY_ACTIVE";
  } else if (recoveryPromotionPreferred) {
    verdict = "PATCH_CANDIDATE";
    reason = "AUTONOMOUS_RECOVERY_PROMOTION_READY";
  } else if (rollback && rollback.ready === true) {
    if (selfEvolutionDeploymentPlanSummary.activation_pending === true) {
      verdict = "HOLD";
      reason = "SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING";
    } else if (!codex || !codexFresh) {
      verdict = "HOLD";
      reason = "EXTERNAL_AUTHORITY_REQUIRED_ROLLBACK";
      blockers.push("EXTERNAL_AUTHORITY_REQUIRED_ROLLBACK");
    } else if (!stageAutopilotFresh) {
      verdict = "HOLD";
      reason = "STAGE_AUTOPILOT_REQUIRED_ROLLBACK";
      blockers.push("STAGE_AUTOPILOT_REQUIRED_ROLLBACK");
    } else if (deploymentPlanActiveApproved) {
      verdict = "HOLD";
      reason = objectiveBlockReason || "OBJECTIVE_RECOVERY_ACTIVE";
    } else if (codexVerdict === "ROLLBACK") {
      verdict = "ROLLBACK_CANDIDATE";
      reason = "AUTO_ROLLBACK_READY";
    } else {
      verdict = "HOLD";
      reason = "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK";
      blockers.push("EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");
    }
  } else if (effectivePromotion && effectivePromotion.ready === true) {
    const recoveryPromotion = effectivePromotion.recovery_mode === true;
    if (promotionObjectiveBlockReason) {
      verdict = "HOLD";
      reason = promotionObjectiveBlockReason;
    } else if (!codex || !codexFresh) {
      verdict = "HOLD";
      reason = "EXTERNAL_AUTHORITY_REQUIRED_PROMOTION";
      blockers.push("EXTERNAL_AUTHORITY_REQUIRED_PROMOTION");
    } else if (!stageAutopilotFresh) {
      verdict = "HOLD";
      reason = "STAGE_AUTOPILOT_REQUIRED_PROMOTION";
      blockers.push("STAGE_AUTOPILOT_REQUIRED_PROMOTION");
    } else if (codexVerdict !== "PROMOTE") {
      verdict = "HOLD";
      reason = "EXTERNAL_AUTHORITY_BLOCK_PROMOTION";
      blockers.push("EXTERNAL_AUTHORITY_BLOCK_PROMOTION");
    } else if (selfEvolutionDeploymentPlanSummary.prepare_pass !== true) {
      verdict = "HOLD";
      reason = "SELF_EVOLUTION_DEPLOYMENT_PLAN_BLOCK";
    } else {
      verdict = "PATCH_CANDIDATE";
      reason = recoveryPromotion ? "AUTONOMOUS_RECOVERY_PROMOTION_READY" : "AUTO_PROMOTION_READY";
    }
  } else if (objectiveBlockReason) {
    verdict = "HOLD";
    reason = objectiveBlockReason;
  } else if (objective && objective.pass === true) {
    verdict = "HOLD";
    reason = "OBJECTIVE_ON_TRACK";
  } else if (blockers.length) {
    verdict = "HOLD";
    reason = blockers[0];
  }

  const codexAuthority = summarizeCodexAuthority({
    reportVerdict: verdict,
    reportReason: reason,
    codexReview: {
      owner: String(codex && codex.owner || "").trim() || "CODEX",
      authority_mode: String(codex && codex.authority_mode || "").trim().toUpperCase() || null,
      status: codexDisplayStatus,
      verdict: codexVerdict,
      recommended_candidate_id: codexCandidateId,
      display_candidate_id: codexDisplayCandidateId,
      recommended_rollback_file_path: codexRollbackPath,
      confidence: toNum(codex && codex.confidence),
      reason: String(codex && (codex.reason || codex.summary) || "N/A"),
      codex_review: codex && codex.codex_review ? codex.codex_review : null,
      claude_review: codex && codex.claude_review ? codex.claude_review : null,
    },
    deploymentPlan: selfEvolutionDeploymentPlanSummary,
  });
  const actionPlan = buildSupervisorActionPlan({
    reason,
    blockers,
    promotionCandidateId,
    promotionReplay,
    deployment: selfEvolutionDeploymentSummary,
    deploymentPlan: selfEvolutionDeploymentPlanSummary,
    governanceEnoughSample: governanceSampleReady,
    codexFresh,
    stageAutopilotFresh,
    retrospective: retrospectiveSummary,
    canaryDriftContext,
    evTunerContext,
    selfEvolutionDatasetSummary,
  });
  const autonomyAssessment = assessAutonomy({
    blockers,
    promotion: effectivePromotion,
    selfEvolutionCycleSummary,
    selfEvolutionDeploymentPlanSummary,
    selfEvolutionWeightTuning,
    selfEvolutionDatasetSummary,
    selfEvolutionCandidatesSummary,
    selfEvolutionReplaySummary,
    selfEvolutionCanarySummary,
  });

  return {
    verdict,
    reason,
    root_cause: reason,
    action_plan: actionPlan,
    blockers: Array.from(new Set(blockers)),
    objective: {
      scope: "GOVERNANCE_7D_ENTRY_COHORT",
      verdict: String(objective.verdict || "N/A"),
      pass: objective.pass === true,
      enough_sample: governanceSampleReady,
      strict_enough_sample: governanceStrictSampleReady,
      activity_pass: objective.activity_pass === true,
      executed_n: toNum(objective.executed_n),
      realized_n: governanceStrictRealizedN,
      monthly_source_realized_n: governanceMonthlySourceRealizedN,
      effective_realized_n: governanceEffectiveRealizedN,
      realized_min_sample: governanceRealizedMinSample,
      win_rate: toNum(governance && governance.current && governance.current.overall && governance.current.overall.win_rate),
      avg_ret_net: toNum(governance && governance.current && governance.current.overall && governance.current.overall.avg_ret_net),
      net_pnl_quote: toNum(governance && governance.current && governance.current.overall && governance.current.overall.net_pnl_quote),
      monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw),
      min_monthly_net_krw: toNum(objectiveCfg.min_monthly_net_krw),
      monthly_pass: objective.monthly_pass === true,
      failed_checks: governanceFailedChecks,
    },
    governance_objective: {
      scope: "GOVERNANCE_7D_ENTRY_COHORT",
      verdict: String(objective.verdict || "N/A"),
      pass: objective.pass === true,
      enough_sample: governanceSampleReady,
      strict_enough_sample: governanceStrictSampleReady,
      activity_pass: objective.activity_pass === true,
      executed_n: toNum(objective.executed_n),
      realized_n: governanceStrictRealizedN,
      monthly_source_realized_n: governanceMonthlySourceRealizedN,
      effective_realized_n: governanceEffectiveRealizedN,
      realized_min_sample: governanceRealizedMinSample,
      win_rate: toNum(governance && governance.current && governance.current.overall && governance.current.overall.win_rate),
      avg_ret_net: toNum(governance && governance.current && governance.current.overall && governance.current.overall.avg_ret_net),
      net_pnl_quote: toNum(governance && governance.current && governance.current.overall && governance.current.overall.net_pnl_quote),
      monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw),
      min_monthly_net_krw: toNum(objectiveCfg.min_monthly_net_krw),
      monthly_pass: objective.monthly_pass === true,
      failed_checks: governanceFailedChecks,
    },
    promotion: {
      ready: effectivePromotion.ready === true,
      reason: String(effectivePromotion.reason || "N/A"),
      recovery_mode: effectivePromotion.recovery_mode === true,
      candidate_id: String(effectivePromotion.candidate_id || "").trim() || null,
      display_candidate_id: resolveDisplayCandidateId(effectivePromotion.candidate_id, changeControl),
      streak_current: toNum(effectivePromotion.streak_current),
      streak_required: toNum(effectivePromotion.streak_required),
      replay_verdict: String(promotionReplay && promotionReplay.validation_verdict || "").trim().toUpperCase() || null,
      replay_delta: toNum(promotionReplay && promotionReplay.candidate_objective_delta),
      replay_blockers: Array.isArray(promotionReplay && promotionReplay.blockers) ? promotionReplay.blockers : [],
    },
    rollback: {
      ready: rollback.ready === true,
      reason: String(rollback.reason || "N/A"),
      rollback_file_path: String(rollback.rollback_file_path || "").trim() || null,
      based_on_patch_id: String(rollback.based_on_patch_id || "").trim() || null,
      based_on_week_key: String(rollback.based_on_week_key || "").trim() || null,
    },
    guards: {
      canary_pass: Boolean(canary && canarySummary.drift === 0 && canaryGolden.drift === 0),
      canary_shadow_drift: toNum(canarySummary.drift) || 0,
      canary_golden_drift: toNum(canaryGolden.drift) || 0,
      coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass === true),
      ai_coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.ai && changeControl.coverage_guard.ai.pass === true),
      market_coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.market && changeControl.coverage_guard.market.pass === true),
    },
    physics: physicsSummary,
    phase0: phase0Summary,
    self_evolution_dataset: selfEvolutionDatasetSummary,
    self_evolution_objective: selfEvolutionObjectiveSummary,
    self_evolution_attribution: selfEvolutionAttributionSummary,
    self_evolution_candidates: selfEvolutionCandidatesSummary,
    self_evolution_replay: selfEvolutionReplaySummary,
    self_evolution_canary: selfEvolutionCanarySummary,
    self_evolution_canonical_parity: selfEvolutionCanonicalParitySummary,
    self_evolution_server_signal_authority: selfEvolutionServerSignalAuthoritySummary,
    self_evolution_server_signal_quality: selfEvolutionServerSignalQualitySummary,
    self_evolution_server_signal_cutover_readiness: selfEvolutionServerSignalCutoverReadinessSummary,
    self_evolution_drop_validation: selfEvolutionDropValidationSummary,
    self_evolution_provisional_realized_outcome: selfEvolutionProvisionalRealizedOutcomeSummary,
    self_evolution_override_authority: selfEvolutionOverrideAuthoritySummary,
    self_evolution_execution_quality: selfEvolutionExecutionQualitySummary,
    self_evolution_reverse_policy: selfEvolutionReversePolicySummary,
    self_evolution_server_primary_learning_epoch: selfEvolutionServerPrimaryLearningEpochSummary,
    self_evolution_initial_signal_quality_contract: selfEvolutionInitialSignalQualityContractSummary,
    self_evolution_exit_trailing_contract: selfEvolutionExitTrailingContractSummary,
    self_evolution_server_native_htf_mode_comparison: selfEvolutionServerNativeHtfModeComparisonSummary,
    self_evolution_server_native_htf_mode_governor: selfEvolutionServerNativeHtfModeGovernorSummary,
    self_evolution_market_objective_score: selfEvolutionMarketObjectiveScoreSummary,
    self_evolution_server_vs_pine_performance_delta: selfEvolutionServerVsPinePerformanceDeltaSummary,
    self_evolution_market_regime_board: selfEvolutionMarketRegimeBoardSummary,
    self_evolution_exploration_budget: selfEvolutionExplorationBudgetSummary,
    self_evolution_server_market_capital_allocator: selfEvolutionServerMarketCapitalAllocatorSummary,
    self_evolution_server_market_quarantine: selfEvolutionServerMarketQuarantineSummary,
    self_evolution_exploration_proposal: selfEvolutionExplorationProposalSummary,
    self_evolution_exploration_apply_candidate: selfEvolutionExplorationApplyCandidateSummary,
    self_evolution_change_result_attribution: selfEvolutionChangeResultAttributionSummary,
    self_evolution_canonical_provenance: selfEvolutionCanonicalProvenanceSummary,
    self_evolution_server_primary_canary: selfEvolutionServerPrimaryCanarySummary,
    self_evolution_pine_shadow_drift: selfEvolutionPineShadowDriftSummary,
    self_evolution_deployment_probe: selfEvolutionDeploymentProbeSummary,
    self_evolution_bundle_activation: selfEvolutionBundleActivationSummary,
    self_evolution_ev_gate_rescue: selfEvolutionEvGateRescueSummary,
    self_evolution_cycle: selfEvolutionCycleSummary,
    self_evolution_deployment: selfEvolutionDeploymentSummary,
    self_evolution_deployment_plan: selfEvolutionDeploymentPlanSummary,
    self_evolution_loop_monitor: selfEvolutionLoopMonitorSummary,
    self_evolution_weight_tuning: selfEvolutionWeightTuning,
    self_evolution_memory: selfEvolutionMemorySummary,
    current_latest_context: {
      report_generated_at_kst: null,
      target_cycle_id: selfEvolutionCycleSummary.expected_cycle_id || null,
      evaluation_scope: "STANDALONE",
      latest_mode: "STANDALONE_RECOMPUTE",
      standalone_recompute: true,
    },
    filter_canary_drift_context: canaryDriftContext,
    ev_tuner_context: evTunerContext,
    retrospective_activity_context: {
      source: "RETROSPECTIVE_DAILY",
      daily_executed_n: retrospectiveSummary.daily.executed_n,
      daily_realized_n: retrospectiveSummary.daily.realized_n,
      daily_failed_checks: retrospectiveSummary.daily.failed_checks,
      daily_no_trade: retrospectiveSummary.daily_no_trade === true,
      daily_zero_idle: retrospectiveSummary.daily_zero_idle === true,
      dataset_window_source: selfEvolutionDatasetSummary.window_source || null,
      dataset_executed_n_7d: toNum(selfEvolutionDatasetSummary.executed_n),
      dataset_realized_n_7d: toNum(selfEvolutionDatasetSummary.realized_n),
    },
    operational_recovery_context: {
      recommended_scheduler_policy: retrospectiveSummary.daily_scope_no_trade ? "ACTIVE_TRADING_HOURS_ONLY" : "NORMAL_4H",
      daily_no_trade: retrospectiveSummary.daily_no_trade === true,
      daily_zero_idle: retrospectiveSummary.daily_zero_idle === true,
      daily_executed_n: retrospectiveSummary.daily.executed_n,
      daily_realized_n: retrospectiveSummary.daily.realized_n,
    },
    sample_readiness: {
      governance_realized_n: governanceStrictRealizedN,
      governance_monthly_source_realized_n: governanceMonthlySourceRealizedN,
      governance_effective_realized_n: governanceEffectiveRealizedN,
      governance_realized_min_sample: governanceRealizedMinSample,
      governance_strict_enough_sample: governanceStrictSampleReady,
      governance_enough_sample: governanceSampleReady,
      self_evolution_realized_n: toNum(selfEvolutionObjectiveSummary.realized_n) || 0,
      self_evolution_provisional_realized_n: toNum(selfEvolutionProvisionalRealizedOutcomeSummary.provisional_realized_n) || 0,
      self_evolution_effective_realized_n: selfEvolutionEffectiveRealizedN,
      self_evolution_realized_min_sample: selfEvolutionRealizedMinSample,
      self_evolution_enough_sample: selfEvolutionSampleReady,
    },
    self_evolution_policy: selfEvolutionPolicy,
    best_febt_tuning_contract: bestFebtTuningContract,
    best_febt_market_contracts: bestFebtMarketContracts,
    filter_layers: filterLayers,
    autonomy_assessment: autonomyAssessment,
    tuning: {
      ev_reason: String(ev && ev.decision_reason || "N/A"),
      wait_reason: String(wait && wait.reason || "N/A"),
      ml_quality_actions: Array.isArray(ml && ml.recommendations && ml.recommendations.QUALITY) ? ml.recommendations.QUALITY.length : 0,
      ml_market_action: String(ml && ml.recommendations && ml.recommendations.MARKET && ml.recommendations.MARKET.action || "N/A"),
      ml_ev_action: String(ml && ml.recommendations && ml.recommendations.EV && ml.recommendations.EV.action || "N/A"),
    },
    codex_review: {
      available: !!codex,
      status: codexDisplayStatus,
      verdict: codexVerdict,
      recommended_candidate_id: codexCandidateId,
      display_candidate_id: codexDisplayCandidateId,
      recommended_rollback_file_path: codexRollbackPath,
      confidence: toNum(codex && codex.confidence),
      reason: String(codex && (codex.reason || codex.summary) || "N/A"),
    },
    codex_authority: codexAuthority,
    stage_autopilot: {
      available: !!stageAutopilot,
      status: stageAutopilotFresh ? "FRESH" : (stageAutopilot ? "STALE" : "N/A"),
      objective_verdict: String(stageAutopilot && stageAutopilot.objective_verdict || "N/A"),
      action_n: Array.isArray(stageAutopilot && stageAutopilot.actions) ? stageAutopilot.actions.length : 0,
      action_types: Array.isArray(stageAutopilot && stageAutopilot.actions)
        ? Array.from(new Set(stageAutopilot.actions.map((row) => String(row && row.type || "N/A"))))
        : [],
    },
    retrospective: retrospectiveSummary,
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Objective Supervisor",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- root_cause: ${report.root_cause || "N/A"}`,
    `- blockers: ${(report.blockers || []).length ? report.blockers.join(", ") : "none"}`,
    `- action_plan: ${(report.action_plan || []).length ? report.action_plan.join(" | ") : "none"}`,
    `- latest_context: ${(report.current_latest_context && report.current_latest_context.latest_mode) || "N/A"} / target_cycle=${report.current_latest_context && report.current_latest_context.target_cycle_id || "N/A"} / generated=${report.current_latest_context && report.current_latest_context.report_generated_at_kst || report.generated_at_kst || "N/A"}`,
    "",
    "## Objective",
    `- objective: ${report.objective && report.objective.verdict || "N/A"}`,
    `- activity: ${report.objective && report.objective.activity_pass ? "PASS" : "FAIL"} / executed=${report.objective && report.objective.executed_n != null ? report.objective.executed_n : "N/A"}`,
    `- governance enough_sample: ${report.objective && report.objective.enough_sample ? "YES" : "NO"} / strict=${report.objective && report.objective.strict_enough_sample ? "YES" : "NO"} / realized=${report.objective && report.objective.realized_n != null ? report.objective.realized_n : "N/A"} / monthly_source=${report.objective && report.objective.monthly_source_realized_n != null ? report.objective.monthly_source_realized_n : "N/A"} / effective=${report.objective && report.objective.effective_realized_n != null ? report.objective.effective_realized_n : "N/A"} / min=${report.objective && report.objective.realized_min_sample != null ? report.objective.realized_min_sample : "N/A"}`,
    `- win_rate: ${pct(report.objective && report.objective.win_rate)}`,
    `- avg_ret_net: ${pct(report.objective && report.objective.avg_ret_net)}`,
    `- net_pnl_quote: ${signedNum(report.objective && report.objective.net_pnl_quote, 2)}`,
    `- monthly_run_rate_krw: ${signedNum(report.objective && report.objective.monthly_run_rate_krw, 0)} / target=${signedNum(report.objective && report.objective.min_monthly_net_krw, 0)}`,
    `- monthly_pass: ${report.objective && report.objective.monthly_pass ? "PASS" : "FAIL"}`,
    "",
    "## Retrospective",
    `- daily: ${report.retrospective && report.retrospective.daily ? `${report.retrospective.daily.verdict} / executed=${report.retrospective.daily.executed_n ?? "N/A"} / realized=${report.retrospective.daily.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.daily.net_pnl_quote, 0)}` : "N/A"}`,
    `- activity_scope: ${report.retrospective_activity_context && report.retrospective_activity_context.source || "N/A"} / daily_no_trade=${report.retrospective_activity_context && report.retrospective_activity_context.daily_no_trade ? "YES" : "NO"} / daily_zero_idle=${report.retrospective_activity_context && report.retrospective_activity_context.daily_zero_idle ? "YES" : "NO"} / dataset_7d_executed=${report.retrospective_activity_context && report.retrospective_activity_context.dataset_executed_n_7d != null ? report.retrospective_activity_context.dataset_executed_n_7d : "N/A"}`,
    `- weekly: ${report.retrospective && report.retrospective.weekly ? `${report.retrospective.weekly.verdict} / executed=${report.retrospective.weekly.executed_n ?? "N/A"} / realized=${report.retrospective.weekly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.weekly.net_pnl_quote, 0)}` : "N/A"}`,
    `- monthly: ${report.retrospective && report.retrospective.monthly ? `${report.retrospective.monthly.verdict} / executed=${report.retrospective.monthly.executed_n ?? "N/A"} / realized=${report.retrospective.monthly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.monthly.net_pnl_quote, 0)}` : "N/A"}`,
    "",
    "## Change Control",
    `- promotion: ${report.promotion && report.promotion.ready ? "READY" : "HOLD"} / ${report.promotion && report.promotion.reason || "N/A"} / candidate=${report.promotion && (report.promotion.display_candidate_id || report.promotion.candidate_id) || "N/A"}`,
    `- promotion replay: ${report.promotion && report.promotion.replay_verdict || "N/A"} / delta=${signedNum(report.promotion && report.promotion.replay_delta, 4)} / blockers=${report.promotion && Array.isArray(report.promotion.replay_blockers) && report.promotion.replay_blockers.length ? report.promotion.replay_blockers.join(", ") : "none"}`,
    `- rollback: ${report.rollback && report.rollback.ready ? "READY" : "HOLD"} / ${report.rollback && report.rollback.reason || "N/A"} / target=${report.rollback && report.rollback.rollback_file_path || "N/A"}`,
    "",
    "## Guards",
    `- canary: ${report.guards && report.guards.canary_pass ? "PASS" : "BLOCK"} / golden=${report.guards && report.guards.canary_golden_drift != null ? report.guards.canary_golden_drift : "N/A"} / shadow=${report.guards && report.guards.canary_shadow_drift != null ? report.guards.canary_shadow_drift : "N/A"}`,
    `- coverage: ${report.guards && report.guards.coverage_pass ? "PASS" : "BLOCK"} / ai=${report.guards && report.guards.ai_coverage_pass ? "PASS" : "BLOCK"} / market=${report.guards && report.guards.market_coverage_pass ? "PASS" : "BLOCK"}`,
    `- canary_drift_detail: shadow=${report.filter_canary_drift_context && report.filter_canary_drift_context.shadow_drift != null ? report.filter_canary_drift_context.shadow_drift : "N/A"} / golden=${report.filter_canary_drift_context && report.filter_canary_drift_context.golden_drift != null ? report.filter_canary_drift_context.golden_drift : "N/A"} / top=${report.filter_canary_drift_context && report.filter_canary_drift_context.primary_label || "N/A"}`,
    `- ev_tuner_detail: stale=${report.ev_tuner_context && report.ev_tuner_context.stale ? "YES" : "NO"} / age_hours=${report.ev_tuner_context && report.ev_tuner_context.age_hours != null ? Number(report.ev_tuner_context.age_hours).toFixed(1) : "N/A"} / observed=${report.ev_tuner_context && report.ev_tuner_context.observed_reason || "N/A"} / source=${report.ev_tuner_context && report.ev_tuner_context.policy_source || "N/A"}`,
    "",
    "## Filter Layers",
    `- 1차 상태/무결성: ${report.filter_layers && report.filter_layers.integrity ? `${report.filter_layers.integrity.server_mode} / coverage=${report.filter_layers.integrity.coverage_pass ? "PASS" : "BLOCK"} / ${report.filter_layers.integrity.expectation}` : "N/A"}`,
    `- 2차 진입 품질: ${report.filter_layers && report.filter_layers.entry_quality ? `candidate=${report.filter_layers.entry_quality.pine_candidate_verdict} / ml_quality_actions=${report.filter_layers.entry_quality.quality_actions}` : "N/A"}`,
    `- 3차 상태 기반 Soft Sizing: ${report.filter_layers && report.filter_layers.state_soft_sizing ? `${report.filter_layers.state_soft_sizing.ml_action} / physics=${report.filter_layers.state_soft_sizing.physics_action} / qty=${report.filter_layers.state_soft_sizing.qty_scale != null ? report.filter_layers.state_soft_sizing.qty_scale : "N/A"} / dominant_state=${report.filter_layers.state_soft_sizing.dominant_state || "N/A"} / dominant_action=${report.filter_layers.state_soft_sizing.dominant_action || "N/A"}` : "N/A"}`,
    `- 4차 EV/시간가치층: ${report.filter_layers && report.filter_layers.ev_time_value ? `${report.filter_layers.ev_time_value.tuner_reason} / policy=${report.filter_layers.ev_time_value.policy_version || "N/A"} / source=${report.filter_layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
    `- 5차 WAIT 타이밍층: ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / action=${report.filter_layers.wait_timing.wait_action} / FEBT calc=${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known=${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire=${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late=${report.filter_layers.wait_timing.febt_late_n ?? 0} / void=${report.filter_layers.wait_timing.febt_void_n ?? 0} / disagree=${report.filter_layers.wait_timing.febt_disagreement_n ?? 0} / fallback=${report.filter_layers.wait_timing.febt_fallback_legacy_n ?? 0} / missing=${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
    "",
    "## Market Physics",
    `- state: ${report.physics && report.physics.display_state || "정보 없음"} (${report.physics && report.physics.state || "N/A"}) / executed=${report.physics && report.physics.executed_n != null ? report.physics.executed_n : "N/A"} / block=${report.physics && report.physics.block_reason || "none"}`,
    `- entropy=${pct(report.physics && report.physics.entropy)} / coherence=${pct(report.physics && report.physics.coherence)} / transition=${pct(report.physics && report.physics.transition_risk)} / align=${pct(report.physics && report.physics.field_alignment)} / wall=${pct(report.physics && report.physics.domain_wall_density)} / susc=${pct(report.physics && report.physics.susceptibility)} / free_energy=${pct(report.physics && report.physics.free_energy)}`,
    "",
    "## FEBT Phase 0",
    `- available: ${report.phase0 && report.phase0.available ? "YES" : "NO"} / fresh=${report.phase0 && report.phase0.fresh ? "YES" : "NO"} / provider=${report.phase0 && report.phase0.provider || "N/A"} / tf=${report.phase0 && report.phase0.tf || "N/A"}`,
    `- legacy_wait coverage=${pct(report.phase0 && report.phase0.legacy_wait_coverage_rate)} / observed=${report.phase0 && report.phase0.legacy_wait_observed_chain_n != null ? report.phase0.legacy_wait_observed_chain_n : "N/A"}`,
    `- legacy_wait immediate_win=${pct(report.phase0 && report.phase0.immediate_win_rate)} / saved_loss=${pct(report.phase0 && report.phase0.saved_loss_pct)} / missed_gain=${pct(report.phase0 && report.phase0.missed_gain_pct)} / delta=${signedPct(report.phase0 && report.phase0.saved_loss_minus_missed_gain)}`,
    `- bridge webhook_to_fill p95=${report.phase0 && report.phase0.webhook_to_fill_p95_ms != null ? `${Number(report.phase0.webhook_to_fill_p95_ms).toFixed(0)}ms` : "N/A"} / duplicate=${report.phase0 && report.phase0.duplicate_count != null ? report.phase0.duplicate_count : "N/A"} / reject=${report.phase0 && report.phase0.reject_count != null ? report.phase0.reject_count : "N/A"}`,
    "",
    "## BEST/FEBT Tuning Contract",
    `- mode: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"}`,
    `- tightening_allowed: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "YES" : "NO"} / recovery_priority: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "YES" : "NO"}`,
    `- projected_replacement_ratio: ${pct(report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio)}`,
    `- projected_count_ratio_global: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2) : "N/A"}`,
    `- projected_net_signal_delta_n: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_net_signal_delta_n != null ? report.best_febt_tuning_contract.projected_net_signal_delta_n : "N/A"}`,
    `- fire/late/void: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fire_n != null ? report.best_febt_tuning_contract.fire_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.late_n != null ? report.best_febt_tuning_contract.late_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.void_n != null ? report.best_febt_tuning_contract.void_n : "N/A"}`,
    `- disagreement/fallback/missing: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.disagreement_n != null ? report.best_febt_tuning_contract.disagreement_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fallback_legacy_n != null ? report.best_febt_tuning_contract.fallback_legacy_n : "N/A"} / ${pct(report.best_febt_tuning_contract && report.best_febt_tuning_contract.missing_rate)}`,
    "",
    "## Self-Evolution Policy",
    `- master_spec_path: ${report.self_evolution_policy && report.self_evolution_policy.master_spec_path || "N/A"}`,
    `- dataset_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.dataset_latest_path || "N/A"}`,
    `- objective_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.objective_latest_path || "N/A"}`,
    `- attribution_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.attribution_latest_path || "N/A"}`,
    `- candidates_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.candidates_latest_path || "N/A"}`,
    `- replay_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.replay_latest_path || "N/A"}`,
    `- canary_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.canary_latest_path || "N/A"}`,
    `- deployment_guards_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.deployment_guards_latest_path || "N/A"}`,
    `- deployment_plan_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.deployment_plan_latest_path || "N/A"}`,
    `- loop_monitor_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.loop_monitor_latest_path || "N/A"}`,
    `- loop_run_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.loop_run_latest_path || "N/A"}`,
    `- weight_tuning_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.weight_tuning_latest_path || "N/A"}`,
    `- memory_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.memory_latest_path || "N/A"}`,
    `- status: ${report.self_evolution_policy && report.self_evolution_policy.status || "N/A"}`,
    `- current_focus: ${report.self_evolution_policy && report.self_evolution_policy.current_focus || "N/A"}`,
    `- next_focus: ${report.self_evolution_policy && report.self_evolution_policy.next_focus || "N/A"}`,
    ...((report.self_evolution_policy && Array.isArray(report.self_evolution_policy.linked_paths) && report.self_evolution_policy.linked_paths.length)
      ? report.self_evolution_policy.linked_paths.map((row) => `- doc: ${row}`)
      : ["- doc: none"]),
    "",
    "## Self-Evolution Dataset",
    `- rows/executed/drop/missed: ${report.self_evolution_dataset && report.self_evolution_dataset.rows_n != null ? report.self_evolution_dataset.rows_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.executed_n != null ? report.self_evolution_dataset.executed_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.drop_n != null ? report.self_evolution_dataset.drop_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.missed_n != null ? report.self_evolution_dataset.missed_n : "N/A"}`,
    `- fallback/rejected/partial: ${report.self_evolution_dataset && report.self_evolution_dataset.fallback_n != null ? report.self_evolution_dataset.fallback_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.rejected_n != null ? report.self_evolution_dataset.rejected_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.partial_n != null ? report.self_evolution_dataset.partial_n : "N/A"}`,
    `- realized_n: ${report.self_evolution_dataset && report.self_evolution_dataset.realized_n != null ? report.self_evolution_dataset.realized_n : "N/A"} / features=${pct(report.self_evolution_dataset && report.self_evolution_dataset.features_coverage_rate)} / febt_all=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate)} / febt_eligible=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate_eligible)} (${report.self_evolution_dataset && report.self_evolution_dataset.febt_eligible_n != null ? report.self_evolution_dataset.febt_eligible_n : "N/A"}) / febt_active=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate_active_eligible)} (${report.self_evolution_dataset && report.self_evolution_dataset.febt_active_eligible_n != null ? report.self_evolution_dataset.febt_active_eligible_n : "N/A"} / missing ${report.self_evolution_dataset && report.self_evolution_dataset.febt_active_missing_n != null ? report.self_evolution_dataset.febt_active_missing_n : "N/A"})`,
    `- active_entry: ${report.self_evolution_dataset && report.self_evolution_dataset.active_entry_n != null ? report.self_evolution_dataset.active_entry_n : "N/A"} / legacy_entry=${report.self_evolution_dataset && report.self_evolution_dataset.legacy_entry_n != null ? report.self_evolution_dataset.legacy_entry_n : "N/A"} / family=${renderSummaryLine(report.self_evolution_dataset && report.self_evolution_dataset.active_entry_family_counts)}`,
    `- entry_pending: total=${report.self_evolution_dataset && report.self_evolution_dataset.entry_pending_total_n != null ? report.self_evolution_dataset.entry_pending_total_n : "N/A"} / executed=${report.self_evolution_dataset && report.self_evolution_dataset.entry_executed_null_realized_n != null ? report.self_evolution_dataset.entry_executed_null_realized_n : "N/A"} / fallback=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_n != null ? report.self_evolution_dataset.entry_fallback_pending_n : "N/A"} / exit_present_unlabeled=${report.self_evolution_dataset && report.self_evolution_dataset.entry_exit_present_unlabeled_n != null ? report.self_evolution_dataset.entry_exit_present_unlabeled_n : "N/A"} / open_pending=${report.self_evolution_dataset && report.self_evolution_dataset.entry_open_pending_n != null ? report.self_evolution_dataset.entry_open_pending_n : "N/A"} / link_missing=${report.self_evolution_dataset && report.self_evolution_dataset.entry_link_missing_n != null ? report.self_evolution_dataset.entry_link_missing_n : "N/A"}`,
    `- fallback_active: ${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_active_n != null ? report.self_evolution_dataset.entry_fallback_pending_active_n : "N/A"} / payload_missing=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_payload_missing_n != null ? report.self_evolution_dataset.entry_fallback_payload_missing_n : "N/A"} / linked_exec=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_payload_missing_linked_n != null ? report.self_evolution_dataset.entry_fallback_payload_missing_linked_n : "N/A"} / family=${renderSummaryLine(report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_active_by_family)}`,
    `- FEBT active canonical coverage: ${renderCoverageLine(report.self_evolution_dataset && report.self_evolution_dataset.febt_active_eligible_by_event)} / low=${renderCoverageLine(report.self_evolution_dataset && report.self_evolution_dataset.febt_active_low_coverage_events)} / gap=${report.self_evolution_dataset && report.self_evolution_dataset.febt_active_coverage_gap_by_event ? `${report.self_evolution_dataset.febt_active_coverage_gap_by_event.low_key} ${pct(report.self_evolution_dataset.febt_active_coverage_gap_by_event.low_coverage_rate)} vs ${report.self_evolution_dataset.febt_active_coverage_gap_by_event.high_key} ${pct(report.self_evolution_dataset.febt_active_coverage_gap_by_event.high_coverage_rate)} (${pct(report.self_evolution_dataset.febt_active_coverage_gap_by_event.coverage_gap)})` : "none"}`,
    `- sample_readiness: governance=${report.sample_readiness && report.sample_readiness.governance_enough_sample ? "YES" : "NO"} (strict ${report.sample_readiness && report.sample_readiness.governance_realized_n != null ? report.sample_readiness.governance_realized_n : "N/A"} / monthly ${report.sample_readiness && report.sample_readiness.governance_monthly_source_realized_n != null ? report.sample_readiness.governance_monthly_source_realized_n : "N/A"} / effective ${report.sample_readiness && report.sample_readiness.governance_effective_realized_n != null ? report.sample_readiness.governance_effective_realized_n : "N/A"} / min ${report.sample_readiness && report.sample_readiness.governance_realized_min_sample != null ? report.sample_readiness.governance_realized_min_sample : "N/A"}) / self_evolution=${report.sample_readiness && report.sample_readiness.self_evolution_enough_sample ? "YES" : "NO"} (final ${report.sample_readiness && report.sample_readiness.self_evolution_realized_n != null ? report.sample_readiness.self_evolution_realized_n : "N/A"} / provisional ${report.sample_readiness && report.sample_readiness.self_evolution_provisional_realized_n != null ? report.sample_readiness.self_evolution_provisional_realized_n : "N/A"} / effective ${report.sample_readiness && report.sample_readiness.self_evolution_effective_realized_n != null ? report.sample_readiness.self_evolution_effective_realized_n : "N/A"} / min ${report.sample_readiness && report.sample_readiness.self_evolution_realized_min_sample != null ? report.sample_readiness.self_evolution_realized_min_sample : "N/A"})`,
    `- avg_realized_ret_net: ${signedPct(report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_ret_net)} / avg_realized_pnl_quote: ${signedNum(report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_pnl_quote, 0)} / avg_hold_minutes: ${report.self_evolution_dataset && report.self_evolution_dataset.avg_hold_minutes != null ? Number(report.self_evolution_dataset.avg_hold_minutes).toFixed(1) : "N/A"}`,
    "",
    "## Self-Evolution Objective",
    `- objective_score: ${signedNum(report.self_evolution_objective && report.self_evolution_objective.objective_score, 4)}`,
    `- constraints: count=${report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === false ? "FAIL" : "N/A")} / replacement=${report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === false ? "FAIL" : "N/A")} / latency=${report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === false ? "FAIL" : "N/A")}`,
    `- components: profit=${signedNum(report.self_evolution_objective && report.self_evolution_objective.profit_score, 3)} / count=${signedNum(report.self_evolution_objective && report.self_evolution_objective.count_score, 3)} / replacement=${signedNum(report.self_evolution_objective && report.self_evolution_objective.replacement_score, 3)} / tp1=${signedNum(report.self_evolution_objective && report.self_evolution_objective.tp1_score, 3)} / drawdown=${signedNum(report.self_evolution_objective && report.self_evolution_objective.drawdown_penalty, 3)} / latency=${signedNum(report.self_evolution_objective && report.self_evolution_objective.latency_penalty, 3)} / instability=${signedNum(report.self_evolution_objective && report.self_evolution_objective.instability_penalty, 3)}`,
    `- fire_win/tp1/count/replacement: ${pct(report.self_evolution_objective && report.self_evolution_objective.fire_win_rate)} / ${pct(report.self_evolution_objective && report.self_evolution_objective.tp1_first_rate)} / ${report.self_evolution_objective && report.self_evolution_objective.projected_count_ratio_global != null ? Number(report.self_evolution_objective.projected_count_ratio_global).toFixed(2) : "N/A"} / ${pct(report.self_evolution_objective && report.self_evolution_objective.projected_replacement_ratio)}`,
    `- top_market: ${report.self_evolution_objective && report.self_evolution_objective.top_market ? `${report.self_evolution_objective.top_market.market} / ${signedNum(report.self_evolution_objective.top_market.objective_score, 3)}` : "N/A"}`,
    `- bottom_market: ${report.self_evolution_objective && report.self_evolution_objective.bottom_market ? `${report.self_evolution_objective.bottom_market.market} / ${signedNum(report.self_evolution_objective.bottom_market.objective_score, 3)}` : "N/A"}`,
    `- dominant_drag: ${report.self_evolution_objective && report.self_evolution_objective.market_concentration && report.self_evolution_objective.market_concentration.dominant_negative_market ? `${report.self_evolution_objective.market_concentration.dominant_negative_market.market} / share ${pct(report.self_evolution_objective.market_concentration.dominant_negative_share)} / ex-bottom ${signedNum(report.self_evolution_objective.market_concentration.objective_score_ex_bottom_market, 3)}` : "N/A"}`,
    `- canonical_parity: ${report.self_evolution_canonical_parity && report.self_evolution_canonical_parity.available ? `source_mismatch=${report.self_evolution_canonical_parity.source_parity_mismatch_n ?? 0} / downstream=${report.self_evolution_canonical_parity.final_downstream_mismatch_n ?? 0} / ev=${report.self_evolution_canonical_parity.ev_policy_mismatch_n ?? 0} / top=${report.self_evolution_canonical_parity.dominant_mismatch_family || "N/A"}` : "N/A"}`,
    `- server_signal_authority: ${report.self_evolution_server_signal_authority && report.self_evolution_server_signal_authority.available ? `server24h=${report.self_evolution_server_signal_authority.authoritative_server_24h_n ?? 0} / shadow24h=${report.self_evolution_server_signal_authority.pine_shadow_24h_n ?? 0} / drift=${report.self_evolution_server_signal_authority.drift_status || "N/A"} / mismatch=${report.self_evolution_server_signal_authority.parity_mismatch_n ?? 0}` : "N/A"}`,
    `- server_signal_quality: ${report.self_evolution_server_signal_quality && report.self_evolution_server_signal_quality.available ? `entry=${report.self_evolution_server_signal_quality.authoritative_entry_signal_24h_n ?? 0} / intent=${report.self_evolution_server_signal_quality.order_intent_24h_n ?? 0} / fill=${report.self_evolution_server_signal_quality.fill_24h_n ?? 0} / quality=${report.self_evolution_server_signal_quality.quality_status || "N/A"}` : "N/A"}`,
    `- server_signal_cutover: ${report.self_evolution_server_signal_cutover_readiness && report.self_evolution_server_signal_cutover_readiness.available ? `${report.self_evolution_server_signal_cutover_readiness.readiness_status || "N/A"} / ready ${report.self_evolution_server_signal_cutover_readiness.promotion_ready ? "YES" : "NO"} / blockers ${Array.isArray(report.self_evolution_server_signal_cutover_readiness.blockers) && report.self_evolution_server_signal_cutover_readiness.blockers.length ? report.self_evolution_server_signal_cutover_readiness.blockers.join("|") : "none"}` : "N/A"}`,
    `- canonical_provenance: ${report.self_evolution_canonical_provenance && report.self_evolution_canonical_provenance.available ? `complete=${report.self_evolution_canonical_provenance.complete_n ?? 0}/${report.self_evolution_canonical_provenance.eligible_n ?? 0} / bundle=${report.self_evolution_canonical_provenance.bundle_version_n ?? 0} / threshold=${report.self_evolution_canonical_provenance.threshold_bundle_version_n ?? 0} / source_decision=${report.self_evolution_canonical_provenance.actual_source_decision_n ?? 0}` : "N/A"}`,
    `- server_primary_canary: ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.available ? `executed=${report.self_evolution_server_primary_canary.executed_n ?? 0} / disagreement=${report.self_evolution_server_primary_canary.disagreement_n ?? 0} / rollback=${report.self_evolution_server_primary_canary.rollback_trigger_n ?? 0} / apply=${report.self_evolution_server_primary_canary.apply_pass == null ? "N/A" : (report.self_evolution_server_primary_canary.apply_pass ? "YES" : "NO")} / acceptance=${report.self_evolution_server_primary_canary.acceptance_ready ? "READY" : "PENDING"} ${report.self_evolution_server_primary_canary.acceptance_reason || "N/A"}` : "N/A"}`,
    `- pine_shadow_drift: ${report.self_evolution_pine_shadow_drift && report.self_evolution_pine_shadow_drift.available ? `observed=${report.self_evolution_pine_shadow_drift.observed_n ?? 0} / drift=${report.self_evolution_pine_shadow_drift.drift_n ?? 0} / top=${report.self_evolution_pine_shadow_drift.top_drift_market || "N/A"} / audit=${report.self_evolution_pine_shadow_drift.audit_only ? "YES" : "NO"}` : "N/A"}`,
    "",
    "## Self-Evolution Attribution",
    `- drop_top_layer: ${report.self_evolution_attribution && report.self_evolution_attribution.drop_top_layer ? `${report.self_evolution_attribution.drop_top_layer.key} ${report.self_evolution_attribution.drop_top_layer.count}` : "N/A"}`,
    `- late_loss_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.late_loss_top_market ? `${report.self_evolution_attribution.late_loss_top_market.key} ${report.self_evolution_attribution.late_loss_top_market.count}` : "N/A"}`,
    `- false_fire_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.false_fire_top_market ? `${report.self_evolution_attribution.false_fire_top_market.key} ${report.self_evolution_attribution.false_fire_top_market.count}` : "N/A"}`,
    `- missed_recovery_top_reason: ${report.self_evolution_attribution && report.self_evolution_attribution.missed_recovery_top_reason ? `${report.self_evolution_attribution.missed_recovery_top_reason.key} ${report.self_evolution_attribution.missed_recovery_top_reason.count}` : "N/A"}`,
    `- fallback_cost_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.fallback_cost_top_market ? `${report.self_evolution_attribution.fallback_cost_top_market.key} ${report.self_evolution_attribution.fallback_cost_top_market.count}` : "N/A"}`,
    "",
    "## Self-Evolution Candidates",
    `- total/ready/blocked: ${report.self_evolution_candidates && report.self_evolution_candidates.total_n != null ? report.self_evolution_candidates.total_n : "N/A"} / ${report.self_evolution_candidates && report.self_evolution_candidates.ready_n != null ? report.self_evolution_candidates.ready_n : "N/A"} / ${report.self_evolution_candidates && report.self_evolution_candidates.blocked_n != null ? report.self_evolution_candidates.blocked_n : "N/A"}`,
    `- top_candidate: ${report.self_evolution_candidates && report.self_evolution_candidates.top_candidate_id || "N/A"} / scope=${report.self_evolution_candidates && report.self_evolution_candidates.top_scope || "N/A"}`,
    "",
    "## Self-Evolution Replay",
    `- mode: ${report.self_evolution_replay && report.self_evolution_replay.validation_mode || "N/A"}`,
    `- total/pass/warn/block: ${report.self_evolution_replay && report.self_evolution_replay.total_n != null ? report.self_evolution_replay.total_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.pass_n != null ? report.self_evolution_replay.pass_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.warn_n != null ? report.self_evolution_replay.warn_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.block_n != null ? report.self_evolution_replay.block_n : "N/A"}`,
    `- best_candidate: ${report.self_evolution_replay && report.self_evolution_replay.best_candidate_id || "N/A"} / verdict=${report.self_evolution_replay && report.self_evolution_replay.best_verdict || "N/A"} / objective_delta=${signedNum(report.self_evolution_replay && report.self_evolution_replay.best_objective_delta, 4)}`,
    "",
    "## Self-Evolution Canary",
    `- total/shadow/soft/hard: ${report.self_evolution_canary && report.self_evolution_canary.total_n != null ? report.self_evolution_canary.total_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.shadow_n != null ? report.self_evolution_canary.shadow_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.soft_n != null ? report.self_evolution_canary.soft_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.hard_n != null ? report.self_evolution_canary.hard_n : "N/A"}`,
    `- ready/blocked/rollback: ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / apply=${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"}`,
    `- open/current/next wave: ${report.self_evolution_canary && report.self_evolution_canary.open_wave != null ? report.self_evolution_canary.open_wave : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.current_open_wave != null ? report.self_evolution_canary.current_open_wave : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.next_wave_candidate != null ? report.self_evolution_canary.next_wave_candidate : "N/A"} / scale=${report.self_evolution_canary && report.self_evolution_canary.scale_allowed ? "YES" : "NO"}`,
    `- top_ready: ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top_rollback: ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`,
    "",
    "## Self-Evolution Deployment",
    `- target/deploy/rollback_only: ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / ${report.self_evolution_deployment && report.self_evolution_deployment.rollback_only ? "YES" : "NO"}`,
    `- replay/open_wave/markets: ${report.self_evolution_deployment && report.self_evolution_deployment.replay_verdict || "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.canary_open_wave != null ? report.self_evolution_deployment.canary_open_wave : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_ready_n != null ? report.self_evolution_deployment.market_ready_n : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_total_n != null ? report.self_evolution_deployment.market_total_n : "N/A"}`,
    `- blockers: ${report.self_evolution_deployment && Array.isArray(report.self_evolution_deployment.blockers) && report.self_evolution_deployment.blockers.length ? report.self_evolution_deployment.blockers.join("|") : "none"}`,
    `- root/promotion: ${report.self_evolution_deployment && report.self_evolution_deployment.root_cause || "N/A"} / ready=${report.self_evolution_deployment && report.self_evolution_deployment.promotion_ready ? "YES" : "NO"} / reason=${report.self_evolution_deployment && report.self_evolution_deployment.promotion_not_ready_reason || "N/A"}`,
    "",
    "## Self-Evolution Deployment Plan",
    `- status/prepare/manual: ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepare_pass ? "PASS" : "BLOCK"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"}`,
    `- target/wave/markets: ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.display_candidate_id || report.self_evolution_deployment_plan.target_candidate_id) || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.open_wave != null ? report.self_evolution_deployment_plan.open_wave : "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.market_scope_ready_n != null ? report.self_evolution_deployment_plan.market_scope_ready_n : "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.market_scope_n != null ? report.self_evolution_deployment_plan.market_scope_n : "N/A"}`,
    `- engine/policy/rollback bundle: ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.prepared_engine_bundle_id || report.self_evolution_deployment_plan.active_engine_bundle_id) || "N/A"} / ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.prepared_policy_bundle_id || report.self_evolution_deployment_plan.active_policy_bundle_id) || "N/A"} / ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.rollback_engine_bundle_id || report.self_evolution_deployment_plan.rollback_source_file_path) || "N/A"}`,
    `- shadow prepared/latest: ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"}`,
    `- blockers: ${report.self_evolution_deployment_plan && Array.isArray(report.self_evolution_deployment_plan.blockers) && report.self_evolution_deployment_plan.blockers.length ? report.self_evolution_deployment_plan.blockers.join("|") : "none"}`,
    "",
    "## Self-Evolution Loop Monitor",
    `- cycle/status/consistent: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_id || "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.overall_status || "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_consistent ? "YES" : "NO"}`,
    `- fresh/stale: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.fresh_loop_n != null ? report.self_evolution_loop_monitor.fresh_loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.loop_n != null ? report.self_evolution_loop_monitor.loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.stale_artifact_n != null ? report.self_evolution_loop_monitor.stale_artifact_n : "N/A"}`,
    `- promotion/manual: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.promotion_path_ready ? "YES" : "NO"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.manual_paste_ready ? "YES" : "NO"} / candidate ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.ready_candidate_id || "N/A"}`,
    `- blockers: ${report.self_evolution_loop_monitor && Array.isArray(report.self_evolution_loop_monitor.critical_blockers) && report.self_evolution_loop_monitor.critical_blockers.length ? report.self_evolution_loop_monitor.critical_blockers.join("|") : "none"}`,
    "",
    "## Self-Evolution Weight Tuning",
    `- advisory_mode: ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.advisory_mode || "N/A"}`,
    `- suggestion_n/dominant_axis: ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.suggestion_n != null ? report.self_evolution_weight_tuning.summary.suggestion_n : "N/A"} / ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.dominant_axis || "N/A"}`,
    `- defer_eta_w/blocked_ids: ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.memory_defer_remaining_weeks_min != null ? report.self_evolution_weight_tuning.summary.memory_defer_remaining_weeks_min : "N/A"} / ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && Array.isArray(report.self_evolution_weight_tuning.summary.memory_defer_blocked_candidate_ids) && report.self_evolution_weight_tuning.summary.memory_defer_blocked_candidate_ids.length ? report.self_evolution_weight_tuning.summary.memory_defer_blocked_candidate_ids.join("|") : "none"}`,
    ...((report.self_evolution_weight_tuning && Array.isArray(report.self_evolution_weight_tuning.suggestions) && report.self_evolution_weight_tuning.suggestions.length)
      ? report.self_evolution_weight_tuning.suggestions.slice(0, 10).map((row) => `- ${row.axis}: ${row.direction} ${row.delta} / ${row.reason}`)
      : ["- none"]),
    "",
    "## Self-Evolution Memory",
    `- total/current/blocked: ${report.self_evolution_memory && report.self_evolution_memory.total_n != null ? report.self_evolution_memory.total_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.current_n != null ? report.self_evolution_memory.current_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.blocked_candidate_n != null ? report.self_evolution_memory.blocked_candidate_n : "N/A"}`,
    `- success/neutral/fail/rolled_back: ${report.self_evolution_memory && report.self_evolution_memory.success_n != null ? report.self_evolution_memory.success_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.neutral_n != null ? report.self_evolution_memory.neutral_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.fail_n != null ? report.self_evolution_memory.fail_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.rolled_back_n != null ? report.self_evolution_memory.rolled_back_n : "N/A"}`,
    "",
    "## Operational Context",
    `- scheduler_policy: ${report.operational_recovery_context && report.operational_recovery_context.recommended_scheduler_policy || "N/A"} / daily_no_trade=${report.operational_recovery_context && report.operational_recovery_context.daily_no_trade ? "YES" : "NO"} / daily_zero_idle=${report.operational_recovery_context && report.operational_recovery_context.daily_zero_idle ? "YES" : "NO"}`,
    `- daily_executed/daily_realized: ${report.operational_recovery_context && report.operational_recovery_context.daily_executed_n != null ? report.operational_recovery_context.daily_executed_n : "N/A"} / ${report.operational_recovery_context && report.operational_recovery_context.daily_realized_n != null ? report.operational_recovery_context.daily_realized_n : "N/A"}`,
    "",
    "## Autonomy",
    `- engine/loop/ops_except_pine: ${report.autonomy_assessment && report.autonomy_assessment.engine_autonomy || "N/A"} / ${report.autonomy_assessment && report.autonomy_assessment.loop_autonomy || "N/A"} / ${report.autonomy_assessment && report.autonomy_assessment.operational_autonomy_except_pine || "N/A"}`,
    `- manual_boundaries: ${report.autonomy_assessment && Array.isArray(report.autonomy_assessment.manual_boundaries) && report.autonomy_assessment.manual_boundaries.length ? report.autonomy_assessment.manual_boundaries.join("|") : "none"}`,
    `- avg objective/count/replacement/ret: ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_objective_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_count_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_replacement_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_ret_net_delta, 4)}`,
    `- top success: ${report.self_evolution_memory && report.self_evolution_memory.top_success_candidate_id || "N/A"} / top failed: ${report.self_evolution_memory && report.self_evolution_memory.top_failed_candidate_id || "N/A"}`,
    `- blocked_candidate_ids: ${report.self_evolution_memory && Array.isArray(report.self_evolution_memory.blocked_candidate_ids) && report.self_evolution_memory.blocked_candidate_ids.length ? report.self_evolution_memory.blocked_candidate_ids.join(", ") : "none"}`,
    "",
    "## OpenClaw Autonomy Contract",
    `- goal/authority/phase_d/ops: ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.goal_state || "N/A"} / ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.authority_state || "N/A"} / ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.phase_d_status || "N/A"} / ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.ops_status || "N/A"}`,
    `- objective_met/recovery_required: ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.objective_met ? "YES" : "NO"} / ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.recovery_required ? "YES" : "NO"}`,
    `- degraded_authority: ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.degraded_authority_enabled ? "ENABLED" : "DISABLED"} / min_streak ${report.self_evolution_openclaw_autonomy_contract && report.self_evolution_openclaw_autonomy_contract.degraded_authority_min_timeout_streak != null ? report.self_evolution_openclaw_autonomy_contract.degraded_authority_min_timeout_streak : "N/A"}`,
    "",
    "## Server-Primary Acceptance Watch",
    `- markets/executed/realized: ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.configured_server_primary_markets_n != null ? report.self_evolution_server_primary_acceptance_watch.configured_server_primary_markets_n : "N/A"} / ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.executed_n != null ? report.self_evolution_server_primary_acceptance_watch.executed_n : "N/A"} / ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.realized_n != null ? report.self_evolution_server_primary_acceptance_watch.realized_n : "N/A"}`,
    `- phase_d: ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.phase_d_status || "N/A"} / ready ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.phase_d_ready ? "YES" : "NO"} / ${report.self_evolution_server_primary_acceptance_watch && report.self_evolution_server_primary_acceptance_watch.phase_d_reason || "N/A"}`,
    "",
    "## Objective Recovery Governor",
    `- status/reason: ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.governor_status || "N/A"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.governor_reason || "N/A"}`,
    `- candidate/deploy_unit: ${report.self_evolution_objective_recovery_governor && (report.self_evolution_objective_recovery_governor.display_candidate_id || report.self_evolution_objective_recovery_governor.target_candidate_id) || "N/A"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.target_deploy_unit || "N/A"}`,
    `- replay/canary/guards/memory: ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.replay_pass ? "YES" : "NO"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.canary_ready ? "YES" : "NO"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.deployment_guards_pass ? "YES" : "NO"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.memory_blocked ? "BLOCK" : "CLEAR"}`,
    `- degraded_authority: ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.degraded_authority_enabled ? "ENABLED" : "DISABLED"} / eligible ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.degraded_authority_eligible ? "YES" : "NO"} / ${report.self_evolution_objective_recovery_governor && report.self_evolution_objective_recovery_governor.degraded_authority_reason || "N/A"}`,
    "",
    "## Objective Recovery Effect",
    `- tracking: ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.tracking_status || "N/A"} / ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.tracking_reason || "N/A"}`,
    `- objective delta/projected/gap: ${signedNum(report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.target_candidate_objective_delta, 4)} / ${signedNum(report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.projected_objective_score, 4)} / ${signedPct(report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.gap_closure_rate, 2)}`,
    `- target/dominant match: ${report.self_evolution_objective_recovery_effect && (report.self_evolution_objective_recovery_effect.display_candidate_id || report.self_evolution_objective_recovery_effect.target_candidate_id) || "N/A"} / ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.dominant_negative_market || "N/A"} / ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.target_matches_dominant_negative_market ? "YES" : "NO"}`,
    `- best ready/replay/higher delta: ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.best_ready_candidate_id || "N/A"} / ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.best_replay_candidate_id || "N/A"} / ${report.self_evolution_objective_recovery_effect && report.self_evolution_objective_recovery_effect.higher_delta_candidate_available ? `${report.self_evolution_objective_recovery_effect.higher_delta_candidate_id || "N/A"} ${report.self_evolution_objective_recovery_effect.higher_delta_candidate_hold_reason || "N/A"}` : "none"}`,
    "",
    "## BEST/FEBT Market Contracts",
    ...((Array.isArray(report.best_febt_market_contracts) && report.best_febt_market_contracts.length)
      ? report.best_febt_market_contracts.map((row) => `- ${formatBestFebtMarketContractLine(row)}`)
      : ["- none"]),
    "",
    "## Tuning Inputs",
    `- EV: ${report.tuning && report.tuning.ev_reason || "N/A"}`,
    `- WAIT: ${report.tuning && report.tuning.wait_reason || "N/A"}`,
    `- ML: quality=${report.tuning && report.tuning.ml_quality_actions != null ? report.tuning.ml_quality_actions : "N/A"} / market=${report.tuning && report.tuning.ml_market_action || "N/A"} / ev=${report.tuning && report.tuning.ml_ev_action || "N/A"}`,
    "",
    "## Codex Review",
    `- status: ${report.codex_review && report.codex_review.status || "N/A"}`,
    `- verdict: ${report.codex_review && report.codex_review.verdict || "N/A"}`,
    `- candidate: ${report.codex_review && (report.codex_review.display_candidate_id || report.codex_review.recommended_candidate_id) || "N/A"}`,
    `- rollback: ${report.codex_review && report.codex_review.recommended_rollback_file_path || "N/A"}`,
    `- confidence: ${report.codex_review && report.codex_review.confidence != null ? report.codex_review.confidence : "N/A"}`,
    `- reason: ${report.codex_review && report.codex_review.reason || "N/A"}`,
    "",
    "## Codex Authority",
    `- owner/mode/status/verdict: ${report.codex_authority && report.codex_authority.owner || "N/A"} / ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / ${report.codex_authority && report.codex_authority.status || "N/A"} / ${report.codex_authority && report.codex_authority.verdict || "N/A"}`,
    `- manual/ready/prepared: ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"} / ${report.codex_authority && report.codex_authority.ready_for_manual_paste ? "YES" : "NO"} / ${report.codex_authority && report.codex_authority.prepared_stage_ready ? "YES" : "NO"}`,
    `- candidate/bundle/rollback: ${report.codex_authority && (report.codex_authority.display_candidate_id || report.codex_authority.recommended_candidate_id) || "N/A"} / ${report.codex_authority && report.codex_authority.prepared_engine_bundle_id || "N/A"} / ${report.codex_authority && report.codex_authority.recommended_rollback_file_path || report.codex_authority && report.codex_authority.rollback_engine_bundle_id || report.codex_authority && report.codex_authority.rollback_source_file_path || "N/A"}`,
    `- shadow prepared: ${report.codex_authority && report.codex_authority.prepared_file_path || report.codex_authority && report.codex_authority.latest_generated_file_path || "N/A"}`,
    `- blockers: ${report.codex_authority && Array.isArray(report.codex_authority.blockers) && report.codex_authority.blockers.length ? report.codex_authority.blockers.join("|") : "none"}`,
    "",
    "## Stage Autopilot",
    `- status: ${report.stage_autopilot && report.stage_autopilot.status || "N/A"}`,
    `- objective: ${report.stage_autopilot && report.stage_autopilot.objective_verdict || "N/A"}`,
    `- actions: ${report.stage_autopilot && report.stage_autopilot.action_n != null ? report.stage_autopilot.action_n : "N/A"} / ${(report.stage_autopilot && report.stage_autopilot.action_types && report.stage_autopilot.action_types.length) ? report.stage_autopilot.action_types.join(", ") : "none"}`,
    "",
    "## Artifacts",
  ];
  for (const row of report.artifacts || []) {
    lines.push(`- ${row.name}: ${row.fresh ? "fresh" : "stale"} / ${row.filePath || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const selfEvolutionStage = String(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE || "STANDALONE").trim().toUpperCase();
  const governanceArtifact = readArtifact("weekly_governance", GOVERNANCE_LATEST_PATH, FRESHNESS_HOURS.governance);
  const changeArtifact = readArtifact("change_control", CHANGE_CONTROL_LATEST_PATH, FRESHNESS_HOURS.changeControl);
  const canaryArtifact = readArtifact("shadow_canary", CANARY_LATEST_PATH, FRESHNESS_HOURS.canary);
  const mlArtifact = readArtifact("ml_policy", ML_LATEST_PATH, FRESHNESS_HOURS.ml);
  const evArtifact = readArtifact("ev_tuner", EV_LATEST_PATH, FRESHNESS_HOURS.ev);
  const waitArtifact = readArtifact("wait_tuner", WAIT_LATEST_PATH, FRESHNESS_HOURS.wait);
  const phase0Artifact = readArtifact("febt_phase0", FEBT_PHASE0_LATEST_PATH, FRESHNESS_HOURS.phase0);
  const selfEvolutionDatasetArtifact = readArtifact("self_evolution_dataset", SELF_EVOLUTION_DATASET_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionDataset);
  const selfEvolutionObjectiveArtifact = readArtifact("self_evolution_objective", SELF_EVOLUTION_OBJECTIVE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionObjective);
  const selfEvolutionMarketObjectiveScoreArtifact = readArtifact("self_evolution_market_objective_score", SELF_EVOLUTION_MARKET_OBJECTIVE_SCORE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionMarketObjectiveScore);
  const selfEvolutionServerVsPinePerformanceDeltaArtifact = readArtifact("self_evolution_server_vs_pine_performance_delta", SELF_EVOLUTION_SERVER_VS_PINE_PERFORMANCE_DELTA_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerVsPinePerformanceDelta);
  const selfEvolutionExplorationBudgetArtifact = readArtifact("self_evolution_exploration_budget", SELF_EVOLUTION_EXPLORATION_BUDGET_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionExplorationBudget);
  const selfEvolutionServerMarketCapitalAllocatorArtifact = readArtifact("self_evolution_server_market_capital_allocator", SELF_EVOLUTION_SERVER_MARKET_CAPITAL_ALLOCATOR_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerMarketCapitalAllocator);
  const selfEvolutionServerMarketQuarantineArtifact = readArtifact("self_evolution_server_market_quarantine", SELF_EVOLUTION_SERVER_MARKET_QUARANTINE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerMarketQuarantine);
  const selfEvolutionExplorationProposalArtifact = readArtifact("self_evolution_exploration_proposal", SELF_EVOLUTION_EXPLORATION_PROPOSAL_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionExplorationProposal);
  const selfEvolutionExplorationApplyCandidateArtifact = readArtifact("self_evolution_exploration_apply_candidate", SELF_EVOLUTION_EXPLORATION_APPLY_CANDIDATE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionExplorationApplyCandidate);
  const selfEvolutionChangeResultAttributionArtifact = readArtifact("self_evolution_change_result_attribution", SELF_EVOLUTION_CHANGE_RESULT_ATTRIBUTION_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionChangeResultAttribution);
  const selfEvolutionAttributionArtifact = readArtifact("self_evolution_attribution", SELF_EVOLUTION_ATTRIBUTION_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionAttribution);
  const selfEvolutionCandidatesArtifact = readArtifact("self_evolution_candidates", SELF_EVOLUTION_CANDIDATES_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCandidates);
  const selfEvolutionReplayArtifact = readArtifact("self_evolution_replay", SELF_EVOLUTION_REPLAY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionReplay);
  const selfEvolutionCanaryArtifact = readArtifact("self_evolution_canary", SELF_EVOLUTION_CANARY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanary);
  const selfEvolutionCanonicalParityArtifact = readArtifact("self_evolution_canonical_parity", SELF_EVOLUTION_CANONICAL_PARITY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanonicalParity);
  const selfEvolutionServerSignalAuthorityArtifact = readArtifact("self_evolution_server_signal_authority", SELF_EVOLUTION_SERVER_SIGNAL_AUTHORITY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerSignalAuthority);
  const selfEvolutionServerSignalQualityArtifact = readArtifact("self_evolution_server_signal_quality", SELF_EVOLUTION_SERVER_SIGNAL_QUALITY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerSignalQuality);
  const selfEvolutionServerSignalCutoverReadinessArtifact = readArtifact("self_evolution_server_signal_cutover_readiness", SELF_EVOLUTION_SERVER_SIGNAL_CUTOVER_READINESS_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerSignalCutoverReadiness);
  const selfEvolutionDropValidationArtifact = readArtifact("self_evolution_drop_validation", SELF_EVOLUTION_DROP_VALIDATION_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionDropValidation);
  const selfEvolutionProvisionalRealizedOutcomeArtifact = readArtifact("self_evolution_provisional_realized_outcome", SELF_EVOLUTION_PROVISIONAL_REALIZED_OUTCOME_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionProvisionalRealizedOutcome);
  const selfEvolutionOverrideAuthorityArtifact = readArtifact("self_evolution_override_authority", SELF_EVOLUTION_OVERRIDE_AUTHORITY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionOverrideAuthority);
  const selfEvolutionExecutionQualityArtifact = readArtifact("self_evolution_execution_quality", SELF_EVOLUTION_EXECUTION_QUALITY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionExecutionQuality);
  const selfEvolutionReversePolicyArtifact = readArtifact("self_evolution_reverse_policy", SELF_EVOLUTION_REVERSE_POLICY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionReversePolicy);
  const selfEvolutionServerPrimaryLearningEpochArtifact = readArtifact("self_evolution_server_primary_learning_epoch", SELF_EVOLUTION_SERVER_PRIMARY_LEARNING_EPOCH_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerPrimaryLearningEpoch);
  const selfEvolutionInitialSignalQualityContractArtifact = readArtifact("self_evolution_initial_signal_quality_contract", SELF_EVOLUTION_INITIAL_SIGNAL_QUALITY_CONTRACT_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionInitialSignalQualityContract);
  const selfEvolutionExitTrailingContractArtifact = readArtifact("self_evolution_exit_trailing_contract", SELF_EVOLUTION_EXIT_TRAILING_CONTRACT_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionExitTrailingContract);
  const selfEvolutionServerNativeHtfModeComparisonArtifact = readArtifact("self_evolution_server_native_htf_mode_comparison", SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_COMPARISON_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerNativeHtfModeComparison);
  const selfEvolutionServerNativeHtfModeGovernorArtifact = readArtifact("self_evolution_server_native_htf_mode_governor", SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_GOVERNOR_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerNativeHtfModeGovernor);
  const selfEvolutionCanonicalProvenanceArtifact = readArtifact("self_evolution_canonical_provenance", SELF_EVOLUTION_CANONICAL_PROVENANCE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanonicalProvenance);
  const selfEvolutionServerPrimaryCanaryArtifact = readArtifact("self_evolution_server_primary_canary", SELF_EVOLUTION_SERVER_PRIMARY_CANARY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerPrimaryCanary);
  const selfEvolutionServerPrimaryAcceptanceWatchArtifact = readArtifact("self_evolution_server_primary_acceptance_watch", SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_WATCH_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionServerPrimaryAcceptanceWatch);
  const selfEvolutionPineShadowDriftArtifact = readArtifact("self_evolution_pine_shadow_drift", SELF_EVOLUTION_PINE_SHADOW_DRIFT_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionPineShadowDrift);
  const currentVersionPineSyncArtifact = readArtifact("current_version_pine_sync", CURRENT_VERSION_PINE_SYNC_LATEST_PATH, FRESHNESS_HOURS.currentVersionPineSync);
  const selfEvolutionDeploymentProbeArtifact = readArtifact("self_evolution_deployment_probe", SELF_EVOLUTION_DEPLOYMENT_PROBE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionBundleActivation);
  const selfEvolutionBundleActivationArtifact = readArtifact("self_evolution_bundle_activation", SELF_EVOLUTION_BUNDLE_ACTIVATION_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionBundleActivation);
  const selfEvolutionOpenclawAutonomyContractArtifact = readArtifact("self_evolution_openclaw_autonomy_contract", SELF_EVOLUTION_OPENCLAW_AUTONOMY_CONTRACT_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionOpenclawAutonomyContract);
  const selfEvolutionObjectiveRecoveryGovernorArtifact = readArtifact("self_evolution_objective_recovery_governor", SELF_EVOLUTION_OBJECTIVE_RECOVERY_GOVERNOR_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionObjectiveRecoveryGovernor);
  const selfEvolutionObjectiveRecoveryEffectArtifact = readArtifact("self_evolution_objective_recovery_effect", SELF_EVOLUTION_OBJECTIVE_RECOVERY_EFFECT_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionObjectiveRecoveryEffect);
  const selfEvolutionEvGateRescueArtifact = readArtifact("self_evolution_ev_gate_rescue", SELF_EVOLUTION_EV_GATE_RESCUE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionEvGateRescue);
  const selfEvolutionMemoryArtifact = readArtifact("self_evolution_memory", SELF_EVOLUTION_MEMORY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionMemory);
  const codexArtifact = readArtifact("codex_patch", CODEX_PATCH_LATEST_PATH, FRESHNESS_HOURS.codex);
  const stageAutopilotArtifact = readArtifact("stage_autopilot", STAGE_AUTOPILOT_LATEST_PATH, FRESHNESS_HOURS.stageAutopilot);
  const weeklyPineHistoryArtifact = readArtifact("weekly_pine_history", WEEKLY_PINE_HISTORY_PATH, FRESHNESS_HOURS.weeklyPineHistory);
  const retrospectiveArtifact = readArtifact("objective_retrospective", RETROSPECTIVE_LATEST_PATH, FRESHNESS_HOURS.retrospective);
  const runtimeState = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const manualPasteAck = runtimeState && runtimeState.data
    ? runtimeState.data
    : readJsonRawSafe(SELF_EVOLUTION_MANUAL_PASTE_ACK_LATEST_PATH, null);
  const preparedOverride = normalizePreparedOverride(readJsonRawSafe(SELF_EVOLUTION_PREPARED_OVERRIDE_PATH, null));
  const signalsCache = readJsonRawSafe(SIGNALS_CACHE_LATEST_PATH, null);
  const selfEvolutionCycleState = summarizeSelfEvolutionArtifactCycles({
    stage: selfEvolutionStage,
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    artifacts: {
      dataset: selfEvolutionDatasetArtifact,
      objective: selfEvolutionObjectiveArtifact,
      marketObjectiveScore: selfEvolutionMarketObjectiveScoreArtifact,
      serverVsPinePerformanceDelta: selfEvolutionServerVsPinePerformanceDeltaArtifact,
      explorationBudget: selfEvolutionExplorationBudgetArtifact,
      serverMarketCapitalAllocator: selfEvolutionServerMarketCapitalAllocatorArtifact,
      serverMarketQuarantine: selfEvolutionServerMarketQuarantineArtifact,
      explorationProposal: selfEvolutionExplorationProposalArtifact,
      explorationApplyCandidate: selfEvolutionExplorationApplyCandidateArtifact,
      changeResultAttribution: selfEvolutionChangeResultAttributionArtifact,
      attribution: selfEvolutionAttributionArtifact,
      candidates: selfEvolutionCandidatesArtifact,
      replay: selfEvolutionReplayArtifact,
      canary: selfEvolutionCanaryArtifact,
      canonicalParity: selfEvolutionCanonicalParityArtifact,
      serverSignalAuthority: selfEvolutionServerSignalAuthorityArtifact,
      serverSignalQuality: selfEvolutionServerSignalQualityArtifact,
      serverSignalCutoverReadiness: selfEvolutionServerSignalCutoverReadinessArtifact,
      dropValidation: selfEvolutionDropValidationArtifact,
      provisionalRealizedOutcome: selfEvolutionProvisionalRealizedOutcomeArtifact,
      overrideAuthority: selfEvolutionOverrideAuthorityArtifact,
      executionQuality: selfEvolutionExecutionQualityArtifact,
      reversePolicy: selfEvolutionReversePolicyArtifact,
      serverPrimaryLearningEpoch: selfEvolutionServerPrimaryLearningEpochArtifact,
      initialSignalQualityContract: selfEvolutionInitialSignalQualityContractArtifact,
      serverNativeHtfModeComparison: selfEvolutionServerNativeHtfModeComparisonArtifact,
      serverNativeHtfModeGovernor: selfEvolutionServerNativeHtfModeGovernorArtifact,
      explorationBudget: selfEvolutionExplorationBudgetArtifact,
      canonicalProvenance: selfEvolutionCanonicalProvenanceArtifact,
      serverPrimaryCanary: selfEvolutionServerPrimaryCanaryArtifact,
      serverPrimaryAcceptanceWatch: selfEvolutionServerPrimaryAcceptanceWatchArtifact,
      pineShadowDrift: selfEvolutionPineShadowDriftArtifact,
      deploymentProbe: selfEvolutionDeploymentProbeArtifact,
      bundleActivation: selfEvolutionBundleActivationArtifact,
      openclawAutonomyContract: selfEvolutionOpenclawAutonomyContractArtifact,
      objectiveRecoveryGovernor: selfEvolutionObjectiveRecoveryGovernorArtifact,
      objectiveRecoveryEffect: selfEvolutionObjectiveRecoveryEffectArtifact,
      memory: selfEvolutionMemoryArtifact,
      codex: codexArtifact,
      stageAutopilot: stageAutopilotArtifact,
    },
  });
  const reportCycleId = selfEvolutionCycleState.expected_cycle_id || cycleMeta.cycle_id;

  const selfEvolutionMemoryData = selfEvolutionMemoryArtifact.exists
    ? { ...selfEvolutionMemoryArtifact.data, fresh: selfEvolutionMemoryArtifact.fresh }
    : buildMemoryLedger({
      candidateChangeSet: selfEvolutionCandidatesArtifact.data,
      replayReport: selfEvolutionReplayArtifact.data,
      canaryReport: selfEvolutionCanaryArtifact.data,
      sampleReadiness: selfEvolutionServerSignalCutoverReadinessArtifact.data,
      previousLedger: null,
      nowMeta,
    });

  const evaluation = evaluateSupervisor({
    governance: governanceArtifact.data,
    changeControl: changeArtifact.data,
    canary: canaryArtifact.data,
    ml: mlArtifact.data,
    ev: evArtifact.exists ? { ...evArtifact.data, fresh: evArtifact.fresh, age_hours: evArtifact.ageHours } : null,
    wait: waitArtifact.data,
    phase0: phase0Artifact.exists ? { ...phase0Artifact.data, fresh: phase0Artifact.fresh } : null,
    selfEvolutionDataset: selfEvolutionDatasetArtifact.exists ? { ...selfEvolutionDatasetArtifact.data, fresh: selfEvolutionDatasetArtifact.fresh } : null,
    selfEvolutionObjective: selfEvolutionObjectiveArtifact.exists ? { ...selfEvolutionObjectiveArtifact.data, fresh: selfEvolutionObjectiveArtifact.fresh } : null,
    selfEvolutionMarketObjectiveScore: selfEvolutionMarketObjectiveScoreArtifact.exists ? { ...selfEvolutionMarketObjectiveScoreArtifact.data, fresh: selfEvolutionMarketObjectiveScoreArtifact.fresh } : null,
    selfEvolutionServerVsPinePerformanceDelta: selfEvolutionServerVsPinePerformanceDeltaArtifact.exists ? { ...selfEvolutionServerVsPinePerformanceDeltaArtifact.data, fresh: selfEvolutionServerVsPinePerformanceDeltaArtifact.fresh } : null,
    selfEvolutionExplorationBudget: selfEvolutionExplorationBudgetArtifact.exists ? { ...selfEvolutionExplorationBudgetArtifact.data, fresh: selfEvolutionExplorationBudgetArtifact.fresh } : null,
    selfEvolutionServerMarketCapitalAllocator: selfEvolutionServerMarketCapitalAllocatorArtifact.exists ? { ...selfEvolutionServerMarketCapitalAllocatorArtifact.data, fresh: selfEvolutionServerMarketCapitalAllocatorArtifact.fresh } : null,
    selfEvolutionServerMarketQuarantine: selfEvolutionServerMarketQuarantineArtifact.exists ? { ...selfEvolutionServerMarketQuarantineArtifact.data, fresh: selfEvolutionServerMarketQuarantineArtifact.fresh } : null,
    selfEvolutionExplorationProposal: selfEvolutionExplorationProposalArtifact.exists ? { ...selfEvolutionExplorationProposalArtifact.data, fresh: selfEvolutionExplorationProposalArtifact.fresh } : null,
    selfEvolutionExplorationApplyCandidate: selfEvolutionExplorationApplyCandidateArtifact.exists ? { ...selfEvolutionExplorationApplyCandidateArtifact.data, fresh: selfEvolutionExplorationApplyCandidateArtifact.fresh } : null,
    selfEvolutionChangeResultAttribution: selfEvolutionChangeResultAttributionArtifact.exists ? { ...selfEvolutionChangeResultAttributionArtifact.data, fresh: selfEvolutionChangeResultAttributionArtifact.fresh } : null,
    selfEvolutionAttribution: selfEvolutionAttributionArtifact.exists ? { ...selfEvolutionAttributionArtifact.data, fresh: selfEvolutionAttributionArtifact.fresh } : null,
    selfEvolutionCandidates: selfEvolutionCandidatesArtifact.exists ? { ...selfEvolutionCandidatesArtifact.data, fresh: selfEvolutionCandidatesArtifact.fresh } : null,
    selfEvolutionReplay: selfEvolutionReplayArtifact.exists ? { ...selfEvolutionReplayArtifact.data, fresh: selfEvolutionReplayArtifact.fresh } : null,
    selfEvolutionCanary: selfEvolutionCanaryArtifact.exists ? { ...selfEvolutionCanaryArtifact.data, fresh: selfEvolutionCanaryArtifact.fresh } : null,
    selfEvolutionCanonicalParity: selfEvolutionCanonicalParityArtifact.exists ? { ...selfEvolutionCanonicalParityArtifact.data, fresh: selfEvolutionCanonicalParityArtifact.fresh } : null,
    selfEvolutionServerSignalAuthority: selfEvolutionServerSignalAuthorityArtifact.exists ? { ...selfEvolutionServerSignalAuthorityArtifact.data, fresh: selfEvolutionServerSignalAuthorityArtifact.fresh } : null,
    selfEvolutionServerSignalQuality: selfEvolutionServerSignalQualityArtifact.exists ? { ...selfEvolutionServerSignalQualityArtifact.data, fresh: selfEvolutionServerSignalQualityArtifact.fresh } : null,
    selfEvolutionServerSignalCutoverReadiness: selfEvolutionServerSignalCutoverReadinessArtifact.exists ? { ...selfEvolutionServerSignalCutoverReadinessArtifact.data, fresh: selfEvolutionServerSignalCutoverReadinessArtifact.fresh } : null,
    selfEvolutionDropValidation: selfEvolutionDropValidationArtifact.exists ? { ...selfEvolutionDropValidationArtifact.data, fresh: selfEvolutionDropValidationArtifact.fresh } : null,
    selfEvolutionProvisionalRealizedOutcome: selfEvolutionProvisionalRealizedOutcomeArtifact.exists ? { ...selfEvolutionProvisionalRealizedOutcomeArtifact.data, fresh: selfEvolutionProvisionalRealizedOutcomeArtifact.fresh } : null,
    selfEvolutionOverrideAuthority: selfEvolutionOverrideAuthorityArtifact.exists ? { ...selfEvolutionOverrideAuthorityArtifact.data, fresh: selfEvolutionOverrideAuthorityArtifact.fresh } : null,
    selfEvolutionExecutionQuality: selfEvolutionExecutionQualityArtifact.exists ? { ...selfEvolutionExecutionQualityArtifact.data, fresh: selfEvolutionExecutionQualityArtifact.fresh } : null,
    selfEvolutionReversePolicy: selfEvolutionReversePolicyArtifact.exists ? { ...selfEvolutionReversePolicyArtifact.data, fresh: selfEvolutionReversePolicyArtifact.fresh } : null,
    selfEvolutionServerPrimaryLearningEpoch: selfEvolutionServerPrimaryLearningEpochArtifact.exists ? { ...selfEvolutionServerPrimaryLearningEpochArtifact.data, fresh: selfEvolutionServerPrimaryLearningEpochArtifact.fresh } : null,
    selfEvolutionInitialSignalQualityContract: selfEvolutionInitialSignalQualityContractArtifact.exists ? { ...selfEvolutionInitialSignalQualityContractArtifact.data, fresh: selfEvolutionInitialSignalQualityContractArtifact.fresh } : null,
    selfEvolutionExitTrailingContract: selfEvolutionExitTrailingContractArtifact.exists ? { ...selfEvolutionExitTrailingContractArtifact.data, fresh: selfEvolutionExitTrailingContractArtifact.fresh } : null,
    selfEvolutionServerNativeHtfModeComparison: selfEvolutionServerNativeHtfModeComparisonArtifact.exists ? { ...selfEvolutionServerNativeHtfModeComparisonArtifact.data, fresh: selfEvolutionServerNativeHtfModeComparisonArtifact.fresh } : null,
    selfEvolutionServerNativeHtfModeGovernor: selfEvolutionServerNativeHtfModeGovernorArtifact.exists ? { ...selfEvolutionServerNativeHtfModeGovernorArtifact.data, fresh: selfEvolutionServerNativeHtfModeGovernorArtifact.fresh } : null,
    selfEvolutionCanonicalProvenance: selfEvolutionCanonicalProvenanceArtifact.exists ? { ...selfEvolutionCanonicalProvenanceArtifact.data, fresh: selfEvolutionCanonicalProvenanceArtifact.fresh } : null,
    selfEvolutionServerPrimaryCanary: selfEvolutionServerPrimaryCanaryArtifact.exists ? { ...selfEvolutionServerPrimaryCanaryArtifact.data, fresh: selfEvolutionServerPrimaryCanaryArtifact.fresh } : null,
    selfEvolutionPineShadowDrift: selfEvolutionPineShadowDriftArtifact.exists ? { ...selfEvolutionPineShadowDriftArtifact.data, fresh: selfEvolutionPineShadowDriftArtifact.fresh } : null,
    selfEvolutionDeploymentProbe: selfEvolutionDeploymentProbeArtifact.exists ? { ...selfEvolutionDeploymentProbeArtifact.data, fresh: selfEvolutionDeploymentProbeArtifact.fresh } : null,
    selfEvolutionBundleActivation: selfEvolutionBundleActivationArtifact.exists ? { ...selfEvolutionBundleActivationArtifact.data, fresh: selfEvolutionBundleActivationArtifact.fresh } : null,
    selfEvolutionEvGateRescue: selfEvolutionEvGateRescueArtifact.exists ? { ...selfEvolutionEvGateRescueArtifact.data, fresh: selfEvolutionEvGateRescueArtifact.fresh } : null,
    selfEvolutionMemory: selfEvolutionMemoryData,
    selfEvolutionLoopMonitor: null,
    selfEvolutionCycleState,
    codex: codexArtifact.exists ? { ...codexArtifact.data, fresh: codexArtifact.fresh } : null,
    stageAutopilot: stageAutopilotArtifact.exists ? { ...stageAutopilotArtifact.data, fresh: stageAutopilotArtifact.fresh } : null,
    retrospective: retrospectiveArtifact.data,
    weeklyHistory: weeklyPineHistoryArtifact.data,
    manualPasteAck,
    signalsCache,
    preparedOverride,
  });
  const selfEvolutionOpenclawAutonomyContractSummary = summarizeSelfEvolutionOpenClawAutonomyContract(selfEvolutionOpenclawAutonomyContractArtifact.data);
  const selfEvolutionServerPrimaryAcceptanceWatchSummary = summarizeSelfEvolutionServerPrimaryAcceptanceWatch(selfEvolutionServerPrimaryAcceptanceWatchArtifact.data);
  const selfEvolutionObjectiveRecoveryGovernorSummary = summarizeSelfEvolutionObjectiveRecoveryGovernor(selfEvolutionObjectiveRecoveryGovernorArtifact.data);
  const selfEvolutionObjectiveRecoveryEffectSummary = summarizeSelfEvolutionObjectiveRecoveryEffect(selfEvolutionObjectiveRecoveryEffectArtifact.data);
  const currentVisualPine = currentVersionPineSyncArtifact.exists && currentVersionPineSyncArtifact.data
    ? currentVersionPineSyncArtifact.data
    : null;
  const objectiveRecoveryPriorityActiveForPlan = Boolean(
    evaluation && evaluation.objective && (evaluation.objective.monthly_pass === false || evaluation.objective.pass === false)
    || evaluation && evaluation.retrospective && evaluation.retrospective.any_fail
  );
  const mergedActionPlan = Array.from(new Set([
    ...(Array.isArray(evaluation.action_plan) ? evaluation.action_plan : []),
    ...(objectiveRecoveryPriorityActiveForPlan && (
      (evaluation.self_evolution_server_signal_authority && evaluation.self_evolution_server_signal_authority.drift_status === "PARITY_DRIFT")
      || (evaluation.self_evolution_server_signal_cutover_readiness && evaluation.self_evolution_server_signal_cutover_readiness.readiness_status)
    ) ? [
      "SERVER_SIGNAL_PRIORITY_MODE: parity drift and cutover readiness are secondary while daily/weekly/monthly recovery remains the primary objective.",
    ] : []),
    ...(evaluation.self_evolution_cycle && evaluation.self_evolution_cycle.derived_cycle_mismatch_n > 0
      ? [`SELF_EVOLUTION_DERIVED_CYCLE_DRIFT: ${evaluation.self_evolution_cycle.derived_cycle_mismatches.map((row) => `${row.key}:${row.cycle_id}`).join(" | ")}`]
      : []),
    ...(evaluation.self_evolution_server_signal_authority && evaluation.self_evolution_server_signal_authority.drift_status === "PARITY_DRIFT"
      ? [`SERVER_SIGNAL_AUTHORITY_DRIFT: server24h=${evaluation.self_evolution_server_signal_authority.authoritative_server_24h_n ?? 0} / shadow24h=${evaluation.self_evolution_server_signal_authority.pine_shadow_24h_n ?? 0} / mismatch=${evaluation.self_evolution_server_signal_authority.parity_mismatch_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_server_signal_quality && evaluation.self_evolution_server_signal_quality.quality_status
      ? [`SERVER_SIGNAL_QUALITY_STATUS: ${evaluation.self_evolution_server_signal_quality.quality_status} / entry24h=${evaluation.self_evolution_server_signal_quality.authoritative_entry_signal_24h_n ?? 0} / intent24h=${evaluation.self_evolution_server_signal_quality.order_intent_24h_n ?? 0} / fill24h=${evaluation.self_evolution_server_signal_quality.fill_24h_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_server_signal_cutover_readiness && evaluation.self_evolution_server_signal_cutover_readiness.readiness_status
      ? [`SERVER_SIGNAL_CUTOVER_STATUS: ${evaluation.self_evolution_server_signal_cutover_readiness.readiness_status} / ready=${evaluation.self_evolution_server_signal_cutover_readiness.promotion_ready ? "YES" : "NO"} / blockers=${Array.isArray(evaluation.self_evolution_server_signal_cutover_readiness.blockers) && evaluation.self_evolution_server_signal_cutover_readiness.blockers.length ? evaluation.self_evolution_server_signal_cutover_readiness.blockers.join("|") : "none"}`]
      : []),
    ...(evaluation.self_evolution_server_signal_cutover_readiness && evaluation.self_evolution_server_signal_cutover_readiness.recommended_action
      ? [`SERVER_SIGNAL_CUTOVER_ACTION: ${evaluation.self_evolution_server_signal_cutover_readiness.recommended_action} / family=${evaluation.self_evolution_server_signal_cutover_readiness.dominant_mismatch_family || "N/A"} / top_market=${evaluation.self_evolution_server_signal_cutover_readiness.ev_policy_top_rescue_market || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_signal_cutover_readiness && Array.isArray(evaluation.self_evolution_server_signal_cutover_readiness.blocker_actions)
      ? evaluation.self_evolution_server_signal_cutover_readiness.blocker_actions.map((row) => `SERVER_SIGNAL_BLOCKER_ACTION: ${row.family || "N/A"} -> ${row.action || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_drop_validation && evaluation.self_evolution_drop_validation.status
      ? [`DROP_VALIDATION_STATUS: ${evaluation.self_evolution_drop_validation.status} / recent_drop=${evaluation.self_evolution_drop_validation.recent_drop_n ?? 0} / matured=${evaluation.self_evolution_drop_validation.matured_reason_n ?? 0} / dominant=${evaluation.self_evolution_drop_validation.dominant_family || "N/A"}:${evaluation.self_evolution_drop_validation.dominant_verdict || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_drop_validation && evaluation.self_evolution_drop_validation.top_rescue_family
      ? [`DROP_VALIDATION_TOP_RESCUE: ${evaluation.self_evolution_drop_validation.top_rescue_family} / ${evaluation.self_evolution_drop_validation.top_rescue_reason || "N/A"} / ${evaluation.self_evolution_drop_validation.top_rescue_market || "N/A"} / avg_ret=${evaluation.self_evolution_drop_validation.top_rescue_avg_horizon_ret_net != null ? evaluation.self_evolution_drop_validation.top_rescue_avg_horizon_ret_net : "N/A"} / avg_pnl_proxy=${evaluation.self_evolution_drop_validation.top_rescue_avg_horizon_pnl_quote_proxy != null ? evaluation.self_evolution_drop_validation.top_rescue_avg_horizon_pnl_quote_proxy : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_drop_validation && Array.isArray(evaluation.self_evolution_drop_validation.top_watch_markets)
      ? evaluation.self_evolution_drop_validation.top_watch_markets
        .slice(0, 6)
        .map((row) => `DROP_VALIDATION_MARKET_WATCH: ${row.market || "N/A"} / ${row.verdict || "N/A"} / ${row.dominant_family || "N/A"} / ${row.dominant_reason || "N/A"} / next=${row.recommended_action || "N/A"} / recent_drop=${row.recent_drop_n ?? 0} / matured=${row.matured_n ?? 0}`)
      : []),
    ...(evaluation.self_evolution_drop_validation && Array.isArray(evaluation.self_evolution_drop_validation.next_actions)
      ? evaluation.self_evolution_drop_validation.next_actions
      : []),
    ...(evaluation.self_evolution_provisional_realized_outcome && evaluation.self_evolution_provisional_realized_outcome.status
      ? [`PROVISIONAL_REALIZED_OUTCOME: ${evaluation.self_evolution_provisional_realized_outcome.status} / final=${evaluation.self_evolution_provisional_realized_outcome.final_realized_n ?? 0} / provisional=${evaluation.self_evolution_provisional_realized_outcome.provisional_realized_n ?? 0} / effective=${evaluation.self_evolution_provisional_realized_outcome.effective_realized_n ?? 0} / top=${evaluation.self_evolution_provisional_realized_outcome.top_provisional_market || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_override_authority && evaluation.self_evolution_override_authority.status
      ? [`OVERRIDE_AUTHORITY: ${evaluation.self_evolution_override_authority.status} / max_markets=${evaluation.self_evolution_override_authority.max_market_overrides_per_cycle ?? "N/A"} / risk=${evaluation.self_evolution_override_authority.risk_override_enabled ? "ALLOW" : "BLOCK"} / top=${Array.isArray(evaluation.self_evolution_override_authority.top_priority_markets) && evaluation.self_evolution_override_authority.top_priority_markets.length ? evaluation.self_evolution_override_authority.top_priority_markets.map((row) => row.market).join("|") : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_exploration_budget && evaluation.self_evolution_exploration_budget.status
      ? [`EXPLORATION_BUDGET: ${evaluation.self_evolution_exploration_budget.status} / prod=${Array.isArray(evaluation.self_evolution_exploration_budget.production_markets) && evaluation.self_evolution_exploration_budget.production_markets.length ? evaluation.self_evolution_exploration_budget.production_markets.join("|") : "N/A"} / explore=${Array.isArray(evaluation.self_evolution_exploration_budget.exploration_markets) && evaluation.self_evolution_exploration_budget.exploration_markets.length ? evaluation.self_evolution_exploration_budget.exploration_markets.join("|") : "N/A"} / deferred=${Array.isArray(evaluation.self_evolution_exploration_budget.deferred_penalty_markets) && evaluation.self_evolution_exploration_budget.deferred_penalty_markets.length ? evaluation.self_evolution_exploration_budget.deferred_penalty_markets.join("|") : "none"}`]
      : []),
    ...(evaluation.self_evolution_server_market_capital_allocator && evaluation.self_evolution_server_market_capital_allocator.status
      ? [`SERVER_MARKET_CAPITAL_ALLOCATOR: ${evaluation.self_evolution_server_market_capital_allocator.status} / increase=${evaluation.self_evolution_server_market_capital_allocator.top_increase_market || "N/A"} / reduce=${evaluation.self_evolution_server_market_capital_allocator.top_reduce_market || "N/A"} / quarantine=${evaluation.self_evolution_server_market_capital_allocator.top_quarantine_market || "N/A"} / explore=${evaluation.self_evolution_server_market_capital_allocator.top_explore_market || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_market_capital_allocator && Array.isArray(evaluation.self_evolution_server_market_capital_allocator.top_watch_markets)
      ? evaluation.self_evolution_server_market_capital_allocator.top_watch_markets.slice(0, 6).map((row) => `SERVER_MARKET_CAPITAL_WATCH: ${row.market || "N/A"} / action=${row.recommended_action || "N/A"} / score=${row.allocation_score != null ? row.allocation_score : "N/A"} / prod=${row.production_slot ? "YES" : "NO"} / explore=${row.exploration_slot ? "YES" : "NO"}`)
      : []),
    ...(evaluation.self_evolution_server_market_quarantine && evaluation.self_evolution_server_market_quarantine.status
      ? [`SERVER_MARKET_QUARANTINE: ${evaluation.self_evolution_server_market_quarantine.status} / n=${evaluation.self_evolution_server_market_quarantine.quarantine_market_n ?? 0} / top=${evaluation.self_evolution_server_market_quarantine.top_quarantine_market || "N/A"} / reason=${evaluation.self_evolution_server_market_quarantine.top_quarantine_reason || "N/A"} / severity=${evaluation.self_evolution_server_market_quarantine.top_quarantine_severity || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_market_quarantine && Array.isArray(evaluation.self_evolution_server_market_quarantine.top_watch_markets)
      ? evaluation.self_evolution_server_market_quarantine.top_watch_markets.slice(0, 6).map((row) => `SERVER_MARKET_QUARANTINE_WATCH: ${row.market || "N/A"} / reason=${row.quarantine_reason || "N/A"} / severity=${row.quarantine_severity || "N/A"} / score=${row.allocation_score != null ? row.allocation_score : "N/A"} / action=${row.recommended_action || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_exploration_proposal && evaluation.self_evolution_exploration_proposal.status
      ? [`EXPLORATION_DRY_RUN: ${evaluation.self_evolution_exploration_proposal.status} / top=${evaluation.self_evolution_exploration_proposal.top_market || "N/A"} / stage=${evaluation.self_evolution_exploration_proposal.top_stage || "N/A"} / action=${evaluation.self_evolution_exploration_proposal.top_action || "N/A"} / n=${evaluation.self_evolution_exploration_proposal.proposal_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_exploration_proposal && Array.isArray(evaluation.self_evolution_exploration_proposal.proposals)
      ? evaluation.self_evolution_exploration_proposal.proposals.slice(0, 3).map((row) => `EXPLORATION_DRY_RUN_WATCH: ${row.market || "N/A"} / ${row.stage || "N/A"} / ${row.proposed_action || "N/A"} / obj=${row.objective_score != null ? row.objective_score : "N/A"} / delta=${row.delta_score != null ? row.delta_score : "N/A"} / drop=${row.drop_family || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_exploration_apply_candidate && evaluation.self_evolution_exploration_apply_candidate.status
      ? [`EXPLORATION_APPLY_CANDIDATE: ${evaluation.self_evolution_exploration_apply_candidate.status} / top=${evaluation.self_evolution_exploration_apply_candidate.top_market || "N/A"} / stage=${evaluation.self_evolution_exploration_apply_candidate.top_stage || "N/A"} / action=${evaluation.self_evolution_exploration_apply_candidate.top_action || "N/A"} / manual=${evaluation.self_evolution_exploration_apply_candidate.manual_confirm_required ? "YES" : "NO"} / auto=${evaluation.self_evolution_exploration_apply_candidate.auto_apply_allowed ? "YES" : "NO"}`]
      : []),
    ...(evaluation.self_evolution_exploration_apply_candidate && Array.isArray(evaluation.self_evolution_exploration_apply_candidate.candidates)
      ? evaluation.self_evolution_exploration_apply_candidate.candidates.slice(0, 2).map((row) => `EXPLORATION_APPLY_CANDIDATE_WATCH: ${row.market || "N/A"} / ${row.stage || "N/A"} / ${row.proposed_action || "N/A"} / source=${row.source_proposed_action || "N/A"} / manual=${row.manual_confirm_required ? "YES" : "NO"} / auto=${row.auto_apply_allowed ? "YES" : "NO"} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join('|') : 'none'}`)
      : []),
    ...(evaluation.self_evolution_change_result_attribution && evaluation.self_evolution_change_result_attribution.status
      ? [`CHANGE_RESULT_ATTRIBUTION: ${evaluation.self_evolution_change_result_attribution.status} / tracked=${evaluation.self_evolution_change_result_attribution.tracked_change_n ?? 0} / 24h=${evaluation.self_evolution_change_result_attribution.evaluated_24h_n ?? 0} / 72h=${evaluation.self_evolution_change_result_attribution.evaluated_72h_n ?? 0} / partial=${evaluation.self_evolution_change_result_attribution.partial_window_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_change_result_attribution && evaluation.self_evolution_change_result_attribution.top_positive_change
      ? [`CHANGE_RESULT_TOP_POSITIVE: ${evaluation.self_evolution_change_result_attribution.top_positive_change.stage || "N/A"} / ${evaluation.self_evolution_change_result_attribution.top_positive_change.action || "N/A"} / ${evaluation.self_evolution_change_result_attribution.top_positive_change.primary_impact && evaluation.self_evolution_change_result_attribution.top_positive_change.primary_impact.primary_window || "N/A"} / score=${evaluation.self_evolution_change_result_attribution.top_positive_change.primary_impact && evaluation.self_evolution_change_result_attribution.top_positive_change.primary_impact.impact_score != null ? evaluation.self_evolution_change_result_attribution.top_positive_change.primary_impact.impact_score : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_change_result_attribution && evaluation.self_evolution_change_result_attribution.top_adverse_change
      ? [`CHANGE_RESULT_TOP_ADVERSE: ${evaluation.self_evolution_change_result_attribution.top_adverse_change.stage || "N/A"} / ${evaluation.self_evolution_change_result_attribution.top_adverse_change.action || "N/A"} / ${evaluation.self_evolution_change_result_attribution.top_adverse_change.primary_impact && evaluation.self_evolution_change_result_attribution.top_adverse_change.primary_impact.primary_window || "N/A"} / score=${evaluation.self_evolution_change_result_attribution.top_adverse_change.primary_impact && evaluation.self_evolution_change_result_attribution.top_adverse_change.primary_impact.impact_score != null ? evaluation.self_evolution_change_result_attribution.top_adverse_change.primary_impact.impact_score : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_change_result_attribution && Array.isArray(evaluation.self_evolution_change_result_attribution.top_watch_changes)
      ? evaluation.self_evolution_change_result_attribution.top_watch_changes.slice(0, 3).map((row) => `CHANGE_RESULT_WATCH: ${row.stage || "N/A"} / ${row.action || "N/A"} / ${row.primary_window || "N/A"} / ${row.impact_verdict || "N/A"} / score=${row.impact_score != null ? row.impact_score : "N/A"} / obj=${row.objective_score_delta != null ? row.objective_score_delta : "N/A"} / fill=${row.server_signal_fill_24h_delta != null ? row.server_signal_fill_24h_delta : "N/A"} / mismatch=${row.parity_mismatch_n_delta != null ? row.parity_mismatch_n_delta : "N/A"}`)
      : []),
    ...(evaluation.self_evolution_override_authority && Array.isArray(evaluation.self_evolution_override_authority.execution_quality_penalty_markets) && evaluation.self_evolution_override_authority.execution_quality_penalty_markets.length
      ? [`OVERRIDE_AUTHORITY_EXECUTION_PENALTY: ${evaluation.self_evolution_override_authority.execution_quality_penalty_markets.join("|")}`]
      : []),
    ...(evaluation.self_evolution_override_authority && Array.isArray(evaluation.self_evolution_override_authority.reverse_policy_penalty_markets) && evaluation.self_evolution_override_authority.reverse_policy_penalty_markets.length
      ? [`OVERRIDE_AUTHORITY_REVERSE_PENALTY: ${evaluation.self_evolution_override_authority.reverse_policy_penalty_markets.join("|")}`]
      : []),
    ...(evaluation.self_evolution_execution_quality && evaluation.self_evolution_execution_quality.status
      ? [`EXECUTION_QUALITY: ${evaluation.self_evolution_execution_quality.status} / latency_p95=${evaluation.self_evolution_execution_quality.created_to_fill_p95_ms ?? "N/A"} / slippage_p95=${evaluation.self_evolution_execution_quality.adverse_slippage_p95_bps ?? "N/A"} / partial=${evaluation.self_evolution_execution_quality.partial_fill_rate_pct ?? "N/A"} / top=${evaluation.self_evolution_execution_quality.top_latency_market || evaluation.self_evolution_execution_quality.top_slippage_market || evaluation.self_evolution_execution_quality.top_partial_market || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_execution_quality && Array.isArray(evaluation.self_evolution_execution_quality.top_watch_markets)
      ? evaluation.self_evolution_execution_quality.top_watch_markets.slice(0, 6).map((row) => `EXECUTION_QUALITY_WATCH: ${row.market || "N/A"} / latency=${row.avg_created_to_fill_ms != null ? row.avg_created_to_fill_ms : "N/A"} / slippage=${row.avg_slippage_bps != null ? row.avg_slippage_bps : "N/A"} / partial=${row.partial_fill_rate_pct != null ? row.partial_fill_rate_pct : "N/A"}`)
      : []),
    ...(evaluation.self_evolution_reverse_policy && evaluation.self_evolution_reverse_policy.status
      ? [`REVERSE_POLICY: ${evaluation.self_evolution_reverse_policy.status} / drop=${evaluation.self_evolution_reverse_policy.reverse_drop_n ?? 0} / revive=${evaluation.self_evolution_reverse_policy.reverse_revive_n ?? 0} / rate=${evaluation.self_evolution_reverse_policy.reverse_revive_rate != null ? evaluation.self_evolution_reverse_policy.reverse_revive_rate : "N/A"} / top=${evaluation.self_evolution_reverse_policy.top_watch_market || "N/A"}:${evaluation.self_evolution_reverse_policy.top_watch_reason || "N/A"}:${evaluation.self_evolution_reverse_policy.top_watch_action || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_primary_learning_epoch && evaluation.self_evolution_server_primary_learning_epoch.status
      ? [`SERVER_PRIMARY_LEARNING_EPOCH: ${evaluation.self_evolution_server_primary_learning_epoch.status} / focus=${evaluation.self_evolution_server_primary_learning_epoch.learning_focus || "N/A"} / age_days=${evaluation.self_evolution_server_primary_learning_epoch.age_days != null ? evaluation.self_evolution_server_primary_learning_epoch.age_days : "N/A"} / penalty_weight=${evaluation.self_evolution_server_primary_learning_epoch.penalty_weight != null ? evaluation.self_evolution_server_primary_learning_epoch.penalty_weight : "N/A"} / sample_weight=${evaluation.self_evolution_server_primary_learning_epoch.sample_weight != null ? evaluation.self_evolution_server_primary_learning_epoch.sample_weight : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_initial_signal_quality_contract && evaluation.self_evolution_initial_signal_quality_contract.status
      ? [`INITIAL_SIGNAL_QUALITY_CONTRACT: ${evaluation.self_evolution_initial_signal_quality_contract.status} / strategy=${evaluation.self_evolution_initial_signal_quality_contract.current_visual_pine && evaluation.self_evolution_initial_signal_quality_contract.current_visual_pine.strategy_id || "N/A"} / early=${evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria && evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.early_threshold != null ? evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.early_threshold : "N/A"} / core=${evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria && evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.core_threshold != null ? evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.core_threshold : "N/A"} / diag_c=${evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria && evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.diag_c_threshold != null ? evaluation.self_evolution_initial_signal_quality_contract.pine_signal_criteria.diag_c_threshold : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_initial_signal_quality_contract && evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality
      ? [`INITIAL_SIGNAL_SERVER_CANONICAL: conf>=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.confidence_min ?? "N/A"} / posterior>=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.posterior_min ?? "N/A"} / wave>=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.wave_conf_min ?? "N/A"} / trisk<=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.transition_risk_max ?? "N/A"} / align>=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.field_alignment_min ?? "N/A"} / coh>=${evaluation.self_evolution_initial_signal_quality_contract.server_canonical_transition_core_quality.coherence_min ?? "N/A"}`]
      : []),
    ...(evaluation.self_evolution_exit_trailing_contract && evaluation.self_evolution_exit_trailing_contract.status
      ? [`EXIT_TRAILING_CONTRACT: ${evaluation.self_evolution_exit_trailing_contract.status} / canonical=${evaluation.self_evolution_exit_trailing_contract.canonical_mode || "N/A"} / basis=${evaluation.self_evolution_exit_trailing_contract.r_basis || "N/A"} / invariant=${evaluation.self_evolution_exit_trailing_contract.leverage_invariant_r ? "YES" : "NO"} / profile=${evaluation.self_evolution_exit_trailing_contract.active_binance_profile_mode || "N/A"} / SL=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.sl_pct_abs != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.sl_pct_abs : "N/A"} / TP1=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.tp1_pct != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.tp1_pct : "N/A"} / TP1_QTY=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.tp1_qty_pct != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.tp1_qty_pct : "N/A"} / BE=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.be_pct != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.be_pct : "N/A"} / TRAIL_R=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.trail_r_multiple != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.trail_r_multiple : "N/A"} / RUNNER_MIN=${evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract && evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.runner_min_profit_pct != null ? evaluation.self_evolution_exit_trailing_contract.active_binance_entry_exit_contract.runner_min_profit_pct : "N/A"} / mismatch=${evaluation.self_evolution_exit_trailing_contract.mismatch_exchange || "none"}`]
      : []),
    ...(evaluation.self_evolution_server_native_htf_mode_comparison && evaluation.self_evolution_server_native_htf_mode_comparison.status
      ? [`SERVER_NATIVE_HTF_MODE: ${evaluation.self_evolution_server_native_htf_mode_comparison.status} / selected=${evaluation.self_evolution_server_native_htf_mode_comparison.selected_mode || "N/A"} / divergence=${evaluation.self_evolution_server_native_htf_mode_comparison.divergence_bar_n ?? 0} / compared=${evaluation.self_evolution_server_native_htf_mode_comparison.compared_bar_n ?? 0} / top=${evaluation.self_evolution_server_native_htf_mode_comparison.top_divergence_symbol || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_native_htf_mode_governor && evaluation.self_evolution_server_native_htf_mode_governor.status
      ? [`SERVER_NATIVE_HTF_GOVERNOR: ${evaluation.self_evolution_server_native_htf_mode_governor.status} / selected=${evaluation.self_evolution_server_native_htf_mode_governor.selected_mode || "N/A"} / rec=${evaluation.self_evolution_server_native_htf_mode_governor.recommendation || "N/A"} / reason=${evaluation.self_evolution_server_native_htf_mode_governor.reason || "N/A"} / top=${evaluation.self_evolution_server_native_htf_mode_governor.top_divergence_symbol || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_reverse_policy && Array.isArray(evaluation.self_evolution_reverse_policy.top_watch_markets)
      ? evaluation.self_evolution_reverse_policy.top_watch_markets.slice(0, 6).map((row) => `REVERSE_POLICY_WATCH: ${row.market || "N/A"} / drop=${row.reverse_drop_n != null ? row.reverse_drop_n : "N/A"} / revive=${row.reverse_revive_n != null ? row.reverse_revive_n : "N/A"} / verdict=${row.verdict || "N/A"} / action=${row.recommended_action || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_market_objective_score && evaluation.self_evolution_market_objective_score.status
      ? [`MARKET_OBJECTIVE_STATUS: ${evaluation.self_evolution_market_objective_score.status} / active=${evaluation.self_evolution_market_objective_score.active_market_n ?? 0} / markets=${evaluation.self_evolution_market_objective_score.market_n ?? 0} / global=${evaluation.self_evolution_market_objective_score.global_objective_score != null ? evaluation.self_evolution_market_objective_score.global_objective_score : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_market_objective_score && evaluation.self_evolution_market_objective_score.top_recovery_market
      ? [`MARKET_OBJECTIVE_TOP_RECOVERY: ${evaluation.self_evolution_market_objective_score.top_recovery_market} / score=${evaluation.self_evolution_market_objective_score.top_recovery_objective_score != null ? evaluation.self_evolution_market_objective_score.top_recovery_objective_score : "N/A"} / action=${evaluation.self_evolution_market_objective_score.top_recovery_drop_action || "N/A"} / avg_pnl_proxy=${evaluation.self_evolution_market_objective_score.top_recovery_avg_horizon_pnl_quote_proxy != null ? evaluation.self_evolution_market_objective_score.top_recovery_avg_horizon_pnl_quote_proxy : "N/A"}`]
      : []),
    ...(evaluation.self_evolution_market_objective_score && evaluation.self_evolution_market_objective_score.top_drag_market
      ? [`MARKET_OBJECTIVE_TOP_DRAG: ${evaluation.self_evolution_market_objective_score.top_drag_market} / score=${evaluation.self_evolution_market_objective_score.top_drag_objective_score != null ? evaluation.self_evolution_market_objective_score.top_drag_objective_score : "N/A"} / concentration=${evaluation.self_evolution_market_objective_score.concentration_flag ? "YES" : "NO"}`]
      : []),
    ...(evaluation.self_evolution_market_objective_score && Array.isArray(evaluation.self_evolution_market_objective_score.top_watch_markets)
      ? evaluation.self_evolution_market_objective_score.top_watch_markets.slice(0, 6).map((row) => `MARKET_OBJECTIVE_WATCH: ${row.market || "N/A"} / obj=${row.objective_score != null ? row.objective_score : "N/A"} / band=${row.objective_band || "N/A"} / drop=${row.drop_verdict || "N/A"} / action=${row.drop_action || "N/A"} / prio=${row.recovery_priority_score != null ? row.recovery_priority_score : "N/A"}`)
      : []),
    ...(evaluation.self_evolution_server_vs_pine_performance_delta && evaluation.self_evolution_server_vs_pine_performance_delta.status
      ? [`SERVER_VS_PINE_DELTA_STATUS: ${evaluation.self_evolution_server_vs_pine_performance_delta.status} / active=${evaluation.self_evolution_server_vs_pine_performance_delta.active_market_n ?? 0} / avg_delta=${evaluation.self_evolution_server_vs_pine_performance_delta.avg_active_delta_score != null ? evaluation.self_evolution_server_vs_pine_performance_delta.avg_active_delta_score : "N/A"} / mismatch=${evaluation.self_evolution_server_vs_pine_performance_delta.parity_mismatch_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_server_vs_pine_performance_delta && evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_market
      ? [`SERVER_VS_PINE_TOP_SHADOW_GAP: ${evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_market} / score=${evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_score != null ? evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_score : "N/A"} / action=${evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_action || "N/A"} / reason=${evaluation.self_evolution_server_vs_pine_performance_delta.top_shadow_gap_reason || "N/A"}`]
      : []),
    ...(evaluation.self_evolution_server_vs_pine_performance_delta && Array.isArray(evaluation.self_evolution_server_vs_pine_performance_delta.top_watch_markets)
      ? evaluation.self_evolution_server_vs_pine_performance_delta.top_watch_markets.slice(0, 6).map((row) => `SERVER_VS_PINE_WATCH: ${row.market || "N/A"} / verdict=${row.verdict || "N/A"} / delta=${row.performance_delta_score != null ? row.performance_delta_score : "N/A"} / obj=${row.objective_score != null ? row.objective_score : "N/A"} / mismatch=${row.mismatch_count != null ? row.mismatch_count : "N/A"} / action=${row.recommended_action || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_market_regime_board && evaluation.self_evolution_market_regime_board.status
      ? [`MARKET_REGIME_BOARD: ${evaluation.self_evolution_market_regime_board.status} / rescue=${evaluation.self_evolution_market_regime_board.rescue_market_n ?? 0} / mixed=${evaluation.self_evolution_market_regime_board.mixed_market_n ?? 0} / keep_drop=${evaluation.self_evolution_market_regime_board.keep_drop_market_n ?? 0} / hold_sample=${evaluation.self_evolution_market_regime_board.hold_sample_market_n ?? 0}`]
      : []),
    ...(evaluation.self_evolution_market_regime_board && evaluation.self_evolution_market_regime_board.top_rescue_market
      ? [`MARKET_REGIME_TOP_RESCUE: ${evaluation.self_evolution_market_regime_board.top_rescue_market} / top_keep_drop=${evaluation.self_evolution_market_regime_board.top_keep_drop_market || "N/A"} / top_drag=${evaluation.self_evolution_market_regime_board.top_drag_market || "N/A"} / split=${evaluation.self_evolution_market_regime_board.has_market_split ? "YES" : "NO"}`]
      : []),
    ...(evaluation.self_evolution_market_regime_board && Array.isArray(evaluation.self_evolution_market_regime_board.top_watch_markets)
      ? evaluation.self_evolution_market_regime_board.top_watch_markets.slice(0, 6).map((row) => `MARKET_REGIME_WATCH: ${row.market || "N/A"} / cohort=${row.cohort || "N/A"} / obj=${row.objective_score != null ? row.objective_score : "N/A"} / drop=${row.drop_verdict || "N/A"} / delta=${row.delta_verdict || "N/A"} / alloc=${row.allocation_action || "N/A"} / quarantine=${row.quarantine_reason || "N/A"}`)
      : []),
    ...(evaluation.self_evolution_server_signal_cutover_readiness
      ? [
        "SERVER_SIGNAL_AUTHORITY_PRIMARY: OpenClaw must tune server signal and downstream server policy first; Pine is not an optimization authority",
        "PINE_SHADOW_COMPARE_ONLY: keep Pine as manual comparison/visualization shadow only; do not prioritize Pine modification over server signal correction",
      ]
      : []),
    ...(currentVisualPine && currentVisualPine.strategy_id
      ? [`CURRENT_VISUAL_PINE: ${currentVisualPine.strategy_id} / status=${currentVisualPine.status || "N/A"} / source=${currentVisualPine.source_file_path || "N/A"} / latest=${currentVisualPine.latest_generated_file_path || "N/A"}`]
      : []),
    ...(Array.isArray(selfEvolutionObjectiveRecoveryGovernorSummary.next_actions) ? selfEvolutionObjectiveRecoveryGovernorSummary.next_actions : []),
    ...(Array.isArray(selfEvolutionObjectiveRecoveryEffectSummary.next_actions) ? selfEvolutionObjectiveRecoveryEffectSummary.next_actions : []),
  ].filter(Boolean)));

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: selfEvolutionCycleState.expected_cycle_id || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    evaluation_scope: selfEvolutionStage,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    root_cause: evaluation.root_cause,
    action_plan: mergedActionPlan,
    blockers: evaluation.blockers,
    objective: evaluation.objective,
    governance_objective: evaluation.governance_objective,
    promotion: evaluation.promotion,
    rollback: evaluation.rollback,
    guards: evaluation.guards,
    physics: evaluation.physics,
    phase0: evaluation.phase0,
    self_evolution_dataset: evaluation.self_evolution_dataset,
    self_evolution_objective: evaluation.self_evolution_objective,
    self_evolution_attribution: evaluation.self_evolution_attribution,
    self_evolution_candidates: evaluation.self_evolution_candidates,
    self_evolution_replay: evaluation.self_evolution_replay,
    self_evolution_canary: evaluation.self_evolution_canary,
    self_evolution_canonical_parity: evaluation.self_evolution_canonical_parity,
    self_evolution_server_signal_authority: evaluation.self_evolution_server_signal_authority,
    self_evolution_server_signal_quality: evaluation.self_evolution_server_signal_quality,
    self_evolution_server_signal_cutover_readiness: evaluation.self_evolution_server_signal_cutover_readiness,
    self_evolution_drop_validation: evaluation.self_evolution_drop_validation,
    self_evolution_provisional_realized_outcome: evaluation.self_evolution_provisional_realized_outcome,
    self_evolution_override_authority: evaluation.self_evolution_override_authority,
    self_evolution_execution_quality: evaluation.self_evolution_execution_quality,
    self_evolution_reverse_policy: evaluation.self_evolution_reverse_policy,
    self_evolution_server_primary_learning_epoch: evaluation.self_evolution_server_primary_learning_epoch,
    self_evolution_initial_signal_quality_contract: evaluation.self_evolution_initial_signal_quality_contract,
    self_evolution_exit_trailing_contract: evaluation.self_evolution_exit_trailing_contract,
    self_evolution_market_objective_score: evaluation.self_evolution_market_objective_score,
    self_evolution_server_vs_pine_performance_delta: evaluation.self_evolution_server_vs_pine_performance_delta,
    self_evolution_market_regime_board: evaluation.self_evolution_market_regime_board,
    self_evolution_exploration_budget: evaluation.self_evolution_exploration_budget,
    self_evolution_server_market_capital_allocator: evaluation.self_evolution_server_market_capital_allocator,
    self_evolution_server_market_quarantine: evaluation.self_evolution_server_market_quarantine,
    self_evolution_exploration_proposal: evaluation.self_evolution_exploration_proposal,
    self_evolution_exploration_apply_candidate: evaluation.self_evolution_exploration_apply_candidate,
    self_evolution_canonical_provenance: evaluation.self_evolution_canonical_provenance,
    self_evolution_server_primary_canary: evaluation.self_evolution_server_primary_canary,
    self_evolution_server_primary_acceptance_watch: selfEvolutionServerPrimaryAcceptanceWatchSummary,
    self_evolution_pine_shadow_drift: evaluation.self_evolution_pine_shadow_drift,
    current_visual_pine: currentVisualPine ? {
      strategy_id: String(currentVisualPine.strategy_id || "").trim() || null,
      status: String(currentVisualPine.status || "").trim().toUpperCase() || null,
      source_file_path: String(currentVisualPine.source_file_path || "").trim() || null,
      latest_generated_file_path: String(currentVisualPine.latest_generated_file_path || "").trim() || null,
      synced: currentVisualPine.synced === true,
      opened: currentVisualPine.opened === true,
    } : {
      strategy_id: String(process.env.DONBEOLJA_STRATEGY_ID || "").trim() || null,
      status: null,
      source_file_path: null,
      latest_generated_file_path: null,
      synced: false,
      opened: false,
    },
    self_evolution_openclaw_autonomy_contract: selfEvolutionOpenclawAutonomyContractSummary,
    self_evolution_bundle_activation: evaluation.self_evolution_bundle_activation,
    self_evolution_objective_recovery_governor: selfEvolutionObjectiveRecoveryGovernorSummary,
    self_evolution_objective_recovery_effect: selfEvolutionObjectiveRecoveryEffectSummary,
    self_evolution_ev_gate_rescue: evaluation.self_evolution_ev_gate_rescue,
    self_evolution_cycle: evaluation.self_evolution_cycle,
    self_evolution_deployment: evaluation.self_evolution_deployment,
    self_evolution_deployment_plan: evaluation.self_evolution_deployment_plan,
    self_evolution_loop_monitor: null,
    self_evolution_weight_tuning: evaluation.self_evolution_weight_tuning,
    self_evolution_memory: evaluation.self_evolution_memory,
    sample_readiness: evaluation.sample_readiness,
    current_latest_context: {
      ...evaluation.current_latest_context,
      report_generated_at_kst: nowMeta.kst,
      target_cycle_id: selfEvolutionCycleState.expected_cycle_id || null,
      evaluation_scope: selfEvolutionStage,
      latest_mode: selfEvolutionStage === "STANDALONE" ? "STANDALONE_RECOMPUTE" : "LOOP_STAGE",
      standalone_recompute: selfEvolutionStage === "STANDALONE",
    },
    filter_canary_drift_context: evaluation.filter_canary_drift_context,
    ev_tuner_context: evaluation.ev_tuner_context,
    filter_layers: evaluation.filter_layers,
    best_febt_tuning_contract: {
      ...(evaluation.best_febt_tuning_contract || {}),
      objective_verdict: evaluation.verdict,
    },
    self_evolution_policy: evaluation.self_evolution_policy,
    best_febt_market_contracts: evaluation.best_febt_market_contracts,
    operational_recovery_context: evaluation.operational_recovery_context,
    autonomy_assessment: evaluation.autonomy_assessment,
    tuning: evaluation.tuning,
    codex_review: evaluation.codex_review,
    codex_authority: evaluation.codex_authority,
    stage_autopilot: evaluation.stage_autopilot,
    retrospective: evaluation.retrospective,
    artifacts: [governanceArtifact, changeArtifact, canaryArtifact, mlArtifact, evArtifact, waitArtifact, phase0Artifact, selfEvolutionDatasetArtifact, selfEvolutionObjectiveArtifact, selfEvolutionChangeResultAttributionArtifact, selfEvolutionAttributionArtifact, selfEvolutionCandidatesArtifact, selfEvolutionReplayArtifact, selfEvolutionCanaryArtifact, selfEvolutionCanonicalParityArtifact, selfEvolutionServerSignalAuthorityArtifact, selfEvolutionServerSignalQualityArtifact, selfEvolutionServerSignalCutoverReadinessArtifact, selfEvolutionDropValidationArtifact, selfEvolutionProvisionalRealizedOutcomeArtifact, selfEvolutionOverrideAuthorityArtifact, selfEvolutionExecutionQualityArtifact, selfEvolutionReversePolicyArtifact, selfEvolutionServerPrimaryLearningEpochArtifact, selfEvolutionInitialSignalQualityContractArtifact, selfEvolutionServerNativeHtfModeComparisonArtifact, selfEvolutionServerNativeHtfModeGovernorArtifact, selfEvolutionMarketObjectiveScoreArtifact, selfEvolutionServerVsPinePerformanceDeltaArtifact, selfEvolutionExplorationBudgetArtifact, selfEvolutionServerMarketCapitalAllocatorArtifact, selfEvolutionServerMarketQuarantineArtifact, selfEvolutionExplorationProposalArtifact, selfEvolutionExplorationApplyCandidateArtifact, selfEvolutionCanonicalProvenanceArtifact, selfEvolutionServerPrimaryCanaryArtifact, selfEvolutionServerPrimaryAcceptanceWatchArtifact, selfEvolutionPineShadowDriftArtifact, currentVersionPineSyncArtifact, selfEvolutionBundleActivationArtifact, selfEvolutionOpenclawAutonomyContractArtifact, selfEvolutionObjectiveRecoveryGovernorArtifact, selfEvolutionObjectiveRecoveryEffectArtifact, selfEvolutionEvGateRescueArtifact, selfEvolutionMemoryArtifact, codexArtifact, stageAutopilotArtifact, weeklyPineHistoryArtifact, retrospectiveArtifact].map((row) => ({
      name: row.name,
      filePath: row.filePath,
      fresh: row.fresh,
      age_hours: row.ageHours,
    })),
  };

  report.self_evolution_loop_monitor = summarizeSelfEvolutionLoopMonitor(deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      candidates: selfEvolutionCandidatesArtifact,
      replay: selfEvolutionReplayArtifact,
      canary: selfEvolutionCanaryArtifact,
      canonicalParity: selfEvolutionCanonicalParityArtifact,
      serverSignalAuthority: selfEvolutionServerSignalAuthorityArtifact,
      serverSignalQuality: selfEvolutionServerSignalQualityArtifact,
      serverSignalCutoverReadiness: selfEvolutionServerSignalCutoverReadinessArtifact,
      dropValidation: selfEvolutionDropValidationArtifact,
      provisionalRealizedOutcome: selfEvolutionProvisionalRealizedOutcomeArtifact,
      overrideAuthority: selfEvolutionOverrideAuthorityArtifact,
      executionQuality: selfEvolutionExecutionQualityArtifact,
      reversePolicy: selfEvolutionReversePolicyArtifact,
      serverPrimaryLearningEpoch: selfEvolutionServerPrimaryLearningEpochArtifact,
      marketObjectiveScore: selfEvolutionMarketObjectiveScoreArtifact,
      serverVsPinePerformanceDelta: selfEvolutionServerVsPinePerformanceDeltaArtifact,
      explorationBudget: selfEvolutionExplorationBudgetArtifact,
      serverMarketCapitalAllocator: selfEvolutionServerMarketCapitalAllocatorArtifact,
      serverMarketQuarantine: selfEvolutionServerMarketQuarantineArtifact,
      explorationProposal: selfEvolutionExplorationProposalArtifact,
      explorationApplyCandidate: selfEvolutionExplorationApplyCandidateArtifact,
      changeResultAttribution: selfEvolutionChangeResultAttributionArtifact,
      canonicalProvenance: selfEvolutionCanonicalProvenanceArtifact,
      serverPrimaryCanary: selfEvolutionServerPrimaryCanaryArtifact,
      serverPrimaryAcceptanceWatch: selfEvolutionServerPrimaryAcceptanceWatchArtifact,
      pineShadowDrift: selfEvolutionPineShadowDriftArtifact,
      deploymentProbe: selfEvolutionDeploymentProbeArtifact,
      bundleActivation: selfEvolutionBundleActivationArtifact,
      openclawAutonomyContract: selfEvolutionOpenclawAutonomyContractArtifact,
      objectiveRecoveryGovernor: selfEvolutionObjectiveRecoveryGovernorArtifact,
      objectiveRecoveryEffect: selfEvolutionObjectiveRecoveryEffectArtifact,
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
      stageAutopilot: stageAutopilotArtifact,
      weightTuning: { fresh: true },
      memory: selfEvolutionMemoryArtifact.exists ? selfEvolutionMemoryArtifact : { fresh: true },
      codexPatch: codexArtifact,
    },
    reports: {
      objectiveSupervisor: report,
      candidates: selfEvolutionCandidatesArtifact.data,
      replay: selfEvolutionReplayArtifact.data,
      canary: selfEvolutionCanaryArtifact.data,
      canonicalParity: selfEvolutionCanonicalParityArtifact.data,
      serverSignalAuthority: selfEvolutionServerSignalAuthorityArtifact.data,
      serverSignalQuality: selfEvolutionServerSignalQualityArtifact.data,
      serverSignalCutoverReadiness: selfEvolutionServerSignalCutoverReadinessArtifact.data,
      dropValidation: selfEvolutionDropValidationArtifact.data,
      provisionalRealizedOutcome: selfEvolutionProvisionalRealizedOutcomeArtifact.data,
      overrideAuthority: selfEvolutionOverrideAuthorityArtifact.data,
      executionQuality: selfEvolutionExecutionQualityArtifact.data,
      reversePolicy: selfEvolutionReversePolicyArtifact.data,
      serverPrimaryLearningEpoch: selfEvolutionServerPrimaryLearningEpochArtifact.data,
      exitTrailingContract: selfEvolutionExitTrailingContractArtifact.data,
      marketObjectiveScore: selfEvolutionMarketObjectiveScoreArtifact.data,
      serverVsPinePerformanceDelta: selfEvolutionServerVsPinePerformanceDeltaArtifact.data,
      explorationBudget: selfEvolutionExplorationBudgetArtifact.data,
      serverMarketCapitalAllocator: selfEvolutionServerMarketCapitalAllocatorArtifact.data,
      serverMarketQuarantine: selfEvolutionServerMarketQuarantineArtifact.data,
      explorationProposal: selfEvolutionExplorationProposalArtifact.data,
      explorationApplyCandidate: selfEvolutionExplorationApplyCandidateArtifact.data,
      changeResultAttribution: selfEvolutionChangeResultAttributionArtifact.data,
      canonicalProvenance: selfEvolutionCanonicalProvenanceArtifact.data,
      serverPrimaryCanary: selfEvolutionServerPrimaryCanaryArtifact.data,
      serverPrimaryAcceptanceWatch: selfEvolutionServerPrimaryAcceptanceWatchArtifact.data,
      pineShadowDrift: selfEvolutionPineShadowDriftArtifact.data,
      deploymentProbe: selfEvolutionDeploymentProbeArtifact.data,
      bundleActivation: selfEvolutionBundleActivationArtifact.data,
      openclawAutonomyContract: selfEvolutionOpenclawAutonomyContractArtifact.data,
      objectiveRecoveryGovernor: selfEvolutionObjectiveRecoveryGovernorArtifact.data,
      objectiveRecoveryEffect: selfEvolutionObjectiveRecoveryEffectArtifact.data,
      deployment: { cycle_id: reportCycleId, summary: evaluation.self_evolution_deployment },
      deploymentPlan: { cycle_id: reportCycleId, summary: evaluation.self_evolution_deployment_plan },
      stageAutopilot: stageAutopilotArtifact.data,
      weightTuning: { cycle_id: reportCycleId, ...evaluation.self_evolution_weight_tuning },
      memory: selfEvolutionMemoryData,
      codexPatch: codexArtifact.data,
    },
  }));

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);
  const selfEvolutionScoped = /^best_self_evolution_/i.test(String(reportCycleId || "").trim()) || selfEvolutionStage !== "STANDALONE";
  if (selfEvolutionScoped) {
    copySelfEvolutionLatest(jsonPath, SELF_EVOLUTION_REPORT_LATEST_JSON);
    copySelfEvolutionLatest(mdPath, SELF_EVOLUTION_REPORT_LATEST_MD);
  }
  const telegramSections = buildObjectiveSupervisorTelegramAlertSections(report);

  if (String(process.env.OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM || "").trim() !== "1") {
    const alert = await sendKoreanTelegramSummary({
      title: `[목표] ${report.verdict}`,
      severity: report.verdict === "ROLLBACK_CANDIDATE" ? "WARN" : (report.verdict === "PATCH_CANDIDATE" ? "INFO" : "INFO"),
      dedupeKey: `objective_supervisor:${report.verdict}:${report.reason}`,
      dedupeWindowSec: 18 * 60 * 60,
      dedupeFingerprint: JSON.stringify({
        verdict: report.verdict,
        reason: report.reason,
        blockers: report.blockers,
        physics: report.physics,
        retrospective: report.retrospective,
      }),
      sections: telegramSections,
    });
    if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    verdict: report.verdict,
    reason: report.reason,
    blockers: report.blockers,
    promotion_ready: report.promotion.ready,
    rollback_ready: report.rollback.ready,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    evaluateSupervisor,
    buildObjectiveSupervisorTelegramSections,
    buildObjectiveSupervisorTelegramAlertSections,
    buildFilterLayerSummary,
    summarizeRetrospective,
    deriveBestFebtTuningContract,
    deriveBestFebtMarketContracts,
    formatBestFebtMarketContractLine,
    summarizeSelfEvolutionObjective,
    summarizeSelfEvolutionAttribution,
    summarizeSelfEvolutionCandidates,
    summarizeSelfEvolutionReplay,
    summarizeSelfEvolutionCanary,
    summarizeSelfEvolutionMemory,
    summarizeSelfEvolutionDeploymentPlan,
    summarizeSelfEvolutionLoopMonitor,
    summarizeSelfEvolutionArtifactCycles,
    summarizeCodexAuthority,
  },
};
