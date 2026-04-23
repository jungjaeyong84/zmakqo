"use strict";

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampRatio(value, fallback) {
  const num = toNumber(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function computePriceByPct({ entryPrice, pct, positionSide, kind } = {}) {
  const price = toNumber(entryPrice);
  const ratio = Math.abs(toNumber(pct));
  const side = upper(positionSide);
  const type = upper(kind);
  if (!(Number.isFinite(price) && price > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (!(Number.isFinite(ratio) && ratio > 0)) throw new Error("PCT_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");

  if (type === "SL") {
    return side === "LONG"
      ? price * (1 - ratio)
      : price * (1 + ratio);
  }
  if (type === "TP1") {
    return side === "LONG"
      ? price * (1 + ratio)
      : price * (1 - ratio);
  }
  throw new Error("PROTECTION_KIND_INVALID");
}

function buildInitialProtectionPlan({
  symbol,
  positionSide,
  entryPrice,
  entryQtyAbs,
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
  exchange = "BINANCEFUT",
} = {}) {
  const sym = upper(symbol);
  const side = upper(positionSide);
  const qty = toNumber(entryQtyAbs);
  const entry = toNumber(entryPrice);
  const tpQtyRatioClamped = clampRatio(tp1QtyRatio, 0.5);
  if (!sym) throw new Error("SYMBOL_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error("ENTRY_QTY_ABS_REQUIRED");
  if (!(Number.isFinite(entry) && entry > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (tpQtyRatioClamped <= 0 || tpQtyRatioClamped >= 1) throw new Error("TP1_QTY_RATIO_INVALID");

  const closeSide = side === "LONG" ? "SELL" : "BUY";
  const tp1QtyAbs = Number((qty * tpQtyRatioClamped).toFixed(8));
  const runnerRemainingQtyAbs = Number((qty - tp1QtyAbs).toFixed(8));

  return Object.freeze({
    exchange: upper(exchange) || "BINANCEFUT",
    symbol: sym,
    position_side: side,
    close_side: closeSide,
    entry_price: entry,
    entry_qty_abs: qty,
    stop_loss_pct: Math.abs(stopLossPct),
    tp1_target_pct: Math.abs(tp1TargetPct),
    tp1_qty_ratio: tpQtyRatioClamped,
    tp1_qty_abs: tp1QtyAbs,
    runner_remaining_qty_abs: runnerRemainingQtyAbs,
    sl_trigger_price: Number(computePriceByPct({
      entryPrice: entry,
      pct: stopLossPct,
      positionSide: side,
      kind: "SL",
    }).toFixed(8)),
    tp1_trigger_price: Number(computePriceByPct({
      entryPrice: entry,
      pct: tp1TargetPct,
      positionSide: side,
      kind: "TP1",
    }).toFixed(8)),
  });
}

module.exports = {
  buildInitialProtectionPlan,
  __test: {
    computePriceByPct,
    clampRatio,
  },
};
