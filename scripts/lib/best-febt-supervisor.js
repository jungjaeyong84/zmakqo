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
const DEFAULT_MARKET_CONTRACT_LIMIT = 7;
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

function pushCount(map, value) {
  const key = String(value || "").trim().toUpperCase() || "UNKNOWN";
  map.set(key, (map.get(key) || 0) + 1);
}

function topCountValue(map) {
  if (!(map instanceof Map) || !map.size) return null;
  return Array.from(map.entries())
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))[0][0];
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

function deriveBestFebtMarketContracts({ governance = null, objectiveSupervisor = null, limit = DEFAULT_MARKET_CONTRACT_LIMIT } = {}) {
  const chainRows = governance && governance.current && governance.current.quality && Array.isArray(governance.current.quality.chain_rows)
    ? governance.current.quality.chain_rows
    : [];
  const objectiveVerdict = String(objectiveSupervisor && objectiveSupervisor.verdict || "N/A");
  const marketMap = new Map();
  for (const row of chainRows) {
    const market = String(row && (row.market || row.symbol_or_pair_id || row.symbol) || "").trim().toUpperCase();
    if (!market) continue;
    if (!marketMap.has(market)) {
      marketMap.set(market, {
        market,
        sampled_n: 0,
        calc_ok_n: 0,
        phase_known_n: 0,
        fire_n: 0,
        late_n: 0,
        void_n: 0,
        disagreement_n: 0,
        fallback_legacy_n: 0,
        missing_n: 0,
        candidate_recovered_n: 0,
        candidate_blocked_n: 0,
        candidate_wait_n: 0,
        disagreementReasons: new Map(),
        legacyWaitActions: new Map(),
        shadowVerdicts: new Map(),
      });
    }
    const acc = marketMap.get(market);
    acc.sampled_n += 1;
    if (row && row.febt_calc_ok === true) acc.calc_ok_n += 1;
    const phase = String(row && row.febt_phase || "").trim().toUpperCase();
    if (phase && phase !== "UNKNOWN") acc.phase_known_n += 1;
    if (phase === "FIRE") acc.fire_n += 1;
    else if (phase === "LATE") acc.late_n += 1;
    else if (phase === "VOID") acc.void_n += 1;
    if (row && row.febt_payload_missing === true) acc.missing_n += 1;
    if (row && row.febt_shadow_fallback_to_legacy === true) acc.fallback_legacy_n += 1;
    const shadowVerdict = String(row && row.febt_shadow_verdict || "").trim().toUpperCase() || "UNKNOWN";
    pushCount(acc.shadowVerdicts, shadowVerdict);
    const legacyWaitAction = String(row && row.febt_shadow_legacy_wait_action || row && row.legacy_wait_action || "").trim().toUpperCase() || "UNKNOWN";
    pushCount(acc.legacyWaitActions, legacyWaitAction);
    if (row && row.febt_shadow_disagrees_legacy_wait === true) {
      acc.disagreement_n += 1;
      const reason = String(row && row.febt_shadow_disagreement_reason || "").trim().toUpperCase() || "UNKNOWN";
      pushCount(acc.disagreementReasons, reason);
      if (reason === "FEBT_ALLOW_LEGACY_WAIT") acc.candidate_recovered_n += 1;
      else if (reason === "FEBT_BLOCK_LEGACY_ALLOW") acc.candidate_blocked_n += 1;
      else if (reason === "FEBT_WAIT_LEGACY_ALLOW") acc.candidate_wait_n += 1;
    }
  }
  return Array.from(marketMap.values())
    .map((acc) => {
      const projectedReplacementRatio = acc.candidate_blocked_n > 0 ? (acc.candidate_recovered_n / acc.candidate_blocked_n) : null;
      const projectedCountRatio = acc.sampled_n > 0
        ? ((acc.sampled_n - acc.candidate_blocked_n + acc.candidate_recovered_n) / acc.sampled_n)
        : null;
      const tighteningAllowed = projectedCountRatio == null ? true : projectedCountRatio >= 1.0;
      const recoveryPriority = projectedReplacementRatio == null ? false : projectedReplacementRatio < 0.80;
      const mode = !tighteningAllowed
        ? "COUNT_GUARD_ACTIVE"
        : (recoveryPriority ? "RECOVERY_FIRST" : "NORMAL");
      return {
        market: acc.market,
        objective_verdict: objectiveVerdict,
        sampled_n: acc.sampled_n,
        calc_ok_rate: acc.sampled_n > 0 ? (acc.calc_ok_n / acc.sampled_n) : null,
        phase_known_rate: acc.sampled_n > 0 ? (acc.phase_known_n / acc.sampled_n) : null,
        fire_n: acc.fire_n,
        late_n: acc.late_n,
        void_n: acc.void_n,
        disagreement_n: acc.disagreement_n,
        fallback_legacy_n: acc.fallback_legacy_n,
        missing_rate: acc.sampled_n > 0 ? (acc.missing_n / acc.sampled_n) : null,
        candidate_recovered_n: acc.candidate_recovered_n,
        candidate_blocked_n: acc.candidate_blocked_n,
        candidate_wait_n: acc.candidate_wait_n,
        projected_net_signal_delta_n: acc.candidate_recovered_n - acc.candidate_blocked_n,
        projected_count_ratio_global: projectedCountRatio,
        projected_replacement_ratio: projectedReplacementRatio,
        tightening_allowed: tighteningAllowed,
        recovery_priority: recoveryPriority,
        count_preservation_required: true,
        mode,
        dominant_disagreement_reason: topCountValue(acc.disagreementReasons),
        dominant_legacy_wait_action: topCountValue(acc.legacyWaitActions),
        dominant_shadow_verdict: topCountValue(acc.shadowVerdicts),
      };
    })
    .sort((a, b) =>
      (b.sampled_n - a.sampled_n)
      || (b.disagreement_n - a.disagreement_n)
      || String(a.market).localeCompare(String(b.market))
    )
    .slice(0, Math.max(1, Number(limit) || DEFAULT_MARKET_CONTRACT_LIMIT));
}

