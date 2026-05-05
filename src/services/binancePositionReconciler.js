"use strict";

const { normalizePositionSide, resolveCloseSide } = require("../utils/positionSide");
const { buildExitQuantityContractLedger } = require("./positionStateMachine");
const { isSimplifiedExitV2Active, buildSimplifiedExitShadowView } = require("./simplifiedExitV2");
const {
  resolveTp0ContractQtyRatio,
  resolveTp1AbsoluteContractQtyRatio,
} = require("../utils/exitQtyContract");
const { isFullTpExitRatio } = require("../v2/exitPolicy");

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isSimplifiedExitV2Enabled(meta = {}) {
  return isSimplifiedExitV2Active(meta);
}

function isFullTpOnlyExitContractMeta(meta = {}) {
  const source = meta && typeof meta === "object" ? meta : {};
  const rules = source.exit_rules_override && typeof source.exit_rules_override === "object"
    ? source.exit_rules_override
    : {};
  const mode = String(
    source.exit_contract_mode
    || source.exitContractMode
    || rules.exit_contract_mode
    || rules.exitContractMode
    || ""
  ).trim().toUpperCase();
  if (mode === "TP_FULL_ONLY") return true;
  if (source.tp_full_only === true || source.tpFullOnly === true) return true;
  return isFullTpExitRatio(
    source.TP_P1_QTY
    ?? source.tp1_qty_ratio
    ?? source.native_protection_tp_qty_ratio
    ?? rules.TP_P1_QTY
    ?? rules.tp1_qty_ratio
  );
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

function resolveConfiguredTp1QtyRatio(meta, fallback = 0.5) {
  return resolveConfiguredTakeProfitQtyRatio(meta, "TP_P1_QTY", fallback);
}

function approxEqual(a, b, { abs = 1e-8, rel = 0.02 } = {}) {
  const left = toNum(a);
  const right = toNum(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const diff = Math.abs(left - right);
  if (diff <= abs) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return diff <= (scale * rel);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildLedgerMetaPatchFromLedger(ledger = {}) {
  return {
    entry_qty_base: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    entry_qty_abs: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    tp_p0_allowed_qty_abs: Number.isFinite(Number(ledger.tp0_allowed_abs)) ? Number(ledger.tp0_allowed_abs) : null,
    tp_p0_consumed_qty_abs: Number.isFinite(Number(ledger.tp0_consumed_abs)) ? Number(ledger.tp0_consumed_abs) : null,
    tp_p1_allowed_qty_abs: Number.isFinite(Number(ledger.tp1_allowed_abs)) ? Number(ledger.tp1_allowed_abs) : null,
    tp_p1_consumed_qty_abs: Number.isFinite(Number(ledger.tp1_consumed_abs)) ? Number(ledger.tp1_consumed_abs) : null,
    runner_allowed_qty_abs: Number.isFinite(Number(ledger.runner_allowed_abs)) ? Number(ledger.runner_allowed_abs) : null,
    runner_remaining_qty_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    canonical_runner_remaining_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    trail_consumed_qty_abs: Number.isFinite(Number(ledger.trail_consumed_abs)) ? Number(ledger.trail_consumed_abs) : null,
    total_consumed_qty_abs: (
      Number.isFinite(Number(ledger.entry_qty_abs)) && Number.isFinite(Number(ledger.total_consumed_ratio))
    ) ? (Number(ledger.entry_qty_abs) * Number(ledger.total_consumed_ratio)) : null,
    tp_p0_allowed_qty_ratio: Number.isFinite(Number(ledger.tp0_allowed_ratio)) ? Number(ledger.tp0_allowed_ratio) : null,
    tp_p0_consumed_qty_ratio: Number.isFinite(Number(ledger.tp0_consumed_ratio)) ? Number(ledger.tp0_consumed_ratio) : null,
    tp_p1_allowed_qty_ratio: Number.isFinite(Number(ledger.tp1_allowed_ratio)) ? Number(ledger.tp1_allowed_ratio) : null,
    tp_p1_consumed_qty_ratio: Number.isFinite(Number(ledger.tp1_consumed_ratio)) ? Number(ledger.tp1_consumed_ratio) : null,
    runner_allowed_qty_ratio: Number.isFinite(Number(ledger.runner_allowed_ratio)) ? Number(ledger.runner_allowed_ratio) : null,
    runner_remaining_qty_ratio: Number.isFinite(Number(ledger.runner_remaining_ratio)) ? Number(ledger.runner_remaining_ratio) : null,
    trail_consumed_qty_ratio: Number.isFinite(Number(ledger.trail_consumed_ratio)) ? Number(ledger.trail_consumed_ratio) : null,
    total_consumed_qty_ratio: Number.isFinite(Number(ledger.total_consumed_ratio)) ? Number(ledger.total_consumed_ratio) : null,
    contract_entry_qty_abs: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    contract_tp0_allowed_abs: Number.isFinite(Number(ledger.tp0_allowed_abs)) ? Number(ledger.tp0_allowed_abs) : null,
    contract_tp0_consumed_abs: Number.isFinite(Number(ledger.tp0_consumed_abs)) ? Number(ledger.tp0_consumed_abs) : null,
    contract_tp1_allowed_abs: Number.isFinite(Number(ledger.tp1_allowed_abs)) ? Number(ledger.tp1_allowed_abs) : null,
    contract_tp1_consumed_abs: Number.isFinite(Number(ledger.tp1_consumed_abs)) ? Number(ledger.tp1_consumed_abs) : null,
    contract_runner_allowed_abs: Number.isFinite(Number(ledger.runner_allowed_abs)) ? Number(ledger.runner_allowed_abs) : null,
    contract_runner_remaining_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    contract_trail_consumed_abs: Number.isFinite(Number(ledger.trail_consumed_abs)) ? Number(ledger.trail_consumed_abs) : null,
    contract_observed_qty_abs: Number.isFinite(Number(ledger.observed_qty_abs)) ? Number(ledger.observed_qty_abs) : null,
    contract_latest: true,
  };
}

function recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
  meta = {},
  positionSide = null,
  qtyBase = null,
  previousQtyBase = null,
  entryPrice = null,
  stopOrder = null,
  tpOrder = null,
  observedAtIso = new Date().toISOString(),
  // 2026-04-18 regression fix:
  //   Before: trail_active was flipped to true on recovery, but trail_high
  //   (LONG) / trail_low (SHORT) stayed null, so the next tick's trail
  //   watermark compare (price > prevHigh) couldn't fire an update until
  //   price moved far enough — and in the meantime the native stop stayed
  //   at the original SL (often below BE). The practical effect was that
  //   a recovered-TP1 runner was unprotected.
  //   Fix: seed the watermark from whichever price signal the sync call
  //   has available (markPrice → entryPrice as fallback) so the trailing
  //   loop starts from a real waterline on its very first tick.
  currentMarkPrice = null,
} = {}) {
  const baseMeta = meta && typeof meta === "object" ? meta : {};
  if (!isSimplifiedExitV2Enabled(baseMeta)) return null;
  if (isFullTpOnlyExitContractMeta(baseMeta)) return null;
  if (baseMeta.tp_p1_done === true || baseMeta.trail_active === true) return null;
  if (tpOrder || !stopOrder) return null;

  const currentQty = toNum(qtyBase);
  const persistedEntryQty = toNum(
    baseMeta.entry_qty_base
    ?? baseMeta.entry_qty_abs
    ?? baseMeta.contract_entry_qty_abs
  );
  const previousQty = toNum(previousQtyBase);
  const inferredEntryQty = Number.isFinite(persistedEntryQty) && persistedEntryQty > currentQty
    ? persistedEntryQty
    : previousQty;
  if (!(Number.isFinite(currentQty) && currentQty > 0 && Number.isFinite(inferredEntryQty) && inferredEntryQty > currentQty)) {
    return null;
  }

  const rules = (baseMeta.exit_rules_override && typeof baseMeta.exit_rules_override === "object")
    ? baseMeta.exit_rules_override
    : {};
  const shadow = buildSimplifiedExitShadowView({
    side: normalizePositionSide(positionSide),
    entryPrice: toNum(entryPrice),
    entryQtyAbs: inferredEntryQty,
    currentQtyAbs: currentQty,
    closePrice: toNum(entryPrice),
    tp1Done: false,
    tp1FilledQtyAbs: Math.max(0, inferredEntryQty - currentQty),
    stopLossPct: Math.abs(toNum(rules.SL)),
    floorLockPct: toNum(rules.RUNNER_MIN_PROFIT_PCT),
    trailPct: toNum(rules.TRAIL_PCT),
    tp1QtyRatio: resolveConfiguredTp1QtyRatio(baseMeta, 1),
    tp1TargetPct: toNum(rules.TP_P1),
    legacyCanonicalStage: baseMeta.canonical_exit_stage ?? baseMeta.authoritative_exit_stage ?? null,
    legacyTp0Done: false,
  });
  if (!shadow || shadow.available !== true || shadow.tp1_complete !== true || shadow.economic_state !== "RUNNER") {
    return null;
  }
  if (!approxEqual(currentQty, shadow.runner_remaining_qty_abs) || !approxEqual(inferredEntryQty - currentQty, shadow.tp1_filled_qty_abs)) {
    return null;
  }

  // Seed trail watermark so the next tick can start trailing from a real
  // waterline. Priority: current mark price → entry price. If both are
  // null / zero / non-finite we leave the watermark null and accept one
  // more tick of unprotected-ness — better than seeding with a stale
  // guess.
  //
  // Note on toNum(): Number(null) === 0 in JS, so the raw `??` chain
  // doesn't work here (it treats 0 as valid). Explicit positivity check.
  const sideUpper = String(positionSide || "").toUpperCase();
  const markNum = currentMarkPrice == null ? null : toNum(currentMarkPrice);
  const entryNum = entryPrice == null ? null : toNum(entryPrice);
  const seedPrice = (Number.isFinite(markNum) && markNum > 0)
    ? markNum
    : ((Number.isFinite(entryNum) && entryNum > 0) ? entryNum : null);
  // 2026-04-19 PR #12 same-class boundary fix (SHORT trail_low=0 seeding):
  //
  // 과거 구현은 `Number.isFinite(toNum(baseMeta.trail_low))` 로 기존
  // watermark 유효성을 판단했는데, `baseMeta.trail_low === null` 이면
  // `toNum(null) === 0` 이 되어 finite 로 통과하고, 이어지는
  // `Math.min(0, seedPrice) === 0` 이 SHORT 포지션의 trail_low 를 영
  // 으로 seed 해버린다.  이는 정확히 PR #8 이 막았던 "SHORT trail_low=0
  // 상태에서 price < prevLow 가드가 영영 false" 재-도입 경로.
  //
  // writer-side (PR #10 schema) + read-side (PR #11 BE-raise) 와 같은
  // 패턴으로, **양수 finite 만 기존 watermark 로 인정** 하도록 수정.
  // 0/null/NaN 이면 seedPrice 로 새로 출발 — PR #8 의 helper 와 동일한
  // "prev<=0 은 uninitialized 취급" 원칙.
  const existingTrailHigh = toNum(baseMeta.trail_high);
  const existingTrailLow = toNum(baseMeta.trail_low);
  const existingTrailHighValid = Number.isFinite(existingTrailHigh) && existingTrailHigh > 0;
  const existingTrailLowValid = Number.isFinite(existingTrailLow) && existingTrailLow > 0;
  const seedPriceValid = Number.isFinite(seedPrice) && seedPrice > 0;
  // "내 side" 분기는 same-class 버그 수정 대상 — 양수 finite 기존값만
  // 유효로 인정.  "반대 side" 분기는 기존값을 그대로 보존 (blast radius
  // 최소화 — 이 리코실 호출은 주로 post-TP1 recovery 경로라 반대 side
  // watermark 는 원래 쓰이지 않는다).
  const seededTrailHigh = sideUpper === "LONG" && seedPriceValid
    ? (existingTrailHighValid ? Math.max(existingTrailHigh, seedPrice) : seedPrice)
    : (baseMeta.trail_high ?? null);
  const seededTrailLow = sideUpper === "SHORT" && seedPriceValid
    ? (existingTrailLowValid ? Math.min(existingTrailLow, seedPrice) : seedPrice)
    : (baseMeta.trail_low ?? null);
  const seededTrailAtMs = seedPriceValid
    ? Date.now()
    : (baseMeta.trail_high_at_ms || baseMeta.trail_low_at_ms || null);

  const nextMeta = {
    ...baseMeta,
    tp_p0_done: false,
    tp_p1_done: true,
    trail_active: true,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_source: baseMeta.tp_p1_source || "EXCHANGE_QTY_REDUCTION_RECOVERY",
    tp_p1_at: baseMeta.tp_p1_at || observedAtIso,
    tp_p1_bar_ms: finiteOrNull(baseMeta.tp_p1_bar_ms)
      ?? (Date.parse(String(observedAtIso || "")) || null),
    tp_p1_entry_event_id: baseMeta.tp_p1_entry_event_id || baseMeta.entry_event_id || baseMeta.origin_entry_event_id || null,
    tp_p1_entry_exec_bar_ms: finiteOrNull(baseMeta.tp_p1_entry_exec_bar_ms)
      ?? finiteOrNull(baseMeta.entry_exec_bar_ms)
      ?? finiteOrNull(baseMeta.origin_entry_exec_bar_ms),
    entry_qty_base: inferredEntryQty,
    entry_qty_abs: inferredEntryQty,
    // trail watermark seed (Fix #2, 2026-04-18)
    trail_high: seededTrailHigh,
    trail_low: seededTrailLow,
    trail_high_at_ms: sideUpper === "LONG" ? seededTrailAtMs : (baseMeta.trail_high_at_ms ?? null),
    trail_low_at_ms: sideUpper === "SHORT" ? seededTrailAtMs : (baseMeta.trail_low_at_ms ?? null),
    // Recovery marker — downstream callers (paperBinanceRunner sync) use
    // this to detect the transition and dispatch a late trade-exec alert
    // so operators are never blind to a TP1 fill again.
    tp_p1_recovery_trigger: baseMeta.tp_p1_recovery_trigger
      || "EXCHANGE_QTY_REDUCTION_RECOVERY",
    tp_p1_recovery_seeded_price: Number.isFinite(seedPrice) && seedPrice > 0 ? seedPrice : null,
    tp_p1_recovery_observed_at: observedAtIso,
  };
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: currentQty,
      entry_qty_base: inferredEntryQty,
      meta: nextMeta,
      position_side: positionSide,
    },
    rules,
  });
  return {
    meta: {
      ...nextMeta,
      ...buildLedgerMetaPatchFromLedger(ledger),
    },
    shadow,
  };
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

