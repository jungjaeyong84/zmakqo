"use strict";

// Maker-first entry execution for Binance Futures.
//
// Motivation
// ----------
// Every entry we used to route through `placeFuturesMarketOrder` pays the
// taker fee (0.04% by default on Binance USDT-M futures) PLUS slippage on
// thin books. Signal cadence is ~15m; we are not in a rush to fill on any
// given bar. Capturing the maker rebate (+0.02% rebate instead of -0.04%
// taker) plus avoiding cross-the-spread slippage is worth ~0.4–0.6% on
// average across a month, comfortably above the added latency cost.
//
// Strategy
// --------
// 1. Fetch bookTicker (best bid / best ask).
// 2. Place a LIMIT order with timeInForce=GTX (post-only):
//      BUY  → price = bestBid      (rests on the bid — maker)
//      SELL → price = bestAsk      (rests on the ask — maker)
//    GTX means Binance *rejects* the order (-5022) if it would cross. That
//    rejection is the guard: if we can't be a maker right now, we skip
//    the limit step entirely and take the market.
// 3. Poll the order's status for up to `timeoutMs` (default 3s):
//      - FILLED                    → done, pocket the rebate + no slippage.
//      - PARTIALLY_FILLED at end   → cancel remainder, market-fill the rest.
//      - unfilled                  → cancel, market-fill full qty.
// 4. Any error at any point (network, API, cancel race) falls back to a
//    plain market order so we never *miss* a signal because of this path.
//
// Output shape
// ------------
// Returns an object that looks enough like a raw Binance order response
// that downstream code (calcAveragePrice, executedQty, orderId) keeps
// working unchanged, plus a `makerFirst` section with telemetry:
//   {
//     orderId, clientOrderId, status, executedQty, origQty, avgPrice, side,
//     makerFirst: {
//       mode: "MAKER_FILLED" | "MAKER_PARTIAL_MARKET" | "MARKET_FALLBACK" |
//             "MARKET_POST_ONLY_REJECTED" | "MARKET_DISABLED" |
//             "MARKET_BOOK_UNAVAILABLE" | "MARKET_ERROR",
//       bookBid, bookAsk, limitPrice, limitOrderId, limitExecutedQty,
//       marketOrderId, marketExecutedQty, refPrice,
//       elapsedMs, savingsBps
//     }
//   }
//
// Env flags
// ---------
//   ENTRY_MAKER_FIRST_ENABLED=1        - master switch (default 0)
//   ENTRY_MAKER_TIMEOUT_MS=3000        - how long to wait for the limit fill
//   ENTRY_MAKER_POLL_INTERVAL_MS=400   - fetchOrder cadence during wait

const {
  placeFuturesMarketOrder,
  placeFuturesLimitOrder,
  cancelFuturesOrder,
  fetchFuturesOrder,
  fetchFuturesBookTicker,
  fetchFuturesExchangeInfo,
  calcAveragePrice,
  __test: primitiveTestHelpers,
} = require("../exchanges/binanceFuturesPrivate");

const { isPostOnlyRejectError, isUnknownOrderError } = primitiveTestHelpers;

function envBool(name, fallback) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim();
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function envInt(name, fallback, { min = 0, max = 600000 } = {}) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isMakerFirstEnabled() {
  return envBool("ENTRY_MAKER_FIRST_ENABLED", false);
}

function resolveTimeoutMs() {
  return envInt("ENTRY_MAKER_TIMEOUT_MS", 3000, { min: 500, max: 30000 });
}

