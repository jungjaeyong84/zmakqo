"use strict";

const { fetchBinanceFuturesAccount, fetchFuturesOpenOrders, fetchFuturesAlgoOpenOrders } = require("../exchanges/binanceFuturesPrivate");
const { resolveExitRulesForPosition, computeRunnerExitStopPrice } = require("../engine/signalEngine");
const { resolveBinanceKeys } = require("./binanceApiKeys");
const {
  getPositionRuntimeObservation,
  resolveTrailObservationSnapshot,
  __test: positionRuntimeObservationTest,
} = require("../storage/positionRuntimeObservations");
const { getPositionReadViewsBySymbols } = require("./positionReadModel");
const { resolvePositionSideFromPosition } = require("../utils/positionSide");
const { resolveTp1RemainingContractQtyRatio } = require("../utils/exitQtyContract");
const { healBinanceLivePosition } = require("./binanceLiveStateSelfHeal");
const { recordExitRepairRequest } = require("../storage/exitRepairRequests");
const { buildRepairRequestDoc } = require("../v2/contracts");
const { putV2Doc } = require("../v2/storage");
const { resolveCanonicalPositionExitStage } = require("./positionStateMachine");
const { isSimplifiedExitV2Active, buildSimplifiedExitShadowView } = require("./simplifiedExitV2");
const { isFullTpExitRatio } = require("../v2/exitPolicy");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBool(value) {
  if (value === true || value === false) return value;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function shouldAllowWatchdogMutation() {
  return false;
}

function resolveReadOnlyWatchdogRepairReason() {
  return "REPAIR_REQUESTED_NON_AUTHORITY_LAYER";
}

function normalizeOrderType(order) {
  return upper(order && (order.type || order.origType || order.orderType || order.algoType)) || "";
}

function normalizeOrderTriggerPrice(order) {
  return toNum(order && (order.stopPrice || order.activatePrice || order.triggerPrice));
}

function normalizeOrderQty(order) {
  return toNum(order && (order.origQty || order.quantity || order.qty || order.executedQty));
}

function resolveExternalMarkPrice(position = null) {
  const direct = toNum(position && (position.markPrice || position.mark_price));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const notional = toNum(position && position.notional);
  const amt = toNum(position && (position.positionAmt || position.position_amt));
  if (Number.isFinite(notional) && Number.isFinite(amt) && Math.abs(amt) > 0) {
    return Math.abs(notional / amt);
  }
  return null;
}

function normalizeOrderId(order) {
  const raw = order && (order.orderId || order.algoId || order.clientOrderId || order.clientAlgoId);
  const text = String(raw || "").trim();
  return text || null;
}

function computeCurrentProfitPct({ avgPrice, stopPrice, side, leverage }) {
  const avg = toNum(avgPrice);
  const stop = toNum(stopPrice);
  const lev = Math.max(1, toNum(leverage, 1));
  if (!(Number.isFinite(avg) && avg > 0 && Number.isFinite(stop) && stop > 0)) return null;
  const sideUpper = upper(side) === "SHORT" ? "SHORT" : "LONG";
  if (sideUpper === "SHORT") return ((avg - stop) / avg) * lev;
  return ((stop - avg) / avg) * lev;
}

function stopTolerance(value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return 1e-8;
  return Math.max(Math.abs(n) * 0.0001, 1e-8);
}

function qtyTolerance(value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return 1e-8;
  return Math.max(Math.abs(n) * 0.03, 1e-8);
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

function isExternalActivePosition(row = {}) {
  return Number(toNum(row && (row.positionAmt || row.position_amt), 0)) !== 0;
}

function isInternalActivePosition(row = {}) {
  const state = upper(row.position_state || row.state);
  const qtyBase = toNum(row.qty_base, 0);
  return qtyBase > 0 && state !== "FLAT";
}

function isSimplifiedExitV2Position(row = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  return isSimplifiedExitV2Active({
    ...row,
    meta,
  });
}

function isWatchdogTarget(row = {}) {
  if (!isInternalActivePosition(row)) return false;
  return true;
}

function resolveStage(row = {}) {
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(row);
  const canonical = resolveCanonicalPositionExitStage({
    positionSnapshot: row,
    simplifiedExitV2Enabled,
  });
  if (canonical.stage === "TRAIL") return { canonical_stage: "TRAIL", stage: "TRAIL", source: canonical.source };
  if (canonical.stage === "TP1") {
    return {
      canonical_stage: "TP1",
      stage: simplifiedExitV2Enabled ? "TP1" : "RUNNER",
      source: canonical.source,
    };
  }
  if (canonical.stage === "TP0") return { canonical_stage: canonical.stage, stage: "PRE_TP1", source: canonical.source };
  if (simplifiedExitV2Enabled) return { canonical_stage: canonical.stage, stage: "PRE_TP1", source: canonical.source };
  return { canonical_stage: canonical.stage, stage: "PRE_TP1", source: canonical.source };
}

function resolveSimplifiedV2QtyShadow(row = {}) {
  if (!isSimplifiedExitV2Position(row)) return null;
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  const rules = meta.exit_rules_override && typeof meta.exit_rules_override === "object"
    ? meta.exit_rules_override
    : {};
  const entryQtyAbs = toNum(row.entry_qty_base ?? meta.entry_qty_base ?? meta.entry_qty_abs);
  const currentQtyAbs = toNum(row.qty_base);
  const entryPrice = toNum(row.avg_price ?? meta.entry_price);
  if (!(Number.isFinite(entryQtyAbs) && entryQtyAbs > 0 && Number.isFinite(currentQtyAbs) && currentQtyAbs > 0 && Number.isFinite(entryPrice) && entryPrice > 0)) {
    return null;
  }
  const shadow = buildSimplifiedExitShadowView({
    side: resolvePositionSideFromPosition(row, meta, null),
    entryPrice,
    entryQtyAbs,
    currentQtyAbs,
    closePrice: resolveExternalMarkPrice(row) ?? entryPrice,
    tp1Done: meta.tp_p1_done === true,
    tp1FilledQtyAbs: Number.isFinite(entryQtyAbs - currentQtyAbs) ? Math.max(0, entryQtyAbs - currentQtyAbs) : null,
    trailHighPrice: toNum(meta.trail_high),
    trailLowPrice: toNum(meta.trail_low),
    currentStopPrice: toNum(meta.native_protection_stop_price),
    stopLossPct: Math.abs(toNum(rules.SL)),
    floorLockPct: toNum(rules.RUNNER_MIN_PROFIT_PCT),
    trailPct: toNum(rules.TRAIL_PCT),
    tp1QtyRatio: toNum(rules.TP_P1_QTY),
    tp1TargetPct: toNum(rules.TP_P1),
    legacyCanonicalStage: meta.canonical_exit_stage ?? meta.authoritative_exit_stage ?? null,
    legacyTp0Done: false,
  });
  return shadow && shadow.available === true ? shadow : null;
}

function groupOrdersBySymbol(orders = []) {
  const map = new Map();
  for (const row of (Array.isArray(orders) ? orders : [])) {
    const symbol = upper(row && row.symbol);
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push(row);
  }
  return map;
}

function pickStopCandidate(orders = [], positionSide) {
  const side = upper(positionSide) === "SHORT" ? "SHORT" : "LONG";
  const closeSide = side === "SHORT" ? "BUY" : "SELL";
  const candidates = (Array.isArray(orders) ? orders : [])
    .filter((order) => {
      const type = normalizeOrderType(order);
      return (type === "STOP_MARKET" || type === "STOP")
        && upper(order && order.side) === closeSide
        && (normalizeBool(order && order.reduceOnly) || normalizeBool(order && order.closePosition));
    })
    .map((order) => ({
      order,
      order_id: normalizeOrderId(order),
      trigger_price: normalizeOrderTriggerPrice(order),
    }))
    .filter((row) => row.order_id || Number.isFinite(row.trigger_price));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const pa = toNum(a.trigger_price);
    const pb = toNum(b.trigger_price);
    if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0;
    if (!Number.isFinite(pa)) return 1;
    if (!Number.isFinite(pb)) return -1;
    return side === "SHORT" ? (pa - pb) : (pb - pa);
  });
  return candidates[0];
}

