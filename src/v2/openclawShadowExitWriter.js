"use strict";

const { reduceCanonicalExit } = require("./canonicalExitReducer");
const { reduceV2ExitFill } = require("./exitFillIngestion");
const { prepareExitTransitionAlert } = require("./alertWorker");
const {
  buildPersistedPreparedAlertOutbox,
  deliverPreparedExitTransitionAlert,
} = require("./alertDeliveryWorker");
const { buildPositionCycleId } = require("./contracts");
const { getV2Doc, putV2DocsBatch } = require("./storage");
const { resolveV2RuntimeConfig } = require("./runtime");

const EPSILON = 1e-8;

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

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseBoolStrict(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function resolveObservedAtIso(observedAtMs = null) {
  return Number.isFinite(Number(observedAtMs))
    ? new Date(Number(observedAtMs)).toISOString()
    : new Date().toISOString();
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function buildExchangeEvidenceSnapshot({
  evidenceKind,
  observedAtMs = null,
  sourceFillId = null,
  sourceOrderId = null,
  rawPayload = null,
} = {}) {
  return Object.freeze({
    evidence_kind: upper(evidenceKind) || "UNKNOWN",
    observed_at: resolveObservedAtIso(observedAtMs),
    source_fill_id: trimOrNull(sourceFillId),
    source_order_id: trimOrNull(sourceOrderId),
    raw_payload: cloneJson(rawPayload),
  });
}

function resolveExitWriterGate({ env = process.env, symbol = null } = {}) {
  const cfg = resolveV2RuntimeConfig(env);
  if (cfg.enabled !== true) return { ok: false, reason: "V2_DISABLED" };
  if (cfg.dryRun === true) return { ok: false, reason: "V2_DRY_RUN" };
  if (!parseBool(env.DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED, false)) {
    return { ok: false, reason: "V2_SHADOW_EXIT_WRITE_DISABLED" };
  }
  const normalizedSymbol = upper(symbol);
  if (
    cfg.canaryOnly === true &&
    Array.isArray(cfg.canarySymbols) &&
    cfg.canarySymbols.length > 0 &&
    normalizedSymbol &&
    !cfg.canarySymbols.includes(normalizedSymbol)
  ) {
    return { ok: false, reason: "V2_CANARY_SYMBOL_FILTERED" };
  }
  return { ok: true, reason: "V2_SHADOW_EXIT_WRITE_ENABLED" };
}

function resolvePositionSide(value) {
  const side = upper(value);
  if (side === "BUY") return "LONG";
  if (side === "SELL") return "SHORT";
  if (side === "LONG" || side === "SHORT") return side;
  return null;
}

function resolveAggregateTp1QtyAbs({ projection = null, fillQtyAbs = null, positionMeta = null } = {}) {
  const sourceProjection = projection && typeof projection === "object" ? projection : {};
  const meta = positionMeta && typeof positionMeta === "object" ? positionMeta : {};
  const targetQtyAbs = toNumberOrNull(sourceProjection.tp1_target_qty_abs);
  const currentFilledQtyAbs = toNumberOrNull(sourceProjection.tp1_filled_qty_abs) || 0;
  if (!(Number.isFinite(targetQtyAbs) && targetQtyAbs > 0)) {
    return { ok: false, reason: "V2_SHADOW_TP1_TARGET_QTY_INVALID", fillQtyAbs: null };
  }
  const targetRemainingQtyAbs = Number((targetQtyAbs - currentFilledQtyAbs).toFixed(8));
  const candidates = [
    {
      source: "FILL_QTY",
      value: toNumberOrNull(fillQtyAbs),
    },
    {
      source: "CONSUMED_TP_QTY_BASE",
      value: toNumberOrNull(meta.native_protection_consumed_tp_qty_base),
      totalMode: true,
    },
    {
      source: "ACTIVE_TP_QTY_BASE",
      value: toNumberOrNull(meta.native_protection_tp_qty_base),
      totalMode: true,
    },
  ];
  for (const candidate of candidates) {
    const rawValue = toNumberOrNull(candidate.value);
    if (!(Number.isFinite(rawValue) && rawValue > 0)) continue;
    const resolvedFillQtyAbs = candidate.totalMode === true
      ? Number((rawValue - currentFilledQtyAbs).toFixed(8))
      : rawValue;
    if (!(Number.isFinite(resolvedFillQtyAbs) && resolvedFillQtyAbs > 0)) continue;
    if (Math.abs(resolvedFillQtyAbs - targetRemainingQtyAbs) <= EPSILON) {
      return {
        ok: true,
        reason: candidate.source,
        fillQtyAbs: resolvedFillQtyAbs,
      };
    }
  }
  return {
    ok: false,
    reason: "V2_SHADOW_TP1_AGGREGATE_INCOMPLETE",
    fillQtyAbs: null,
  };
}

function buildTrailActivationEvidenceId({
  positionCycleId,
  sourceOrderId,
  observedAtMs = null,
} = {}) {
  const cycleId = trimOrNull(positionCycleId) || "UNKNOWN_CYCLE";
  const orderId = trimOrNull(sourceOrderId) || "UNKNOWN_ORDER";
  const at = Number.isFinite(Number(observedAtMs)) ? Number(observedAtMs) : Date.now();
  return `TRAIL_ACTIVATION__${cycleId}__${orderId}__${at}`;
}

function isTerminalProjectionStage(stage) {
  const normalized = upper(stage);
  return normalized === "EXITED_SL"
    || normalized === "EXITED_TRAIL"
    || normalized === "EXITED_EXTERNAL"
    || normalized === "EXITED_MANUAL";
}

function evaluateTrailActivationProtectionGate({
  protectionRuntime,
  nativeRefreshStatus,
  nextStopPrice,
} = {}) {
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  const refreshStatus = upper(nativeRefreshStatus) || "OK";
  const healthStatus = upper(runtime.health_status);
  const stopPrice = toNumberOrNull(nextStopPrice);
  const issues = [];

  if (!(stopPrice > 0)) issues.push("TRAIL_STOP_PRICE_INVALID");
  if (refreshStatus !== "OK") issues.push("NATIVE_REFRESH_UNHEALTHY");
  if (healthStatus === "TERMINAL_EXITED") issues.push("TERMINAL_PROTECTION_RUNTIME");

  return Object.freeze({
    ok: issues.length === 0,
    reason: issues[0] || "V2_SHADOW_TRAIL_PROTECTION_READY",
    issue_codes: Object.freeze(issues),
  });
}

function evaluateTp1TransitionRuntimeGate({
  positionCycle,
  protectionRuntime,
} = {}) {
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : {};
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  const issues = [];

  if (upper(cycle.status) !== "ACTIVE_PROTECTED") issues.push("POSITION_NOT_ACTIVE_PROTECTED");
  if (trimOrNull(runtime.position_cycle_id) !== trimOrNull(cycle.position_cycle_id)) {
    issues.push("PROTECTION_RUNTIME_CYCLE_MISMATCH");
  }
  if (upper(runtime.health_status) !== "HEALTHY") issues.push("PROTECTION_RUNTIME_NOT_HEALTHY");
  if (upper(runtime.native_refresh_status) !== "OK") issues.push("NATIVE_REFRESH_UNHEALTHY");
  if (!trimOrNull(runtime.sl_order_id)) issues.push("SL_ORDER_MISSING");
  if (!trimOrNull(runtime.tp1_order_id)) issues.push("TP1_ORDER_MISSING");
  if (upper(runtime.tp1_order_status) && upper(runtime.tp1_order_status) !== "PLACED") {
    issues.push("TP1_ORDER_NOT_PLACED");
  }

  return Object.freeze({
    ok: issues.length === 0,
    reason: issues[0] || "V2_SHADOW_TP1_RUNTIME_READY",
    issue_codes: Object.freeze(issues),
  });
}

function hasPlacedRuntimeOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const orderId = trimOrNull(row[orderKey]);
  const status = upper(row[statusKey]);
  if (!orderId) return false;
  if (status && status !== "PLACED") return false;
  return true;
}

function pickEvidenceValue(evidence, keys) {
  const row = evidence && typeof evidence === "object" ? evidence : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return null;
}

function resolveStopExitFullExit({ fullExit = null, exchangeEvidence = null } = {}) {
  const direct = parseBoolStrict(fullExit);
  if (direct === true) return { ok: true, reason: "FULL_EXIT_FLAG" };
  if (direct === false) return { ok: false, reason: "STOP_FULL_EXIT_NOT_CONFIRMED" };

  const evidenceFlag = parseBoolStrict(pickEvidenceValue(exchangeEvidence, [
    "full_exit",
    "fullExit",
    "is_full_exit",
    "isFullExit",
    "is_final_exit",
    "isFinalExit",
    "position_closed",
    "positionClosed",
  ]));
  if (evidenceFlag === true) return { ok: true, reason: "EVIDENCE_FULL_EXIT_FLAG" };
  if (evidenceFlag === false) return { ok: false, reason: "STOP_FULL_EXIT_NOT_CONFIRMED" };

  const remainingQty = toNumberOrNull(pickEvidenceValue(exchangeEvidence, [
    "position_amt_after",
    "positionAmtAfter",
    "position_qty_after",
    "positionQtyAfter",
    "remaining_position_qty_abs",
    "remainingPositionQtyAbs",
  ]));
  if (Number.isFinite(remainingQty) && Math.abs(remainingQty) <= EPSILON) {
    return { ok: true, reason: "EVIDENCE_ZERO_POSITION_AFTER" };
  }

  return { ok: false, reason: "STOP_FULL_EXIT_NOT_CONFIRMED" };
}

function resolveStopFillEvidence({ event = null, exchangeEvidence = null } = {}) {
  const normalizedEvent = upper(event);
  const executionType = upper(pickEvidenceValue(exchangeEvidence, [
    "execution_type",
    "executionType",
    "x",
  ]));
  const orderType = upper(pickEvidenceValue(exchangeEvidence, [
    "order_type",
    "orderType",
    "type",
    "o",
  ]));
  const stopPrice = toNumberOrNull(pickEvidenceValue(exchangeEvidence, [
    "stop_price",
    "stopPrice",
    "sp",
  ]));
  const stopEvent = [
    "EXIT_SL",
    "EXIT_STOP",
    "EXIT_TRAIL",
    "SL_HIT",
    "STOP_EXIT",
    "TRAIL_HIT",
  ].includes(normalizedEvent);
  const stopOrderType = [
    "STOP",
    "STOP_MARKET",
    "TRAILING_STOP_MARKET",
  ].includes(orderType);

  if (executionType === "TRADE" && (stopEvent || stopOrderType || stopPrice > 0)) {
    return { ok: true, reason: "EXCHANGE_STOP_TRADE" };
  }
  return { ok: false, reason: "STOP_FILL_EVIDENCE_MISSING" };
}

function evaluateStopExitFillEvidenceGate({
  event = null,
  fullExit = null,
  exchangeEvidence = null,
} = {}) {
  const fullExitGate = resolveStopExitFullExit({ fullExit, exchangeEvidence });
  if (fullExitGate.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: fullExitGate.reason,
      issue_codes: Object.freeze([fullExitGate.reason]),
    });
  }

  const stopFillGate = resolveStopFillEvidence({ event, exchangeEvidence });
  if (stopFillGate.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: stopFillGate.reason,
      issue_codes: Object.freeze([stopFillGate.reason]),
    });
  }

  return Object.freeze({
    ok: true,
    reason: "V2_SHADOW_STOP_EXIT_FILL_EVIDENCE_READY",
    issue_codes: Object.freeze([]),
  });
}

