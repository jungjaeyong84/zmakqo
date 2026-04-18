"use strict";

// nativeProtectionMetaSync.js
//
// Admin/rescue utility: reads the live Binance futures open-order set for a
// symbol, identifies the closePosition STOP_MARKET (the SL) and closePosition
// TAKE_PROFIT_MARKET orders (TP1 runner exit and optional TP0 partial), and
// writes their ids + trigger prices back into `meta.native_protection_*`.
//
// This closes a recurring meta-drift bug where real protective orders exist on
// the exchange but the position doc shows `native_protection_stop_price=null`,
// which in turn tricks the dashboard + BE-raise automation into thinking the
// position is unprotected.
//
// This does NOT place, cancel, or modify any orders on Binance. It only
// reconciles our internal meta to match what Binance already reports.

const {
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
} = require("../exchanges/binanceFuturesPrivate");
const { resolveLiveFuturesConfig } = require("../engine/paperBinanceRunner");
const { getPositionReadView } = require("./positionReadModel");
const {
  getPosition: getPaperPosition,
  upsertPositionMetaOnly,
} = require("../storage/positionsPaper");

function normalizeOrderShape(order) {
  if (!order || typeof order !== "object") return null;
  const type = String(order.type || order.origType || order.orderType || "").toUpperCase();
  const side = String(order.side || "").toUpperCase();
  const triggerRaw = order.triggerPrice ?? order.stopPrice ?? order.activatePrice;
  const triggerPrice = Number(triggerRaw);
  const orderIdRaw = order.algoId ?? order.orderId;
  const orderId = orderIdRaw == null ? null : String(orderIdRaw).trim() || null;
  const closePosition =
    order.closePosition === true
    || String(order.closePosition || "").toLowerCase() === "true";
  return {
    type,
    side,
    triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : null,
    orderId,
    closePosition,
  };
}

function classifyOrders(orders, positionSide) {
  const closeSide = String(positionSide || "").toUpperCase() === "SHORT" ? "BUY" : "SELL";
  const sl = [];
  const tpClose = [];
  const tpPartial = [];
  for (const raw of orders || []) {
    const o = normalizeOrderShape(raw);
    if (!o) continue;
    if (o.side !== closeSide) continue;
    if (!Number.isFinite(o.triggerPrice) || !o.orderId) continue;
    if (o.type === "STOP_MARKET" && o.closePosition) {
      sl.push(o);
    } else if (o.type === "TAKE_PROFIT_MARKET") {
      if (o.closePosition) tpClose.push(o);
      else tpPartial.push(o);
    }
  }
  // If multiple closePosition SLs exist (shouldn't, but defensively), pick the
  // tightest one — for SHORT that's the lowest trigger, for LONG the highest.
  const pickTightestSl = (list) => {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const asc = [...list].sort((a, b) => a.triggerPrice - b.triggerPrice);
    return String(positionSide).toUpperCase() === "SHORT" ? asc[0] : asc[asc.length - 1];
  };
  return {
    sl: pickTightestSl(sl),
    tpClose: tpClose[0] || null,
    tpPartial: tpPartial[0] || null,
  };
}

function hasPositionSize(pos) {
  const qty = Number(pos && pos.qty_base);
  const sizePct = Number(pos && pos.size_pct);
  return (Number.isFinite(qty) && qty > 0) || (Number.isFinite(sizePct) && sizePct > 0);
}

