"use strict";

const { BINANCE_NATIVE_STOP_WRITER_SOURCE } = require("../utils/binanceNativeProtectionWriter");
const {
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
} = require("../exchanges/binanceFuturesPrivate");

const DEFAULT_WORKING_TYPE = "MARK_PRICE";
const DEFAULT_PRICE_PROTECT = true;
const DEFAULT_PROTECTION_WRITE_DEADLINE_MS = 15_000;
const MIN_PROTECTION_WRITE_DEADLINE_MS = 250;
const MAX_PROTECTION_WRITE_DEADLINE_MS = 120_000;

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

function resolveProtectionWriteDeadlineMs({ env = process.env, deadlineMs = null } = {}) {
  const raw = deadlineMs ?? (env && env.DONBEOLJA_V2_PROTECTION_WRITE_DEADLINE_MS);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PROTECTION_WRITE_DEADLINE_MS;
  const rounded = Math.trunc(parsed);
  if (rounded < MIN_PROTECTION_WRITE_DEADLINE_MS) return MIN_PROTECTION_WRITE_DEADLINE_MS;
  if (rounded > MAX_PROTECTION_WRITE_DEADLINE_MS) return MAX_PROTECTION_WRITE_DEADLINE_MS;
  return rounded;
}

function buildDeadlineExceededError(errorCode) {
  const code = stableCode(errorCode) || "BINANCE_PROTECTION_WRITE_DEADLINE_EXCEEDED";
  const error = new Error(code);
  error.code = code;
  return error;
}