function evaluateExternalCloseEvidenceGate({
  fullExit = null,
  exchangeEvidence = null,
} = {}) {
  const direct = parseBoolStrict(fullExit);
  if (direct === true) {
    return Object.freeze({
      ok: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_EVIDENCE_READY",
      issue_codes: Object.freeze([]),
    });
  }
  if (direct === false) {
    return Object.freeze({
      ok: false,
      reason: "FULL_EXIT_NOT_CONFIRMED",
      issue_codes: Object.freeze(["EXTERNAL_CLOSE_FULL_EXIT_NOT_CONFIRMED"]),
    });
  }

  const evidenceFlag = parseBoolStrict(pickEvidenceValue(exchangeEvidence, [
    "full_exit",
    "fullExit",
    "is_full_exit",
    "isFullExit",
    "is_final_exit",
    "isFinalExit",
    "position_closed",
    "positionClosed",
  ]));
  if (evidenceFlag === true) {
    return Object.freeze({
      ok: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_EVIDENCE_READY",
      issue_codes: Object.freeze([]),
    });
  }

  const remainingQty = toNumberOrNull(pickEvidenceValue(exchangeEvidence, [
    "position_amt_after",
    "positionAmtAfter",
    "position_qty_after",
    "positionQtyAfter",
    "remaining_position_qty_abs",
    "remainingPositionQtyAbs",
  ]));
  if (Number.isFinite(remainingQty) && Math.abs(remainingQty) <= EPSILON) {
    return Object.freeze({
      ok: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_EVIDENCE_READY",
      issue_codes: Object.freeze([]),
    });
  }

  return Object.freeze({
    ok: false,
    reason: "FULL_EXIT_NOT_CONFIRMED",
    issue_codes: Object.freeze(["EXTERNAL_CLOSE_FULL_EXIT_NOT_CONFIRMED"]),
  });
}

