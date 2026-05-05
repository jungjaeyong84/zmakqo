"use strict";

const { putV2Doc } = require("./storage");
const { buildCompletedRepairExecutionLedgerDoc } = require("./repairExecutionLedger");

async function persistCompletedRepairExecution({
  db = null,
  env = process.env,
  delegatedRepair,
  protectionWriteResult,
  recordedAt = null,
} = {}) {
  const ledgerDoc = buildCompletedRepairExecutionLedgerDoc({
    delegatedRepair,
    protectionWriteResult,
    recordedAt,
  });
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "REPAIR_EXECUTION_LEDGER",
    doc: ledgerDoc,
  });
  const runtimeDoc = protectionWriteResult && protectionWriteResult.runtimeDoc && typeof protectionWriteResult.runtimeDoc === "object"
    ? protectionWriteResult.runtimeDoc
    : null;
  const persistedRuntime = runtimeDoc
    ? await putV2Doc({
        db,
        env,
        collectionKey: "PROTECTION_RUNTIME",
        doc: runtimeDoc,
        merge: true,
      })
    : null;
  const statusUpdateDoc = delegatedRepair && delegatedRepair.exit_repair_request_id
    ? {
        exit_repair_request_id: delegatedRepair.exit_repair_request_id,
        status: ledgerDoc.execution_status,
        completed_at: ledgerDoc.recorded_at,
        completion_ledger_id: ledgerDoc.repair_execution_ledger_id,
        completion_command_type: ledgerDoc.command_type || null,
      }
    : null;
  const persistedRepairRequest = statusUpdateDoc
    ? await putV2Doc({
        db,
        env,
        collectionKey: "REPAIR_REQUESTS",
        doc: statusUpdateDoc,
        merge: true,
      })
    : null;
  return Object.freeze({
    ok: true,
    ledger_doc: ledgerDoc,
    persisted,
    persisted_runtime: persistedRuntime,
    persisted_repair_request: persistedRepairRequest,
  });
}

module.exports = {
  persistCompletedRepairExecution,
};