function classifyTakeProfitOrders({ orders = [], positionSide, qtyBase, meta = {} } = {}) {
  const candidates = pickTakeProfitCandidates(orders, positionSide, qtyBase);
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled(meta);
  if (!candidates.length) {
    return {
      tp0: null,
      tp1: null,
      simplifiedExitV2Enabled,
      unexpectedTpOrders: [],
    };
  }
  if (simplifiedExitV2Enabled) {
    const configuredTp1QtyRatio = resolveConfiguredTp1QtyRatio(meta, 1);
    const [tp1] = [...candidates].sort((a, b) => {
      const aDist = Number.isFinite(a.qtyRatio) && Number.isFinite(configuredTp1QtyRatio)
        ? Math.abs(a.qtyRatio - configuredTp1QtyRatio)
        : Number.POSITIVE_INFINITY;
      const bDist = Number.isFinite(b.qtyRatio) && Number.isFinite(configuredTp1QtyRatio)
        ? Math.abs(b.qtyRatio - configuredTp1QtyRatio)
        : Number.POSITIVE_INFINITY;
      if (aDist !== bDist) return aDist - bDist;
      return 0;
    });
    const unexpectedTpOrders = candidates.filter((row) => row.orderId !== (tp1 && tp1.orderId));
    return {
      tp0: null,
      tp1: tp1 || null,
      simplifiedExitV2Enabled,
      unexpectedTpOrders,
    };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    const inferredKind = inferTakeProfitKindFromQtyRatio(only.qtyRatio);
    if (inferredKind === "TP0") {
      return { tp0: only, tp1: null, simplifiedExitV2Enabled, unexpectedTpOrders: [] };
    }
    return { tp0: null, tp1: only, simplifiedExitV2Enabled, unexpectedTpOrders: [] };
  }
  let [first, second] = candidates;
  const firstLooksLikeTp1 = inferTakeProfitKindFromQtyRatio(first.qtyRatio) === "TP1";
  const secondLooksLikeTp0 = inferTakeProfitKindFromQtyRatio(second.qtyRatio) === "TP0";
  if (firstLooksLikeTp1 && secondLooksLikeTp0) {
    [first, second] = [second, first];
  }
  return {
    tp0: first || null,
    tp1: second || null,
    simplifiedExitV2Enabled,
    unexpectedTpOrders: candidates.slice(2),
  };
}

