"use strict";

const { listExchangePositionReadViews } = require("./positionReadModel");

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isActivePosition(row = null) {
  const pos = row && typeof row === "object" ? row : {};
  const state = upper(pos.position_state || pos.state);
  const sizePct = toNum(pos.size_pct);
  const qtyBase = toNum(pos.qty_base);
  const hasSize = (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
  return hasSize && state !== "FLAT";
}

function buildNativeTrailProtectionGapRecord(row = null) {
  const pos = row && typeof row === "object" ? row : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const invariants = Array.isArray(meta.exchange_projection_invariants)
    ? meta.exchange_projection_invariants.map((x) => upper(x)).filter(Boolean)
    : [];
  const refreshStatus = upper(meta.native_protection_refresh_status || "");
  const trailActive = meta.trail_active === true;
  const stopMissing = invariants.includes("NATIVE_STOP_MISSING")
    || refreshStatus === "MISSING"
    || refreshStatus === "FAILED"
    || (!meta.native_protection_stop_order_id && !Number.isFinite(toNum(meta.native_protection_stop_price)));
  const gap = isActivePosition(pos) && trailActive && stopMissing;
  return {
    exchange: upper(pos.exchange),
    symbol: upper(pos.symbol_or_pair_id || pos.symbol),
    state: upper(pos.position_state || pos.state),
    qty_base: toNum(pos.qty_base),
    size_pct: toNum(pos.size_pct),
    trail_active: trailActive,
    tp_p1_done: meta.tp_p1_done === true,
    native_refresh_status: refreshStatus || null,
    native_stop_order_id: meta.native_protection_stop_order_id || null,
    native_stop_price: toNum(meta.native_protection_stop_price),
    exchange_projection_invariants: invariants,
    updated_at: pos.updated_at || null,
    gap,
  };
}

async function loadNativeTrailProtectionRuntime({
  exchange = "BINANCEFUT",
  limit = 200,
  listPositions = listExchangePositionReadViews,
} = {}) {
  const ex = upper(exchange || "BINANCEFUT") || "BINANCEFUT";
  const rows = await listPositions({
    exchange: ex,
    limit: Math.max(20, Number(limit) || 200),
  }).catch(() => []);
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => isActivePosition(row));
  const gapRows = activeRows
    .map((row) => buildNativeTrailProtectionGapRecord(row))
    .filter((row) => row.gap === true);
  const topSymbols = gapRows.reduce((acc, row) => {
    if (!row.symbol) return acc;
    acc.set(row.symbol, (acc.get(row.symbol) || 0) + 1);
    return acc;
  }, new Map());
  return {
    exchange: ex,
    available: true,
    generated_at_ms: Date.now(),
    active_position_count: activeRows.length,
    gap_count: gapRows.length,
    top_symbols: Array.from(topSymbols.entries())
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 20),
    rows: gapRows.slice(0, 100),
  };
}

module.exports = {
  loadNativeTrailProtectionRuntime,
  __test: {
    isActivePosition,
    buildNativeTrailProtectionGapRecord,
  },
};