function pickTpCandidate(orders = [], positionSide) {
  const side = upper(positionSide) === "SHORT" ? "SHORT" : "LONG";
  const closeSide = side === "SHORT" ? "BUY" : "SELL";
  const candidates = (Array.isArray(orders) ? orders : [])
    .filter((order) => {
      const type = normalizeOrderType(order);
      return (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT")
        && upper(order && order.side) === closeSide
        && normalizeBool(order && order.reduceOnly);
    })
    .map((order) => ({
      order,
      order_id: normalizeOrderId(order),
      trigger_price: normalizeOrderTriggerPrice(order),
      qty_base: normalizeOrderQty(order),
    }))
    .filter((row) => row.order_id || Number.isFinite(row.trigger_price) || Number.isFinite(row.qty_base));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const qa = toNum(a.qty_base);
    const qb = toNum(b.qty_base);
    if (!Number.isFinite(qa) && !Number.isFinite(qb)) return 0;
    if (!Number.isFinite(qa)) return 1;
    if (!Number.isFinite(qb)) return -1;
    return qb - qa;
  });
  return candidates[0];
}

function buildIssue(code, detail, extra = {}) {
  return {
    code: upper(code),
    detail: String(detail || "").trim(),
    ...extra,
  };
}

function inspectExitProtection({
  symbol,
  internalPosition = null,
  externalPosition = null,
  observation = null,
  openOrders = [],
  algoOrders = [],
} = {}) {
  const row = internalPosition && typeof internalPosition === "object" ? internalPosition : {};
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(row);
  const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation });
  const allOrders = [
    ...(Array.isArray(openOrders) ? openOrders : []),
    ...normalizeAlgoOrderFetchResult(algoOrders).orders,
  ];
  const positionSide = resolvePositionSideFromPosition(row, meta, null);
  const stageInfo = resolveStage(row);
  const simplifiedQtyShadow = resolveSimplifiedV2QtyShadow(row);
  const inferredTpFullMetaGap = simplifiedExitV2Enabled
    && (stageInfo.stage === "PRE_TP1" || stageInfo.source === "POSITION_STATE_MACHINE_V2_RUNNER_QTY")
    && simplifiedQtyShadow
    && simplifiedQtyShadow.economic_state === "RUNNER";
  const stage = inferredTpFullMetaGap ? "TP1" : stageInfo.stage;
  const qtyBase = toNum(row.qty_base, 0);
  const issues = [];
  const refreshStatus = upper(trailSnapshot.native_refresh_status || meta.native_protection_refresh_status);
  const stopCandidate = pickStopCandidate(allOrders, positionSide);
  const tpCandidate = pickTpCandidate(allOrders, positionSide);
  const rules = resolveExitRulesForPosition({
    exchange: upper(row.exchange) || "BINANCEFUT",
    position: row,
  });
  const expectedTp1RemainingRatio = resolveTp1RemainingContractQtyRatio(rules, 1);
  const expectedTp1Base = qtyBase > 0 ? Number((qtyBase * expectedTp1RemainingRatio).toFixed(8)) : null;
  const actualTpQtyBase = toNum(tpCandidate && tpCandidate.qty_base);
  const actualTpQtyRatio = Number.isFinite(actualTpQtyBase) && qtyBase > 0
    ? Number((actualTpQtyBase / qtyBase).toFixed(8))
    : null;
  const runnerExit = computeRunnerExitStopPrice({
    avg: toNum(row.avg_price),
    leverageEff: toNum(meta.external_leverage || meta.leverage || row.leverage || 1),
    side: positionSide,
    rules,
    tpP1Done: meta.tp_p1_done === true,
    trailActive: meta.trail_active === true,
    trailHigh: toNum(trailSnapshot.trail_high),
    trailLow: toNum(trailSnapshot.trail_low),
    entryRDistance: toNum(trailSnapshot.entry_r_distance ?? meta.entry_r_distance),
  });
  const actualStopPrice = toNum((stopCandidate && stopCandidate.trigger_price), toNum(trailSnapshot.native_stop_price ?? meta.native_protection_stop_price));
  const computedStopPrice = toNum(trailSnapshot.computed_trail_stop ?? (runnerExit && runnerExit.stopPrice));
  const floorStopPrice = toNum(trailSnapshot.runner_floor_stop ?? (runnerExit && runnerExit.runnerFloorStop));
  const trailStopByR = toNum(trailSnapshot.trail_stop_by_r ?? (runnerExit && runnerExit.trailStopByR));
  const trailRMultiple = toNum(trailSnapshot.trail_r_multiple ?? rules.TRAIL_R_MULTIPLE);
  const finalEffectiveStop = toNum(trailSnapshot.final_effective_stop ?? trailSnapshot.chosen_stop_price ?? computedStopPrice);
  const canonicalRunnerRemainingAbs = toNum(
    meta.canonical_runner_remaining_abs
    ?? meta.runner_remaining_qty_abs
    ?? meta.runner_remaining_abs
    ?? meta.contract_runner_remaining_abs
  );
  const normalizedChosenStop = positionRuntimeObservationTest.normalizeChosenStopAuthority({
    side: positionSide,
    runnerFloorStop: floorStopPrice,
    trailStopByR,
    trailStopByPct: null,
    chosenStopSource: trailSnapshot.chosen_stop_source || null,
    chosenStopPrice: trailSnapshot.chosen_stop_price ?? finalEffectiveStop ?? computedStopPrice,
  });
  const chosenStopPrice = toNum(normalizedChosenStop.chosenStopPrice ?? finalEffectiveStop ?? computedStopPrice);
  const chosenStopSource = upper(normalizedChosenStop.chosenStopSource || null);
  const expectedStopPrice = Number.isFinite(finalEffectiveStop) ? finalEffectiveStop : chosenStopPrice;
  const minGuaranteedProfitPct = toNum(rules.RUNNER_MIN_PROFIT_PCT);
  const currentGuaranteedProfitPct = computeCurrentProfitPct({
    avgPrice: toNum(row.avg_price),
    stopPrice: actualStopPrice,
    side: positionSide,
    leverage: toNum(meta.external_leverage || meta.leverage || row.leverage || 1),
  });
  const externalActive = isExternalActivePosition(externalPosition || {});
  const currentMarkPrice = resolveExternalMarkPrice(externalPosition);

  if (externalActive !== true) {
    issues.push(buildIssue("EXTERNAL_POSITION_MISSING", "내부 활성 포지션인데 거래소 실포지션이 없습니다."));
  }
  if (meta.trail_active === true && meta.tp_p1_done !== true) {
    issues.push(buildIssue("TRAIL_ACTIVE_WITHOUT_TP1_DONE", "trail_active=true 인데 tp_p1_done=false 입니다."));
  }
  if ((stage === "PRE_TP1" || stage === "TRAIL" || stage === "RUNNER")
    && (refreshStatus === "FAILED" || refreshStatus === "MISSING")) {
    issues.push(buildIssue("NATIVE_REFRESH_UNHEALTHY", `native_protection_refresh_status=${refreshStatus}`));
  }
  if (inferredTpFullMetaGap) {
    issues.push(buildIssue(
      "TP1_META_SYNC_GAP",
      `qty=${qtyBase} tp_full_shadow=${simplifiedQtyShadow.runner_qty_abs} meta still pre-TP1`,
      {
        current_qty_base: qtyBase,
        expected_tp_full_exit_qty_abs: simplifiedQtyShadow.runner_qty_abs,
        shadow_canonical_stage: simplifiedQtyShadow.canonical_stage,
      }
    ));
  }

  if (stage === "PRE_TP1") {
    if (!tpCandidate) {
      issues.push(buildIssue("TP1_ORDER_MISSING", "pre-TP1 단계인데 거래소 TP1 reduce-only 주문이 없습니다."));
    } else if (Number.isFinite(actualTpQtyRatio) && Number.isFinite(expectedTp1RemainingRatio)) {
      const ratioGap = Math.abs(actualTpQtyRatio - expectedTp1RemainingRatio);
      if (ratioGap > 0.03) {
        issues.push(buildIssue(
          "TP1_ORDER_QTY_MISMATCH",
          `actual=${actualTpQtyRatio.toFixed(4)} expected=${expectedTp1RemainingRatio.toFixed(4)}`,
          {
            actual_tp_qty_ratio: actualTpQtyRatio,
            expected_tp_qty_ratio: expectedTp1RemainingRatio,
            actual_tp_qty_base: actualTpQtyBase,
            expected_tp_qty_base: expectedTp1Base,
          }
        ));
      }
    }
  }

  if (stage === "TRAIL" || stage === "RUNNER") {
    if (!stopCandidate && !Number.isFinite(actualStopPrice)) {
      issues.push(buildIssue("TRAIL_STOP_MISSING", "runner/trail 단계인데 거래소 stop protection이 없습니다."));
    }
    if (Number.isFinite(trailRMultiple) && trailRMultiple > 0 && !Number.isFinite(trailStopByR)) {
      issues.push(buildIssue(
        "TRAIL_R_STOP_MISSING",
        `TRAIL_R_MULTIPLE=${trailRMultiple} 인데 trail_stop_by_r가 없습니다.`,
        { trail_r_multiple: trailRMultiple }
      ));
    }
    if (Number.isFinite(minGuaranteedProfitPct) && minGuaranteedProfitPct > 0 && !Number.isFinite(floorStopPrice)) {
      issues.push(buildIssue(
        "RUNNER_FLOOR_STOP_MISSING",
        `RUNNER_MIN_PROFIT_PCT=${minGuaranteedProfitPct} 인데 runner_floor_stop가 없습니다.`,
        { min_guaranteed_profit_pct: minGuaranteedProfitPct }
      ));
    }
    if (Number.isFinite(canonicalRunnerRemainingAbs) && canonicalRunnerRemainingAbs > 0 && Number.isFinite(qtyBase) && qtyBase > 0) {
      const tolerance = qtyTolerance(canonicalRunnerRemainingAbs);
      if (Math.abs(qtyBase - canonicalRunnerRemainingAbs) > tolerance) {
        issues.push(buildIssue(
          "RUNNER_REMAINING_QTY_MISMATCH",
          `qty=${qtyBase} runner_remaining=${canonicalRunnerRemainingAbs}`,
          {
            current_qty_base: qtyBase,
            expected_runner_remaining_abs: canonicalRunnerRemainingAbs,
          }
        ));
      }
    }
    if (meta.tp_p1_done === true && meta.trail_active !== true && !isFullTpExitRatio(rules && rules.TP_P1_QTY)) {
      issues.push(buildIssue("TP1_DONE_WITHOUT_TRAIL_ACTIVE", "tp_p1_done=true 인데 trail_active=false 입니다."));
    }
    const floorTolerance = stopTolerance(floorStopPrice);
    if (Number.isFinite(actualStopPrice) && Number.isFinite(floorStopPrice)) {
      const tolerance = floorTolerance;
      if (upper(positionSide) === "SHORT") {
        if (actualStopPrice > floorStopPrice + tolerance) {
          issues.push(buildIssue(
            "TRAIL_STOP_ABOVE_RUNNER_FLOOR_SHORT",
            `actual=${actualStopPrice} floor=${floorStopPrice}`,
            { actual_stop_price: actualStopPrice, expected_floor_stop_price: floorStopPrice, expected_stop_price: expectedStopPrice }
          ));
        }
      } else if (actualStopPrice < floorStopPrice - tolerance) {
        issues.push(buildIssue(
          "TRAIL_STOP_BELOW_RUNNER_FLOOR_LONG",
          `actual=${actualStopPrice} floor=${floorStopPrice}`,
          { actual_stop_price: actualStopPrice, expected_floor_stop_price: floorStopPrice, expected_stop_price: expectedStopPrice }
        ));
      }
    }
    if (Number.isFinite(actualStopPrice) && Number.isFinite(chosenStopPrice) && chosenStopSource) {
      const chosenTolerance = stopTolerance(chosenStopPrice);
      if (Math.abs(actualStopPrice - chosenStopPrice) > chosenTolerance) {
        issues.push(buildIssue(
          "TRAIL_STOP_CHOSEN_SOURCE_MISMATCH",
          `actual=${actualStopPrice} chosen=${chosenStopPrice} source=${chosenStopSource}`,
          { actual_stop_price: actualStopPrice, chosen_stop_price: chosenStopPrice, chosen_stop_source: chosenStopSource }
        ));
      }
    }
    if (Number.isFinite(currentMarkPrice) && Number.isFinite(chosenStopPrice)) {
      const chosenTolerance = stopTolerance(chosenStopPrice);
      const breached = upper(positionSide) === "SHORT"
        ? currentMarkPrice >= chosenStopPrice + chosenTolerance
        : currentMarkPrice <= chosenStopPrice - chosenTolerance;
      if (breached) {
        issues.push(buildIssue(
          "TRAIL_HARD_EXIT_MISSED",
          `mark=${currentMarkPrice} chosen=${chosenStopPrice} source=${chosenStopSource || "UNKNOWN"}`,
          {
            current_mark_price: currentMarkPrice,
            chosen_stop_price: chosenStopPrice,
            chosen_stop_source: chosenStopSource,
          }
        ));
      }
    }
    if (!chosenStopSource && Number.isFinite(trailStopByR) && Number.isFinite(floorStopPrice)) {
      const sourceTolerance = floorTolerance;
      if (Math.abs(trailStopByR - floorStopPrice) > sourceTolerance) {
        issues.push(buildIssue(
          "TRAIL_STOP_SOURCE_UNDECLARED",
          `trail_stop_by_r=${trailStopByR} floor=${floorStopPrice}`,
          { trail_stop_by_r: trailStopByR, expected_floor_stop_price: floorStopPrice }
        ));
      }
    }
    if (chosenStopSource === "TRAIL" && Number.isFinite(chosenStopPrice) && Number.isFinite(trailStopByR)) {
      const sourceTolerance = stopTolerance(trailStopByR);
      if (Math.abs(chosenStopPrice - trailStopByR) > sourceTolerance) {
        issues.push(buildIssue(
          "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT",
          `source=TRAIL chosen=${chosenStopPrice} trail_by_r=${trailStopByR}`,
          { chosen_stop_price: chosenStopPrice, trail_stop_by_r: trailStopByR, chosen_stop_source: chosenStopSource }
        ));
      }
    }
    if (chosenStopSource === "RUNNER_FLOOR" && Number.isFinite(chosenStopPrice) && Number.isFinite(floorStopPrice)) {
      const sourceTolerance = floorTolerance;
      if (Math.abs(chosenStopPrice - floorStopPrice) > sourceTolerance) {
        issues.push(buildIssue(
          "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT",
          `source=RUNNER_FLOOR chosen=${chosenStopPrice} floor=${floorStopPrice}`,
          { chosen_stop_price: chosenStopPrice, expected_floor_stop_price: floorStopPrice, chosen_stop_source: chosenStopSource }
        ));
      }
    }
    if (Number.isFinite(minGuaranteedProfitPct) && Number.isFinite(currentGuaranteedProfitPct)) {
      const floorSatisfiedWithinTolerance = Number.isFinite(actualStopPrice)
        && Number.isFinite(floorStopPrice)
        && (upper(positionSide) === "SHORT"
          ? actualStopPrice <= floorStopPrice + floorTolerance
          : actualStopPrice >= floorStopPrice - floorTolerance);
      if (!floorSatisfiedWithinTolerance && currentGuaranteedProfitPct + 1e-9 < minGuaranteedProfitPct) {
        issues.push(buildIssue(
          "RUNNER_MIN_GUARANTEE_MISSED",
          `current=${currentGuaranteedProfitPct} required=${minGuaranteedProfitPct}`,
          { current_guaranteed_profit_pct: currentGuaranteedProfitPct, min_guaranteed_profit_pct: minGuaranteedProfitPct }
        ));
      }
    }
  }

  const actionableIssues = issues.filter((issue) => !String(issue.code || "").endsWith("_ARTIFACT"));
  return {
    symbol: upper(symbol || row.symbol_or_pair_id || row.symbol),
    stage,
    canonical_stage: inferredTpFullMetaGap ? "TP1" : stageInfo.canonical_stage,
    canonical_stage_source: inferredTpFullMetaGap ? "SIMPLIFIED_V2_TP_FULL_QTY_SHADOW" : stageInfo.source,
    simplified_exit_v2_enabled: simplifiedExitV2Enabled,
    position_side: positionSide,
    qty_base: qtyBase,
    avg_price: toNum(row.avg_price),
    tp_p0_done: meta.tp_p0_done === true,
    tp_p1_done: meta.tp_p1_done === true,
    tp_p1_pending: meta.tp_p1_pending === true,
    trail_active: meta.trail_active === true,
    position_cycle_id: trimOrNull(row.position_cycle_id || meta.position_cycle_id),
    external_active: externalActive,
    native_refresh_status: refreshStatus || null,
    expected_tp1_remaining_ratio: expectedTp1RemainingRatio,
    actual_tp_qty_ratio: actualTpQtyRatio,
    expected_tp_qty_base: expectedTp1Base,
    actual_tp_qty_base: actualTpQtyBase,
    tp_order_id: tpCandidate && tpCandidate.order_id || null,
    stop_order_id: stopCandidate && stopCandidate.order_id || null,
    actual_stop_price: actualStopPrice,
    expected_stop_price: expectedStopPrice,
    computed_stop_price: computedStopPrice,
    expected_floor_stop_price: floorStopPrice,
    chosen_stop_price: chosenStopPrice,
    chosen_stop_source: chosenStopSource,
    final_effective_stop: expectedStopPrice,
    trail_stop_by_r: trailStopByR,
    trail_r_multiple: trailRMultiple,
    canonical_runner_remaining_abs: canonicalRunnerRemainingAbs,
    min_guaranteed_profit_pct: minGuaranteedProfitPct,
    current_guaranteed_profit_pct: currentGuaranteedProfitPct,
    current_mark_price: currentMarkPrice,
    simplified_exit_v2_shadow: simplifiedQtyShadow,
    issues,
    actionable_issue_n: actionableIssues.length,
    actionable_issue_codes: actionableIssues.map((issue) => issue.code),
    repairable: actionableIssues.length > 0,
  };
}

