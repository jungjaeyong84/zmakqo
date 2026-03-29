"use strict";

const { resolveRegimeRecord } = require("./regime");
const {
  resolveStatPhysFeatures,
  entropyBucket,
  coherenceBucket,
  transitionRiskBucket,
  fieldAlignmentBucket,
  domainWallBucket,
  susceptibilityBucket,
  freeEnergyBucket,
} = require("./statPhysFeatures");
const { resolveFebtShadow } = require("./febtShadow");

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function featuresOf(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function sessionBucketFromMs(ms, utcOffsetHours = 9) {
  const ts = Number(ms);
  if (!Number.isFinite(ts)) return "unknown";
  const shifted = ts + (utcOffsetHours * 60 * 60 * 1000);
  const hour = new Date(shifted).getUTCHours();
  if (hour >= 8 && hour < 16) return "asia";
  if (hour >= 16 && hour < 24) return "europe";
  return "us";
}

function scoreBucket(scoreAbs) {
  if (scoreAbs === null || scoreAbs === undefined || scoreAbs === "") return "unknown";
  const v = Number(scoreAbs);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 25) return "<25";
  if (v < 35) return "25-34";
  if (v < 45) return "35-44";
  if (v < 55) return "45-54";
  return "55+";
}

function confBucket(conf) {
  if (conf === null || conf === undefined || conf === "") return "unknown";
  const v = Number(conf);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.40) return "<0.40";
  if (v < 0.50) return "0.40-0.49";
  if (v < 0.55) return "0.50-0.54";
  if (v < 0.60) return "0.55-0.59";
  return "0.60+";
}

function waveBucket(conf) {
  if (conf === null || conf === undefined || conf === "") return "unknown";
  const v = Number(conf);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.60) return "<0.60";
  if (v < 0.65) return "0.60-0.64";
  if (v < 0.70) return "0.65-0.69";
  return "0.70+";
}

function volatilityBucket(atrPct) {
  if (atrPct === null || atrPct === undefined || atrPct === "") return "unknown";
  const v = Number(atrPct);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.005) return "<0.5%";
  if (v < 0.010) return "0.5-0.99%";
  if (v < 0.015) return "1.0-1.49%";
  return "1.5%+";
}

function lateBucket(lateBars) {
  const v = Number(lateBars);
  if (!Number.isFinite(v)) return "on_time";
  if (v <= 0) return "on_time";
  if (v === 1) return "late1";
  return "late2+";
}

function resolveBarMs(row) {
  return (
    toNum(row && row.signal_bar_close_time_utc_ms) ??
    toNum(row && row.bar_close_time_utc_ms) ??
    toNum(row && row.exec_bar_close_time_utc_ms) ??
    Date.parse(String((row && (row.created_at || row.updated_at || row.ts)) || ""))
  );
}