// P3-04: when Binance reports qty=0 but internal meta had an active trail,
// the FLAT projection erases the canonical context before the trail-final
// fill can be processed. We preserve a forensic "frozen" snapshot so the
// alert / canonical transition layer can still classify the final fill as
// TRAIL_FINAL_EXIT instead of EXIT_EXTERNAL_SYNC when fills arrive late.
// The operational alert emitted here lets ops correlate with the source
// WebSocket gap or reconciler-first race.
const FLAT_META_FROZEN_TRAIL_FIELDS = Object.freeze([
  "canonical_exit_stage",
  "canonical_exit_chain_key",
  "trail_active",
  "trail_high",
  "trail_low",
  "trail_stop_by_r",
  "trail_stop_by_pct",
  "runner_remaining_qty_abs",
]);

function buildFrozenTrailContext(meta = {}, { nowIso = new Date().toISOString() } = {}) {
  if (!meta || typeof meta !== "object") return null;
  if (meta.trail_active !== true) return null;
  const frozen = { frozen_trail_context_at: nowIso };
  for (const field of FLAT_META_FROZEN_TRAIL_FIELDS) {
    if (meta[field] !== undefined) frozen[`frozen_${field}`] = meta[field];
  }
  return frozen;
}

function emitFlatProjectionTrailContextLostAlert(meta = {}) {
  if (!meta || meta.trail_active !== true) return false;
  console.warn("[RECONCILER_FLAT_PROJECTION_TRAIL_CONTEXT_LOST]", JSON.stringify({
    canonical_exit_chain_key: meta.canonical_exit_chain_key || null,
    canonical_exit_stage: meta.canonical_exit_stage || null,
    runner_remaining_qty_abs: Number.isFinite(Number(meta.runner_remaining_qty_abs))
      ? Number(meta.runner_remaining_qty_abs)
      : null,
    at: new Date().toISOString(),
  }));
  return true;
}