function shouldRepairIssue(row = {}) {
  const repairableCodes = new Set([
    "TP1_ORDER_MISSING",
    "TP1_ORDER_QTY_MISMATCH",
    "TRAIL_STOP_MISSING",
    "TRAIL_STOP_ABOVE_RUNNER_FLOOR_SHORT",
    "TRAIL_STOP_BELOW_RUNNER_FLOOR_LONG",
    "TRAIL_STOP_CHOSEN_SOURCE_MISMATCH",
    "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT",
    "NATIVE_REFRESH_UNHEALTHY",
    "TP1_DONE_WITHOUT_TRAIL_ACTIVE",
    "TP1_META_SYNC_GAP",
  ]);
  const codes = Array.isArray(row.actionable_issue_codes) ? row.actionable_issue_codes : [];
  return codes.some((code) => repairableCodes.has(String(code || "").trim().toUpperCase()));
}

function resolveV2RepairAction(issueCode) {
  const code = upper(issueCode);
  if (code === "TP1_ORDER_MISSING" || code === "TP1_ORDER_QTY_MISMATCH") return "ENSURE_TP1_ORDER";
  if (code === "TRAIL_STOP_MISSING" || code === "NATIVE_REFRESH_UNHEALTHY") return "REFRESH_NATIVE_STOP";
  return null;
}