function evaluateStopExitRuntimeGate({
  positionCycle,
  projection,
  protectionRuntime,
} = {}) {
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : {};
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  const issues = [];

  if (upper(cycle.status) !== "ACTIVE_PROTECTED") issues.push("POSITION_NOT_ACTIVE_PROTECTED");
  if (trimOrNull(runtime.position_cycle_id) !== trimOrNull(cycle.position_cycle_id)) {
    issues.push("PROTECTION_RUNTIME_CYCLE_MISMATCH");
  }
  if (upper(runtime.health_status) === "TERMINAL_EXITED") issues.push("PROTECTION_RUNTIME_ALREADY_TERMINAL");
  if (!hasPlacedRuntimeOrder(runtime, "sl_order_id", "sl_order_status")) issues.push("SL_ORDER_MISSING");
  if (!(toNumberOrNull(runtime.native_stop_price) > 0 || toNumberOrNull(projection && projection.native_stop_price) > 0)) {
    issues.push("NATIVE_STOP_PRICE_MISSING");
  }

  return Object.freeze({
    ok: issues.length === 0,
    reason: issues[0] || "V2_SHADOW_STOP_EXIT_RUNTIME_READY",
    issue_codes: Object.freeze(issues),
  });
}

function prepareCanonicalExitAlertArtifacts({
  positionCycle,
  transition,
  projection,
} = {}) {
  const preparedAlert = prepareExitTransitionAlert({
    positionCycle,
    transition,
    projection,
  });
  return Object.freeze({
    prepared_alert: preparedAlert,
    outbox_doc: preparedAlert.outbox,
    payload: preparedAlert.payload,
    ok: preparedAlert.ok === true,
    reason: preparedAlert.reason || null,
  });
}