// 2026-04-27 Stage L → V — senior audit caught LINKUSDT staying DB-active +
// exchange-flat for 30+ minutes earlier today. Stage L's first cut keyed
// the staleness clock off `native_protection_refresh_at_ms`, but that
// field gets nulled the moment buildFlatMetaProjection runs once — so a
// second reconciler pass would have no baseline to measure against and
// every subsequent stale window would silently pass through. Stage V
// adds an immortal `flat_first_observed_at_ms` baseline that survives
// cleanups (whitelisted from FLAT_META_NULL_FIELDS) and resets only when
// the position re-confirms active again. The emitter now prefers that
// field, falls back to native_protection_refresh_at_ms for the very
// first flat pass, and stamps `flat_first_observed_at_ms` for the next
// pass to find.
//
// 안전 계약:
//   - threshold env: `RECONCILER_FLAT_STALE_THRESHOLD_MS` (default 30min).
//   - kill switch: `RECONCILER_FLAT_STALE_OBSERVE=0`.
//   - emit 자체가 throw 해도 swallow (best-effort).
//   - 후보 값 (refresh timestamp) 누락 시 silent (false negative 허용).
//   - `flat_first_observed_at_ms` 가 있으면 그것을 baseline 으로 사용
//     (multi-pass 누적 추적). 없으면 native_protection_refresh_at_ms
//     fallback (Stage L 호환).
function emitFlatStaleThresholdBreachAlert(meta = {}, {
  now = Date.now(),
  thresholdMs = Number(process.env.RECONCILER_FLAT_STALE_THRESHOLD_MS) || (30 * 60 * 1000),
  observe = String(process.env.RECONCILER_FLAT_STALE_OBSERVE ?? "1").trim() !== "0",
  emit = (line) => console.warn("[RECONCILER_FLAT_STALE_BREACH]", line),
} = {}) {
  if (!observe) return false;
  if (!meta || typeof meta !== "object") return false;
  const firstFlatAtMs = Number(meta.flat_first_observed_at_ms);
  const previousRefreshAtMs = Number(meta.native_protection_refresh_at_ms);
  let baselineMs = null;
  let baselineSource = null;
  if (Number.isFinite(firstFlatAtMs) && firstFlatAtMs > 0) {
    baselineMs = firstFlatAtMs;
    baselineSource = "FLAT_FIRST_OBSERVED_AT_MS";
  } else if (Number.isFinite(previousRefreshAtMs) && previousRefreshAtMs > 0) {
    baselineMs = previousRefreshAtMs;
    baselineSource = "NATIVE_PROTECTION_REFRESH_AT_MS";
  }
  if (baselineMs === null) return false;
  const ageMs = Number(now) - baselineMs;
  if (!Number.isFinite(ageMs) || ageMs < thresholdMs) return false;
  try {
    emit(JSON.stringify({
      event: "reconciler_flat_stale_breach",
      symbol: meta.symbol || meta.market || null,
      position_side: meta.position_side || meta.native_protection_side || null,
      baseline_source: baselineSource,
      baseline_at_ms: baselineMs,
      stale_age_ms: ageMs,
      threshold_ms: thresholdMs,
      observed_at: new Date(Number(now)).toISOString(),
    }));
  } catch (_) { /* surveillance must never throw */ }
  return true;
}

