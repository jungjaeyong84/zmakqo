"use strict";

const { resolvePositionLeverage, resolveFillLeverage } = require("./leverageView");

function isBinanceExchange(exchange) {
  return String(exchange || "").toUpperCase().includes("BINANCE");
}

function toPositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveBudgetUsedFromNotional({ notional, leverage } = {}) {
  const notionalNum = toPositiveNumber(notional);
  if (notionalNum == null) return 0;
  const lev = toPositiveNumber(leverage) || 1;
  return notionalNum / lev;
}

function resolvePositionBudgetUsedKrw({ exchange, position, budgetMaxKrw = null } = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const maxKrw = toPositiveNumber(budgetMaxKrw);
  const stored = toPositiveNumber(pos.budget_used_krw);
  const sizePct = Number(pos.size_pct);

  if (!isBinanceExchange(exchange)) {
    if (stored != null) return stored;
    if (maxKrw != null && Number.isFinite(sizePct) && sizePct > 0) return maxKrw * sizePct;
    return 0;
  }

  const qtyBase = toPositiveNumber(pos.qty_base ?? meta.qty_base ?? meta.external_qty_base);
  const priceRef = toPositiveNumber(pos.avg_price ?? meta.external_entry_price ?? meta.external_mark_price);
  const leverage = resolvePositionLeverage(pos, { fallback: 1 }) || 1;
  const notional = (qtyBase != null && priceRef != null) ? (qtyBase * priceRef) : null;
  if (notional != null) return resolveBudgetUsedFromNotional({ notional, leverage });

  if (stored != null) {
    if (maxKrw == null || stored <= (maxKrw * 1.05)) return stored;
  }

  if (maxKrw != null && Number.isFinite(sizePct) && sizePct > 0) {
    return Math.min(maxKrw, Math.max(0, sizePct) * maxKrw);
  }
  return 0;
}

function resolveFillBudgetUsedKrw({ exchange, fill, position = null, budgetMaxKrw = null } = {}) {
  const row = fill && typeof fill === "object" ? fill : {};
  const stored = toPositiveNumber(row.budget_used_krw);
  if (!isBinanceExchange(exchange)) return stored;

  const leverage = resolveFillLeverage(row, { position, fallback: 1 }) || 1;
  const notional = toPositiveNumber(
    row.notional_krw ??
    row.notional_quote ??
    row.exec_notional_quote
  );
  if (notional != null) return resolveBudgetUsedFromNotional({ notional, leverage });

  if (stored != null) {
    const maxKrw = toPositiveNumber(budgetMaxKrw);
    if (maxKrw == null || stored <= (maxKrw * 1.05)) return stored;
  }
  return stored;
}

module.exports = {
  resolveBudgetUsedFromNotional,
  resolvePositionBudgetUsedKrw,
  resolveFillBudgetUsedKrw,
};