async function withProtectionWriteDeadline(operation, {
  env = process.env,
  deadlineMs = null,
  errorCode = "BINANCE_PROTECTION_WRITE_DEADLINE_EXCEEDED",
} = {}) {
  if (typeof operation !== "function") throw new Error("BINANCE_PROTECTION_WRITE_OPERATION_REQUIRED");
  const resolvedDeadlineMs = resolveProtectionWriteDeadlineMs({ env, deadlineMs });
  let timeout = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(buildDeadlineExceededError(errorCode)), resolvedDeadlineMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function deadlineErrorCode(error, fallback) {
  return stableCode(error && (error.code || error.message)) || stableCode(fallback);
}

function validateProtectionRepairLiveCfg(liveCfg = null, errorPrefix = "BINANCE_PROTECTION_REPAIR") {
  const cfg = liveCfg && typeof liveCfg === "object" ? liveCfg : null;
  if (!cfg) throw new Error(`${errorPrefix}_LIVE_CFG_REQUIRED`);
  const apiKey = trimOrNull(cfg.apiKey);
  const apiSecret = trimOrNull(cfg.apiSecret);
  if (!apiKey || !apiSecret) throw new Error(`${errorPrefix}_KEYS_MISSING`);
  if (cfg.liveEnabled !== true && cfg.liveDryRun !== true) {
    throw new Error(`${errorPrefix}_LIVE_CFG_NOT_ENABLED`);
  }
  return Object.freeze({
    ...cfg,
    apiKey,
    apiSecret,
    liveEnabled: cfg.liveEnabled === true,
    liveDryRun: cfg.liveDryRun === true,
  });
}

function validateTp1LiveCfg(liveCfg = null) {
  return validateProtectionRepairLiveCfg(liveCfg, "BINANCE_TP1_REPAIR");
}

async function resolveTransportContext({
  delegatedRepair,
  command,
  env,
  db,
  resolveContext,
} = {}) {
  if (typeof resolveContext !== "function") {
    throw new Error("BINANCE_TRANSPORT_CONTEXT_RESOLVER_REQUIRED");
  }
  const context = await resolveContext({
    delegatedRepair,
    command,
    env,
    db,
  });
  if (!context || typeof context !== "object") {
    throw new Error("BINANCE_TRANSPORT_CONTEXT_REQUIRED");
  }
  if (!context.liveCfg || typeof context.liveCfg !== "object") {
    throw new Error("BINANCE_TRANSPORT_LIVE_CFG_REQUIRED");
  }
  if (!trimOrNull(context.symbol)) {
    throw new Error("BINANCE_TRANSPORT_SYMBOL_REQUIRED");
  }
  if (!trimOrNull(context.fallbackSide)) {
    throw new Error("BINANCE_TRANSPORT_FALLBACK_SIDE_REQUIRED");
  }
  if (!(toNumberOrNull(context.fallbackEntryPrice) > 0)) {
    throw new Error("BINANCE_TRANSPORT_FALLBACK_ENTRY_PRICE_REQUIRED");
  }
  if (!(toNumberOrNull(context.fallbackLeverage) > 0)) {
    throw new Error("BINANCE_TRANSPORT_FALLBACK_LEVERAGE_REQUIRED");
  }
  return Object.freeze({
    liveCfg: context.liveCfg,
    exchange: upper(context.exchange) || "BINANCEFUT",
    symbol: upper(context.symbol),
    fallbackSide: upper(context.fallbackSide),
    fallbackEntryPrice: Number(context.fallbackEntryPrice),
    fallbackLeverage: Number(context.fallbackLeverage),
    exitRulesOverride: context.exitRulesOverride || null,
    posMeta: context.posMeta && typeof context.posMeta === "object" ? context.posMeta : null,
  });
}

function normalizeRefreshNativeStopAck({
  command,
  refreshResult,
  nowIso = null,
} = {}) {
  const result = refreshResult && typeof refreshResult === "object" ? refreshResult : {};
  const orderId = trimOrNull(result.stop_order_id || result.stopOrderId || result.order_id);
  const triggerPrice = toNumberOrNull(result.stop_price)
    ?? toNumberOrNull(result.stopPrice)
    ?? toNumberOrNull(result.trigger_price)
    ?? toNumberOrNull(command && command.trigger_price);
  if (result.ok === true && orderId) {
    const ackAt = Number.isFinite(Number(result.stop_ack_ms))
      ? new Date(Number(result.stop_ack_ms)).toISOString()
      : (trimOrNull(result.ack_at) || trimOrNull(nowIso) || new Date().toISOString());
    return Object.freeze({
      status: "PLACED",
      order_id: orderId,
      trigger_price: triggerPrice,
      error_code: null,
      ack_at: ackAt,
    });
  }
  return Object.freeze({
    status: "FAILED",
    order_id: orderId,
    trigger_price: triggerPrice,
    error_code: stableCode(result.reason || result.error || "BINANCE_NATIVE_REFRESH_FAILED"),
    ack_at: null,
  });
}

function normalizePlaceOrReplaceTp1Ack({
  command,
  order,
  nowIso = null,
} = {}) {
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
    error_code: stableCode(row.reason || row.note || "BINANCE_TP1_REPAIR_ORDER_NOT_PLACED"),
    ack_at: null,
  });
}

function normalizePlaceOrReplaceSlAck({
  command,
  order,
  nowIso = null,
} = {}) {
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
    error_code: stableCode(row.reason || row.note || "BINANCE_SL_REPAIR_ORDER_NOT_PLACED"),
    ack_at: null,
  });
}

function buildFailedRepairAck({ command, errorCode }) {
  return Object.freeze({
    status: "FAILED",
    order_id: null,
    trigger_price: toNumberOrNull(command && command.trigger_price),
    error_code: stableCode(errorCode),
    ack_at: null,
  });
}