function buildFlatMetaProjection(meta = {}, { nowMs = Date.now() } = {}) {
  const frozen = buildFrozenTrailContext(meta);
  if (frozen) emitFlatProjectionTrailContextLostAlert(meta);
  emitFlatStaleThresholdBreachAlert(meta, { now: nowMs });
  // Stage V — preserve `flat_first_observed_at_ms` across cleanups. If
  // the previous projection already stamped it, keep the original. On
  // the first flat pass we inherit `native_protection_refresh_at_ms`
  // (the last active confirm timestamp) — it's the best lower-bound on
  // when the position actually went flat. Falls back to `nowMs` only if
  // the refresh timestamp is missing (defensive: still gives the next
  // pass *some* baseline to accumulate staleness from).
  const existingFirstFlat = Number(meta && meta.flat_first_observed_at_ms);
  const previousRefreshAtMs = Number(meta && meta.native_protection_refresh_at_ms);
  let flatFirstObservedAtMs;
  if (Number.isFinite(existingFirstFlat) && existingFirstFlat > 0) {
    flatFirstObservedAtMs = existingFirstFlat;
  } else if (Number.isFinite(previousRefreshAtMs) && previousRefreshAtMs > 0) {
    flatFirstObservedAtMs = previousRefreshAtMs;
  } else {
    flatFirstObservedAtMs = nowMs;
  }
  const next = {
    ...meta,
    exchange_projection_source: "BINANCE_LIVE_STATE",
    exchange_projection_in_sync: true,
  };
  for (const field of FLAT_META_FALSE_FIELDS) next[field] = false;
  for (const field of FLAT_META_NULL_FIELDS) next[field] = null;
  if (frozen) Object.assign(next, frozen);
  // Stamp AFTER the cleanup so it survives the field nulling loop.
  next.flat_first_observed_at_ms = flatFirstObservedAtMs;
  return next;
}

