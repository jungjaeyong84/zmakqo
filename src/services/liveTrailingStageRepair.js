"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesUserTrades,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
} = require("../exchanges/binanceFuturesPrivate");
const { computeRunnerExitStopPrice } = require("../engine/signalEngine");
const {
  resolveLiveFuturesConfig,
  refreshBinanceNativeProtectionWithRetry,
  buildNativeProtectionMetaPatch,
} = require("../engine/paperBinanceRunner");
const { resolveBinanceKeys } = require("./binanceApiKeys");
const { upsertTrailObservation } = require("../storage/positionRuntimeObservations");
const { getPosition, upsertPositionMetaOnly } = require("../storage/positionsPaper");
const { recordExitRepairRequest } = require("../storage/exitRepairRequests");
const { resolveCanonicalExitStageFromCycleEvidence } = require("./positionStateMachine");

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shouldEnforceSingleStopWriter() {
  const raw = String(process.env.BINANCE_EXIT_SINGLE_STOP_WRITER_ENFORCED || "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function groupTrades(trades = []) {
  const grouped = new Map();
  for (const trade of trades || []) {
    const key = [
      String(trade.orderId || "").trim(),
      String(trade.time || "").trim(),
      String(trade.side || "").trim().toUpperCase(),
    ].join("|");
    const current = grouped.get(key) || {
      orderId: trade.orderId || null,
      time: Number(trade.time) || null,
      side: String(trade.side || "").trim().toUpperCase(),
      qty: 0,
      quoteQty: 0,
      realizedPnl: 0,
      minPrice: Infinity,
      maxPrice: 0,
    };
    current.qty += Number(trade.qty) || 0;
    current.quoteQty += Number(trade.quoteQty) || 0;
    current.realizedPnl += Number(trade.realizedPnl) || 0;
    const price = Number(trade.price) || 0;
    if (price > 0) {
      current.minPrice = Math.min(current.minPrice, price);
      current.maxPrice = Math.max(current.maxPrice, price);
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      avgPrice: item.qty > 0 ? item.quoteQty / item.qty : null,
      iso: Number.isFinite(item.time) ? new Date(item.time).toISOString() : null,
    }))
    .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
}

function resolveForwardSignedQty(trade, positionSide) {
  const side = String(trade && trade.side || "").trim().toUpperCase();
  if (positionSide === "SHORT") {
    return side === "SELL" ? Number(trade.qty || 0) : -Number(trade.qty || 0);
  }
  return side === "BUY" ? Number(trade.qty || 0) : -Number(trade.qty || 0);
}

function extractActiveCycleTrades(groupedTrades, { positionQty, positionSide } = {}) {
  const currentQty = Number(positionQty);
  if (!Number.isFinite(currentQty) || currentQty <= 0) return null;
  const cycle = [];
  let balance = currentQty;
  for (let idx = groupedTrades.length - 1; idx >= 0; idx -= 1) {
    const trade = groupedTrades[idx];
    const signedQty = resolveForwardSignedQty(trade, positionSide);
    const prevBalance = balance - signedQty;
    cycle.unshift({
      ...trade,
      signedQty,
      balanceAfter: balance,
      balanceBefore: prevBalance,
    });
    balance = prevBalance;
    if (Math.abs(balance) <= 0.02) {
      return cycle;
    }
  }
  return null;
}

function inferStageFromCycle(cycleTrades, options = {}) {
  return resolveCanonicalExitStageFromCycleEvidence({
    cycleTrades,
    positionQty: options && options.positionQty,
    tp0QtyRatio: options && options.tp0QtyRatio,
    tp1QtyRatio: options && options.tp1QtyRatio,
  });
}

