"use strict";

const { reduceCanonicalExit } = require("./canonicalExitReducer");
const { prepareExitTransitionAlert } = require("./alertWorker");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function resolveObservedAtIso(value = null) {
  const direct = trimOrNull(value);
  if (direct) {
    const time = Date.parse(direct);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function resolveExitFillKind(exitFill) {
  const row = exitFill && typeof exitFill === "object" ? exitFill : {};
  const kind = upper(row.exit_kind || row.exitKind || row.kind || row.event || row.transition_event || row.transitionEvent);
  if (!kind) throw new Error("EXIT_FILL_KIND_REQUIRED");
  if (kind === "LEGACY_EARLY_PARTIAL_EXIT" || /^EXIT_[A-Z_]+_P\d/.test(kind)) {
    throw new Error("V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL");
  }
  if (kind === "TP1" || kind === "TP1_REACHED" || kind === "TP1_CONFIRMED") return "TP1";
  if (kind === "SL" || kind === "SL_HIT" || kind === "STOP" || kind === "STOP_EXIT" || kind === "STOP_EXIT_CONFIRMED") return "STOP";
  if (kind === "TRAIL" || kind === "TRAIL_HIT" || kind === "TRAIL_EXIT") return "STOP";
  if (kind === "EXTERNAL" || kind === "EXTERNAL_CLOSE" || kind === "EXTERNAL_CLOSE_SYNC") return "EXTERNAL";
  if (kind === "MANUAL" || kind === "MANUAL_CLOSE" || kind === "MANUAL_CLOSE_SYNC") return "MANUAL";
  throw new Error(`EXIT_FILL_KIND_UNSUPPORTED:${kind}`);
}

function buildExchangeEvidenceSnapshot({
  evidenceKind,
  sourceFillId,
  sourceOrderId,
  observedAt = null,
  rawPayload = null,
} = {}) {
  return Object.freeze({
    evidence_kind: upper(evidenceKind) || "UNKNOWN",
    observed_at: resolveObservedAtIso(observedAt),
    source_fill_id: trimOrNull(sourceFillId),
    source_order_id: trimOrNull(sourceOrderId),
    raw_payload: cloneJson(rawPayload),
  });
}

function normalizeV2ExitFillEvidence({ exitFill } = {}) {
  const row = exitFill && typeof exitFill === "object" ? exitFill : null;
  if (!row) throw new Error("EXIT_FILL_REQUIRED");
  const exitKind = resolveExitFillKind(row);
  const sourceFillId = trimOrNull(row.source_fill_id || row.sourceFillId || row.fill_id || row.fillId || row.trade_id || row.tradeId);
  const sourceOrderId = trimOrNull(row.source_order_id || row.sourceOrderId || row.order_id || row.orderId || row.client_order_id || row.clientOrderId);
  if (!sourceFillId) throw new Error("EXIT_FILL_SOURCE_FILL_ID_REQUIRED");
  if (!sourceOrderId) throw new Error("EXIT_FILL_SOURCE_ORDER_ID_REQUIRED");

  const fillQtyAbs = toNumberOrNull(row.fill_qty_abs || row.fillQtyAbs || row.qty_abs || row.qtyAbs || row.quantity_abs || row.quantityAbs);
  const fillPrice = toNumberOrNull(row.fill_price || row.fillPrice || row.price || row.avg_price || row.avgPrice);
  if (exitKind === "TP1" && !(fillQtyAbs > 0)) throw new Error("EXIT_FILL_TP1_QTY_REQUIRED");
  if (exitKind === "STOP" && !(fillPrice > 0)) throw new Error("EXIT_FILL_STOP_PRICE_REQUIRED");

  if (exitKind === "TP1") {
    return Object.freeze({
      kind: "TP1_CONFIRMED",
      sourceFillId,
      sourceOrderId,
      fillQtyAbs,
      fillPrice,
      exchangeEvidenceKind: "TP1_FILL",
    });
  }
  if (exitKind === "STOP") {
    return Object.freeze({
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId,
      sourceOrderId,
      fillQtyAbs,
      fillPrice,
      exchangeEvidenceKind: "STOP_EXIT",
    });
  }
  if (exitKind === "EXTERNAL") {
    return Object.freeze({
      kind: "EXTERNAL_CLOSE_CONFIRMED",
      sourceFillId,
      sourceOrderId,
      fillQtyAbs,
      fillPrice,
      exchangeEvidenceKind: "EXTERNAL_CLOSE",
    });
  }
  return Object.freeze({
    kind: "MANUAL_CLOSE_CONFIRMED",
    sourceFillId,
    sourceOrderId,
    fillQtyAbs,
    fillPrice,
    exchangeEvidenceKind: "MANUAL_CLOSE",
  });
}

function reduceV2ExitFill({
  positionCycle,
  projection,
  exitFill,
  protectionRuntime = null,
} = {}) {
  const evidence = normalizeV2ExitFillEvidence({ exitFill });
  const reduced = reduceCanonicalExit({
    positionCycle,
    projection,
    evidence,
    protectionRuntime,
    requireProtectionRuntimeGate: evidence.kind === "TP1_CONFIRMED",
  });
  if (reduced.duplicate === true || !reduced.transition) {
    return Object.freeze({
      ok: true,
      duplicate: true,
      written: false,
      reason: reduced.reason || "V2_EXIT_FILL_DUPLICATE",
      evidence,
      transition: null,
      nextProjection: reduced.nextProjection,
      alert: null,
    });
  }
  const transition = Object.freeze({
    ...reduced.transition,
    source_exchange_evidence: buildExchangeEvidenceSnapshot({
      evidenceKind: evidence.exchangeEvidenceKind,
      sourceFillId: evidence.sourceFillId,
      sourceOrderId: evidence.sourceOrderId,
      observedAt: exitFill && (exitFill.observed_at || exitFill.observedAt || exitFill.time || exitFill.event_time),
      rawPayload: exitFill && (exitFill.raw_payload || exitFill.rawPayload || exitFill.exchange_evidence || exitFill.exchangeEvidence) || exitFill,
    }),
  });
  const alert = prepareExitTransitionAlert({
    positionCycle,
    transition,
    projection: reduced.nextProjection,
  });
  return Object.freeze({
    ok: true,
    duplicate: false,
    written: false,
    reason: "V2_EXIT_FILL_REDUCED",
    evidence,
    transition,
    nextProjection: reduced.nextProjection,
    alert,
  });
}

module.exports = {
  normalizeV2ExitFillEvidence,
  reduceV2ExitFill,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    resolveExitFillKind,
    buildExchangeEvidenceSnapshot,
  },
};