function buildFilterFeatureSignature(row) {
  const f = featuresOf(row);
  const statPhys = resolveStatPhysFeatures(row);
  const rawScore = toNum(
    f.score ??
    (row && row.score) ??
    f.score_panel
  );
  const scoreAbs = Number.isFinite(rawScore) ? Math.abs(rawScore) : null;
  const confidence = toNum(
    f.confidence ??
    (row && row.confidence) ??
    f.ai_confidence ??
    f.ai_bias_confidence
  );
  const waveConf = toNum(f.zz_wave_conf ?? (row && row.zz_wave_conf));
  const atrPct = toNum(f.ev_gate_atr_pct ?? (row && row.ev_gate_atr_pct));
  const lateByBars = toNum(f._late_by_bars ?? (row && row._late_by_bars));
  const barMs = resolveBarMs(row);
  const febt = resolveFebtShadow(row);
  const marketStateSummaryState = String(f.market_state_summary_state ?? f.sp_state ?? statPhys.state ?? "unknown").trim().toUpperCase() || "unknown";
  const marketStateSummaryAction = String(f.market_state_summary_action ?? f.market_physics_action ?? "unknown").trim().toUpperCase() || "unknown";
  const waitOneBarMarketStateAction = String(f.wait_one_bar_market_state_action ?? "unknown").trim().toUpperCase() || "unknown";
  const legacyWaitAction = String(f.wait_one_bar_action ?? "unknown").trim().toUpperCase() || "unknown";
  const legacyWaitTriggerPath = String(f.wait_one_bar_trigger_path ?? "unknown").trim().toUpperCase() || "unknown";
  const entryExecTiming = String(f._entry_exec_timing ?? (row && row._entry_exec_timing) ?? "unknown").trim().toUpperCase() || "unknown";
  const evGatePolicyVersion = String(f.ev_gate_policy_version ?? f.policy_version ?? "unknown").trim().toUpperCase() || "unknown";
  const evGatePolicySource = String(f.ev_gate_policy_source ?? f.policy_source ?? "unknown").trim().toUpperCase() || "unknown";
  return {
    regime: resolveRegimeRecord(row) || "unknown",
    score_abs: scoreAbs,
    confidence,
    wave_conf: waveConf,
    volatility: atrPct,
    entropy_score: statPhys.entropy,
    coherence_score: statPhys.coherence,
    transition_risk: statPhys.transitionRisk,
    field_alignment: statPhys.fieldAlignment,
    domain_wall_density: statPhys.domainWallDensity,
    susceptibility: statPhys.susceptibility,
    free_energy: statPhys.freeEnergy,
    stat_phys_state: statPhys.state || "unknown",
    market_state_summary_state: marketStateSummaryState,
    market_state_summary_action: marketStateSummaryAction,
    wait_one_bar_market_state_action: waitOneBarMarketStateAction,
    legacy_wait_action: legacyWaitAction,
    legacy_wait_trigger_path: legacyWaitTriggerPath,
    entry_exec_timing: entryExecTiming,
    ev_gate_policy_version: evGatePolicyVersion,
    ev_gate_policy_source: evGatePolicySource,
    febt_mode: febt.mode || "unknown",
    febt_phase: febt.phase || "unknown",
    febt_calc_ok: febt.calcOk,
    febt_calc_reason: febt.calcReason || "unknown",
    febt_timing_action: febt.timingAction || "unknown",
    febt_authority: febt.authority || "unknown",
    febt_payload_missing: febt.payloadMissing === true,
    febt_lock_score: Number.isFinite(febt.lockScore) ? febt.lockScore : null,
    febt_delay_cost: Number.isFinite(febt.delayCost) ? febt.delayCost : null,
    febt_late_risk: Number.isFinite(febt.lateRisk) ? febt.lateRisk : null,
    febt_failure_risk: Number.isFinite(febt.failureRisk) ? febt.failureRisk : null,
    febt_edge: Number.isFinite(febt.edge) ? febt.edge : null,
    late_by_bars: lateByBars,
    score_bucket: scoreBucket(scoreAbs),
    conf_bucket: confBucket(confidence),
    wave_bucket: waveBucket(waveConf),
    volatility_bucket: volatilityBucket(atrPct),
    entropy_bucket: entropyBucket(statPhys.entropy),
    coherence_bucket: coherenceBucket(statPhys.coherence),
    transition_bucket: transitionRiskBucket(statPhys.transitionRisk),
    field_alignment_bucket: fieldAlignmentBucket(statPhys.fieldAlignment),
    domain_wall_bucket: domainWallBucket(statPhys.domainWallDensity),
    susceptibility_bucket: susceptibilityBucket(statPhys.susceptibility),
    free_energy_bucket: freeEnergyBucket(statPhys.freeEnergy),
    late_bucket: lateBucket(lateByBars),
    session_bucket: sessionBucketFromMs(barMs),
  };
}

module.exports = {
  buildFilterFeatureSignature,
  sessionBucketFromMs,
  scoreBucket,
  confBucket,
  waveBucket,
  volatilityBucket,
  entropyBucket,
  coherenceBucket,
  transitionRiskBucket,
  fieldAlignmentBucket,
  domainWallBucket,
  susceptibilityBucket,
  freeEnergyBucket,
  lateBucket,
  __test: {
    toNum,
    resolveBarMs,
  },
};