function resolveV2RepairHealth(issueCode) {
  const code = upper(issueCode);
  if (code === "TRAIL_STOP_MISSING") return "DEGRADED_UNPROTECTED";
  return "DEGRADED_REPAIRABLE";
}

function normalizeV2RepairStage(stage) {
  const normalized = upper(stage);
  if (normalized === "PRE_TP1") return "PRE_TP1";
  if (normalized === "RUNNER" || normalized === "TP1" || normalized === "TP1_DONE") return "TP1_DONE";
  if (normalized === "TRAIL" || normalized === "TRAIL_ACTIVE") return "TRAIL_ACTIVE";
  return normalized || "PRE_TP1";
}

function buildWatchdogV2RepairRequests(row = {}) {
  const positionCycleId = trimOrNull(row.position_cycle_id);
  if (!positionCycleId) return Object.freeze([]);
  const codes = Array.isArray(row.actionable_issue_codes) ? row.actionable_issue_codes : [];
  const docs = [];
  for (const code of codes) {
    const issueCode = upper(code);
    const requestedAction = resolveV2RepairAction(issueCode);
    if (!requestedAction) continue;
    docs.push(buildRepairRequestDoc({
      positionCycleId,
      stage: normalizeV2RepairStage(row.stage || row.canonical_stage),
      issueCode,
      healthStatus: resolveV2RepairHealth(issueCode),
      requestedAction,
      detail: {
        requested_by_service: "BINANCE_ACTIVE_EXIT_WATCHDOG",
        source: "BINANCE_ACTIVE_EXIT_WATCHDOG",
        symbol: trimOrNull(row.symbol),
        position_side: upper(row.position_side),
        qty_base: toNum(row.qty_base),
        avg_price: toNum(row.avg_price),
        expected_tp_qty_base: toNum(row.expected_tp_qty_base),
        expected_tp1_remaining_ratio: toNum(row.expected_tp1_remaining_ratio),
        actual_tp_qty_base: toNum(row.actual_tp_qty_base),
        actual_tp_qty_ratio: toNum(row.actual_tp_qty_ratio),
        tp1_order_id: trimOrNull(row.tp_order_id),
        sl_order_id: trimOrNull(row.stop_order_id),
        native_stop_price: toNum(row.actual_stop_price),
        final_effective_stop: toNum(row.final_effective_stop),
        chosen_stop_price: toNum(row.chosen_stop_price),
        chosen_stop_source: upper(row.chosen_stop_source),
        native_refresh_status: upper(row.native_refresh_status),
        watchdog_issue_codes: Object.freeze(codes.map(upper).filter(Boolean)),
      },
    }));
  }
  return Object.freeze(docs);
}