async function commitCanonicalExitArtifacts({
  db = null,
  env = process.env,
  transition,
  projection,
  outbox,
  protectionRuntime = null,
} = {}) {
  const writes = [
    {
      collectionKey: "CANONICAL_EXIT_TRANSITIONS",
      doc: transition,
    },
    {
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      doc: projection,
    },
    {
      collectionKey: "TRADE_ALERT_OUTBOX",
      doc: outbox,
    },
  ];
  if (protectionRuntime) {
    writes.push({
      collectionKey: "PROTECTION_RUNTIME",
      doc: protectionRuntime,
      merge: true,
    });
  }
  return putV2DocsBatch({ db, env, writes });
}

function batchWrites(result) {
  return result && Array.isArray(result.writes) ? result.writes : [];
}

async function commitReducedExitFillArtifacts({
  db = null,
  env = process.env,
  positionCycle,
  projection,
  exitFill,
  protectionRuntime = null,
  persistProtectionRuntime = true,
  resultReason,
  sendSummary = null,
} = {}) {
  const reduced = reduceV2ExitFill({
    positionCycle,
    projection,
    exitFill,
    protectionRuntime,
  });

  if (reduced.duplicate === true || !reduced.transition) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: reduced.reason || "V2_SHADOW_EXIT_FILL_DUPLICATE",
      position_cycle_id: projection && projection.position_cycle_id,
    };
  }

  const persistedOutbox = buildPersistedPreparedAlertOutbox({
    preparedAlert: reduced.alert,
  });
  const writeResult = await commitCanonicalExitArtifacts({
    db,
    env,
    transition: reduced.transition,
    projection: reduced.nextProjection,
    outbox: persistedOutbox,
    protectionRuntime: persistProtectionRuntime === true ? protectionRuntime : null,
  });

  return {
    ok: true,
    written: true,
    skipped: false,
    reason: resultReason,
    position_cycle_id: reduced.nextProjection && reduced.nextProjection.position_cycle_id,
    canonical_transition_id: reduced.transition.canonical_transition_id,
    alert_outbox_id: reduced.alert && reduced.alert.outbox && reduced.alert.outbox.alert_outbox_id,
    alert_prepare_ok: reduced.alert && reduced.alert.ok === true,
    alert_prepare_reason: reduced.alert && reduced.alert.reason,
    alert_delivery: await deliverPreparedExitTransitionAlert({
      preparedAlert: reduced.alert,
      db,
      env,
      sendSummary: sendSummary || undefined,
    }),
    write_mode: writeResult.write_mode,
    writes: batchWrites(writeResult),
  };
}

