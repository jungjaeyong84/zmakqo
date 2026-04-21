"use strict";

const { runRepairQueueWorker } = require("./repairQueueWorker");
const { persistCompletedRepairExecution } = require("./repairExecutionCompletion");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildFallbackFailedProtectionWriteResult({
  delegatedRepair,
  error,
} = {}) {
  const row = delegatedRepair && typeof delegatedRepair === "object" ? delegatedRepair : {};
  return Object.freeze({
    runtimeDoc: null,
    writeDecision: Object.freeze({
      ok: false,
      requires_repair: true,
      runtime_write_reason: "REPAIR_EXECUTION_EXCEPTION",
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
      placement_issue_codes: [trimOrNull(row.issue_code)].filter(Boolean),
    }),
  });
}

async function executeRepairQueueLiveWorker({
  db = null,
  env = process.env,
  executeDelegatedRepair,
  repairRequestLimit = null,
  placementStartedAt = null,
  placementRetryIdPrefix = "RQ",
  recordedAt = null,
  persistExecutionLedger = true,
} = {}) {
  if (typeof executeDelegatedRepair !== "function") {
    throw new Error("EXECUTE_DELEGATED_REPAIR_REQUIRED");
  }
  const queueRun = await runRepairQueueWorker({
    db,
    env,
    repairRequestLimit,
    placementStartedAt,
    placementRetryIdPrefix,
    recordedAt,
    persistExecutionLedger,
  });

  const completionAttempts = [];
  for (const delegatedRepair of queueRun.batch.delegated_repairs) {
    let protectionWriteResult;
    let executionError = null;
    try {
      const execution = await executeDelegatedRepair({
        delegatedRepair,
        env,
        db,
      });
      protectionWriteResult = execution && execution.protectionWriteResult
        ? execution.protectionWriteResult
        : execution;
      if (!protectionWriteResult || typeof protectionWriteResult !== "object" || !protectionWriteResult.writeDecision) {
        throw new Error("PROTECTION_WRITE_RESULT_REQUIRED");
      }
    } catch (error) {
      executionError = error;
      protectionWriteResult = buildFallbackFailedProtectionWriteResult({
        delegatedRepair,
        error,
      });
    }
    const completion = await persistCompletedRepairExecution({
      db,
      env,
      delegatedRepair,
      protectionWriteResult,
      recordedAt,
    });
    completionAttempts.push(Object.freeze({
      exit_repair_request_id: delegatedRepair.exit_repair_request_id,
      position_cycle_id: delegatedRepair.position_cycle_id,
      issue_code: delegatedRepair.issue_code,
      ok: completion.ledger_doc.execution_status === "COMPLETED_SUCCESS",
      completion_ledger: completion.ledger_doc,
      execution_error: trimOrNull(executionError && executionError.message),
    }));
  }

  return Object.freeze({
    ok: true,
    queue_run: queueRun,
    completion_attempt_n: completionAttempts.length,
    completion_success_n: completionAttempts.filter((row) => row.ok === true).length,
    completion_failed_n: completionAttempts.filter((row) => row.ok !== true).length,
    completion_attempts: Object.freeze(completionAttempts),
  });
}

module.exports = {
  executeRepairQueueLiveWorker,
  __test: {
    trimOrNull,
    buildFallbackFailedProtectionWriteResult,
  },
};