function deriveBestFebtMarketGuardContract({ contract = null, marketContracts = [] } = {}) {
  const rows = Array.isArray(marketContracts) ? marketContracts.filter((row) => row && typeof row === "object") : [];
  if (!rows.length) return contract || null;
  const countGuardRows = rows.filter((row) => row.tightening_allowed === false);
  if (countGuardRows.length) {
    return countGuardRows.slice().sort((a, b) =>
      ((toNum(a.projected_count_ratio_global) ?? Infinity) - (toNum(b.projected_count_ratio_global) ?? Infinity))
      || ((toNum(b.sampled_n) ?? 0) - (toNum(a.sampled_n) ?? 0))
      || String(a.market || "").localeCompare(String(b.market || ""))
    )[0];
  }
  const recoveryRows = rows.filter((row) => row.recovery_priority === true);
  if (recoveryRows.length) {
    return recoveryRows.slice().sort((a, b) =>
      ((toNum(a.projected_replacement_ratio) ?? Infinity) - (toNum(b.projected_replacement_ratio) ?? Infinity))
      || ((toNum(b.sampled_n) ?? 0) - (toNum(a.sampled_n) ?? 0))
      || String(a.market || "").localeCompare(String(b.market || ""))
    )[0];
  }
  return rows.slice().sort((a, b) =>
    ((toNum(b.sampled_n) ?? 0) - (toNum(a.sampled_n) ?? 0))
    || String(a.market || "").localeCompare(String(b.market || ""))
  )[0];
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
  const marketContracts = Array.isArray(objectiveSupervisor && objectiveSupervisor.best_febt_market_contracts)
    ? objectiveSupervisor.best_febt_market_contracts
    : deriveBestFebtMarketContracts({
      governance,
      objectiveSupervisor,
      limit: options.marketContractLimit || DEFAULT_MARKET_CONTRACT_LIMIT,
    });
  return {
    governance,
    objectiveSupervisor,
    governanceArtifact,
    objectiveSupervisorArtifact,
    contract,
    marketContracts,
    marketGuardContract: deriveBestFebtMarketGuardContract({ contract, marketContracts }),
  };
}

module.exports = {
  POLICY_PATH,
  AUTO_LEVERS,
  deriveBestFebtTuningContract,
  deriveBestFebtMarketContracts,
  deriveBestFebtMarketGuardContract,
  readBestFebtSupervisorContext,
  __test: {
    deriveBestFebtTuningContract,
    deriveBestFebtMarketContracts,
    deriveBestFebtMarketGuardContract,
  },
};
