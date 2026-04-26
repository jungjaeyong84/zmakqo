"use strict";

const { placeFuturesMarketOrder } = require("../exchanges/binanceFuturesPrivate");

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

function validateLiveCfg(liveCfg = null) {
  const cfg = liveCfg && typeof liveCfg === "object" ? liveCfg : null;
  if (!cfg) throw new Error("BINANCE_ENTRY_LIVE_CFG_REQUIRED");
  const apiKey = trimOrNull(cfg.apiKey);
  const apiSecret = trimOrNull(cfg.apiSecret);
  if (!apiKey || !apiSecret) throw new Error("BINANCE_ENTRY_KEYS_MISSING");
  if (cfg.liveEnabled !== true && cfg.liveDryRun !== true) {
    throw new Error("BINANCE_ENTRY_LIVE_CFG_NOT_ENABLED");
  }
  return Object.freeze({
    ...cfg,
    apiKey,
    apiSecret,
    liveEnabled: cfg.liveEnabled === true,
    liveDryRun: cfg.liveDryRun === true,
  });
}

function sideToEntryOrderSide(side) {
  const normalized = upper(side);
  if (normalized === "LONG") return "BUY";
  if (normalized === "SHORT") return "SELL";
  throw new Error("BINANCE_ENTRY_SIDE_INVALID");
}

function resolveEntryQuantityAbs({ entryIntent, quantityResolver }) {
  if (typeof quantityResolver !== "function") throw new Error("BINANCE_ENTRY_QUANTITY_RESOLVER_REQUIRED");
  const qty = toNumberOrNull(quantityResolver({ entryIntent }));
  if (!(qty > 0)) throw new Error("BINANCE_ENTRY_QTY_ABS_REQUIRED");
  return qty;
}

function buildEntryClientOrderId({ entryIntent, submittedAt = null } = {}) {
  const intent = entryIntent && typeof entryIntent === "object" ? entryIntent : {};
  const symbol = upper(intent.symbol);
  const side = upper(intent.side);
  const intentId = trimOrNull(intent.entry_intent_id);
  if (!symbol) throw new Error("BINANCE_ENTRY_SYMBOL_REQUIRED");
  if (!side) throw new Error("BINANCE_ENTRY_POSITION_SIDE_REQUIRED");
  if (!intentId) throw new Error("BINANCE_ENTRY_INTENT_ID_REQUIRED");
  const seed = `${symbol}_${side}_${intentId}_${trimOrNull(submittedAt) || "NA"}`;
  const cleaned = seed.replace(/[^A-Za-z0-9_.:-]/g, "");
  return `EV2_${cleaned}`.slice(0, 36);
}

function normalizeEntryOrderReceipt({ order, entryIntent, quantityAbs, submittedAt = null, clientOrderId = null, nowIso = null } = {}) {
  const row = order && typeof order === "object" ? order : {};
  const status = upper(row.status || row.orderStatus || row.order_status);
  const symbol = upper(row.symbol || entryIntent && entryIntent.symbol);
  const positionSide = upper(entryIntent && entryIntent.side);
  const orderId = trimOrNull(row.orderId || row.order_id);
  const clientId = trimOrNull(row.clientOrderId || row.client_order_id || row.origClientOrderId || clientOrderId);
  const avgPrice = toNumberOrNull(row.avgPrice || row.avg_price || row.averagePrice || row.price);
  const executedQty = toNumberOrNull(row.executedQty || row.executed_qty || row.cumQty || row.origQty || quantityAbs);
  if (status !== "FILLED") {
    return Object.freeze({
      status: status || "FAILED",
      symbol,
      side: positionSide,
      entry_event_id: null,
      entry_order_id: orderId,
      entry_fill_group_id: null,
      avg_price: avgPrice,
      executed_qty_abs: executedQty,
      error_code: stableCode(row.reason || row.note || `BINANCE_ENTRY_${status || "NOT_FILLED"}`),
      submitted_order_id: clientId,
      exchange_order_id: orderId,
      filled_at: null,
    });
  }
  if (!orderId) throw new Error("BINANCE_ENTRY_ORDER_ID_REQUIRED");
  if (!(avgPrice > 0)) throw new Error("BINANCE_ENTRY_AVG_PRICE_REQUIRED");
  if (!(executedQty > 0)) throw new Error("BINANCE_ENTRY_EXECUTED_QTY_REQUIRED");
  return Object.freeze({
    status: "FILLED",
    symbol,
    side: positionSide,
    entry_event_id: `ENTRYV2__${symbol}__${positionSide}__${orderId}`,
    entry_order_id: String(orderId),
    entry_fill_group_id: `FILLGROUPV2__${symbol}__${positionSide}__${orderId}`,
    avg_price: avgPrice,
    executed_qty_abs: executedQty,
    submitted_order_id: clientId,
    exchange_order_id: String(orderId),
    filled_at: trimOrNull(row.updateTime || row.transactTime || row.filled_at) || trimOrNull(nowIso) || trimOrNull(submittedAt),
    raw_order_status: status,
  });
}