async function persistWatchdogV2RepairRequests({
  row = {},
  env = process.env,
  db = null,
} = {}) {
  const docs = buildWatchdogV2RepairRequests(row);
  const writes = [];
  for (const doc of docs) {
    writes.push(await putV2Doc({
      db,
      env,
      collectionKey: "REPAIR_REQUESTS",
      doc,
      merge: true,
    }));
  }
  return Object.freeze({
    ok: true,
    requested_n: docs.length,
    persisted_n: writes.length,
    repair_request_ids: Object.freeze(docs.map((doc) => doc.exit_repair_request_id)),
  });
}

async function loadWatchdogSnapshot({
  exchange = "BINANCEFUT",
  fetchAccount = fetchBinanceFuturesAccount,
  fetchOpenOrders = fetchFuturesOpenOrders,
  fetchAlgoOrders = fetchFuturesAlgoOpenOrders,
  getReadViews = getPositionReadViewsBySymbols,
} = {}) {
  const keys = await resolveBinanceKeys();
  if (!keys) {
    return {
      ok: false,
      reason: "BINANCE_KEYS_MISSING",
      exchange,
      rows: [],
      active_symbol_n: 0,
    };
  }

  const account = await fetchAccount({ ...keys });
  const externalPositions = (Array.isArray(account && account.positions) ? account.positions : [])
    .filter((row) => isExternalActivePosition(row))
    .map((row) => ({
      symbol: upper(row && row.symbol),
      row,
    }))
    .filter((row) => !!row.symbol);

  const symbols = [...new Set(externalPositions.map((row) => row.symbol))];
  const readViewsBySymbol = symbols.length
    ? await getReadViews({ exchange, symbols }).catch(() => ({}))
    : {};
  const openOrdersAll = await fetchOpenOrders({ ...keys }).catch(() => []);
  const openOrdersBySymbol = groupOrdersBySymbol(openOrdersAll);

  const rows = [];
  for (const symbol of symbols) {
    const internal = readViewsBySymbol && readViewsBySymbol[symbol] ? readViewsBySymbol[symbol] : null;
    if (!internal || !isWatchdogTarget(internal)) continue;
    const algoOrders = await fetchAlgoOrders({ ...keys, symbol }).catch(() => []);
    const observation = await getPositionRuntimeObservation({ exchange, symbol }).catch(() => null);
    const reportRow = inspectExitProtection({
      symbol,
      internalPosition: internal,
      externalPosition: externalPositions.find((row) => row.symbol === symbol)?.row || null,
      observation,
      openOrders: openOrdersBySymbol.get(symbol) || [],
      algoOrders,
    });
    rows.push(reportRow);
  }

  return {
    ok: true,
    exchange,
    active_symbol_n: symbols.length,
    target_symbol_n: rows.length,
    rows,
  };
}

