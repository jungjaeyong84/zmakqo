"use strict";

const {
  fetchFuturesOrder,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
} = require("../exchanges/binanceFuturesPrivate");
const { withProtectionWriteDeadline } = require("./binanceProtectionTransport");

const DEFAULT_WORKING_TYPE = "MARK_PRICE";
const DEFAULT_PRICE_PROTECT = true;

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
  if (!cfg) throw new Error("BINANCE_INITIAL_PROTECTION_LIVE_CFG_REQUIRED");
  const apiKey = trimOrNull(cfg.apiKey);
  const apiSecret = trimOrNull(cfg.apiSecret);
  if (!apiKey || !apiSecret) throw new Error("BINANCE_INITIAL_PROTECTION_KEYS_MISSING");
  if (cfg.liveEnabled !== true && cfg.liveDryRun !== true) {
    throw new Error("BINANCE_INITIAL_PROTECTION_LIVE_CFG_NOT_ENABLED");
  }
  return Object.freeze({
    ...cfg,
    apiKey,
    apiSecret,
    liveEnabled: cfg.liveEnabled === true,
    liveDryRun: cfg.liveDryRun === true,
  });
}

function normalizeOrderAck({ name, command, order, nowIso = null } = {}) {
  const row = order && typeof order === "object" ? order : {};
  const skipped = row.skipped === true;
  const orderId = trimOrNull(row.orderId || row.order_id || row.algoId || row.algo_id);
  const triggerPrice = toNumberOrNull(row.stopPrice)
    ?? toNumberOrNull(row.triggerPrice)
    ?? toNumberOrNull(row.stop_price)
    ?? toNumberOrNull(row.trigger_price)
    ?? toNumberOrNull(command && command.trigger_price);
  if (!skipped && orderId) {
    return Object.freeze({
      status: "PLACED",
      order_id: orderId,
      trigger_price: triggerPrice,
      error_code: null,
      ack_at: trimOrNull(row.ack_at) || trimOrNull(nowIso) || new Date().toISOString(),
    });
  }
  return Object.freeze({
    status: "FAILED",
    order_id: orderId,
    trigger_price: triggerPrice,
    error_code: stableCode(row.reason || row.note || `${name}_ORDER_NOT_PLACED`),
    ack_at: null,
  });
}

function buildDryRunAck({ command, name } = {}) {
  return Object.freeze({
    status: "FAILED",
    order_id: null,
    trigger_price: toNumberOrNull(command && command.trigger_price),
    error_code: `BINANCE_INITIAL_${name}_DRY_RUN`,
    ack_at: null,
  });
}

function assertCommandType(command, expectedType) {
  const row = command && typeof command === "object" ? command : null;
  if (!row) throw new Error(`${expectedType}_COMMAND_REQUIRED`);
  if (upper(row.command_type) !== expectedType) {
    throw new Error(`${expectedType}_COMMAND_TYPE_INVALID`);
  }
  return row;
}

function buildBinanceInitialProtectionTransports({
  liveCfg,
  fetchOrder = fetchFuturesOrder,
  placeStopMarketOrder = placeFuturesStopMarketOrder,
  placeTakeProfitMarketOrder = placeFuturesTakeProfitMarketOrder,
  now = () => new Date().toISOString(),
} = {}) {
  const cfg = validateLiveCfg(liveCfg);
  if (typeof placeStopMarketOrder !== "function") {
    throw new Error("BINANCE_INITIAL_STOP_ORDER_FN_REQUIRED");
  }
  if (typeof placeTakeProfitMarketOrder !== "function") {
    throw new Error("BINANCE_INITIAL_TP1_ORDER_FN_REQUIRED");
  }
  if (typeof fetchOrder !== "function") {
    throw new Error("BINANCE_INITIAL_FETCH_ORDER_FN_REQUIRED");
  }

  return Object.freeze({
    async fetchOrderByClientOrderId({ command } = {}) {
      const row = command && typeof command === "object" ? command : {};
      const clientOrderId = trimOrNull(row.client_order_key);
      if (!clientOrderId) throw new Error("BINANCE_INITIAL_CLIENT_ORDER_KEY_REQUIRED");
      if (cfg.liveDryRun === true || cfg.liveEnabled !== true) return null;
      return fetchOrder({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        symbol: upper(row.symbol),
        origClientOrderId: clientOrderId,
      });
    },

    async placeInitialSl({ command } = {}) {
      const row = assertCommandType(command, "PLACE_INITIAL_SL");
      if (cfg.liveDryRun === true || cfg.liveEnabled !== true) {
        return buildDryRunAck({ command: row, name: "SL" });
      }
      const order = await withProtectionWriteDeadline(({ signal }) => placeStopMarketOrder({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        symbol: upper(row.symbol),
        side: upper(row.close_side),
        stopPrice: row.trigger_price,
        closePosition: true,
        workingType: DEFAULT_WORKING_TYPE,
        priceProtect: DEFAULT_PRICE_PROTECT,
        clientOrderId: trimOrNull(row.client_order_key),
        idempotencyKey: trimOrNull(row.client_order_key) || trimOrNull(row.placement_attempt_id),
        signal,
      }), {
        errorCode: "BINANCE_INITIAL_SL_WRITE_DEADLINE_EXCEEDED",
      });
      return normalizeOrderAck({
        name: "SL",
        command: row,
        order,
        nowIso: now(),
      });
    },

    async placeInitialTp1({ command } = {}) {
      const row = assertCommandType(command, "PLACE_INITIAL_TP1");
      if (cfg.liveDryRun === true || cfg.liveEnabled !== true) {
        return buildDryRunAck({ command: row, name: "TP1" });
      }
      const qty = toNumberOrNull(row.quantity_abs);
      if (!(qty > 0)) {
        return Object.freeze({
          status: "FAILED",
          order_id: null,
          trigger_price: toNumberOrNull(row.trigger_price),
          error_code: "BINANCE_INITIAL_TP1_QTY_REQUIRED",
          ack_at: null,
        });
      }
      const order = await withProtectionWriteDeadline(({ signal }) => placeTakeProfitMarketOrder({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        symbol: upper(row.symbol),
        side: upper(row.close_side),
        stopPrice: row.trigger_price,
        closePosition: false,
        quantity: qty,
        reduceOnly: true,
        workingType: DEFAULT_WORKING_TYPE,
        priceProtect: DEFAULT_PRICE_PROTECT,
        clientOrderId: trimOrNull(row.client_order_key),
        idempotencyKey: trimOrNull(row.client_order_key) || trimOrNull(row.placement_attempt_id),
        signal,
      }), {
        errorCode: "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED",
      });
      return normalizeOrderAck({
        name: "TP1",
        command: row,
        order,
        nowIso: now(),
      });
    },
  });
}

module.exports = {
  buildBinanceInitialProtectionTransports,
  normalizeOrderAck,
  validateLiveCfg,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    stableCode,
    buildDryRunAck,
    assertCommandType,
  },
};
