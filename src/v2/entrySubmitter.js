"use strict";

const { buildV2ExecutedEntryFromIntent, validateExecutableEntryIntent } = require("./entryExecutor");
const { runV2EntryProtectionActivation } = require("./entryProtectionRunner");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function stableCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateTransportFn(name, value) {
  if (typeof value !== "function") throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateProtectionTransports(transports) {
  const bag = validateRequiredObject("PROTECTION_TRANSPORTS", transports);
  validateTransportFn("PLACE_INITIAL_SL_TRANSPORT", bag.placeInitialSl);
  validateTransportFn("PLACE_INITIAL_TP1_TRANSPORT", bag.placeInitialTp1);
  return bag;
}

function normalizeEntryFillReceipt({ receipt, entryContract } = {}) {
  const row = validateRequiredObject("ENTRY_FILL_RECEIPT", receipt);
  const contract = validateRequiredObject("ENTRY_CONTRACT", entryContract);
  const status = upper(row.status || row.execution_status || row.orderStatus || row.order_status);
  if (status !== "FILLED") throw new Error("ENTRY_ORDER_FILLED_STATUS_REQUIRED");

  const symbol = upper(row.symbol || contract.symbol);
  const side = upper(row.side || row.position_side || contract.side);
  if (symbol !== contract.symbol) throw new Error("ENTRY_FILL_SYMBOL_MISMATCH");
  if (side !== contract.side) throw new Error("ENTRY_FILL_SIDE_MISMATCH");

  const entryEventId = trimOrNull(row.entry_event_id || row.entryEventId);
  const entryOrderId = trimOrNull(row.entry_order_id || row.entryOrderId || row.order_id || row.orderId);
  const entryFillGroupId = trimOrNull(row.entry_fill_group_id || row.entryFillGroupId || row.fill_group_id || row.fillGroupId);
  const entryPrice = toNumberOrNull(row.entry_price || row.entryPrice || row.avg_price || row.avgPrice || row.average_price || row.averagePrice);
  const entryQtyAbs = toNumberOrNull(row.entry_qty_abs || row.entryQtyAbs || row.executed_qty_abs || row.executedQtyAbs || row.executed_qty || row.executedQty);

  if (!entryEventId) throw new Error("ENTRY_EVENT_ID_REQUIRED");
  if (!entryOrderId) throw new Error("ENTRY_ORDER_ID_REQUIRED");
  if (!entryFillGroupId) throw new Error("ENTRY_FILL_GROUP_ID_REQUIRED");
  if (!(entryPrice > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (!(entryQtyAbs > 0)) throw new Error("ENTRY_QTY_ABS_REQUIRED");

  return Object.freeze({
    status,
    symbol,
    side,
    entry_event_id: entryEventId,
    entry_order_id: entryOrderId,
    entry_fill_group_id: entryFillGroupId,
    entry_price: entryPrice,
    entry_qty_abs: entryQtyAbs,
    submitted_order_id: trimOrNull(row.submitted_order_id || row.submittedOrderId),
    exchange_order_id: trimOrNull(row.exchange_order_id || row.exchangeOrderId || entryOrderId),
    filled_at: trimOrNull(row.filled_at || row.filledAt),
    raw_receipt: Object.freeze({ ...row }),
  });
}

function validateProtectionActivationResult(result) {
  const row = result && typeof result === "object" ? result : null;
  if (!row) return Object.freeze({ ok: false, reason: "ENTRY_PROTECTION_RESULT_REQUIRED" });
  const activationCommit = row.activationCommit && typeof row.activationCommit === "object" ? row.activationCommit : null;
  const chainAudit = activationCommit && activationCommit.chainAudit && typeof activationCommit.chainAudit === "object"
    ? activationCommit.chainAudit
    : null;
  const protectionWriteResult = row.protectionWriteResult && typeof row.protectionWriteResult === "object"
    ? row.protectionWriteResult
    : null;
  const writeDecision = protectionWriteResult && protectionWriteResult.writeDecision && typeof protectionWriteResult.writeDecision === "object"
    ? protectionWriteResult.writeDecision
    : null;
  const runtimeDoc = protectionWriteResult && protectionWriteResult.runtimeDoc && typeof protectionWriteResult.runtimeDoc === "object"
    ? protectionWriteResult.runtimeDoc
    : null;
  const checks = [
    ["ENTRY_PROTECTION_RESULT_OK", row.ok === true],
    ["ENTRY_PROTECTION_ACTIVATION_COMMIT_OK", activationCommit && activationCommit.ok === true],
    ["ENTRY_PROTECTION_ACTIVE_STATUS", activationCommit && upper(activationCommit.position_cycle_status) === "ACTIVE_PROTECTED"],
    ["ENTRY_PROTECTION_CHAIN_AUDIT_OK", chainAudit && chainAudit.ok === true && Number(chainAudit.fail_n) === 0],
    ["ENTRY_PROTECTION_WRITE_DECISION_OK", writeDecision && writeDecision.ok === true],
    ["ENTRY_PROTECTION_RUNTIME_HEALTHY", runtimeDoc && upper(runtimeDoc.health_status) === "HEALTHY"],
    ["ENTRY_PROTECTION_SL_ORDER_PRESENT", runtimeDoc && !!trimOrNull(runtimeDoc.sl_order_id)],
    ["ENTRY_PROTECTION_TP1_ORDER_PRESENT", runtimeDoc && !!trimOrNull(runtimeDoc.tp1_order_id)],
  ];
  const failed = checks.filter(([, ok]) => ok !== true).map(([id]) => id);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_OK" : "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_INVALID",
    failed_check_ids: Object.freeze(failed),
  });
}

function protectionAckStatus(result, leg) {
  const row = result && typeof result === "object" ? result : {};
  const ack = row[leg] && typeof row[leg] === "object" ? row[leg] : null;
  return upper(ack && ack.status);
}

function shouldRetryFullProtectionPlacement(protectionResult) {
  const slStatus = protectionAckStatus(protectionResult, "slAck");
  const tp1Status = protectionAckStatus(protectionResult, "tp1Ack");
  return slStatus !== "PLACED" && tp1Status !== "PLACED";
}

async function recoverUnprotectedEntryProtection({
  db = null,
  env = process.env,
  executedEntry,
  protectionTransports,
  protectionEvidence,
  protectionResult,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
  runProtectionActivation = runV2EntryProtectionActivation,
} = {}) {
  if (typeof runProtectionActivation !== "function") throw new Error("RUN_PROTECTION_ACTIVATION_REQUIRED");
  const retryId = `${trimOrNull(placementRetryId) || "R0"}_RECOVERY`;
  if (!shouldRetryFullProtectionPlacement(protectionResult)) {
    return Object.freeze({
      ok: false,
      attempted: false,
      reason: "ENTRY_PROTECTION_RECOVERY_DEFERRED_TO_REPAIR_QUEUE",
      placement_retry_id: retryId,
      protectionEvidence: protectionEvidence || null,
      protectionResult: protectionResult || null,
      repairQueueCommit: protectionResult && protectionResult.repairQueueCommit ? protectionResult.repairQueueCommit : null,
    });
  }
  try {
    const retryResult = await runProtectionActivation({
      db,
      env,
      executedEntry,
      transports: protectionTransports,
      now,
      placementRetryId: retryId,
    });
    const retryEvidence = validateProtectionActivationResult(retryResult);
    return Object.freeze({
      ok: retryEvidence.ok === true,
      attempted: true,
      reason: retryEvidence.ok === true
        ? "ENTRY_PROTECTION_RECOVERY_ACTIVE"
        : "ENTRY_PROTECTION_RECOVERY_BLOCKED",
      placement_retry_id: retryId,
      protectionEvidence: retryEvidence,
      protectionResult: retryResult,
      initialProtectionEvidence: protectionEvidence || null,
      initialProtectionResult: protectionResult || null,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      attempted: true,
      reason: "ENTRY_PROTECTION_RECOVERY_THROWN",
      placement_retry_id: retryId,
      error_code: stableCode(error && error.message) || "ENTRY_PROTECTION_RECOVERY_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
      initialProtectionEvidence: protectionEvidence || null,
      initialProtectionResult: protectionResult || null,
    });
  }
}

async function runV2EntrySubmitter({
  db = null,
  env = process.env,
  entryIntent,
  entryTransport,
  protectionTransports,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
  stopLossPct = 0.0165,
  tp1TargetPct = 0.025,
  tp1QtyRatio = 0.5,
  leverage = null,
  protectionLeverageNormalize = undefined,
  runProtectionActivation = runV2EntryProtectionActivation,
} = {}) {
  const submitEntryOrder = validateTransportFn("SUBMIT_ENTRY_ORDER_TRANSPORT", entryTransport && entryTransport.submitEntryOrder);
  const protectionBag = validateProtectionTransports(protectionTransports);
  if (typeof runProtectionActivation !== "function") throw new Error("RUN_PROTECTION_ACTIVATION_REQUIRED");
  const entryContract = validateExecutableEntryIntent(entryIntent);
  const submittedAt = trimOrNull(now()) || new Date().toISOString();

  const receipt = await submitEntryOrder({
    entryIntent: entryContract,
    env,
    db,
    submittedAt,
  });
  let fill = null;
  try {
    fill = normalizeEntryFillReceipt({ receipt, entryContract });
  } catch (error) {
    const receiptStatus = upper(receipt && (receipt.status || receipt.execution_status || receipt.orderStatus || receipt.order_status));
    const receiptOrderId = trimOrNull(receipt && (receipt.entry_order_id || receipt.entryOrderId || receipt.order_id || receipt.orderId || receipt.exchange_order_id || receipt.exchangeOrderId));
    if (receiptStatus === "FILLED" || !receiptOrderId) {
      throw error;
    }
    return Object.freeze({
      ok: false,
      reason: "ENTRY_SUBMITTED_FILL_RECEIPT_INVALID",
      submitted_at: submittedAt,
      entryContract,
      fill: receipt && typeof receipt === "object"
        ? Object.freeze({
          ...receipt,
          receipt_validation_error_code: stableCode(error && error.message) || "ENTRY_FILL_RECEIPT_INVALID",
          receipt_validation_error_message: trimOrNull(error && error.message) || String(error),
        })
        : null,
      executedEntry: null,
      protectionEvidence: Object.freeze({
        ok: false,
        reason: "ENTRY_PROTECTION_NOT_ATTEMPTED_AFTER_INVALID_FILL_RECEIPT",
        failed_check_ids: Object.freeze(["ENTRY_FILL_RECEIPT_VALID"]),
      }),
      protectionResult: null,
      recoveryResult: null,
    });
  }
  const executedEntry = buildV2ExecutedEntryFromIntent({
    entryIntent: {
      ...entryIntent,
      ...entryContract,
    },
    entryEventId: fill.entry_event_id,
    entryOrderId: fill.entry_order_id,
    entryFillGroupId: fill.entry_fill_group_id,
    entryPrice: fill.entry_price,
    entryQtyAbs: fill.entry_qty_abs,
    stopLossPct,
    tp1TargetPct,
    tp1QtyRatio,
    leverage,
    ...(protectionLeverageNormalize !== undefined ? { protectionLeverageNormalize } : {}),
  });

  let protectionResult = null;
  try {
    protectionResult = await runProtectionActivation({
      db,
      env,
      executedEntry,
      transports: protectionBag,
      now,
      placementRetryId,
    });
  } catch (error) {
    protectionResult = Object.freeze({
      ok: false,
      reason: "ENTRY_PROTECTION_ACTIVATION_THROWN",
      error_code: stableCode(error && error.message) || "ENTRY_PROTECTION_ACTIVATION_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
    });
  }
  let protectionEvidence = validateProtectionActivationResult(protectionResult);
  const recoveryResult = protectionEvidence.ok === true
    ? null
    : await recoverUnprotectedEntryProtection({
      db,
      env,
      executedEntry,
      protectionTransports: protectionBag,
      protectionEvidence,
      protectionResult,
      now,
      placementRetryId,
      runProtectionActivation,
    });
  if (recoveryResult && recoveryResult.ok === true) {
    protectionEvidence = recoveryResult.protectionEvidence;
    protectionResult = recoveryResult.protectionResult;
  }

  return Object.freeze({
    ok: protectionEvidence.ok === true,
    reason: protectionEvidence.ok === true ? "ENTRY_SUBMITTED_AND_PROTECTED" : "ENTRY_SUBMITTED_PROTECTION_BLOCKED",
    submitted_at: submittedAt,
    entryContract,
    fill,
    executedEntry,
    protectionEvidence,
    protectionResult,
    recoveryResult,
  });
}

module.exports = {
  runV2EntrySubmitter,
  normalizeEntryFillReceipt,
  validateProtectionActivationResult,
  recoverUnprotectedEntryProtection,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    stableCode,
    validateRequiredObject,
    validateTransportFn,
    validateProtectionTransports,
    validateProtectionActivationResult,
    protectionAckStatus,
    shouldRetryFullProtectionPlacement,
    recoverUnprotectedEntryProtection,
  },
};
