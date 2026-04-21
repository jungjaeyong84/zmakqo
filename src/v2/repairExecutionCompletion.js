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
  return Object.freeze({
    ok: true,
    ledger_doc: ledgerDoc,
    persisted,
  });
}

module.exports = {
  persistCompletedRepairExecution,
};