function buildBinanceRefreshNativeStopTransport({
  refreshNativeProtectionWithRetry,
  resolveContext,
  now = () => new Date().toISOString(),
  deadlineMs = null,
} = {}) {
  if (typeof refreshNativeProtectionWithRetry !== "function") {
    throw new Error("BINANCE_REFRESH_NATIVE_PROTECTION_FN_REQUIRED");
  }
  return async function refreshNativeStop({ command, delegatedRepair, env, db } = {}) {
    if (!command || typeof command !== "object") throw new Error("BINANCE_REFRESH_COMMAND_REQUIRED");
    if (upper(command.command_type) !== "REFRESH_NATIVE_STOP") {
      throw new Error("BINANCE_REFRESH_COMMAND_TYPE_INVALID");
    }
    const context = await resolveTransportContext({
      delegatedRepair,
      command,
      env,
      db,
      resolveContext,
    });
    let refreshResult;
    try {
      refreshResult = await withProtectionWriteDeadline(() => refreshNativeProtectionWithRetry({
        liveCfg: context.liveCfg,
        exchange: context.exchange,
        symbol: context.symbol,
        fallbackSide: context.fallbackSide,
        fallbackEntryPrice: context.fallbackEntryPrice,
        fallbackLeverage: context.fallbackLeverage,
        exitRulesOverride: context.exitRulesOverride,
        posMeta: context.posMeta,
        writerSource: BINANCE_NATIVE_STOP_WRITER_SOURCE,
      }), {
        env,
        deadlineMs,
        errorCode: "BINANCE_NATIVE_STOP_REFRESH_DEADLINE_EXCEEDED",
      });
    } catch (error) {
      refreshResult = {
        ok: false,
        reason: deadlineErrorCode(error, "BINANCE_NATIVE_STOP_REFRESH_FAILED"),
      };
    }
    return normalizeRefreshNativeStopAck({
      command,
      refreshResult,
      nowIso: now(),
    });
  };
}

function assertFullProtectionCommand(command) {
  const row = command && typeof command === "object" ? command : null;
  if (!row) throw new Error("BINANCE_FULL_PROTECTION_REPAIR_COMMAND_REQUIRED");
  if (upper(row.command_type) !== "PLACE_OR_REPLACE_FULL_PROTECTION") {
    throw new Error("BINANCE_FULL_PROTECTION_REPAIR_COMMAND_TYPE_INVALID");
  }
  const commands = row.commands && typeof row.commands === "object" ? row.commands : {};
  const sl = commands.sl && typeof commands.sl === "object" ? commands.sl : null;
  const tp1 = commands.tp1 && typeof commands.tp1 === "object" ? commands.tp1 : null;
  if (row.include_sl_order === true && !sl) throw new Error("BINANCE_FULL_PROTECTION_SL_COMMAND_REQUIRED");
  if (row.include_tp1_order === true && !tp1) throw new Error("BINANCE_FULL_PROTECTION_TP1_COMMAND_REQUIRED");
  if (row.include_sl_order !== true && row.include_tp1_order !== true) {
    throw new Error("BINANCE_FULL_PROTECTION_TARGET_REQUIRED");
  }
  return Object.freeze({
    row,
    sl,
    tp1,
  });
}

