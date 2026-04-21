"use strict";

const { V2_SERVICES } = require("./constants");
const { buildRepairExecutionLedgerDoc } = require("./contracts");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function runbookRefsForRepair({ issueCode, commandType } = {}) {
  const issue = upper(issueCode);
  const command = upper(commandType);
  if (command === "PLACE_OR_REPLACE_FULL_PROTECTION" || issue === "UNPROTECTED_ACTIVE_POSITION") {
    return Object.freeze(["RQ_RBK_03"]);
  }
  if (command === "PLACE_OR_REPLACE_TP1" || issue === "TP1_ORDER_MISSING") {
    return Object.freeze(["RQ_RBK_01"]);
  }
  if (command === "REFRESH_NATIVE_STOP" || issue === "TRAIL_STOP_MISSING" || issue === "NATIVE_REFRESH_UNHEALTHY") {
    return Object.freeze(["RQ_RBK_02"]);
  }
  return Object.freeze(["RQ_RBK_99"]);
}

function buildOrderEvidence({ runtimeDoc, commandSnapshot, leg }) {
  const runtime = runtimeDoc && typeof runtimeDoc === "object" ? runtimeDoc : {};
  const command = commandSnapshot && typeof commandSnapshot === "object" ? commandSnapshot : {};
  const commands = command.commands && typeof command.commands === "object" ? command.commands : {};
  const legCommand = leg === "SL" ? (commands.sl || command) : (commands.tp1 || command);
  if (leg === "SL") {
    return Object.freeze({
      leg: "SL",
      expected_command_type: legCommand && legCommand.command_type ? legCommand.command_type : null,
      order_id: trimOrNull(runtime.sl_order_id),
      order_status: upper(runtime.sl_order_status),
      trigger_price: runtime.native_stop_price == null ? null : Number(runtime.native_stop_price),
      ack_at: trimOrNull(runtime.sl_ack_at),
      error_code: upper(legCommand && legCommand.error_code),
      requested_trigger_price: legCommand && legCommand.trigger_price == null ? null : Number(legCommand.trigger_price),
    });
  }
  return Object.freeze({
    leg: "TP1",
    expected_command_type: legCommand && legCommand.command_type ? legCommand.command_type : null,
    order_id: trimOrNull(runtime.tp1_order_id),
    order_status: upper(runtime.tp1_order_status),
    trigger_price: runtime.native_tp1_price == null ? null : Number(runtime.native_tp1_price),
    ack_at: trimOrNull(runtime.tp1_ack_at),
    error_code: upper(legCommand && legCommand.error_code),
    requested_trigger_price: legCommand && legCommand.trigger_price == null ? null : Number(legCommand.trigger_price),
    requested_quantity_abs: legCommand && legCommand.quantity_abs == null ? null : Number(legCommand.quantity_abs),
  });
}

function buildRepairEvidenceSummary({
  delegatedRepair,
  commandSnapshot,
  writeDecision,
  runtimeDoc,
} = {}) {
  const row = delegatedRepair && typeof delegatedRepair === "object" ? delegatedRepair : {};
  const command = commandSnapshot && typeof commandSnapshot === "object" ? commandSnapshot : {};
  const commandType = upper(command.command_type);
  const issueCode = upper(row.issue_code);
  const runbookRefs = runbookRefsForRepair({
    issueCode,
    commandType,
  });
  const orderEvidence = [];
  if (commandType === "PLACE_OR_REPLACE_FULL_PROTECTION") {
    if (command.include_sl_order === true) orderEvidence.push(buildOrderEvidence({ runtimeDoc, commandSnapshot: command, leg: "SL" }));
    if (command.include_tp1_order === true) orderEvidence.push(buildOrderEvidence({ runtimeDoc, commandSnapshot: command, leg: "TP1" }));
  } else if (commandType === "PLACE_OR_REPLACE_TP1") {
    orderEvidence.push(buildOrderEvidence({ runtimeDoc, commandSnapshot: command, leg: "TP1" }));
  } else if (commandType === "REFRESH_NATIVE_STOP") {
    orderEvidence.push(buildOrderEvidence({ runtimeDoc, commandSnapshot: command, leg: "SL" }));
  }
  return Object.freeze({
    issue_code: issueCode,
    requested_action: upper(row.requested_action),
    command_type: commandType,
    runtime_write_reason: trimOrNull(writeDecision && writeDecision.runtime_write_reason),
    health_status: trimOrNull(writeDecision && writeDecision.health_status),
    runbook_refs: runbookRefs,
    order_evidence: Object.freeze(orderEvidence),
  });
}