async function writeOpenClawShadowTp1Transition({
  db = null,
  env = process.env,
  exchange = "BINANCEFUT",
  symbol,
  entryEventId,
  positionSide,
  sourceFillId,
  sourceOrderId,
  fillQtyAbs,
  fillPrice = null,
  positionMeta = null,
  sendSummary = null,
} = {}) {
  const gate = resolveExitWriterGate({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  const normalizedSymbol = upper(symbol);
  const normalizedEntryEventId = trimOrNull(entryEventId);
  const normalizedPositionSide = resolvePositionSide(positionSide);
  const normalizedFillId = trimOrNull(sourceFillId);
  const normalizedOrderId = trimOrNull(sourceOrderId);
  if (!normalizedSymbol || !normalizedEntryEventId || !normalizedPositionSide || !normalizedFillId || !normalizedOrderId) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_TP1_CONTEXT_INCOMPLETE",
    };
  }

  const positionCycleId = buildPositionCycleId({
    exchange,
    symbol: normalizedSymbol,
    entryEventId: normalizedEntryEventId,
    positionSide: normalizedPositionSide,
  });

  const [positionCycleResult, projectionResult, protectionResult] = await Promise.all([
    getV2Doc({
      db,
      env,
      collectionKey: "POSITION_CYCLES",
      docId: positionCycleId,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      docId: `ERPv2__${positionCycleId}`,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "PROTECTION_RUNTIME",
      docId: `PRTV2__${positionCycleId}`,
    }),
  ]);

  if (!positionCycleResult.ok || !projectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_TP1_POSITION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }
  if (!protectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_TP1_PROTECTION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }

  const runtimeGate = evaluateTp1TransitionRuntimeGate({
    positionCycle: positionCycleResult.doc,
    protectionRuntime: protectionResult.doc,
  });
  if (runtimeGate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: `V2_SHADOW_TP1_${runtimeGate.reason}`,
      issue_codes: runtimeGate.issue_codes,
      position_cycle_id: positionCycleId,
    };
  }

  const aggregate = resolveAggregateTp1QtyAbs({
    projection: projectionResult.doc,
    fillQtyAbs,
    positionMeta,
  });
  if (aggregate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: aggregate.reason,
      position_cycle_id: positionCycleId,
    };
  }

  const result = await commitReducedExitFillArtifacts({
    db,
    env,
    positionCycle: positionCycleResult.doc,
    projection: projectionResult.doc,
    exitFill: {
      exit_kind: "TP1",
      source_fill_id: normalizedFillId,
      source_order_id: normalizedOrderId,
      fill_qty_abs: aggregate.fillQtyAbs,
      fill_price: fillPrice,
    },
    protectionRuntime: protectionResult.doc,
    persistProtectionRuntime: false,
    resultReason: "V2_SHADOW_TP1_TRANSITION_OK",
    sendSummary,
  });
  return {
    ...result,
    position_cycle_id: positionCycleId,
  };
}

