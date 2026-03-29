"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  readJsonRawSafe,
} = require("./automation-utils");

const POLICY_PATH = "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md";
const DEFAULT_WEEKLY_GOVERNANCE_MAX_AGE_HOURS = 18;
const DEFAULT_OBJECTIVE_SUPERVISOR_MAX_AGE_HOURS = 18;
const AUTO_LEVERS = Object.freeze([
  "febt_lock_arm_min",
  "febt_lock_fire_min",
  "febt_fire_edge_min",
  "febt_late_hard_max",
  "febt_fail_max",
]);

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readFreshArtifact(filePath, nowMs, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data || typeof data !== "object") {
    return { filePath, data: null, age_ms: null, fresh: false };
  }
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const mtimeMs = stat ? Number(stat.mtimeMs) : null;
  const ageMs = Number.isFinite(mtimeMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - mtimeMs) : null;
  const fresh = Number.isFinite(ageMs) ? ageMs <= (Number(maxAgeHours) * 60 * 60 * 1000) : false;
  return { filePath, data, age_ms: ageMs, fresh };
}

function deriveBestFebtTuningContract({ governance = null, objectiveSupervisor = null } = {}) {
  const febtShadow = governance && governance.current && governance.current.febt_shadow && typeof governance.current.febt_shadow === "object"
    ? governance.current.febt_shadow
    : {};
  const waitLayer = objectiveSupervisor
    && objectiveSupervisor.filter_layers
    && objectiveSupervisor.filter_layers.wait_timing
    && typeof objectiveSupervisor.filter_layers.wait_timing === "object"
      ? objectiveSupervisor.filter_layers.wait_timing
      : {};
  const phase0 = objectiveSupervisor && objectiveSupervisor.phase0 && typeof objectiveSupervisor.phase0 === "object"
    ? objectiveSupervisor.phase0
    : {};
  const projectedReplacementRatio = toNum(febtShadow.projected_replacement_ratio);
  const projectedCountRatio = toNum(febtShadow.projected_count_ratio);
  const projectedNetSignalDeltaN = toNum(febtShadow.projected_net_signal_delta_n);
  const fireN = toNum(waitLayer.febt_fire_n);
  const lateN = toNum(waitLayer.febt_late_n);
  const voidN = toNum(waitLayer.febt_void_n);
  const disagreementN = toNum(waitLayer.febt_disagreement_n);
  const fallbackLegacyN = toNum(waitLayer.febt_fallback_legacy_n);
  const missingRate = toNum(waitLayer.febt_missing_rate);
  const legacyWaitCoverageRate = toNum(phase0.legacy_wait_coverage_rate);
  const legacyWaitObservedN = toNum(phase0.legacy_wait_observed_chain_n);
  const tighteningAllowed = projectedCountRatio == null ? true : projectedCountRatio >= 1.0;
  const recoveryPriority = projectedReplacementRatio == null ? false : projectedReplacementRatio < 0.80;
  const mode = !tighteningAllowed
    ? "COUNT_GUARD_ACTIVE"
    : (recoveryPriority ? "RECOVERY_FIRST" : "NORMAL");
  return {
    policy_path: POLICY_PATH,
    allowed_auto_levers: AUTO_LEVERS.slice(),
    objective_verdict: String(objectiveSupervisor && objectiveSupervisor.verdict || "N/A"),
    wait_tuner_reason: String(waitLayer.tuner_reason || "N/A"),
    wait_action: String(waitLayer.wait_action || "N/A"),
    projected_replacement_ratio: projectedReplacementRatio,
    projected_count_ratio_global: projectedCountRatio,
    projected_net_signal_delta_n: projectedNetSignalDeltaN,
    candidate_recovered_n: toNum(febtShadow.candidate_recovered_n),
    candidate_blocked_n: toNum(febtShadow.candidate_blocked_n),
    candidate_wait_n: toNum(febtShadow.candidate_wait_n),
    fire_n: fireN,
    late_n: lateN,
    void_n: voidN,
    disagreement_n: disagreementN,
    fallback_legacy_n: fallbackLegacyN,
    missing_rate: missingRate,
    legacy_wait_coverage_rate: legacyWaitCoverageRate,
    legacy_wait_observed_chain_n: legacyWaitObservedN,
    tightening_allowed: tighteningAllowed,
    recovery_priority: recoveryPriority,
    count_preservation_required: true,
    mode,
  };
}

function readBestFebtSupervisorContext(nowMs, options = {}) {
  const weeklyMaxAgeHours = Math.max(1, Number(options.weeklyMaxAgeHours || DEFAULT_WEEKLY_GOVERNANCE_MAX_AGE_HOURS));
  const objectiveSupervisorMaxAgeHours = Math.max(1, Number(options.objectiveSupervisorMaxAgeHours || DEFAULT_OBJECTIVE_SUPERVISOR_MAX_AGE_HOURS));
  const governanceArtifact = readFreshArtifact(path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"), nowMs, weeklyMaxAgeHours);
  const objectiveSupervisorArtifact = readFreshArtifact(path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), nowMs, objectiveSupervisorMaxAgeHours);
  const governance = governanceArtifact.data;
  const objectiveSupervisor = objectiveSupervisorArtifact.data;
  const contract = objectiveSupervisor
    && objectiveSupervisor.best_febt_tuning_contract
    && typeof objectiveSupervisor.best_febt_tuning_contract === "object"
      ? objectiveSupervisor.best_febt_tuning_contract
      : deriveBestFebtTuningContract({ governance, objectiveSupervisor });
  return {
    governance,
    objectiveSupervisor,
    governanceArtifact,
    objectiveSupervisorArtifact,
    contract,
  };
}

module.exports = {
  POLICY_PATH,
  AUTO_LEVERS,
  deriveBestFebtTuningContract,
  readBestFebtSupervisorContext,
  __test: {
    deriveBestFebtTuningContract,
  },
};