function buildRepairedMeta(meta = {}, stageInfo = {}) {
  const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
  const exits = Array.isArray(stageInfo.exits) ? stageInfo.exits : [];
  const tp0Trade = exits[0] || null;
  const tp1Trade = exits[1] || null;
  if (tp0Trade) {
    nextMeta.tp_p0_done = true;
    nextMeta.tp_p0_source = nextMeta.tp_p0_source || "LIVE_STAGE_REPAIR";
    nextMeta.tp_p0_price = Number.isFinite(Number(tp0Trade.avgPrice)) ? Number(tp0Trade.avgPrice) : nextMeta.tp_p0_price;
    nextMeta.tp_p0_at = tp0Trade.iso || nextMeta.tp_p0_at || null;
    nextMeta.tp_p0_bar_ms = Number.isFinite(Number(tp0Trade.time)) ? Number(tp0Trade.time) : nextMeta.tp_p0_bar_ms || null;
  }
  if (stageInfo.stage === "TRAIL" && tp1Trade) {
    nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
    nextMeta.tp_p1_pending = false;
    nextMeta.tp_p1_pending_at_ms = null;
    nextMeta.tp_p1_pending_until_ms = null;
    nextMeta.tp_p1_pending_event = null;
    nextMeta.tp_p1_source = nextMeta.tp_p1_source || "LIVE_STAGE_REPAIR";
    nextMeta.tp_p1_price = Number.isFinite(Number(tp1Trade.avgPrice)) ? Number(tp1Trade.avgPrice) : nextMeta.tp_p1_price;
    nextMeta.tp_p1_at = tp1Trade.iso || nextMeta.tp_p1_at || null;
    nextMeta.tp_p1_bar_ms = Number.isFinite(Number(tp1Trade.time)) ? Number(tp1Trade.time) : nextMeta.tp_p1_bar_ms || null;
  }
  return nextMeta;
}

async function patchPositionMetaOnlyWithRetry({
  exchange,
  symbol,
  executionMode,
  nextMeta,
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await getPosition({ exchange, symbol });
    if (!current) throw new Error(`POSITION_NOT_FOUND ${symbol}`);
    try {
      const updated = await upsertPositionMetaOnly({
        exchange,
        symbol,
        runId: `RUN__LIVE_STAGE_REPAIR__${exchange}__${symbol}__${Date.now()}`,
        executionMode: executionMode || current.execution_mode || "LIVE",
        meta: nextMeta,
        source: "LIVE_STAGE_REPAIR",
        mutationKind: "POSITION_META_UPSERT",
        reason: "LIVE_STAGE_REPAIR",
        expectedWriteToken: current.position_write_token || null,
        suppressAuthorityRuntimeFamily: true,
        suppressAuthorityRuntimeFamilyReason: "LIVE_STAGE_REPAIR",
      });
      return updated;
    } catch (err) {
      const code = String(err && (err.code || err.message) || "").toUpperCase();
      if (!code.includes("POSITION_WRITE_TOKEN_MISMATCH") || attempt >= 3) throw err;
    }
  }
  throw new Error(`POSITION_WRITE_TOKEN_MISMATCH_RETRY_EXHAUSTED ${symbol}`);
}

async function fetchOpenOrderSnapshot(keys, symbol) {
  const [openOrders, algoOrders] = await Promise.all([
    fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol }).catch(() => []),
    fetchFuturesAlgoOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol }).catch(() => []),
  ]);
  return {
    openOrders: Array.isArray(openOrders) ? openOrders : [],
    algoOrders: Array.isArray(algoOrders) ? algoOrders : [],
  };
}