async function writeOpenClawShadowTrailActivation({
  db = null,
  env = process.env,
  exchange = "BINANCEFUT",
  symbol,
  entryEventId,
  positionSide,
  sourceOrderId,
  nextStopPrice,
  nativeStopPrice = null,
  nativeRefreshStatus = "OK",
  observedAtMs = null,
  exchangeEvidence = null,
  sendSummary = null,
} = {}) {
  const gate = resolveExitWriterGate({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  const normalizedSymbol = upper(symbol);
  const normalizedEntryEventId = trimOrNull(entryEventId);
  const normalizedPositionSide = resolvePositionSide(positionSide);
  const normalizedOrderId = trimOrNull(sourceOrderId);
  const resolvedStopPrice = toNumberOrNull(nativeStopPrice) || toNumberOrNull(nextStopPrice);
  if (!normalizedSymbol || !normalizedEntryEventId || !normalizedPositionSide || !normalizedOrderId || !(resolvedStopPrice > 0)) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_TRAIL_CONTEXT_INCOMPLETE",
    };
  }

  const positionCycleId = buildPositionCycleId({
    exchange,
    symbol: normalizedSymbol,
    entryEventId: normalizedEntryEventId,
    positionSide: normalizedPositionSide,
  });

  const [positionCycleResult, projectionResult, protectionResult] = await Promise.all([
    getV2Doc({
      db,
      env,
      collectionKey: "POSITION_CYCLES",
      docId: positionCycleId,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      docId: `ERPv2__${positionCycleId}`,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "PROTECTION_RUNTIME",
      docId: `PRTV2__${positionCycleId}`,
    }),
  ]);

  if (!positionCycleResult.ok || !projectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_TRAIL_POSITION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }
  if (!protectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_TRAIL_PROTECTION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }

  const trailGate = evaluateTrailActivationProtectionGate({
    protectionRuntime: protectionResult.doc,
    nativeRefreshStatus,
    nextStopPrice: resolvedStopPrice,
  });
  if (trailGate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: `V2_SHADOW_TRAIL_${trailGate.reason}`,
      issue_codes: trailGate.issue_codes,
      position_cycle_id: positionCycleId,
    };
  }

  const reduced = reduceCanonicalExit({
    positionCycle: positionCycleResult.doc,
    projection: projectionResult.doc,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      positionCycleId,
      sourceFillId: buildTrailActivationEvidenceId({
        positionCycleId,
        sourceOrderId: normalizedOrderId,
        observedAtMs,
      }),
      sourceOrderId: normalizedOrderId,
      nextStopPrice: resolvedStopPrice,
    },
  });

  if (reduced.duplicate === true || !reduced.transition) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: reduced.reason || "V2_SHADOW_TRAIL_DUPLICATE",
      position_cycle_id: positionCycleId,
    };
  }
  const alertArtifacts = prepareCanonicalExitAlertArtifacts({
    positionCycle: positionCycleResult.doc,
    transition: reduced.transition,
    projection: reduced.nextProjection,
  });
  const persistedOutbox = buildPersistedPreparedAlertOutbox({
    preparedAlert: alertArtifacts.prepared_alert,
  });

  const evidenceSnapshot = buildExchangeEvidenceSnapshot({
    evidenceKind: "TRAIL_ACTIVATION",
    observedAtMs,
    sourceFillId: reduced.transition.source_fill_id,
    sourceOrderId: normalizedOrderId,
    rawPayload: exchangeEvidence,
  });

  const refreshStatus = upper(nativeRefreshStatus) || "OK";
  const protectionRuntime = {
    ...protectionResult.doc,
    native_stop_price: resolvedStopPrice,
    native_refresh_status: refreshStatus,
    last_refresh_at: resolveObservedAtIso(observedAtMs),
    health_status: refreshStatus === "OK"
      ? "HEALTHY"
      : (protectionResult.doc.health_status || "DEGRADED_REPAIRABLE"),
    last_exchange_evidence: evidenceSnapshot,
    last_evidence_observed_at: evidenceSnapshot.observed_at,
  };

  const writeResult = await commitCanonicalExitArtifacts({
    db,
    env,
    transition: {
      ...reduced.transition,
      source_exchange_evidence: evidenceSnapshot,
    },
    projection: reduced.nextProjection,
    outbox: persistedOutbox,
    protectionRuntime,
  });

  return {
    ok: true,
    written: true,
    skipped: false,
    reason: "V2_SHADOW_TRAIL_ACTIVATION_OK",
    position_cycle_id: positionCycleId,
    canonical_transition_id: reduced.transition.canonical_transition_id,
    alert_outbox_id: alertArtifacts.outbox_doc.alert_outbox_id,
    alert_prepare_ok: alertArtifacts.ok,
    alert_prepare_reason: alertArtifacts.reason,
    alert_delivery: await deliverPreparedExitTransitionAlert({
      preparedAlert: alertArtifacts.prepared_alert,
      db,
      env,
      sendSummary: sendSummary || undefined,
    }),
    write_mode: writeResult.write_mode,
    writes: batchWrites(writeResult),
  };
}

