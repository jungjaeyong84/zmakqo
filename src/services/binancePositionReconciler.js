"use strict";

const { normalizePositionSide, resolveCloseSide } = require("../utils/positionSide");
const {
  resolveTp0ContractQtyRatio,
  resolveTp1AbsoluteContractQtyRatio,
} = require("../utils/exitQtyContract");

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeAlgoOrderFetchResult(payload) {
  if (Array.isArray(payload)) return { orders: payload, endpointUnavailable: false, note: null };
  if (payload && typeof payload === "object" && payload.endpointUnavailable === true) {
    return {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      endpointUnavailable: true,
      note: String(payload.note || "ALGO_ENDPOINT_UNAVAILABLE"),
    };
  }
  return { orders: [], endpointUnavailable: false, note: null };
}

function normalizeOrderType(order) {
  return String(order && (order.type || order.origType || order.orderType || order.algoType) || "").toUpperCase();
}

function normalizeOrderTriggerPrice(order) {
  return toNum(order && (order.stopPrice || order.activatePrice || order.triggerPrice));
}

function normalizeOrderQty(order) {
  return toNum(order && (order.origQty || order.quantity || order.qty || order.executedQty));
}

function normalizeOrderId(order) {
  const raw = order && (order.orderId || order.algoId || order.clientOrderId || order.clientAlgoId);
  const text = String(raw || "").trim();
  return text || null;
}