function buildBinancePlaceOrReplaceTp1Transport({
  placeTakeProfitMarketOrder = placeFuturesTakeProfitMarketOrder,
  resolveContext,
  now = () => new Date().toISOString(),
  deadlineMs = null,
} = {}) {
  if (typeof placeTakeProfitMarketOrder !== "function") {
    throw new Error("BINANCE_TP1_REPAIR_ORDER_FN_REQUIRED");
  }
  return async function placeOrReplaceTp1({ command, delegatedRepair, env, db } = {}) {
    const row = command && typeof command === "object" ? command : null;
    if (!row) throw new Error("BINANCE_TP1_REPAIR_COMMAND_REQUIRED");
    if (upper(row.command_type) !== "PLACE_OR_REPLACE_TP1") {
      throw new Error("BINANCE_TP1_REPAIR_COMMAND_TYPE_INVALID");
    }
    const qty = toNumberOrNull(row.quantity_abs);
    if (!(qty > 0)) {
      return Object.freeze({
        status: "FAILED",
        order_id: null,
        trigger_price: toNumberOrNull(row.trigger_price),
        error_code: "BINANCE_TP1_REPAIR_QTY_REQUIRED",
        ack_at: null,
      });
    }
    const triggerPrice = toNumberOrNull(row.trigger_price);
    if (!(triggerPrice > 0)) {
      return Object.freeze({
        status: "FAILED",
        order_id: null,
        trigger_price: null,
        error_code: "BINANCE_TP1_REPAIR_PRICE_REQUIRED",
        ack_at: null,
      });
    }
    const context = await resolveTransportContext({
      delegatedRepair,
      command: row,
      env,
      db,
      resolveContext,
    });
    const cfg = validateProtectionRepairLiveCfg(context.liveCfg, "BINANCE_FULL_PROTECTION_REPAIR");
    if (cfg.liveDryRun === true || cfg.liveEnabled !== true) {
      return Object.freeze({
        status: "FAILED",
        order_id: null,
        trigger_price: triggerPrice,
        error_code: "BINANCE_TP1_REPAIR_DRY_RUN",
        ack_at: null,
      });
    }
    let order;
    try {
      order = await withProtectionWriteDeadline(() => placeTakeProfitMarketOrder({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        symbol: upper(row.symbol) || context.symbol,
        side: upper(row.close_side) || context.fallbackSide,
        stopPrice: triggerPrice,
        closePosition: false,
        quantity: qty,
        reduceOnly: true,
        workingType: DEFAULT_WORKING_TYPE,
        priceProtect: DEFAULT_PRICE_PROTECT,
        clientOrderId: trimOrNull(row.client_order_key),
        idempotencyKey: trimOrNull(row.client_order_key) || trimOrNull(row.placement_attempt_id),
      }), {
        env,
        deadlineMs,
        errorCode: "BINANCE_TP1_REPAIR_DEADLINE_EXCEEDED",
      });
    } catch (error) {
      order = {
        skipped: true,
        reason: deadlineErrorCode(error, "BINANCE_TP1_REPAIR_ORDER_FAILED"),
      };
    }
    return normalizePlaceOrReplaceTp1Ack({
      command: row,
      order,
      nowIso: now(),
    });
  };
}

