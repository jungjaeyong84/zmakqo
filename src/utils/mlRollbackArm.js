"use strict";

const fs = require("fs");

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function fileExists(filePath) {
  const target = norm(filePath);
  if (!target) return false;
  try {
    return fs.existsSync(target);
  } catch (_err) {
    return false;
  }
}

function buildMlRollbackArm({
  deploymentPlan = null,
  serverPrimaryCanary = null,
} = {}) {
  const deployment = readSummary(deploymentPlan);
  const serverPrimary = readSummary(serverPrimaryCanary);

  const rollbackFilePath = norm(deployment.rollback_file_path);
  const rollbackSourceFilePath = norm(deployment.rollback_source_file_path);
  const rollbackTargetPath = rollbackFilePath || rollbackSourceFilePath;
  const rollbackEngineBundleId = norm(deployment.rollback_engine_bundle_id)
    || norm(deployment.rollback_engine_bundle && deployment.rollback_engine_bundle.bundle_id);
  const rollbackEngineStrategyId = norm(deployment.rollback_engine_bundle && deployment.rollback_engine_bundle.strategy_id);
  const rollbackEngineReady = deployment.rollback_engine_bundle && deployment.rollback_engine_bundle.ready === true;
  const rollbackTargetExists = fileExists(rollbackTargetPath);
  const rollbackTriggerN = toNum(serverPrimary.rollback_trigger_n) || 0;
  const rollbackTriggerMarkets = Array.isArray(serverPrimary.rollback_trigger_markets)
    ? serverPrimary.rollback_trigger_markets.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const rollbackTriggerStatus = rollbackTriggerN > 0 ? "TRIGGERED" : "NOT_TRIGGERED";

  const blockingReasons = [];
  if (!rollbackTargetPath) blockingReasons.push("ROLLBACK_TARGET_MISSING");
  if (rollbackTargetPath && !rollbackTargetExists) blockingReasons.push("ROLLBACK_TARGET_FILE_MISSING");
  if (!rollbackEngineBundleId && !rollbackEngineReady) blockingReasons.push("ROLLBACK_ENGINE_BUNDLE_MISSING");

  let evidenceStatus = "ROLLBACK_ARM_EVIDENCE_READY";
  if (!rollbackTargetPath) evidenceStatus = "ROLLBACK_ARM_TARGET_MISSING";
  else if (!rollbackTargetExists) evidenceStatus = "ROLLBACK_ARM_TARGET_FILE_MISSING";
  else if (!rollbackEngineBundleId && !rollbackEngineReady) evidenceStatus = "ROLLBACK_ARM_ENGINE_BUNDLE_MISSING";

  return {
    status: "ML_ROLLBACK_ARM_READY",
    rollback_binding_source: "DEPLOYMENT_PLAN",
    rollback_arm_ready: blockingReasons.length === 0,
    evidence_status: evidenceStatus,
    rollback_file_path: rollbackFilePath,
    rollback_source_file_path: rollbackSourceFilePath,
    rollback_target_path: rollbackTargetPath,
    rollback_target_exists: rollbackTargetExists,
    rollback_engine_bundle_id: rollbackEngineBundleId,
    rollback_engine_strategy_id: rollbackEngineStrategyId,
    rollback_engine_ready: rollbackEngineReady,
    deployment_plan_status: norm(deployment.status),
    deployment_plan_plan_status: norm(deployment.plan_status),
    deployment_plan_target_candidate_id: norm(deployment.target_candidate_id),
    deployment_plan_display_candidate_id: norm(deployment.display_candidate_id),
    server_primary_apply_pass: serverPrimary.apply_pass === true,
    server_primary_acceptance_ready: serverPrimary.acceptance_ready === true,
    server_primary_rollback_trigger_n: rollbackTriggerN,
    server_primary_rollback_trigger_markets: rollbackTriggerMarkets,
    rollback_trigger_status: rollbackTriggerStatus,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlRollbackArm,
};
