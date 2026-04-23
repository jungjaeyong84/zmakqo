"use strict";

const { runV2EntrySubmitter } = require("./entrySubmitter");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function stableCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || null;
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function pushCheck(checks, id, ok, details = {}) {
  checks.push(Object.freeze({
    id,
    ok: ok === true,
    ...details,
  }));
}

function evaluateEntryExecutionKernelResult(result) {
  const row = asObject(result);
  const fill = asObject(row && row.fill);
  const executedEntry = asObject(row && row.executedEntry);
  const positionCycle = asObject(executedEntry && executedEntry.positionCycle);
  const protectionEvidence = asObject(row && row.protectionEvidence);
  const protectionResult = asObject(row && row.protectionResult);
  const activationCommit = asObject(protectionResult && protectionResult.activationCommit);
  const chainAudit = asObject(activationCommit && activationCommit.chainAudit);
  const protectionWriteResult = asObject(protectionResult && protectionResult.protectionWriteResult);
  const writeDecision = asObject(protectionWriteResult && protectionWriteResult.writeDecision);
  const runtimeDoc = asObject(protectionWriteResult && protectionWriteResult.runtimeDoc);

  const fillEntryEventId = trimOrNull(fill && fill.entry_event_id);
  const positionCycleEntryEventId = trimOrNull(positionCycle && positionCycle.entry_event_id);
  const positionCycleId = trimOrNull(positionCycle && positionCycle.position_cycle_id);
  const runtimePositionCycleId = trimOrNull(runtimeDoc && runtimeDoc.position_cycle_id);

  const checks = [];
  pushCheck(checks, "ENTRY_KERNEL_SUBMITTER_OK", row && row.ok === true);
  pushCheck(checks, "ENTRY_KERNEL_SUBMITTER_REASON_PROTECTED", row && row.reason === "ENTRY_SUBMITTED_AND_PROTECTED", {
    expected: "ENTRY_SUBMITTED_AND_PROTECTED",
    actual: trimOrNull(row && row.reason),
  });
  pushCheck(checks, "ENTRY_KERNEL_FILL_FILLED", upper(fill && fill.status) === "FILLED", {
    expected: "FILLED",
    actual: upper(fill && fill.status),
  });
  pushCheck(checks, "ENTRY_KERNEL_ENTRY_EVENT_PRESENT", !!fillEntryEventId);
  pushCheck(checks, "ENTRY_KERNEL_POSITION_CYCLE_ID_PRESENT", !!positionCycleId);
  pushCheck(checks, "ENTRY_KERNEL_POSITION_CYCLE_ENTRY_EVENT_MATCH", !!fillEntryEventId && fillEntryEventId === positionCycleEntryEventId, {
    fill_entry_event_id: fillEntryEventId,
    position_cycle_entry_event_id: positionCycleEntryEventId,
  });
  pushCheck(checks, "ENTRY_KERNEL_EXECUTED_BOOTSTRAP_PENDING", upper(positionCycle && positionCycle.status) === "PROTECTION_PENDING", {
    expected: "PROTECTION_PENDING",
    actual: upper(positionCycle && positionCycle.status),
  });
  pushCheck(checks, "ENTRY_KERNEL_PROTECTION_EVIDENCE_OK", protectionEvidence && protectionEvidence.ok === true);
  pushCheck(checks, "ENTRY_KERNEL_ACTIVATION_COMMIT_OK", activationCommit && activationCommit.ok === true);
  pushCheck(checks, "ENTRY_KERNEL_ACTIVATION_ACTIVE_PROTECTED", upper(activationCommit && activationCommit.position_cycle_status) === "ACTIVE_PROTECTED", {
    expected: "ACTIVE_PROTECTED",
    actual: upper(activationCommit && activationCommit.position_cycle_status),
  });
  pushCheck(checks, "ENTRY_KERNEL_CHAIN_AUDIT_OK", chainAudit && chainAudit.ok === true && Number(chainAudit.fail_n) === 0, {
    fail_n: chainAudit ? Number(chainAudit.fail_n) : null,
  });
  pushCheck(checks, "ENTRY_KERNEL_WRITE_DECISION_OK", writeDecision && writeDecision.ok === true);
  pushCheck(checks, "ENTRY_KERNEL_RUNTIME_POSITION_CYCLE_MATCH", !!positionCycleId && positionCycleId === runtimePositionCycleId, {
    position_cycle_id: positionCycleId,
    runtime_position_cycle_id: runtimePositionCycleId,
  });
  pushCheck(checks, "ENTRY_KERNEL_RUNTIME_HEALTHY", upper(runtimeDoc && runtimeDoc.health_status) === "HEALTHY", {
    expected: "HEALTHY",
    actual: upper(runtimeDoc && runtimeDoc.health_status),
  });
  pushCheck(checks, "ENTRY_KERNEL_SL_ORDER_PRESENT", !!trimOrNull(runtimeDoc && runtimeDoc.sl_order_id));
  pushCheck(checks, "ENTRY_KERNEL_TP1_ORDER_PRESENT", !!trimOrNull(runtimeDoc && runtimeDoc.tp1_order_id));

  const failed = checks.filter((check) => !check.ok);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "ENTRY_EXECUTION_KERNEL_EVIDENCE_OK" : "ENTRY_EXECUTION_KERNEL_EVIDENCE_INVALID",
    check_n: checks.length,
    fail_n: failed.length,
    check_ids: Object.freeze(checks.map((check) => check.id)),
    passed_check_ids: Object.freeze(checks.filter((check) => check.ok).map((check) => check.id)),
    failed_check_ids: Object.freeze(failed.map((check) => check.id)),
    checks: Object.freeze(checks),
    position_cycle_id: positionCycleId,
    entry_event_id: fillEntryEventId,
    protection_runtime_id: trimOrNull(runtimeDoc && runtimeDoc.protection_runtime_id),
  });
}