function buildBinancePlaceOrReplaceFullProtectionTransport({
  placeStopMarketOrder = placeFuturesStopMarketOrder,
  placeTakeProfitMarketOrder = placeFuturesTakeProfitMarketOrder,
  resolveContext,
  now = () => new Date().toISOString(),
  deadlineMs = null,
} = {}) {
  if (typeof placeStopMarketOrder !== "function") {
    throw new Error("BINANCE_FULL_PROTECTION_SL_ORDER_FN_REQUIRED");
  }
  if (typeof placeTakeProfitMarketOrder !== "function") {
    throw new Error("BINANCE_FULL_PROTECTION_TP1_ORDER_FN_REQUIRED");
  }
  return async function placeOrReplaceFullProtection({ command, delegatedRepair, env, db } = {}) {
    const { row, sl, tp1 } = assertFullProtectionCommand(command);
    const context = await resolveTransportContext({
      delegatedRepair,
      command: row,
      env,
      db,
      resolveContext,
    });
    const cfg = validateTp1LiveCfg(context.liveCfg);
    if (cfg.liveDryRun === true || cfg.liveEnabled !== true) {
      return Object.freeze({
        slAck: sl ? buildFailedRepairAck({ command: sl, errorCode: "BINANCE_FULL_PROTECTION_DRY_RUN" }) : null,
        tp1Ack: tp1 ? buildFailedRepairAck({ command: tp1, errorCode: "BINANCE_FULL_PROTECTION_DRY_RUN" }) : null,
      });
    }
    let slAck = null;
    if (sl) {
      const stopPrice = toNumberOrNull(sl.trigger_price);
      if (!(stopPrice > 0)) {
        slAck = buildFailedRepairAck({ command: sl, errorCode: "BINANCE_FULL_PROTECTION_SL_PRICE_REQUIRED" });
      } else {
        let slOrder;
        try {
          slOrder = await withProtectionWriteDeadline(() => placeStopMarketOrder({
            apiKey: cfg.apiKey,
            apiSecret: cfg.apiSecret,
            symbol: upper(sl.symbol) || context.symbol,
            side: upper(sl.close_side) || context.fallbackSide,
            stopPrice,
            closePosition: true,
            workingType: DEFAULT_WORKING_TYPE,
            priceProtect: DEFAULT_PRICE_PROTECT,
            clientOrderId: trimOrNull(sl.client_order_key),
            idempotencyKey: trimOrNull(sl.client_order_key) || trimOrNull(sl.placement_attempt_id),
          }), {
            env,
            deadlineMs,
            errorCode: "BINANCE_FULL_PROTECTION_SL_DEADLINE_EXCEEDED",
          });
        } catch (error) {
          slOrder = {
            skipped: true,
            reason: deadlineErrorCode(error, "BINANCE_FULL_PROTECTION_SL_ORDER_FAILED"),
          };
        }
        slAck = normalizePlaceOrReplaceSlAck({
          command: sl,
          order: slOrder,
          nowIso: now(),
        });
      }
    }
    let tp1Ack = null;
    if (tp1) {
      const qty = toNumberOrNull(tp1.quantity_abs);
      const triggerPrice = toNumberOrNull(tp1.trigger_price);
      if (!(qty > 0)) {
        tp1Ack = buildFailedRepairAck({ command: tp1, errorCode: "BINANCE_FULL_PROTECTION_TP1_QTY_REQUIRED" });
      } else if (!(triggerPrice > 0)) {
        tp1Ack = buildFailedRepairAck({ command: tp1, errorCode: "BINANCE_FULL_PROTECTION_TP1_PRICE_REQUIRED" });
      } else {
        let tp1Order;
        try {
          tp1Order = await withProtectionWriteDeadline(() => placeTakeProfitMarketOrder({
            apiKey: cfg.apiKey,
            apiSecret: cfg.apiSecret,
            symbol: upper(tp1.symbol) || context.symbol,
            side: upper(tp1.close_side) || context.fallbackSide,
            stopPrice: triggerPrice,
            closePosition: false,
            quantity: qty,
            reduceOnly: true,
            workingType: DEFAULT_WORKING_TYPE,
            priceProtect: DEFAULT_PRICE_PROTECT,
            clientOrderId: trimOrNull(tp1.client_order_key),
            idempotencyKey: trimOrNull(tp1.client_order_key) || trimOrNull(tp1.placement_attempt_id),
          }), {
            env,
            deadlineMs,
            errorCode: "BINANCE_FULL_PROTECTION_TP1_DEADLINE_EXCEEDED",
          });
        } catch (error) {
          tp1Order = {
            skipped: true,
            reason: deadlineErrorCode(error, "BINANCE_FULL_PROTECTION_TP1_ORDER_FAILED"),
          };
        }
        tp1Ack = normalizePlaceOrReplaceTp1Ack({
          command: tp1,
          order: tp1Order,
          nowIso: now(),
        });
      }
    }
    return Object.freeze({
      slAck,
      tp1Ack,
    });
  };
}

module.exports = {
  buildBinanceRefreshNativeStopTransport,
  buildBinancePlaceOrReplaceTp1Transport,
  buildBinancePlaceOrReplaceFullProtectionTransport,
  normalizeRefreshNativeStopAck,
  normalizePlaceOrReplaceTp1Ack,
  normalizePlaceOrReplaceSlAck,
  resolveTransportContext,
  validateProtectionRepairLiveCfg,
  validateTp1LiveCfg,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    stableCode,
    resolveProtectionWriteDeadlineMs,
    withProtectionWriteDeadline,
    buildFailedRepairAck,
    assertFullProtectionCommand,
  },
};