async function writeOpenClawShadowStopExit({
  db = null,
  env = process.env,
  exchange = "BINANCEFUT",
  symbol,
  entryEventId,
  positionSide,
  sourceFillId,
  sourceOrderId,
  fillPrice,
  event = null,
  fullExit = null,
  observedAtMs = null,
  exchangeEvidence = null,
  sendSummary = null,
} = {}) {
  const gate = resolveExitWriterGate({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  const normalizedSymbol = upper(symbol);
  const normalizedEntryEventId = trimOrNull(entryEventId);
  const normalizedPositionSide = resolvePositionSide(positionSide);
  const normalizedFillId = trimOrNull(sourceFillId);
  const normalizedOrderId = trimOrNull(sourceOrderId);
  const normalizedFillPrice = toNumberOrNull(fillPrice);
  if (!normalizedSymbol || !normalizedEntryEventId || !normalizedPositionSide || !normalizedFillId || !normalizedOrderId || !(normalizedFillPrice > 0)) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_STOP_EXIT_CONTEXT_INCOMPLETE",
    };
  }

  const positionCycleId = buildPositionCycleId({
    exchange,
    symbol: normalizedSymbol,
    entryEventId: normalizedEntryEventId,
    positionSide: normalizedPositionSide,
  });

  const [positionCycleResult, projectionResult, protectionResult] = await Promise.all([
    getV2Doc({
      db,
      env,
      collectionKey: "POSITION_CYCLES",
      docId: positionCycleId,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      docId: `ERPv2__${positionCycleId}`,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "PROTECTION_RUNTIME",
      docId: `PRTV2__${positionCycleId}`,
    }),
  ]);

  if (!positionCycleResult.ok || !projectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_STOP_EXIT_POSITION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }
  if (isTerminalProjectionStage(projectionResult.doc && projectionResult.doc.stage)) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_STOP_EXIT_ALREADY_TERMINAL",
      position_cycle_id: positionCycleId,
    };
  }
  if (!protectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_STOP_EXIT_PROTECTION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }
  const runtimeGate = evaluateStopExitRuntimeGate({
    positionCycle: positionCycleResult.doc,
    projection: projectionResult.doc,
    protectionRuntime: protectionResult.doc,
  });
  if (runtimeGate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: `V2_SHADOW_STOP_EXIT_${runtimeGate.reason}`,
      issue_codes: runtimeGate.issue_codes,
      position_cycle_id: positionCycleId,
    };
  }

  const fillEvidenceGate = evaluateStopExitFillEvidenceGate({
    event,
    fullExit,
    exchangeEvidence,
  });
  if (fillEvidenceGate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: `V2_SHADOW_STOP_EXIT_${fillEvidenceGate.reason}`,
      issue_codes: fillEvidenceGate.issue_codes,
      position_cycle_id: positionCycleId,
    };
  }

  const evidenceSnapshot = buildExchangeEvidenceSnapshot({
    evidenceKind: "STOP_EXIT",
    observedAtMs,
    sourceFillId: normalizedFillId,
    sourceOrderId: normalizedOrderId,
    rawPayload: exchangeEvidence,
  });

  const terminalHealthStatus = "TERMINAL_EXITED";
  const protectionRuntime = {
    ...protectionResult.doc,
    native_stop_price: normalizedFillPrice,
    native_refresh_status: "OK",
    last_refresh_at: resolveObservedAtIso(observedAtMs),
    health_status: terminalHealthStatus,
    last_reason: trimOrNull(event) || null,
    last_exchange_evidence: evidenceSnapshot,
    last_evidence_observed_at: evidenceSnapshot.observed_at,
  };

  const result = await commitReducedExitFillArtifacts({
    db,
    env,
    positionCycle: positionCycleResult.doc,
    projection: projectionResult.doc,
    exitFill: {
      exit_kind: "STOP",
      source_fill_id: normalizedFillId,
      source_order_id: normalizedOrderId,
      fill_price: normalizedFillPrice,
      observed_at: evidenceSnapshot.observed_at,
      raw_payload: exchangeEvidence,
    },
    protectionRuntime,
    resultReason: "V2_SHADOW_STOP_EXIT_OK",
    sendSummary,
  });
  return {
    ...result,
    position_cycle_id: positionCycleId,
  };
}