function resolvePollIntervalMs() {
  return envInt("ENTRY_MAKER_POLL_INTERVAL_MS", 400, { min: 100, max: 5000 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}

function sideToUpper(side) {
  const s = String(side || "").toUpperCase();
  return s === "BUY" || s === "SELL" ? s : null;
}

// Pull executedQty out of whatever shape the Binance REST response uses.
// Binance variously returns executedQty / executed_qty / origQty on different
// endpoints (POST vs GET), and some egress proxy layers JSON-stringify
// numbers, so be defensive.
function readExecutedQty(order) {
  if (!order) return 0;
  const raw = order.executedQty ?? order.executed_qty ?? order.cumQuote ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readOrigQty(order) {
  if (!order) return 0;
  const raw = order.origQty ?? order.orig_qty ?? order.quantity ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readOrderStatus(order) {
  if (!order) return null;
  return String(order.status || order.orderStatus || "").toUpperCase() || null;
}

function isOrderTerminal(status) {
  // FILLED / CANCELED / REJECTED / EXPIRED all mean Binance will not fill
  // this order any further; stop polling.
  return status === "FILLED"
    || status === "CANCELED"
    || status === "CANCELLED"
    || status === "REJECTED"
    || status === "EXPIRED";
}

function qtyApproxEqual(a, b, epsilon) {
  const av = Number(a);
  const bv = Number(b);
  const eps = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 1e-8;
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
  return Math.abs(av - bv) <= eps;
}

// Reported savings in basis points (positive = we got a better fill than
// crossing the spread at refPrice would have given). Used for post-hoc
// telemetry so we can check whether the flag actually earns its keep.
function computeSavingsBps({ side, refPrice, avgPrice }) {
  const s = sideToUpper(side);
  const ref = Number(refPrice);
  const avg = Number(avgPrice);
  if (!s || !Number.isFinite(ref) || ref <= 0 || !Number.isFinite(avg) || avg <= 0) return null;
  // For BUY: we save when avg < ref (bought cheaper). For SELL: we save
  // when avg > ref (sold higher). Normalize so positive = win either way.
  const diff = s === "BUY" ? (ref - avg) : (avg - ref);
  return (diff / ref) * 10000;
}

function makeTelemetryBase({ refPrice, bookBid, bookAsk, limitPrice, startedAt }) {
  return {
    refPrice: Number.isFinite(Number(refPrice)) ? Number(refPrice) : null,
    bookBid: Number.isFinite(Number(bookBid)) ? Number(bookBid) : null,
    bookAsk: Number.isFinite(Number(bookAsk)) ? Number(bookAsk) : null,
    limitPrice: Number.isFinite(Number(limitPrice)) ? Number(limitPrice) : null,
    limitOrderId: null,
    limitExecutedQty: 0,
    limitAvgPrice: null,
    marketOrderId: null,
    marketExecutedQty: 0,
    marketAvgPrice: null,
    elapsedMs: Math.max(0, Date.now() - (startedAt || Date.now())),
    savingsBps: null,
    mode: null,
    error: null,
  };
}

function finaliseTelemetry(telemetry, { mode, startedAt, avgPrice, refPrice, side, error = null }) {
  telemetry.mode = mode;
  telemetry.elapsedMs = Math.max(0, Date.now() - (startedAt || Date.now()));
  telemetry.savingsBps = computeSavingsBps({ side, refPrice, avgPrice });
  if (error) telemetry.error = error;
  return telemetry;
}

// Build a synthesized "order detail" object that downstream code can read
// with the same field names Binance returns from POST /fapi/v1/order. We
// weight-average across maker + taker fills when both happened.
function buildCombinedOrder({
  takerOrder,
  makerOrder,
  fallbackSymbol,
  fallbackSide,
}) {
  const limitQty = readExecutedQty(makerOrder);
  const takerQty = readExecutedQty(takerOrder);
  const totalQty = limitQty + takerQty;

  const limitAvg = Number(makerOrder && (makerOrder.avgPrice || makerOrder.avg_price || 0)) || 0;
  const takerAvg = Number(takerOrder && (takerOrder.avgPrice || takerOrder.avg_price || 0)) || 0;

  let avgPrice = null;
  if (totalQty > 0) {
    const notional = (limitQty * limitAvg) + (takerQty * takerAvg);
    avgPrice = notional / totalQty;
  } else if (takerAvg > 0) {
    avgPrice = takerAvg;
  } else if (limitAvg > 0) {
    avgPrice = limitAvg;
  }

  // Prefer the TAKER fill's orderId as the primary so downstream lookups
  // (which may call fetchFuturesOrder) hit a reliable record. Fall back
  // to the maker order when there was no taker leg.
  const primary = takerOrder || makerOrder || {};
  return {
    symbol: (primary && primary.symbol) || fallbackSymbol,
    side: (primary && primary.side) || fallbackSide,
    orderId: primary && primary.orderId,
    clientOrderId: primary && primary.clientOrderId,
    status: totalQty > 0 ? "FILLED" : (readOrderStatus(primary) || "UNKNOWN"),
    executedQty: totalQty > 0 ? String(totalQty) : (primary && primary.executedQty) || "0",
    origQty: (primary && primary.origQty) || undefined,
    avgPrice: Number.isFinite(avgPrice) && avgPrice > 0 ? String(avgPrice) : (primary && primary.avgPrice) || undefined,
  };
}

// Main entry point. The helper never throws for business errors — it will
// always fall back to a market order and surface the failure via the
// `makerFirst.error` field — because missing an entry is worse than paying
// taker fees. It only throws if the *market fallback itself* fails; the
// caller already handles that exception.
async function placeFuturesEntryMakerFirst({
  apiKey,
  apiSecret,
  symbol,
  side,
  quantity,
  refPrice,
  idempotencyKey,               // used for the MARKET fallback (unchanged)
  limitIdempotencyKey,          // used for the LIMIT attempt (distinct key)
  timeoutMs,
  pollIntervalMs,
  logger = console,
  _primitives,                  // test injection
} = {}) {
  const prims = _primitives || {
    placeFuturesMarketOrder,
    placeFuturesLimitOrder,
    cancelFuturesOrder,
    fetchFuturesOrder,
    fetchFuturesBookTicker,
    fetchFuturesExchangeInfo,
  };
  const sideU = sideToUpper(side);
  const qty = Number(quantity);
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym || !sideU || !Number.isFinite(qty) || qty <= 0) {
    throw new Error("MAKER_FIRST_ENTRY_PARAMS_INVALID");
  }

  const effectiveTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 500
    ? Math.floor(Number(timeoutMs))
    : resolveTimeoutMs();
  const effectivePoll = Number.isFinite(Number(pollIntervalMs)) && Number(pollIntervalMs) >= 100
    ? Math.floor(Number(pollIntervalMs))
    : resolvePollIntervalMs();
  const startedAt = Date.now();

  // If the master flag is off we behave exactly like the legacy path: one
  // market order, no extra round-trips. This is the safe default for any
  // runtime that hasn't opted in.
  if (!isMakerFirstEnabled()) {
    const telemetry = makeTelemetryBase({ refPrice, bookBid: null, bookAsk: null, limitPrice: null, startedAt });
    const takerOrder = await prims.placeFuturesMarketOrder({
      apiKey, apiSecret, symbol: sym, side: sideU, quantity: qty,
      reduceOnly: false, idempotencyKey,
    });
    finaliseTelemetry(telemetry, {
      mode: "MARKET_DISABLED",
      startedAt,
      avgPrice: calcAveragePrice(takerOrder),
      refPrice,
      side: sideU,
    });
    telemetry.marketOrderId = takerOrder && takerOrder.orderId;
    telemetry.marketExecutedQty = readExecutedQty(takerOrder);
    telemetry.marketAvgPrice = calcAveragePrice(takerOrder);
    const out = buildCombinedOrder({ takerOrder, makerOrder: null, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }

  // ── Step 1: book snapshot ────────────────────────────────────────────
  let book = null;
  try {
    book = await prims.fetchFuturesBookTicker({ symbol: sym });
  } catch (e) {
    logger && logger.warn && logger.warn("[maker-first] bookTicker fetch failed, falling back to market", e && e.message);
  }
  const bid = book && Number.isFinite(Number(book.bidPrice)) ? Number(book.bidPrice) : null;
  const ask = book && Number.isFinite(Number(book.askPrice)) ? Number(book.askPrice) : null;
  if (!(Number.isFinite(bid) && bid > 0) || !(Number.isFinite(ask) && ask > 0) || ask <= bid) {
    const telemetry = makeTelemetryBase({ refPrice, bookBid: bid, bookAsk: ask, limitPrice: null, startedAt });
    const takerOrder = await prims.placeFuturesMarketOrder({
      apiKey, apiSecret, symbol: sym, side: sideU, quantity: qty,
      reduceOnly: false, idempotencyKey,
    });
    finaliseTelemetry(telemetry, {
      mode: "MARKET_BOOK_UNAVAILABLE",
      startedAt,
      avgPrice: calcAveragePrice(takerOrder),
      refPrice,
      side: sideU,
    });
    telemetry.marketOrderId = takerOrder && takerOrder.orderId;
    telemetry.marketExecutedQty = readExecutedQty(takerOrder);
    telemetry.marketAvgPrice = calcAveragePrice(takerOrder);
    const out = buildCombinedOrder({ takerOrder, makerOrder: null, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }
  const limitPrice = sideU === "BUY" ? bid : ask;

  // ── Step 2: place the GTX (post-only) limit ──────────────────────────
  const telemetry = makeTelemetryBase({ refPrice, bookBid: bid, bookAsk: ask, limitPrice, startedAt });
  let limitOrder = null;
  try {
    limitOrder = await prims.placeFuturesLimitOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      side: sideU,
      quantity: qty,
      price: limitPrice,
      timeInForce: "GTX",
      reduceOnly: false,
      clientOrderId: undefined,
      idempotencyKey: limitIdempotencyKey,
    });
    telemetry.limitOrderId = limitOrder && limitOrder.orderId;
  } catch (e) {
    if (isPostOnlyRejectError(e)) {
      // Book moved between our snapshot and the order landing; the price
      // would have crossed. Fall through to market immediately.
      logger && logger.info && logger.info("[maker-first] GTX rejected (would cross), taking market", { symbol: sym, side: sideU });
      const takerOrder = await prims.placeFuturesMarketOrder({
        apiKey, apiSecret, symbol: sym, side: sideU, quantity: qty,
        reduceOnly: false, idempotencyKey,
      });
      finaliseTelemetry(telemetry, {
        mode: "MARKET_POST_ONLY_REJECTED",
        startedAt,
        avgPrice: calcAveragePrice(takerOrder),
        refPrice,
        side: sideU,
      });
      telemetry.marketOrderId = takerOrder && takerOrder.orderId;
      telemetry.marketExecutedQty = readExecutedQty(takerOrder);
      telemetry.marketAvgPrice = calcAveragePrice(takerOrder);
      const out = buildCombinedOrder({ takerOrder, makerOrder: null, fallbackSymbol: sym, fallbackSide: sideU });
      out.makerFirst = telemetry;
      return out;
    }
    // Any other error from the limit leg: log, skip to market so we don't
    // drop the signal.
    logger && logger.warn && logger.warn("[maker-first] limit place failed, falling back", e && e.message);
    const takerOrder = await prims.placeFuturesMarketOrder({
      apiKey, apiSecret, symbol: sym, side: sideU, quantity: qty,
      reduceOnly: false, idempotencyKey,
    });
    finaliseTelemetry(telemetry, {
      mode: "MARKET_ERROR",
      startedAt,
      avgPrice: calcAveragePrice(takerOrder),
      refPrice,
      side: sideU,
      error: e && e.message ? String(e.message).slice(0, 400) : "LIMIT_PLACE_FAILED",
    });
    telemetry.marketOrderId = takerOrder && takerOrder.orderId;
    telemetry.marketExecutedQty = readExecutedQty(takerOrder);
    telemetry.marketAvgPrice = calcAveragePrice(takerOrder);
    const out = buildCombinedOrder({ takerOrder, makerOrder: null, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }

  // ── Step 3: poll for fill until timeout ──────────────────────────────
  const limitOrderId = limitOrder && limitOrder.orderId;
  let latestLimit = limitOrder;
  const deadline = startedAt + effectiveTimeout;
  while (Date.now() < deadline) {
    const status = readOrderStatus(latestLimit);
    if (isOrderTerminal(status)) break;
    const execQty = readExecutedQty(latestLimit);
    if (execQty > 0 && qtyApproxEqual(execQty, qty, qty * 1e-6)) break;

    await sleep(effectivePoll);
    try {
      latestLimit = await prims.fetchFuturesOrder({
        apiKey, apiSecret, symbol: sym, orderId: limitOrderId,
      });
    } catch (e) {
      logger && logger.warn && logger.warn("[maker-first] fetchFuturesOrder poll failed", e && e.message);
      // Keep polling — transient errors shouldn't collapse the maker leg.
    }
  }

  const terminalStatus = readOrderStatus(latestLimit);
  const limitExecQty = readExecutedQty(latestLimit);
  const limitAvg = calcAveragePrice(latestLimit);
  telemetry.limitExecutedQty = limitExecQty;
  telemetry.limitAvgPrice = limitAvg;

  // ── Step 4a: fully filled on the maker leg — no taker needed ─────────
  if (terminalStatus === "FILLED" || qtyApproxEqual(limitExecQty, qty, qty * 1e-6)) {
    finaliseTelemetry(telemetry, {
      mode: "MAKER_FILLED",
      startedAt,
      avgPrice: limitAvg,
      refPrice,
      side: sideU,
    });
    const out = buildCombinedOrder({ takerOrder: null, makerOrder: latestLimit, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }

  // ── Step 4b: cancel remainder ────────────────────────────────────────
  // Order may still be partially filled; if we don't cancel now the stale
  // limit will keep resting on the book. Ignore -2011 (already gone).
  if (!isOrderTerminal(terminalStatus)) {
    try {
      await prims.cancelFuturesOrder({ apiKey, apiSecret, symbol: sym, orderId: limitOrderId });
    } catch (e) {
      if (!isUnknownOrderError(e)) {
        logger && logger.warn && logger.warn("[maker-first] cancel limit failed", e && e.message);
      }
    }
    // Re-fetch so we pick up any fills that raced in between the last
    // poll and the cancel landing at the matching engine.
    try {
      latestLimit = await prims.fetchFuturesOrder({
        apiKey, apiSecret, symbol: sym, orderId: limitOrderId,
      });
    } catch (_) { /* best-effort */ }
  }
  const finalLimitExecQty = readExecutedQty(latestLimit);
  const finalLimitAvg = calcAveragePrice(latestLimit);
  telemetry.limitExecutedQty = finalLimitExecQty;
  telemetry.limitAvgPrice = finalLimitAvg;

  // If the race produced a full fill despite the cancel, the cancel is a
  // no-op and we're done as a maker.
  if (qtyApproxEqual(finalLimitExecQty, qty, qty * 1e-6)) {
    finaliseTelemetry(telemetry, {
      mode: "MAKER_FILLED",
      startedAt,
      avgPrice: finalLimitAvg,
      refPrice,
      side: sideU,
    });
    const out = buildCombinedOrder({ takerOrder: null, makerOrder: latestLimit, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }

  // ── Step 4c: market-fill the remainder ───────────────────────────────
  const remaining = Math.max(0, qty - finalLimitExecQty);
  if (remaining <= 0) {
    // Defensive — should have been caught by the full-fill branch above.
    finaliseTelemetry(telemetry, {
      mode: "MAKER_FILLED",
      startedAt,
      avgPrice: finalLimitAvg,
      refPrice,
      side: sideU,
    });
    const out = buildCombinedOrder({ takerOrder: null, makerOrder: latestLimit, fallbackSymbol: sym, fallbackSide: sideU });
    out.makerFirst = telemetry;
    return out;
  }
  let takerOrder = null;
  try {
    takerOrder = await prims.placeFuturesMarketOrder({
      apiKey, apiSecret, symbol: sym, side: sideU, quantity: remaining,
      reduceOnly: false, idempotencyKey,
    });
  } catch (e) {
    // If the market fallback itself fails we have a real problem (partial
    // fill with no follow-up). Surface the error so the caller can alert.
    finaliseTelemetry(telemetry, {
      mode: "MARKET_ERROR",
      startedAt,
      avgPrice: finalLimitAvg,
      refPrice,
      side: sideU,
      error: e && e.message ? String(e.message).slice(0, 400) : "MARKET_FALLBACK_FAILED",
    });
    const err = new Error("MAKER_FIRST_MARKET_FALLBACK_FAILED: " + (e && e.message ? e.message : ""));
    err.makerFirst = telemetry;
    err.cause = e;
    throw err;
  }
  telemetry.marketOrderId = takerOrder && takerOrder.orderId;
  telemetry.marketExecutedQty = readExecutedQty(takerOrder);
  telemetry.marketAvgPrice = calcAveragePrice(takerOrder);

  const combined = buildCombinedOrder({ takerOrder, makerOrder: latestLimit, fallbackSymbol: sym, fallbackSide: sideU });
  const combinedAvg = calcAveragePrice(combined);
  finaliseTelemetry(telemetry, {
    mode: finalLimitExecQty > 0 ? "MAKER_PARTIAL_MARKET" : "MARKET_FALLBACK",
    startedAt,
    avgPrice: combinedAvg,
    refPrice,
    side: sideU,
  });
  combined.makerFirst = telemetry;
  return combined;
}

module.exports = {
  placeFuturesEntryMakerFirst,
  isMakerFirstEnabled,
  __test: {
    computeSavingsBps,
    buildCombinedOrder,
    readExecutedQty,
    readOrderStatus,
    isOrderTerminal,
    qtyApproxEqual,
  },
};