function buildDelegatedRepairExecutionLedgerDoc({
  delegatedRepair,
  recordedAt = null,
} = {}) {
  const row = delegatedRepair && typeof delegatedRepair === "object" ? delegatedRepair : null;
  const envelope = row && row.envelope && typeof row.envelope === "object" ? row.envelope : {};
  const writerDelegation = envelope.writer_delegation && typeof envelope.writer_delegation === "object"
    ? envelope.writer_delegation
    : {};
  const repairCommand = envelope.repair_command && typeof envelope.repair_command === "object"
    ? envelope.repair_command
    : {};
  return buildRepairExecutionLedgerDoc({
    exitRepairRequestId: row && row.exit_repair_request_id,
    positionCycleId: row && row.position_cycle_id,
    issueCode: row && row.issue_code,
    requestedAction: row && row.requested_action,
    executionStatus: "DELEGATED",
    delegatedToService: writerDelegation.delegated_to_service || V2_SERVICES.PROTECTION_WRITER,
    requestedByService: writerDelegation.requested_by_service || V2_SERVICES.REPAIR_EXECUTOR,
    commandType: writerDelegation.command && writerDelegation.command.command_type,
    commandSnapshot: writerDelegation.command || null,
    attemptMeta: writerDelegation.attempt_meta || null,
    recordedAt,
  });
}

function buildSkippedRepairExecutionLedgerDoc({
  skippedRepair,
  recordedAt = null,
} = {}) {
  const row = skippedRepair && typeof skippedRepair === "object" ? skippedRepair : null;
  return buildRepairExecutionLedgerDoc({
    exitRepairRequestId: row && row.exit_repair_request_id,
    positionCycleId: row && row.position_cycle_id,
    issueCode: row && row.issue_code,
    requestedAction: row && row.requested_action,
    executionStatus: "SKIPPED",
    delegatedToService: null,
    requestedByService: V2_SERVICES.REPAIR_EXECUTOR,
    commandType: null,
    skipReason: row && row.skip_reason,
    commandSnapshot: null,
    attemptMeta: null,
    recordedAt,
  });
}

function buildCompletedRepairExecutionLedgerDoc({
  delegatedRepair,
  protectionWriteResult,
  recordedAt = null,
} = {}) {
  const row = delegatedRepair && typeof delegatedRepair === "object" ? delegatedRepair : null;
  const envelope = row && row.envelope && typeof row.envelope === "object" ? row.envelope : {};
  const writerDelegation = envelope.writer_delegation && typeof envelope.writer_delegation === "object"
    ? envelope.writer_delegation
    : {};
  const writeResult = protectionWriteResult && typeof protectionWriteResult === "object" ? protectionWriteResult : {};
  const writeDecision = writeResult.writeDecision && typeof writeResult.writeDecision === "object"
    ? writeResult.writeDecision
    : null;
  if (!writeDecision) {
    throw new Error("PROTECTION_WRITE_DECISION_REQUIRED");
  }
  const commandSnapshot = writerDelegation.command || null;
  const runtimeDoc = writeResult.runtimeDoc && typeof writeResult.runtimeDoc === "object"
    ? writeResult.runtimeDoc
    : null;
  const repairEvidenceSummary = buildRepairEvidenceSummary({
    delegatedRepair: row,
    commandSnapshot,
    writeDecision,
    runtimeDoc,
  });
  return buildRepairExecutionLedgerDoc({
    exitRepairRequestId: row && row.exit_repair_request_id,
    positionCycleId: row && row.position_cycle_id,
    issueCode: row && row.issue_code,
    requestedAction: row && row.requested_action,
    executionStatus: writeDecision.ok === true ? "COMPLETED_SUCCESS" : "COMPLETED_FAILED",
    delegatedToService: writerDelegation.delegated_to_service || V2_SERVICES.PROTECTION_WRITER,
    requestedByService: writerDelegation.requested_by_service || V2_SERVICES.REPAIR_EXECUTOR,
    commandType: writerDelegation.command && writerDelegation.command.command_type,
    commandSnapshot,
    attemptMeta: writerDelegation.attempt_meta || null,
    resultSnapshot: Object.freeze({
      ok: writeDecision.ok === true,
      requires_repair: writeDecision.requires_repair === true,
      runtime_write_reason: trimOrNull(writeDecision.runtime_write_reason),
      native_refresh_status: trimOrNull(writeDecision.native_refresh_status),
      health_status: trimOrNull(writeDecision.health_status),
      placement_issue_codes: Array.isArray(writeDecision.placement_issue_codes)
        ? Object.freeze(writeDecision.placement_issue_codes.slice())
        : Object.freeze([]),
      runbook_refs: repairEvidenceSummary.runbook_refs,
      repair_evidence_summary: repairEvidenceSummary,
      runtime_doc: runtimeDoc,
    }),
    recordedAt,
  });
}

module.exports = {
  buildDelegatedRepairExecutionLedgerDoc,
  buildSkippedRepairExecutionLedgerDoc,
  buildCompletedRepairExecutionLedgerDoc,
  __test: {
    trimOrNull,
    upper,
    runbookRefsForRepair,
    buildOrderEvidence,
    buildRepairEvidenceSummary,
  },
};
