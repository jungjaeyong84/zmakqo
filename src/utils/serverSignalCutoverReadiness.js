"use strict";

const { deriveCanonicalParityDiagnostics } = require("./bestSelfEvolutionAnalysis");

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  if (value.summary && typeof value.summary === "object") return value.summary;
  return value;
}

function deriveServerSignalCutoverReadiness({
  authority = null,
  quality = null,
  parity = null,
  runtime = null,
  serverPrimaryCanary = null,
} = {}) {
  const authoritySummary = readSummary(authority);
  const qualitySummary = readSummary(quality);
  const paritySummary = deriveCanonicalParityDiagnostics(parity);
  const runtimeSummary = readSummary(runtime);
  const canarySummary = readSummary(serverPrimaryCanary);

  const driftStatus = toUpper(authoritySummary.drift_status) || "PARITY_UNKNOWN";
  const qualityStatus = toUpper(qualitySummary.quality_status) || "N_A";
  const runtimeStatus = toUpper(runtimeSummary.runtime_status) || "N_A";
  const sourceMode = toUpper(authoritySummary.source_mode || runtimeSummary.canonical_engine_source_mode) || "PINE_PRIMARY";
  const shadowObservedN = toNum(authoritySummary.pine_shadow_24h_n) || 0;
  const mismatchN = toNum(authoritySummary.parity_mismatch_n) || 0;
  const entryN = toNum(qualitySummary.authoritative_entry_signal_24h_n) || 0;
  const intentN = toNum(qualitySummary.order_intent_24h_n) || 0;
  const fillN = toNum(qualitySummary.fill_24h_n) || 0;
  const runtimeTf = String(runtimeSummary.exec_tf || "").trim() || null;
  const marketCount = toNum(runtimeSummary.market_count) || 0;
  const sourceParityMismatchN = toNum(paritySummary.source_parity_mismatch_n) || 0;
  const finalDownstreamMismatchN = toNum(paritySummary.final_downstream_mismatch_n) || 0;
  const evPolicyMismatchN = toNum(paritySummary.ev_policy_mismatch_n) || 0;
  const cooldownPolicyMismatchN = toNum(paritySummary.cooldown_policy_mismatch_n) || 0;
  const strategyGateMismatchN = toNum(paritySummary.strategy_gate_mismatch_n) || 0;
  const dominantMismatchFamily = toUpper(paritySummary.dominant_mismatch_family)
    || toUpper(qualitySummary.top_drop_reason_family && qualitySummary.top_drop_reason_family.key)
    || null;
  const canaryReady = canarySummary.acceptance_ready === true;
  const canaryReason = String(canarySummary.acceptance_reason || "").trim().toUpperCase() || null;

  const blockers = [];
  if (runtimeStatus !== "READY") blockers.push("SERVER_RUNTIME_NOT_READY");
  if (runtimeTf !== "15m") blockers.push("SERVER_RUNTIME_TF_NOT_15M");
  if (marketCount <= 0) blockers.push("SERVER_RUNTIME_NO_MARKETS");
  if (shadowObservedN < 3) blockers.push("SHADOW_SAMPLE_SHORT");
  if (sourceParityMismatchN > 0) blockers.push("SOURCE_PARITY_DRIFT_ACTIVE");
  if (finalDownstreamMismatchN > 0) {
    if (evPolicyMismatchN > 0) blockers.push("EV_POLICY_DRIFT_ACTIVE");
    if (cooldownPolicyMismatchN > 0) blockers.push("COOLDOWN_POLICY_DRIFT_ACTIVE");
    if (strategyGateMismatchN > 0) blockers.push("STRATEGY_GATE_DRIFT_ACTIVE");
    if (evPolicyMismatchN <= 0 && cooldownPolicyMismatchN <= 0 && strategyGateMismatchN <= 0) blockers.push("FINAL_DOWNSTREAM_MISMATCH_ACTIVE");
  } else if (mismatchN > 0 || driftStatus === "PARITY_DRIFT") {
    blockers.push("PARITY_DRIFT_ACTIVE");
  }
  if (entryN <= 0) blockers.push("NO_SERVER_ENTRY_SIGNAL");
  if (intentN <= 0) blockers.push("NO_SERVER_INTENT");
  if (fillN <= 0) blockers.push("NO_SERVER_FILL");
  if (qualityStatus === "SERVER_SIGNAL_NOT_REACHING_EXECUTION") blockers.push("SERVER_SIGNAL_NOT_REACHING_EXECUTION");
  if (sourceMode === "SERVER_PRIMARY" && canaryReady !== true) blockers.push(canaryReason || "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT");

  const promotionReady = blockers.length === 0 && sourceMode !== "SERVER_PRIMARY";
  const alreadyServerPrimary = sourceMode === "SERVER_PRIMARY";
  const status = promotionReady
    ? "SERVER_PRIMARY_PROMOTION_READY"
    : (alreadyServerPrimary
      ? (canaryReady ? "SERVER_PRIMARY_ACTIVE" : (canaryReason || "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT"))
      : (blockers[0] || "CUTOVER_HOLD"));

  return {
    current_status: {
      source_mode: sourceMode,
      drift_status: driftStatus,
      quality_status: qualityStatus,
      runtime_status: runtimeStatus,
      runtime_exec_tf: runtimeTf,
      runtime_market_count: marketCount,
      shadow_observed_24h_n: shadowObservedN,
      parity_mismatch_n: mismatchN,
      source_parity_mismatch_n: sourceParityMismatchN,
      final_downstream_mismatch_n: finalDownstreamMismatchN,
      ev_policy_mismatch_n: evPolicyMismatchN,
      cooldown_policy_mismatch_n: cooldownPolicyMismatchN,
      strategy_gate_mismatch_n: strategyGateMismatchN,
      dominant_mismatch_family: dominantMismatchFamily,
      entry_24h_n: entryN,
      intent_24h_n: intentN,
      fill_24h_n: fillN,
      canary_acceptance_ready: canaryReady,
      canary_acceptance_reason: canaryReason,
    },
    summary: {
      promotion_ready: promotionReady,
      already_server_primary: alreadyServerPrimary,
      readiness_status: status,
      blocker_n: blockers.length,
      blockers,
      source_mode: sourceMode,
      runtime_exec_tf: runtimeTf,
      runtime_market_count: marketCount,
      entry_24h_n: entryN,
      intent_24h_n: intentN,
      fill_24h_n: fillN,
      dominant_mismatch_family: dominantMismatchFamily,
    },
  };
}

module.exports = {
  deriveServerSignalCutoverReadiness,
};
