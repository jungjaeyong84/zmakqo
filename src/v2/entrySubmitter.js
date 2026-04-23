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

async function runV2EntrySubmitter({
  db = null,
  env = process.env,
  entryIntent,
  entryTransport,
  protectionTransports,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
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
  const fill = normalizeEntryFillReceipt({ receipt, entryContract });
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
  const protectionEvidence = validateProtectionActivationResult(protectionResult);

  return Object.freeze({
    ok: protectionEvidence.ok === true,
    reason: protectionEvidence.ok === true ? "ENTRY_SUBMITTED_AND_PROTECTED" : "ENTRY_SUBMITTED_PROTECTION_BLOCKED",
    submitted_at: submittedAt,
    entryContract,
    fill,
    executedEntry,
    protectionEvidence,
    protectionResult,
  });
}

module.exports = {
  runV2EntrySubmitter,
  normalizeEntryFillReceipt,
  validateProtectionActivationResult,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    stableCode,
    validateRequiredObject,
    validateTransportFn,
    validateProtectionTransports,
    validateProtectionActivationResult,
  },
};