function normalizeBool(value) {
  if (value === true || value === false) return value;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function profitableTpComparator(positionSide, a, b) {
  const side = normalizePositionSide(positionSide);
  const pa = Number(a && a.triggerPrice);
  const pb = Number(b && b.triggerPrice);
  if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0;
  if (!Number.isFinite(pa)) return 1;
  if (!Number.isFinite(pb)) return -1;
  if (side === "SHORT") return pb - pa;
  return pa - pb;
}

function pickStopCandidate(orders = [], positionSide) {
  const closeSide = resolveCloseSide(positionSide);
  const candidates = orders
    .filter((order) => {
      const type = normalizeOrderType(order);
      const side = String(order && order.side || "").toUpperCase();
      return (type === "STOP_MARKET" || type === "STOP")
        && side === closeSide
        && (normalizeBool(order && order.reduceOnly) || normalizeBool(order && order.closePosition));
    })
    .map((order) => ({
      order,
      orderId: normalizeOrderId(order),
      triggerPrice: normalizeOrderTriggerPrice(order),
    }))
    .filter((row) => row.orderId || Number.isFinite(row.triggerPrice));

  if (!candidates.length) return null;
  const side = normalizePositionSide(positionSide);
  candidates.sort((a, b) => {
    const pa = Number(a.triggerPrice);
    const pb = Number(b.triggerPrice);
    if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0;
    if (!Number.isFinite(pa)) return 1;
    if (!Number.isFinite(pb)) return -1;
    if (side === "SHORT") return pa - pb;
    return pb - pa;
  });
  return candidates[0];
}

function pickTakeProfitCandidates(orders = [], positionSide, qtyBase) {
  const closeSide = resolveCloseSide(positionSide);
  const qty = toNum(qtyBase);
  const side = normalizePositionSide(positionSide);
  return orders
    .filter((order) => {
      const type = normalizeOrderType(order);
      const orderSide = String(order && order.side || "").toUpperCase();
      return (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT")
        && orderSide === closeSide
        && normalizeBool(order && order.reduceOnly);
    })
    .map((order) => {
      const orderQty = normalizeOrderQty(order);
      const triggerPrice = normalizeOrderTriggerPrice(order);
      return {
        order,
        orderId: normalizeOrderId(order),
        qtyBase: orderQty,
        qtyRatio: Number.isFinite(orderQty) && Number.isFinite(qty) && qty > 0 ? Math.min(1, orderQty / qty) : null,
        triggerPrice,
      };
    })
    .filter((row) => row.orderId || Number.isFinite(row.triggerPrice))
    .sort((a, b) => profitableTpComparator(side, a, b));
}

function inferTakeProfitKindFromQtyRatio(qtyRatio, tp0QtyRatio = 0.25, tp1QtyRatio = 0.5) {
  const ratio = toNum(qtyRatio);
  const tp0Ref = resolveTp0ContractQtyRatio(tp0QtyRatio, 0.25);
  const tp1Ref = resolveTp1AbsoluteContractQtyRatio({
    tp0QtyRatio: tp0QtyRatio,
    tp1RemainingQtyRatio: tp1QtyRatio,
  });
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const candidates = [];
  if (Number.isFinite(tp0Ref) && tp0Ref > 0) {
    candidates.push({ kind: "TP0", dist: Math.abs(ratio - tp0Ref), ref: tp0Ref });
  }
  if (Number.isFinite(tp1Ref) && tp1Ref > 0) {
    candidates.push({ kind: "TP1", dist: Math.abs(ratio - tp1Ref), ref: tp1Ref });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  if (!Number.isFinite(best.ref) || best.ref <= 0) return null;
  if (best.dist > Math.max(0.05, best.ref * 0.4)) return null;
  return best.kind;
}

function resolveConfiguredTakeProfitQtyRatio(meta, key, fallback) {
  const baseMeta = meta && typeof meta === "object" ? meta : {};
  const rules = (baseMeta.exit_rules_override && typeof baseMeta.exit_rules_override === "object")
    ? baseMeta.exit_rules_override
    : null;
  const configured = toNum(rules && rules[key]);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(1, Math.max(configured, 0));
  }
  const fallbackNum = toNum(fallback);
  if (Number.isFinite(fallbackNum) && fallbackNum > 0) {
    return Math.min(1, Math.max(fallbackNum, 0));
  }
  return null;
}

const FLAT_META_FALSE_FIELDS = [
  "tp_p0_done",
  "tp_p1_done",
  "tp_p1_pending",
  "trail_active",
  "native_protection_stale",
  "canonical_exit_stage_relocked",
];

const FLAT_META_NULL_FIELDS = [
  "tp_p0_price",
  "tp_p0_at",
  "tp_p0_source",
  "tp_p0_qty_ratio",
  "tp_p0_entry_event_id",
  "tp_p0_entry_exec_bar_ms",
  "tp_p0_bar_ms",
  "tp_p1_price",
  "tp_p1_target_price",
  "tp_p1_at",
  "tp_p1_source",
  "tp_p1_entry_event_id",
  "tp_p1_entry_exec_bar_ms",
  "tp_p1_bar_ms",
  "tp_p1_pending_at_ms",
  "tp_p1_pending_until_ms",
  "tp_p1_pending_event",
  "tp_p1_pending_active_by_intent",
  "tp_p1_pending_cleared_at",
  "tp_p1_pending_cleared_reason",
  "tp_p1_skip_at",
  "tp_p1_skip_note",
  "tp_p1_skip_reason",
  "trail_high",
  "trail_high_at_ms",
  "trail_low",
  "trail_low_at_ms",
  "trail_stop",
  "trail_stop_by_r",
  "trail_r_multiple",
  "entry_r_distance",
  "runner_floor_stop",
  "r_based_trail_stop",
  "final_effective_stop",
  "chosen_stop_source",
  "native_protection_refresh_status",
  "native_protection_refresh_reason",
  "native_protection_refresh_context",
  "native_protection_refresh_at_ms",
  "native_protection_refresh_bar_ms",
  "native_protection_attempts",
  "native_protection_max_attempts",
  "native_protection_stop_order_id",
  "native_protection_tp0_order_id",
  "native_protection_tp_order_id",
  "native_protection_stop_price",
  "native_protection_tp0_price",
  "native_protection_tp_price",
  "native_protection_tp0_qty_base",
  "native_protection_tp_qty_base",
  "native_protection_tp0_qty_ratio",
  "native_protection_tp_qty_ratio",
  "native_protection_tp0_status",
  "native_protection_tp_status",
  "native_protection_tp0_reason",
  "native_protection_tp_reason",
  "native_protection_entry_price",
  "native_protection_side",
  "native_protection_leverage",
  "canonical_exit_stage",
  "canonical_exit_event",
  "canonical_exit_reason",
  "canonical_exit_chain_key",
  "canonical_primary_transition_event",
  "canonical_transition_events",
  "canonical_exit_blocked_invariant",
  "canonical_exit_ledger_blocked_invariant",
  "canonical_exit_ledger_issue_codes",
  "canonical_alert_event",
  "canonical_runner_remaining_abs",
  "authoritative_exit_stage",
  "authoritative_exit_chain_key",
  "authoritative_qty_reason",
  "authoritative_qty_pct_raw",
  "authoritative_qty_pct_accepted",
  "authoritative_qty_pct_dropped",
  "authoritative_qty_cap_applied",
  "authoritative_duplicate_suspected",
  "entry_qty_base",
  "entry_qty_abs",
  "tp_p0_allowed_qty_abs",
  "tp_p0_consumed_qty_abs",
  "tp_p1_allowed_qty_abs",
  "tp_p1_consumed_qty_abs",
  "runner_allowed_qty_abs",
  "runner_remaining_qty_abs",
  "trail_consumed_qty_abs",
  "total_consumed_qty_abs",
  "tp_p0_allowed_qty_ratio",
  "tp_p0_consumed_qty_ratio",
  "tp_p1_allowed_qty_ratio",
  "tp_p1_consumed_qty_ratio",
  "runner_allowed_qty_ratio",
  "runner_remaining_qty_ratio",
  "trail_consumed_qty_ratio",
  "total_consumed_qty_ratio",
  "contract_entry_qty_abs",
  "contract_tp0_allowed_abs",
  "contract_tp0_consumed_abs",
  "contract_tp1_allowed_abs",
  "contract_tp1_consumed_abs",
  "contract_runner_allowed_abs",
  "contract_runner_remaining_abs",
  "contract_trail_consumed_abs",
  "contract_observed_qty_abs",
  "contract_latest",
];

function classifyTakeProfitOrders({ orders = [], positionSide, qtyBase } = {}) {
  const candidates = pickTakeProfitCandidates(orders, positionSide, qtyBase);
  if (!candidates.length) return { tp0: null, tp1: null };
  if (candidates.length === 1) {
    const only = candidates[0];
    const inferredKind = inferTakeProfitKindFromQtyRatio(only.qtyRatio);
    if (inferredKind === "TP0") return { tp0: only, tp1: null };
    return { tp0: null, tp1: only };
  }
  let [first, second] = candidates;
  const firstLooksLikeTp1 = inferTakeProfitKindFromQtyRatio(first.qtyRatio) === "TP1";
  const secondLooksLikeTp0 = inferTakeProfitKindFromQtyRatio(second.qtyRatio) === "TP0";
  if (firstLooksLikeTp1 && secondLooksLikeTp0) {
    [first, second] = [second, first];
  }
  return { tp0: first || null, tp1: second || null };
}

function buildFlatMetaProjection(meta = {}) {
  const next = {
    ...meta,
    exchange_projection_source: "BINANCE_LIVE_STATE",
    exchange_projection_in_sync: true,
  };
  for (const field of FLAT_META_FALSE_FIELDS) next[field] = false;
  for (const field of FLAT_META_NULL_FIELDS) next[field] = null;
  return next;
}

function reconcileBinancePositionMetaWithExchange({
  active,
  meta,
  positionSide,
  qtyBase,
  entryPrice,
  leverage,
  openOrders = [],
  algoOrders = [],
} = {}) {
  const baseMeta = meta && typeof meta === "object" ? meta : {};
  if (!active) {
    return {
      meta: buildFlatMetaProjection(baseMeta),
      invariants: [],
    };
  }

  const normalizedAlgo = normalizeAlgoOrderFetchResult(algoOrders);
  const allOrders = [
    ...(Array.isArray(openOrders) ? openOrders : []),
    ...normalizedAlgo.orders,
  ];
  const stop = pickStopCandidate(allOrders, positionSide);
  const { tp0, tp1 } = classifyTakeProfitOrders({
    orders: allOrders,
    positionSide,
    qtyBase,
  });

  const nextMeta = {
    ...baseMeta,
    native_protection_refresh_status: stop ? "OK" : "MISSING",
    native_protection_refresh_reason: stop ? null : "STOP_ORDER_NOT_FOUND",
    native_protection_refresh_context: "EXCHANGE_RECONCILE",
    native_protection_stale: !stop,
    native_protection_stop_order_id: stop ? stop.orderId : null,
    native_protection_stop_price: stop && Number.isFinite(stop.triggerPrice) ? stop.triggerPrice : null,
    native_protection_entry_price: Number.isFinite(Number(entryPrice)) ? Number(entryPrice) : null,
    native_protection_side: normalizePositionSide(positionSide),
    exchange_projection_source: "BINANCE_LIVE_STATE",
    exchange_projection_in_sync: !!stop,
  };

  const side = normalizePositionSide(positionSide);
  const hasTrailObservation = side === "SHORT"
    ? Number.isFinite(Number(nextMeta.trail_low))
    : Number.isFinite(Number(nextMeta.trail_high));
  const trailObservedAtMs = side === "SHORT"
    ? Number(nextMeta.trail_low_at_ms)
    : Number(nextMeta.trail_high_at_ms);
  const tp1ObservedAtMs = Number(nextMeta.tp_p1_bar_ms) || Date.parse(String(nextMeta.tp_p1_at || ""));
  const hasFreshTrailObservation = hasTrailObservation && (
    !Number.isFinite(tp1ObservedAtMs)
    || tp1ObservedAtMs <= 0
    || (Number.isFinite(trailObservedAtMs) && trailObservedAtMs >= tp1ObservedAtMs)
  );
  if (nextMeta.tp_p1_done === true && hasFreshTrailObservation) {
    nextMeta.trail_active = true;
  }

  const invariants = [];
  if (nextMeta.tp_p1_done === true && hasTrailObservation && !hasFreshTrailObservation) {
    invariants.push("STALE_TRAIL_OBSERVATION");
  }
  if (nextMeta.trail_active === true && nextMeta.tp_p1_done !== true) {
    invariants.push("TRAIL_WITHOUT_TP1");
    nextMeta.trail_active = false;
  }

  nextMeta.native_protection_tp0_order_id = tp0 ? tp0.orderId : null;
  nextMeta.native_protection_tp_order_id = tp1 ? tp1.orderId : null;
  nextMeta.native_protection_tp0_price = tp0 && Number.isFinite(tp0.triggerPrice) ? tp0.triggerPrice : null;
  nextMeta.native_protection_tp_price = tp1 && Number.isFinite(tp1.triggerPrice) ? tp1.triggerPrice : null;
  nextMeta.native_protection_tp0_qty_base = tp0 && Number.isFinite(tp0.qtyBase) ? tp0.qtyBase : null;
  nextMeta.native_protection_tp_qty_base = tp1 && Number.isFinite(tp1.qtyBase) ? tp1.qtyBase : null;
  nextMeta.native_protection_tp0_qty_ratio = tp0
    ? resolveConfiguredTakeProfitQtyRatio(baseMeta, "TP_P0_QTY", tp0.qtyRatio)
    : null;
  nextMeta.native_protection_tp_qty_ratio = tp1
    ? resolveConfiguredTakeProfitQtyRatio(baseMeta, "TP_P1_QTY", tp1.qtyRatio)
    : null;
  nextMeta.native_protection_tp0_status = tp0 ? "OK" : null;
  nextMeta.native_protection_tp_status = tp1 ? "OK" : null;
  nextMeta.native_protection_tp0_reason = null;
  nextMeta.native_protection_tp_reason = null;

  if (!stop) invariants.push("NATIVE_STOP_MISSING");
  if ((nextMeta.tp_p1_done === true || nextMeta.trail_active === true) && (tp0 || tp1)) {
    invariants.push("TP1_DONE_WITH_TP_ORDER");
  }
  if (normalizedAlgo.endpointUnavailable) {
    invariants.push(String(normalizedAlgo.note || "ALGO_ENDPOINT_UNAVAILABLE"));
  }
  if (Number.isFinite(Number(leverage)) && Number(leverage) > 0) {
    nextMeta.native_protection_leverage = Number(leverage);
  }

  return { meta: nextMeta, invariants };
}

module.exports = {
  reconcileBinancePositionMetaWithExchange,
  inferTakeProfitKindFromQtyRatio,
  __test: {
    normalizeAlgoOrderFetchResult,
    inferTakeProfitKindFromQtyRatio,
    resolveConfiguredTakeProfitQtyRatio,
    classifyTakeProfitOrders,
    pickStopCandidate,
    buildFlatMetaProjection,
  },
};