async function runBinanceActiveExitWatchdog({
  exchange = "BINANCEFUT",
  apply = false,
  maxRepairCount = 10,
  loadSnapshot = loadWatchdogSnapshot,
  healPosition = healBinanceLivePosition,
  persistV2RepairRequests = persistWatchdogV2RepairRequests,
  recordLegacyRepairRequest = recordExitRepairRequest,
  env = process.env,
  db = null,
} = {}) {
  const snapshot = await loadSnapshot({ exchange });
  if (!snapshot || snapshot.ok !== true) {
    return {
      ok: false,
      exchange,
      status: "ERROR",
      reason: snapshot && snapshot.reason ? snapshot.reason : "SNAPSHOT_LOAD_FAILED",
      rows: [],
      actionable_rows: [],
      repaired_rows: [],
      active_symbol_n: snapshot && snapshot.active_symbol_n || 0,
      target_symbol_n: snapshot && snapshot.target_symbol_n || 0,
      issue_symbol_n: 0,
      issue_symbols: [],
      repaired_symbol_n: 0,
      repaired_symbols: [],
      apply,
    };
  }

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const actionableRows = rows.filter((row) => Number(row.actionable_issue_n || 0) > 0);
  const repairedRows = [];
  const allowMutation = shouldAllowWatchdogMutation();

  if (apply) {
    for (const row of actionableRows) {
      if (!shouldRepairIssue(row)) continue;
      if (repairedRows.length >= Math.max(1, Number(maxRepairCount) || 10)) break;
      const runId = `RUN__ACTIVE_EXIT_WATCHDOG__${exchange}__${row.symbol}__${Date.now()}`;
      let repaired;
      if (!allowMutation) {
        repaired = await recordLegacyRepairRequest({
          exchange,
          symbol: row.symbol,
          source: "BINANCE_ACTIVE_EXIT_WATCHDOG",
          requestKind: "EXIT_PROTECTION_REPAIR",
          reason: resolveReadOnlyWatchdogRepairReason(),
          runId,
          dedupeKey: `${exchange}__${row.symbol}__WATCHDOG__EXIT_PROTECTION_REPAIR`,
          payload: {
            stage: row.stage,
            actionable_issue_codes: row.actionable_issue_codes,
          },
        }).then(() => ({
          ok: false,
          skipped: true,
          reason: resolveReadOnlyWatchdogRepairReason(),
        })).catch((error) => ({
          ok: false,
          skipped: false,
          error: error && error.message ? error.message : String(error),
        }));
        if (repaired && repaired.skipped === true && typeof persistV2RepairRequests === "function") {
          const v2Repair = await persistV2RepairRequests({
            row,
            env,
            db,
          }).catch((error) => ({
            ok: false,
            error: error && error.message ? error.message : String(error),
          }));
          repaired = {
            ...repaired,
            v2_repair_request_ok: v2Repair && v2Repair.ok === true,
            v2_repair_request_n: v2Repair && Number(v2Repair.persisted_n) || 0,
            v2_repair_request_ids: v2Repair && Array.isArray(v2Repair.repair_request_ids)
              ? v2Repair.repair_request_ids
              : [],
            v2_repair_request_error: v2Repair && v2Repair.error ? v2Repair.error : null,
          };
        }
      } else {
        repaired = await healPosition({
          exchange,
          symbol: row.symbol,
          forceRepair: true,
          runId,
        }).catch((error) => ({
          ok: false,
          error: error && error.message ? error.message : String(error),
        }));
      }
      repairedRows.push({
        symbol: row.symbol,
        stage: row.stage,
        actionable_issue_codes: row.actionable_issue_codes,
        repair_ok: repaired && repaired.ok === true,
        repair_skipped: repaired && repaired.skipped === true,
        repair_reason: repaired && repaired.reason ? repaired.reason : null,
        repair_error: repaired && repaired.error ? repaired.error : null,
        v2_repair_request_ok: repaired && repaired.v2_repair_request_ok === true,
        v2_repair_request_n: repaired && Number(repaired.v2_repair_request_n) || 0,
        v2_repair_request_ids: repaired && Array.isArray(repaired.v2_repair_request_ids)
          ? repaired.v2_repair_request_ids
          : [],
        v2_repair_request_error: repaired && repaired.v2_repair_request_error ? repaired.v2_repair_request_error : null,
      });
    }
  }

  return {
    ok: true,
    exchange,
    status: actionableRows.length > 0 ? "WARN" : "OK",
    active_symbol_n: snapshot.active_symbol_n,
    target_symbol_n: snapshot.target_symbol_n,
    issue_symbol_n: actionableRows.length,
    issue_symbols: actionableRows.map((row) => row.symbol),
    repaired_symbol_n: repairedRows.filter((row) => row.repair_ok === true).length,
    repaired_symbols: repairedRows.filter((row) => row.repair_ok === true).map((row) => row.symbol),
    apply,
    rows,
    actionable_rows: actionableRows,
    repaired_rows: repairedRows,
  };
}

module.exports = {
  runBinanceActiveExitWatchdog,
  __test: {
    isWatchdogTarget,
    resolveStage,
    inspectExitProtection,
    shouldRepairIssue,
    shouldAllowWatchdogMutation,
    resolveReadOnlyWatchdogRepairReason,
    resolveV2RepairAction,
    normalizeV2RepairStage,
    buildWatchdogV2RepairRequests,
    persistWatchdogV2RepairRequests,
    groupOrdersBySymbol,
    resolveBinanceKeys,
    loadWatchdogSnapshot,
  },
};
