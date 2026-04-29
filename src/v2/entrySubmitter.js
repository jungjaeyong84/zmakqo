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

  // 2026-04-29 P0-3 — broker truth is the authoritative protection
  // signal. Operator-reported pattern (DOGE 07:01:31, ETH 07:16:11):
  // both broker side STOP and TP placements ack'd within 514–690 ms
  // (native_protection_unprotected_window_observed status=OK), yet the
  // 8-check AND below tripped on internal write-side stamping race
  // (runtimeDoc / chainAudit fields populated milliseconds AFTER the
  // broker ack arrived). Result: V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL
  // for positions that were in fact fully protected on the exchange.
  //
  // New separation:
  //   - BROKER-TRUTH gate (slAck=PLACED && tp1Ack=PLACED) decides
  //     whether the position is *operationally* protected. This is
  //     the only signal that affects ok/critical.
  //   - INTERNAL evidence quality checks (8 below) become a quality
  //     metric — surfaced as `quality_check_fails` so operators see
  //     stamping races / chainAudit issues, but they do not raise
  //     POST_FILL_PROTECTION_CRITICAL when the broker side is sound.
  //
  // If the broker did not ack STOP+TP, we still return ok=false; in
  // that case the position is genuinely exposed and the existing
  // recovery path (recoverUnprotectedEntryProtection) is invoked.
  const slAck = (row.slAck && typeof row.slAck === "object") ? row.slAck : null;
  const tp1Ack = (row.tp1Ack && typeof row.tp1Ack === "object") ? row.tp1Ack : null;
  const slAckStatus = slAck ? upper(slAck.status) : null;
  const tp1AckStatus = tp1Ack ? upper(tp1Ack.status) : null;
  const slPlaced = slAckStatus === "PLACED";
  const tp1Placed = tp1AckStatus === "PLACED";
  const brokerTruthOk = !!(slPlaced && tp1Placed);
  // Whether the caller actually supplied broker-truth evidence. If the
  // protectionResult shape doesn't include slAck/tp1Ack at all (legacy
  // fixtures, alternate code paths), we fall back to the 8-check AND
  // for backward compatibility — only the production path that wires
  // up `slAck`/`tp1Ack` from the broker placement gets the new
  // broker-truth contract.
  const brokerTruthAvailable = (slAck !== null && tp1Ack !== null);

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

  // Decision matrix:
  //   broker truth available + PLACED+PLACED → ok=true
  //                          + anything else → ok=false (true exposure)
  //   broker truth NOT available             → fall back to 8-check AND
  //                                            (legacy contract preserved)
  let ok;
  let reason;
  if (brokerTruthAvailable) {
    ok = brokerTruthOk;
    if (ok) {
      reason = failed.length === 0
        ? "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_OK"
        : "ENTRY_PROTECTION_BROKER_TRUTH_OK_INTERNAL_QUALITY_DEGRADED";
    } else {
      reason = "ENTRY_PROTECTION_BROKER_TRUTH_BLOCKED";
    }
  } else {
    // Legacy / fixture path — no broker ack info, fall back to the
    // pre-2026-04-29 8-check AND.
    ok = failed.length === 0;
    reason = ok ? "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_OK" : "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_INVALID";
  }
  return Object.freeze({
    ok,
    reason,
    broker_truth_ok: brokerTruthOk,
    broker_truth_available: brokerTruthAvailable,
    sl_ack_status: slAckStatus,
    tp1_ack_status: tp1AckStatus,
    quality_check_fails: Object.freeze(failed),
    // Back-compat: legacy callers and dashboards still read
    // `failed_check_ids` for evidence diagnostics. Surface the same
    // list under the legacy name as well so observability is preserved.
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
  // 2026-04-29 P0-3 — observability split. Two distinct conditions
  // worth surfacing now that broker truth (slAck/tp1Ack PLACED) is the
  // critical-path signal:
  //   1. evidence_blocked — broker truth says NOT placed
  //                         (ENTRY_PROTECTION_BROKER_TRUTH_BLOCKED).
  //                         This is the real exposure case → recovery path.
  //   2. evidence_quality_degraded — broker truth says PLACED but
  //                         internal stamping (chainAudit / runtimeDoc /
  //                         activationCommit / writeDecision) didn't
  //                         finish atomically. NOT a critical event;
  //                         positions are protected on the exchange.
  //                         Surface it as a warning so operators can
  //                         track stamping-race rates and address
  //                         them at a slower cadence (chainAudit
  //                         strictening, writer fence, etc.) without
  //                         blocking entries.
  try {
    if (protectionEvidence.ok !== true) {
      console.log(JSON.stringify({
        event: "v2_entry_protection_evidence_blocked",
        ts: new Date().toISOString(),
        symbol: executedEntry && executedEntry.symbol,
        side: executedEntry && executedEntry.side,
        position_cycle_id: executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id,
        entry_order_id: executedEntry && executedEntry.entry_order_id,
        stage: "INITIAL",
        evidence_reason: protectionEvidence.reason,
        failed_check_ids: Array.isArray(protectionEvidence.failed_check_ids)
          ? protectionEvidence.failed_check_ids.slice(0, 16)
          : null,
        protection_result_ok: protectionResult && protectionResult.ok === true,
        protection_result_reason: protectionResult && protectionResult.reason,
        sl_ack_status: protectionResult && protectionResult.slAck && protectionResult.slAck.status,
        tp1_ack_status: protectionResult && protectionResult.tp1Ack && protectionResult.tp1Ack.status,
        sl_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.sl_order_id,
        tp1_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.tp1_order_id,
        runtime_health_status: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.health_status,
        chain_audit_ok: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.chainAudit && protectionResult.activationCommit.chainAudit.ok,
        chain_audit_fail_n: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.chainAudit && protectionResult.activationCommit.chainAudit.fail_n,
        activation_position_cycle_status: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.position_cycle_status,
      }));
    } else if (Array.isArray(protectionEvidence.quality_check_fails)
        && protectionEvidence.quality_check_fails.length > 0) {
      // Broker truth OK but stamping race(s) — operator-visible warning,
      // does not block the entry. See P0-3 audit comment above.
      console.log(JSON.stringify({
        event: "v2_entry_protection_evidence_quality_degraded",
        ts: new Date().toISOString(),
        symbol: executedEntry && executedEntry.symbol,
        side: executedEntry && executedEntry.side,
        position_cycle_id: executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id,
        entry_order_id: executedEntry && executedEntry.entry_order_id,
        stage: "INITIAL",
        evidence_reason: protectionEvidence.reason,
        quality_check_fails: protectionEvidence.quality_check_fails.slice(0, 16),
        broker_truth_ok: protectionEvidence.broker_truth_ok === true,
        sl_ack_status: protectionEvidence.sl_ack_status,
        tp1_ack_status: protectionEvidence.tp1_ack_status,
        sl_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.sl_order_id,
        tp1_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.tp1_order_id,
        runtime_health_status: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.health_status,
        chain_audit_fail_n: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.chainAudit && protectionResult.activationCommit.chainAudit.fail_n,
        activation_position_cycle_status: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.position_cycle_status,
      }));
    }
  } catch (_) { /* observability only */ }
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
  // 2026-04-29 — also surface post-recovery evidence so operators see
  // whether the recovery path actually fixed the failed checks.
  try {
    if (protectionEvidence.ok !== true) {
      console.log(JSON.stringify({
        event: "v2_entry_protection_evidence_blocked",
        ts: new Date().toISOString(),
        symbol: executedEntry && executedEntry.symbol,
        side: executedEntry && executedEntry.side,
        position_cycle_id: executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id,
        entry_order_id: executedEntry && executedEntry.entry_order_id,
        stage: "POST_RECOVERY",
        evidence_reason: protectionEvidence.reason,
        failed_check_ids: Array.isArray(protectionEvidence.failed_check_ids)
          ? protectionEvidence.failed_check_ids.slice(0, 16)
          : null,
        recovery_attempted: recoveryResult ? recoveryResult.attempted === true : false,
        recovery_ok: recoveryResult ? recoveryResult.ok === true : null,
        recovery_reason: recoveryResult ? recoveryResult.reason : null,
        sl_ack_status: protectionResult && protectionResult.slAck && protectionResult.slAck.status,
        tp1_ack_status: protectionResult && protectionResult.tp1Ack && protectionResult.tp1Ack.status,
        sl_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.sl_order_id,
        tp1_order_id: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.tp1_order_id,
        runtime_health_status: protectionResult && protectionResult.runtimeDoc && protectionResult.runtimeDoc.health_status,
        chain_audit_fail_n: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.chainAudit && protectionResult.activationCommit.chainAudit.fail_n,
        activation_position_cycle_status: protectionResult && protectionResult.activationCommit && protectionResult.activationCommit.position_cycle_status,
      }));
    }
  } catch (_) { /* observability only */ }

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