async function runV2EntryExecutionKernel({
  runEntrySubmitter = runV2EntrySubmitter,
  ...submitterArgs
} = {}) {
  if (typeof runEntrySubmitter !== "function") throw new Error("RUN_ENTRY_SUBMITTER_REQUIRED");

  let submitterResult = null;
  try {
    submitterResult = await runEntrySubmitter(submitterArgs);
  } catch (error) {
    const errorCode = stableCode(error && error.message) || "ENTRY_SUBMITTER_THROWN";
    return Object.freeze({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_THROWN",
      error_code: errorCode,
      error_message: trimOrNull(error && error.message) || String(error),
      submitterResult: null,
      kernelAudit: Object.freeze({
        ok: false,
        reason: "ENTRY_EXECUTION_KERNEL_SUBMITTER_THROWN",
        check_n: 1,
        fail_n: 1,
        check_ids: Object.freeze(["ENTRY_KERNEL_SUBMITTER_RETURNED"]),
        passed_check_ids: Object.freeze([]),
        failed_check_ids: Object.freeze(["ENTRY_KERNEL_SUBMITTER_RETURNED"]),
        checks: Object.freeze([
          Object.freeze({
            id: "ENTRY_KERNEL_SUBMITTER_RETURNED",
            ok: false,
            error_code: errorCode,
          }),
        ]),
        position_cycle_id: null,
        entry_event_id: null,
        protection_runtime_id: null,
      }),
    });
  }

  const kernelAudit = evaluateEntryExecutionKernelResult(submitterResult);
  return Object.freeze({
    ok: kernelAudit.ok,
    reason: kernelAudit.ok ? "V2_ENTRY_EXECUTION_KERNEL_PROTECTED" : "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
    submitterResult,
    kernelAudit,
  });
}

module.exports = {
  evaluateEntryExecutionKernelResult,
  runV2EntryExecutionKernel,
  __test: {
    trimOrNull,
    upper,
    stableCode,
    asObject,
  },
};
