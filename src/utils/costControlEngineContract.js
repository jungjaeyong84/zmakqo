"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function readOperations(value) {
  if (!value || typeof value !== "object") return {};
  return value.operations && typeof value.operations === "object" ? value.operations : {};
}

function buildCostControlEngineContract({
  evGateCompositePolicy = null,
  overallAccountReport = null,
  cooldownPolicyReview = null,
  serverSignalCutoverReadiness = null,
  reversePolicy = null,
  executionQuality = null,
} = {}) {
  const ev = readSummary(evGateCompositePolicy);
  const operations = readOperations(overallAccountReport);
  const cooldown = readSummary(cooldownPolicyReview);
  const cutover = readSummary(serverSignalCutoverReadiness);
  const reverse = readSummary(reversePolicy);
  const quality = readSummary(executionQuality);

  const reviewReasons = Array.isArray(quality.review_reasons)
    ? quality.review_reasons.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const cutoverBlockers = Array.isArray(cutover.blockers)
    ? cutover.blockers.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];

  const expectancyGateActive = toUpper(ev.status) === "EV_GATE_COMPOSITE_POLICY_READY"
    && ev.ev_gate_enabled === true
    && toUpper(ev.threshold_metric_family) === "TP_COMPOSITE_EXIT_VALUE"
    && String(ev.threshold_metric || "").trim() === "exit_value_lower_bound";
  const costBlockModeActive = String(operations.mode || "").trim() === "비용 차단";
  const cooldownReentryControlActive = toUpper(cooldown.status) === "MONITOR_WITH_TARGETED_REVIEW"
    && (toNum(cooldown.cooldown_policy_mismatch_n) || 0) >= 1
    && cutoverBlockers.includes("COOLDOWN_POLICY_DRIFT_ACTIVE");
  const reverseReentryControlActive = toUpper(reverse.status) === "REVERSE_POLICY_REVIEW"
    && ((toNum(reverse.reverse_blocked_n) || 0) > 0 || (toNum(reverse.reverse_cooldown_n) || 0) > 0);
  const fillCostPressureActive = reviewReasons.includes("ADVERSE_SLIPPAGE_P95_HIGH")
    || reviewReasons.includes("PARTIAL_FILL_RATE_HIGH");

  const automaticEntrySuppressionReady = expectancyGateActive && costBlockModeActive;
  const systemReentryControlReady = cooldownReentryControlActive && reverseReentryControlActive;
  const costControlEngineReady = automaticEntrySuppressionReady && systemReentryControlReady;

  const blockingReasons = [];
  if (!expectancyGateActive) blockingReasons.push("EXPECTANCY_GATE_NOT_ACTIVE");
  if (!costBlockModeActive) blockingReasons.push("OPS_COST_BLOCK_MODE_NOT_ACTIVE");
  if (!cooldownReentryControlActive) blockingReasons.push("COOLDOWN_REENTRY_CONTROL_NOT_ACTIVE");
  if (!reverseReentryControlActive) blockingReasons.push("REVERSE_REENTRY_CONTROL_NOT_ACTIVE");

  return {
    status: costControlEngineReady
      ? "COST_CONTROL_ENGINE_CONTRACT_READY"
      : ((automaticEntrySuppressionReady || systemReentryControlReady)
        ? "COST_CONTROL_ENGINE_CONTRACT_BOOTSTRAPPING"
        : "COST_CONTROL_ENGINE_CONTRACT_BLOCKED"),
    contract_mode: "EXPECTANCY_AND_REENTRY_CONTROL",
    automatic_entry_suppression_ready: automaticEntrySuppressionReady,
    system_reentry_control_ready: systemReentryControlReady,
    expectancy_gate_active: expectancyGateActive,
    cost_block_mode_active: costBlockModeActive,
    cooldown_reentry_control_active: cooldownReentryControlActive,
    reverse_reentry_control_active: reverseReentryControlActive,
    fill_cost_pressure_active: fillCostPressureActive,
    expectancy_metric: String(ev.threshold_metric || "").trim() || null,
    expectancy_metric_family: String(ev.threshold_metric_family || "").trim() || null,
    operations_status: String(operations.status || "").trim() || null,
    operations_mode: String(operations.mode || "").trim() || null,
    operations_error_count_24h: toNum(operations.error_count_24h),
    cooldown_policy_status: String(cooldown.status || "").trim() || null,
    cooldown_policy_mismatch_n: toNum(cooldown.cooldown_policy_mismatch_n),
    reverse_policy_status: String(reverse.status || "").trim() || null,
    reverse_blocked_n: toNum(reverse.reverse_blocked_n),
    reverse_cooldown_n: toNum(reverse.reverse_cooldown_n),
    execution_quality_status: String(quality.status || "").trim() || null,
    execution_quality_review_reasons: reviewReasons,
    cutover_readiness_status: String(cutover.readiness_status || "").trim() || null,
    cutover_blockers: cutoverBlockers,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildCostControlEngineContract,
};