function reconcileBinancePositionMetaWithExchange({
  active,
  meta,
  positionSide,
  qtyBase,
  previousQtyBase = null,
  entryPrice,
  leverage,
  openOrders = [],
  algoOrders = [],
  // Optional: current mark price from the Binance /fapi/v2/account snapshot.
  // When provided the qty-reduction-recovery path uses it to seed the
  // trail watermark (trail_high / trail_low) so the next tick can start
  // trailing from a real waterline instead of sitting at null.
  markPrice = null,
} = {}) {
  const baseMeta = meta && typeof meta === "object" ? meta : {};
  const fullTpOnly = isFullTpOnlyExitContractMeta(baseMeta);
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
  const {
    tp0,
    tp1,
    simplifiedExitV2Enabled,
    unexpectedTpOrders = [],
  } = classifyTakeProfitOrders({
    orders: allOrders,
    positionSide,
    qtyBase,
    meta: baseMeta,
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
    // Stage V — clear `flat_first_observed_at_ms` once the position is
    // confirmed active again so the next flat episode starts a fresh
    // staleness clock instead of inheriting an old one.
    flat_first_observed_at_ms: null,
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
  if (!fullTpOnly && nextMeta.tp_p1_done === true && hasFreshTrailObservation) {
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

  const qtyReductionRecovery = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
    meta: nextMeta,
    positionSide,
    qtyBase,
    previousQtyBase,
    entryPrice,
    stopOrder: stop,
    tpOrder: tp1,
    // markPrice flows through from reconcileBinancePositionMetaWithExchange's
    // opts so the recovery helper can seed trail_high / trail_low with a
    // real waterline instead of null.
    currentMarkPrice: Number.isFinite(Number(markPrice)) ? Number(markPrice) : null,
  });
  if (qtyReductionRecovery && qtyReductionRecovery.meta) {
    Object.assign(nextMeta, qtyReductionRecovery.meta);
  }

  if (simplifiedExitV2Enabled) {
    // Stamp the resolved policy onto reconciled meta. Without this, positions
    // entered before the env-fallback was needed (or fetched fresh from the
    // exchange) carry an undefined flag, and downstream consumers that read
    // meta directly (rather than going through isSimplifiedExitV2Active) treat
    // them as legacy two-TP positions.
    nextMeta.simplified_exit_v2_enabled = true;
    nextMeta.tp_p0_done = false;
    nextMeta.tp_p0_at = null;
    nextMeta.tp_p0_price = null;
    nextMeta.tp_p0_source = null;
    nextMeta.native_protection_tp0_order_id = null;
    nextMeta.native_protection_tp0_price = null;
    nextMeta.native_protection_tp0_qty_base = null;
    nextMeta.native_protection_tp0_qty_ratio = null;
    nextMeta.native_protection_tp0_status = null;
    nextMeta.native_protection_tp0_reason = null;
    if (fullTpOnly) {
      nextMeta.exit_contract_mode = nextMeta.exit_contract_mode || "TP_FULL_ONLY";
      nextMeta.tp_full_only = true;
      nextMeta.trail_active = false;
      nextMeta.trail_high = null;
      nextMeta.trail_low = null;
      nextMeta.trail_high_at_ms = null;
      nextMeta.trail_low_at_ms = null;
      nextMeta.runner_remaining_qty_abs = 0;
    }
  }

  if (!stop) invariants.push("NATIVE_STOP_MISSING");
  if (simplifiedExitV2Enabled && unexpectedTpOrders.length > 0) {
    invariants.push("SIMPLIFIED_EXIT_V2_MULTIPLE_TP_ORDERS");
  }
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
    recoverSimplifiedExitV2RunnerMetaFromQtyReduction,
    pickStopCandidate,
    buildFlatMetaProjection,
    buildFrozenTrailContext,
    emitFlatProjectionTrailContextLostAlert,
    emitFlatStaleThresholdBreachAlert,
    FLAT_META_FROZEN_TRAIL_FIELDS,
  },
};