async function writeOpenClawShadowExternalClose({
  db = null,
  env = process.env,
  exchange = "BINANCEFUT",
  symbol,
  entryEventId,
  positionSide,
  sourceFillId,
  sourceOrderId,
  event = "EXIT_EXTERNAL_SYNC",
  closeKind = null,
  fullExit = null,
  observedAtMs = null,
  exchangeEvidence = null,
  sendSummary = null,
} = {}) {
  const gate = resolveExitWriterGate({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  const normalizedSymbol = upper(symbol);
  const normalizedEntryEventId = trimOrNull(entryEventId);
  const normalizedPositionSide = resolvePositionSide(positionSide);
  const normalizedFillId = trimOrNull(sourceFillId);
  const normalizedOrderId = trimOrNull(sourceOrderId) || normalizedFillId;
  const normalizedKind = upper(closeKind) || (upper(event) === "EXIT_MANUAL_SYNC" ? "MANUAL" : "EXTERNAL");
  const evidenceKind = normalizedKind === "MANUAL" ? "MANUAL_CLOSE_CONFIRMED" : "EXTERNAL_CLOSE_CONFIRMED";
  if (!normalizedSymbol || !normalizedEntryEventId || !normalizedPositionSide || !normalizedFillId || !normalizedOrderId) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_CONTEXT_INCOMPLETE",
    };
  }

  const positionCycleId = buildPositionCycleId({
    exchange,
    symbol: normalizedSymbol,
    entryEventId: normalizedEntryEventId,
    positionSide: normalizedPositionSide,
  });

  const [positionCycleResult, projectionResult, protectionResult] = await Promise.all([
    getV2Doc({
      db,
      env,
      collectionKey: "POSITION_CYCLES",
      docId: positionCycleId,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      docId: `ERPv2__${positionCycleId}`,
    }),
    getV2Doc({
      db,
      env,
      collectionKey: "PROTECTION_RUNTIME",
      docId: `PRTV2__${positionCycleId}`,
    }),
  ]);

  if (!positionCycleResult.ok || !projectionResult.ok) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_POSITION_CONTEXT_MISSING",
      position_cycle_id: positionCycleId,
    };
  }
  if (isTerminalProjectionStage(projectionResult.doc && projectionResult.doc.stage)) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_ALREADY_TERMINAL",
      position_cycle_id: positionCycleId,
    };
  }

  const evidenceGate = evaluateExternalCloseEvidenceGate({
    fullExit,
    exchangeEvidence,
  });
  if (evidenceGate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: `V2_SHADOW_EXTERNAL_CLOSE_${evidenceGate.reason}`,
      issue_codes: evidenceGate.issue_codes,
      position_cycle_id: positionCycleId,
    };
  }

  const evidenceSnapshot = buildExchangeEvidenceSnapshot({
    evidenceKind: normalizedKind === "MANUAL" ? "MANUAL_CLOSE" : "EXTERNAL_CLOSE",
    observedAtMs,
    sourceFillId: normalizedFillId,
    sourceOrderId: normalizedOrderId,
    rawPayload: exchangeEvidence,
  });

  const protectionRuntime = protectionResult.ok
    ? {
      ...protectionResult.doc,
      native_refresh_status: "OK",
      last_refresh_at: resolveObservedAtIso(observedAtMs),
      health_status: "TERMINAL_EXITED",
      last_reason: trimOrNull(event) || evidenceKind,
      last_exchange_evidence: evidenceSnapshot,
      last_evidence_observed_at: evidenceSnapshot.observed_at,
    }
    : null;

  const result = await commitReducedExitFillArtifacts({
    db,
    env,
    positionCycle: positionCycleResult.doc,
    projection: projectionResult.doc,
    exitFill: {
      exit_kind: normalizedKind,
      source_fill_id: normalizedFillId,
      source_order_id: normalizedOrderId,
      observed_at: evidenceSnapshot.observed_at,
      raw_payload: exchangeEvidence,
    },
    protectionRuntime,
    resultReason: "V2_SHADOW_EXTERNAL_CLOSE_OK",
    sendSummary,
  });
  return {
    ...result,
    position_cycle_id: positionCycleId,
  };
}

module.exports = {
  writeOpenClawShadowTp1Transition,
  writeOpenClawShadowTrailActivation,
  writeOpenClawShadowStopExit,
  writeOpenClawShadowExternalClose,
  __test: {
    resolveExitWriterGate,
    resolvePositionSide,
    resolveAggregateTp1QtyAbs,
    buildTrailActivationEvidenceId,
    isTerminalProjectionStage,
    evaluateTrailActivationProtectionGate,
    evaluateTp1TransitionRuntimeGate,
    evaluateStopExitRuntimeGate,
    evaluateStopExitFillEvidenceGate,
    evaluateExternalCloseEvidenceGate,
    prepareCanonicalExitAlertArtifacts,
    resolveObservedAtIso,
    buildExchangeEvidenceSnapshot,
  },
};