async function repairLiveTrailingStageForSymbol({
  exchange = "BINANCEFUT",
  symbol,
  keys = null,
} = {}) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_REQUIRED" };
  const resolvedKeys = keys || await resolveBinanceKeys();
  if (!resolvedKeys || !resolvedKeys.apiKey || !resolvedKeys.apiSecret) {
    return { ok: false, skipped: true, reason: "BINANCE_KEYS_MISSING" };
  }
  const account = await fetchBinanceFuturesAccount(resolvedKeys);
  const accountRow = (account.positions || []).find((row) => normalizeSymbol(row && row.symbol) === sym && Number(row.positionAmt || 0) !== 0);
  if (!accountRow) return { ok: true, skipped: true, reason: "NO_EXTERNAL_ACTIVE_POSITION", symbol: sym };
  const positionAmt = Number(accountRow && accountRow.positionAmt);
  const positionSide = positionAmt < 0 ? "SHORT" : "LONG";
  const positionQty = Math.abs(positionAmt);
  const position = await getPosition({ exchange, symbol: sym });
  if (!position || String(position.state || "").toUpperCase() !== "ACTIVE") {
    return { ok: true, skipped: true, reason: "POSITION_READ_MODEL_MISSING", symbol: sym };
  }
  const meta = (position.meta && typeof position.meta === "object") ? position.meta : {};
  const rules = (meta.exit_rules_override && typeof meta.exit_rules_override === "object") ? meta.exit_rules_override : {};
  const groupedTrades = groupTrades(await fetchFuturesUserTrades({
    apiKey: resolvedKeys.apiKey,
    apiSecret: resolvedKeys.apiSecret,
    symbol: sym,
    startTime: Date.now() - (7 * 24 * 60 * 60 * 1000),
    limit: 500,
  }));
  const cycleTrades = extractActiveCycleTrades(groupedTrades, { positionQty, positionSide });
  if (!cycleTrades) return { ok: true, skipped: true, reason: "ACTIVE_CYCLE_NOT_FOUND", symbol: sym };
  const stageInfo = inferStageFromCycle(cycleTrades, {
    positionQty,
    tp0QtyRatio: toNum(rules.TP_P0_QTY) || 0.25,
    tp1QtyRatio: toNum(rules.TP_P1_QTY) || 0.5,
  });
  if (stageInfo.stage !== "TRAIL" && stageInfo.stage !== "TP0") {
    return {
      ok: true,
      skipped: true,
      reason: "STAGE_NOT_REPAIRABLE",
      symbol: sym,
      remaining_ratio: stageInfo.remainingRatio,
      exits_n: Array.isArray(stageInfo.exits) ? stageInfo.exits.length : 0,
    };
  }
  const nextMeta = buildRepairedMeta(meta, stageInfo);
  await patchPositionMetaOnlyWithRetry({
    exchange,
    symbol: sym,
    executionMode: position.execution_mode || "LIVE",
    nextMeta,
  });
  let nativeProtection = null;
  if (shouldEnforceSingleStopWriter()) {
    await recordExitRepairRequest({
      exchange,
      symbol: sym,
      source: "LIVE_TRAILING_STAGE_REPAIR",
      requestKind: "NATIVE_STOP_REFRESH",
      reason: "NON_AUTHORITY_LAYER_REQUEST",
      dedupeKey: `${exchange}__${sym}__LIVE_TRAILING_STAGE_REPAIR__NATIVE_STOP_REFRESH`,
      payload: {
        fallback_side: positionSide,
        fallback_entry_price: Number(position.avg_price),
        fallback_leverage: Number(position.leverage || meta.external_leverage || meta.leverage || 1),
        exit_rules_override: nextMeta.exit_rules_override || null,
      },
    });
    nativeProtection = {
      ok: false,
      skipped: true,
      reason: "NON_AUTHORITY_LAYER_REQUEST",
      stop_price: Number(nextMeta.native_protection_stop_price || meta.native_protection_stop_price) || null,
      stop_order_id: nextMeta.native_protection_stop_order_id || meta.native_protection_stop_order_id || null,
    };
  } else {
    const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol: sym });
    nativeProtection = await refreshBinanceNativeProtectionWithRetry({
      liveCfg,
      exchange,
      symbol: sym,
      fallbackSide: positionSide,
      fallbackEntryPrice: Number(position.avg_price),
      fallbackLeverage: Number(position.leverage || meta.external_leverage || meta.leverage || 1),
      exitRulesOverride: nextMeta.exit_rules_override || null,
      posMeta: nextMeta,
    });
  }
  const nativeProtectionMetaPatch = buildNativeProtectionMetaPatch({
    nativeProtection,
    intent: "ENTRY",
    execBarCloseMs: null,
  });
  if (nativeProtectionMetaPatch && typeof nativeProtectionMetaPatch === "object") {
    await patchPositionMetaOnlyWithRetry({
      exchange,
      symbol: sym,
      executionMode: position.execution_mode || "LIVE",
      nextMeta: {
        ...nextMeta,
        ...nativeProtectionMetaPatch,
      },
    });
  }
  const entryPrice = Number(position.avg_price);
  const leverage = Number(position.leverage || meta.external_leverage || meta.leverage || 1);
  const runnerExit = computeRunnerExitStopPrice({
    avg: entryPrice,
    leverageEff: leverage,
    side: positionSide,
    rules: nextMeta.exit_rules_override || {},
    tpP1Done: nextMeta.tp_p1_done === true,
    trailActive: nextMeta.trail_active === true,
    trailHigh: Number(nextMeta.trail_high),
    trailLow: Number(nextMeta.trail_low),
    entryRDistance: Number(nextMeta.entry_r_distance),
  });
  await upsertTrailObservation({
    exchange,
    symbol: sym,
    side: positionSide,
    entryEventId: nextMeta.entry_event_id || null,
    entryExecBarMs: Number(nextMeta.entry_exec_bar_ms) || null,
    entryPrice,
    entryRDistance: Number(nextMeta.entry_r_distance) || null,
    trailRMultiple: Number(nextMeta.trail_r_multiple || (nextMeta.exit_rules_override && nextMeta.exit_rules_override.TRAIL_R_MULTIPLE)) || null,
    trailHigh: Number(nextMeta.trail_high) || null,
    trailHighAtMs: Number(nextMeta.trail_high_at_ms) || null,
    trailLow: Number(nextMeta.trail_low) || null,
    trailLowAtMs: Number(nextMeta.trail_low_at_ms) || null,
    runnerFloorStop: Number(runnerExit && runnerExit.runnerFloorStop) || null,
    computedTrailStop: Number(runnerExit && runnerExit.stopPrice) || null,
    trailStopRaw: Number(runnerExit && runnerExit.trailStop) || null,
    trailStopByR: Number(runnerExit && runnerExit.trailStopByR) || null,
    trailStopByPct: Number(runnerExit && runnerExit.trailStopByPct) || null,
    chosenStopSource: runnerExit && runnerExit.stopSource ? runnerExit.stopSource : null,
    chosenStopPrice: Number(runnerExit && runnerExit.stopPrice) || null,
    nativeStopPrice: Number(nativeProtection && nativeProtection.stop_price) || null,
    nativeStopOrderId: nativeProtection && nativeProtection.stop_order_id ? nativeProtection.stop_order_id : null,
    nativeRefreshStatus: nativeProtection && nativeProtection.ok === true ? "OK" : String(nativeProtection && nativeProtection.reason || "FAILED"),
    lastRepriceAtMs: Date.now(),
    runtimeEvalAtMs: Date.now(),
    source: "LIVE_STAGE_REPAIR",
  });
  const orders = await fetchOpenOrderSnapshot(resolvedKeys, sym);
  return {
    ok: true,
    symbol: sym,
    stage: stageInfo.stage,
    total_entry_qty: stageInfo.totalEntryQty,
    remaining_qty: positionQty,
    remaining_ratio: stageInfo.remainingRatio,
    native_protection: nativeProtection,
    open_orders_n: orders.openOrders.length,
    algo_orders_n: orders.algoOrders.length,
    open_orders: orders.openOrders,
    algo_orders: orders.algoOrders,
  };
}

module.exports = {
  repairLiveTrailingStageForSymbol,
  __test: {
    groupTrades,
    extractActiveCycleTrades,
    inferStageFromCycle,
    buildRepairedMeta,
  },
};
