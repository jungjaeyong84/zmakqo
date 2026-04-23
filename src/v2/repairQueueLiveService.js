"use strict";

const { V2_SERVICES } = require("./constants");
const { resolveV2RuntimeConfig } = require("./runtime");
const { executeRepairQueueLiveWorker } = require("./repairQueueLiveWorker");

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseNonNegativeInt(value, fallback = 0, minimum = 0) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Math.max(minimum, Number(fallback) || minimum);
  return Math.max(minimum, Math.floor(raw));
}

function freezeArray(value) {
  return Object.freeze(Array.isArray(value) ? value.slice() : []);
}

function resolveRepairQueueLiveServiceConfig(env = process.env) {
  const runtimeCfg = resolveV2RuntimeConfig(env);
  const defaults = runtimeCfg.defaultRepairQueuePolicy || {};
  return Object.freeze({
    service_name: V2_SERVICES.REPAIR_EXECUTOR,
    enabled: parseBool(env.DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED, runtimeCfg.enabled),
    failClosed: parseBool(env.DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED, true),
    batchLimit: parseNonNegativeInt(
      env.DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT,
      defaults.batchLimit,
      1
    ),
    maxCompletionFailureCount: parseNonNegativeInt(
      env.DONBEOLJA_V2_REPAIR_QUEUE_MAX_COMPLETION_FAILURE_COUNT,
      defaults.maxCompletionFailureCount,
      0
    ),
    maxSkippedRepairCount: parseNonNegativeInt(
      env.DONBEOLJA_V2_REPAIR_QUEUE_MAX_SKIPPED_REPAIR_COUNT,
      defaults.maxSkippedRepairCount,
      0
    ),
    maxMissingContextCount: parseNonNegativeInt(
      env.DONBEOLJA_V2_REPAIR_QUEUE_MAX_MISSING_CONTEXT_COUNT,
      defaults.maxMissingContextCount,
      0
    ),
  });
}

function buildRepairQueueLiveServiceSummary({
  liveWorkerRun,
  config,
} = {}) {
  const run = liveWorkerRun && typeof liveWorkerRun === "object" ? liveWorkerRun : {};
  const queueRun = run.queue_run && typeof run.queue_run === "object" ? run.queue_run : {};
  const batch = queueRun.batch && typeof queueRun.batch === "object" ? queueRun.batch : {};
  const missingPositionCycleIds = freezeArray(queueRun.missing_position_cycle_ids);
  const missingProjectionCycleIds = freezeArray(queueRun.missing_projection_cycle_ids);
  const missingProtectionRuntimeCycleIds = freezeArray(queueRun.missing_protection_runtime_cycle_ids);
  const missingContextCount = missingPositionCycleIds.length + missingProjectionCycleIds.length + missingProtectionRuntimeCycleIds.length;
  const requestedRepairCount = Math.max(0, Number(queueRun.requested_repair_n) || 0);
  const delegatedRepairCount = Math.max(0, Number(batch.delegated_n) || 0);
  const skippedRepairCount = Math.max(0, Number(batch.skipped_n) || 0);
  const completionAttemptCount = Math.max(0, Number(run.completion_attempt_n) || 0);
  const completionSuccessCount = Math.max(0, Number(run.completion_success_n) || 0);
  const completionFailedCount = Math.max(0, Number(run.completion_failed_n) || 0);
  const blockerReasons = [];

  if (completionFailedCount > config.maxCompletionFailureCount) {
    blockerReasons.push("COMPLETION_FAILURE_LIMIT_EXCEEDED");
  }
  if (skippedRepairCount > config.maxSkippedRepairCount) {
    blockerReasons.push("SKIPPED_REPAIR_LIMIT_EXCEEDED");
  }
  if (missingContextCount > config.maxMissingContextCount) {
    blockerReasons.push("MISSING_CONTEXT_LIMIT_EXCEEDED");
  }

  const idle = (
    requestedRepairCount === 0 &&
    delegatedRepairCount === 0 &&
    skippedRepairCount === 0 &&
    completionAttemptCount === 0
  );

  const status = blockerReasons.length === 0 ? "HEALTHY" : "DEGRADED";

  return Object.freeze({
    service_name: config.service_name,
    status,
    idle,
    requested_repair_n: requestedRepairCount,
    delegated_repair_n: delegatedRepairCount,
    skipped_repair_n: skippedRepairCount,
    completion_attempt_n: completionAttemptCount,
    completion_success_n: completionSuccessCount,
    completion_failed_n: completionFailedCount,
    missing_context_n: missingContextCount,
    missing_position_cycle_ids: missingPositionCycleIds,
    missing_projection_cycle_ids: missingProjectionCycleIds,
    missing_protection_runtime_cycle_ids: missingProtectionRuntimeCycleIds,
    blocker_reason_n: blockerReasons.length,
    blocker_reasons: Object.freeze(blockerReasons),
  });
}

async function runRepairQueueLiveService({
  db = null,
  env = process.env,
  executeDelegatedRepair,
  recordedAt = null,
  executeRepairQueueLiveWorkerFn = executeRepairQueueLiveWorker,
} = {}) {
  const config = resolveRepairQueueLiveServiceConfig(env);
  if (config.enabled !== true) {
    return Object.freeze({
      ok: true,
      service_name: config.service_name,
      status: "DISABLED",
      fail_closed_triggered: false,
      config,
      summary: Object.freeze({
        service_name: config.service_name,
        status: "DISABLED",
        requested_repair_n: 0,
        delegated_repair_n: 0,
        skipped_repair_n: 0,
        completion_attempt_n: 0,
        completion_success_n: 0,
        completion_failed_n: 0,
        missing_context_n: 0,
        missing_position_cycle_ids: Object.freeze([]),
        missing_projection_cycle_ids: Object.freeze([]),
        missing_protection_runtime_cycle_ids: Object.freeze([]),
        blocker_reason_n: 0,
        blocker_reasons: Object.freeze([]),
      }),
      live_worker_run: null,
    });
  }
  if (typeof executeDelegatedRepair !== "function") {
    throw new Error("EXECUTE_DELEGATED_REPAIR_REQUIRED");
  }
  const liveWorkerRun = await executeRepairQueueLiveWorkerFn({
    db,
    env,
    executeDelegatedRepair,
    repairRequestLimit: config.batchLimit,
    recordedAt,
  });
  const summary = buildRepairQueueLiveServiceSummary({
    liveWorkerRun,
    config,
  });
  const failClosedTriggered = config.failClosed === true && summary.blocker_reason_n > 0;
  return Object.freeze({
    ok: failClosedTriggered !== true,
    service_name: config.service_name,
    status: summary.status,
    fail_closed_triggered: failClosedTriggered,
    config,
    summary,
    live_worker_run: liveWorkerRun,
  });
}

module.exports = {
  resolveRepairQueueLiveServiceConfig,
  buildRepairQueueLiveServiceSummary,
  runRepairQueueLiveService,
  __test: {
    parseBool,
    parseNonNegativeInt,
    freezeArray,
  },
};