function buildDryRunReceipt({ entryIntent, quantityAbs, submittedAt = null } = {}) {
  return Object.freeze({
    status: "DRY_RUN",
    symbol: upper(entryIntent && entryIntent.symbol),
    side: upper(entryIntent && entryIntent.side),
    entry_event_id: null,
    entry_order_id: null,
    entry_fill_group_id: null,
    avg_price: null,
    executed_qty_abs: quantityAbs,
    error_code: "BINANCE_ENTRY_DRY_RUN",
    submitted_order_id: null,
    exchange_order_id: null,
    filled_at: trimOrNull(submittedAt),
  });
}

function buildBinanceEntryOrderTransport({
  liveCfg,
  quantityResolver,
  placeMarketOrder = placeFuturesMarketOrder,
  now = () => new Date().toISOString(),
} = {}) {
  const cfg = validateLiveCfg(liveCfg);
  if (typeof placeMarketOrder !== "function") throw new Error("BINANCE_ENTRY_MARKET_ORDER_FN_REQUIRED");
  if (typeof quantityResolver !== "function") throw new Error("BINANCE_ENTRY_QUANTITY_RESOLVER_REQUIRED");

  return Object.freeze({
    async submitEntryOrder({ entryIntent, submittedAt = null } = {}) {
      const intent = entryIntent && typeof entryIntent === "object" ? entryIntent : null;
      if (!intent) throw new Error("BINANCE_ENTRY_INTENT_REQUIRED");
      const symbol = upper(intent.symbol);
      if (!symbol) throw new Error("BINANCE_ENTRY_SYMBOL_REQUIRED");
      const orderSide = sideToEntryOrderSide(intent.side);
      const quantityAbs = resolveEntryQuantityAbs({ entryIntent: intent, quantityResolver });
      if (cfg.liveDryRun === true || cfg.liveEnabled !== true) {
        return buildDryRunReceipt({ entryIntent: intent, quantityAbs, submittedAt });
      }
      const clientOrderId = buildEntryClientOrderId({ entryIntent: intent, submittedAt });
      const order = await placeMarketOrder({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        symbol,
        side: orderSide,
        quantity: quantityAbs,
        reduceOnly: false,
        clientOrderId,
        idempotencyKey: clientOrderId,
        newOrderRespType: "RESULT",
      });
      return normalizeEntryOrderReceipt({
        order,
        entryIntent: intent,
        quantityAbs,
        submittedAt,
        clientOrderId,
        nowIso: now(),
      });
    },
  });
}

module.exports = {
  buildBinanceEntryOrderTransport,
  validateLiveCfg,
  normalizeEntryOrderReceipt,
  sideToEntryOrderSide,
  resolveEntryQuantityAbs,
  buildEntryClientOrderId,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    stableCode,
    buildDryRunReceipt,
  },
};