async function syncNativeProtectionMetaFromBinance({
  exchange = "BINANCEFUT",
  symbol,
} = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const exUpper = String(exchange || "").trim().toUpperCase();
  if (!sym) return { ok: false, error: "SYMBOL_REQUIRED" };
  if (exUpper !== "BINANCEFUT") return { ok: false, error: "BINANCE_ONLY" };

  const liveCfg = await resolveLiveFuturesConfig({ exchange: exUpper, symbol: sym });
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) {
    return { ok: false, error: "BINANCEFUT_KEYS_MISSING" };
  }

  const posView = await getPositionReadView({ exchange: exUpper, symbol: sym });
  const posDoc = await getPaperPosition({ exchange: exUpper, symbol: sym });
  const basePos = posView || posDoc;
  if (!basePos || !hasPositionSize(basePos)) {
    return { ok: false, error: "NO_ACTIVE_POSITION" };
  }
  const prevMeta = (basePos && typeof basePos.meta === "object" && basePos.meta) || {};
  const positionSide = String(
    basePos.position_side || prevMeta.position_side || prevMeta.external_side || ""
  ).toUpperCase();
  if (positionSide !== "LONG" && positionSide !== "SHORT") {
    return { ok: false, error: "POSITION_SIDE_UNKNOWN" };
  }

  const { apiKey, apiSecret } = liveCfg;
  let regularOrders = [];
  let algoOrders = [];
  const fetchErrors = {};
  try {
    const res = await fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: sym });
    regularOrders = Array.isArray(res) ? res : [];
  } catch (e) {
    fetchErrors.regular = e && e.message ? String(e.message) : String(e);
  }
  try {
    const res = await fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: sym });
    algoOrders = Array.isArray(res) ? res : (Array.isArray(res && res.data) ? res.data : []);
  } catch (e) {
    fetchErrors.algo = e && e.message ? String(e.message) : String(e);
  }

  if (fetchErrors.regular && fetchErrors.algo) {
    return {
      ok: false,
      error: "FETCH_ORDERS_FAILED",
      fetch_errors: fetchErrors,
    };
  }

  const allOrders = [...regularOrders, ...algoOrders];
  const { sl, tpClose, tpPartial } = classifyOrders(allOrders, positionSide);

  const nowMs = Date.now();
  const metaPatch = {
    native_protection_stop_order_id: sl ? sl.orderId : null,
    native_protection_stop_price: sl ? sl.triggerPrice : null,
    native_protection_tp_order_id: tpClose ? tpClose.orderId : null,
    native_protection_tp_price: tpClose ? tpClose.triggerPrice : null,
    native_protection_tp0_order_id: tpPartial ? tpPartial.orderId : null,
    native_protection_tp0_price: tpPartial ? tpPartial.triggerPrice : null,
    native_protection_meta_synced_at_ms: nowMs,
    native_protection_meta_synced_source: "BINANCE_ORDERS_SNAPSHOT",
    native_protection_meta_synced_regular_order_n: regularOrders.length,
    native_protection_meta_synced_algo_order_n: algoOrders.length,
  };
  const nextMeta = { ...prevMeta, ...metaPatch };

  const runId = `RUN__NATIVE_PROTECTION_META_SYNC__${exUpper}__${sym}__${nowMs}`;
  const writeTokenSource = (posDoc && Object.prototype.hasOwnProperty.call(posDoc, "position_write_token"))
    ? posDoc
    : (Object.prototype.hasOwnProperty.call(basePos, "position_write_token") ? basePos : null);
  const expectedWriteToken = writeTokenSource ? (writeTokenSource.position_write_token ?? null) : null;

  await upsertPositionMetaOnly({
    exchange: exUpper,
    symbol: sym,
    runId,
    executionMode: "LIVE",
    meta: nextMeta,
    source: "NATIVE_PROTECTION_META_SYNC",
    mutationKind: "POSITION_META_UPSERT",
    reason: "NATIVE_PROTECTION_META_SYNC_FROM_BINANCE",
    expectedWriteToken,
  });

  return {
    ok: true,
    exchange: exUpper,
    symbol: sym,
    position_side: positionSide,
    meta_patch: metaPatch,
    orders_found: {
      stop: sl ? { orderId: sl.orderId, triggerPrice: sl.triggerPrice } : null,
      tp_close: tpClose ? { orderId: tpClose.orderId, triggerPrice: tpClose.triggerPrice } : null,
      tp_partial: tpPartial ? { orderId: tpPartial.orderId, triggerPrice: tpPartial.triggerPrice } : null,
      regular_count: regularOrders.length,
      algo_count: algoOrders.length,
    },
    fetch_errors: Object.keys(fetchErrors).length ? fetchErrors : null,
  };
}

module.exports = {
  syncNativeProtectionMetaFromBinance,
  // Exported for unit tests.
  _internal: {
    normalizeOrderShape,
    classifyOrders,
  },
};
