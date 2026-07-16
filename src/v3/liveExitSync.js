"use strict";

// src/v3/liveExitSync.js — micro-live exit recording, increment 2 (2026-07-15).
//
// Pure logic (no network): given live entry rows and exchange order/trade
// state fetched by the runner, decide which live positions closed and
// measure what micro-live exists to measure — REAL entry/exit prices and
// fees versus the paper assumption (fill at signal_price, exit exactly at
// stop/target, zero fees). Output rows land in v3_live_exit_ledger.jsonl
// with per-trade slippage and fee in R units, so the live-vs-paper report
// can produce the one number that gates full live: measured cost per trade.
//
// Dry-run rows close by MIRRORING the paper exit for the same signal_id
// (zero slippage / zero fee). That lets the whole executor→sync→report loop
// run for weeks with V3_LIVE_DRY_RUN=1 as a pipeline health check.

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function upper(v) { const s = String(v == null ? "" : v).trim(); return s ? s.toUpperCase() : null; }

const { latestRowsBySignalId } = require("./liveLedgerView");

// Live entry rows that still need exit resolution, split by mode.
// 2026-07-16: reads through latestRowsBySignalId — bracket REPAIR appends a
// fresh row per signal_id, and exits must resolve against the repaired
// order ids, never the superseded originals.
function buildOpenLiveEntries(liveEntryRows = [], liveExitRows = []) {
  const closed = new Set();
  for (const r of Array.isArray(liveExitRows) ? liveExitRows : []) {
    if (r && r.signal_id && upper(r.status) === "CLOSED") closed.add(r.signal_id);
  }
  const real = [];
  const dryRun = [];
  for (const r of latestRowsBySignalId(liveEntryRows).values()) {
    if (closed.has(r.signal_id)) continue;
    const st = upper(r.status);
    if (r.dry_run === true && st === "DRY_RUN") dryRun.push(r);
    else if (r.dry_run !== true && (st === "OPEN" || st === "OPEN_BRACKET_INCOMPLETE")) real.push(r);
  }
  return Object.freeze({ real: Object.freeze(real), dry_run: Object.freeze(dryRun) });
}

// Decide whether a real position closed, from its bracket order states.
// stopOrder / tpOrder are Binance order objects (or null if unfetchable).
// Returns null while still open; otherwise { exit_event, exit_order,
// sibling_order_id, anomaly }.
function resolveLiveExitFromBracket({ entryRow = {}, stopOrder = null, tpOrder = null } = {}) {
  const filled = (o) => o && upper(o.status) === "FILLED";
  const stopFilled = filled(stopOrder);
  const tpFilled = filled(tpOrder);
  if (!stopFilled && !tpFilled) return null;

  if (stopFilled && tpFilled) {
    // should be impossible with closePosition brackets — take the earlier
    // fill as the real exit and flag the anomaly for manual review.
    const stopT = num(stopOrder.updateTime) || 0;
    const tpT = num(tpOrder.updateTime) || 0;
    const useStop = stopT <= tpT;
    return Object.freeze({
      exit_event: useStop ? "SL_HIT" : "TP_HIT",
      exit_order: useStop ? stopOrder : tpOrder,
      sibling_order_id: useStop ? (tpOrder.orderId || null) : (stopOrder.orderId || null),
      anomaly: "BOTH_BRACKET_LEGS_FILLED",
    });
  }
  const exitOrder = stopFilled ? stopOrder : tpOrder;
  const sibling = stopFilled ? tpOrder : stopOrder;
  return Object.freeze({
    exit_event: stopFilled ? "SL_HIT" : "TP_HIT",
    exit_order: exitOrder,
    sibling_order_id: sibling && sibling.orderId != null ? sibling.orderId : null,
    anomaly: null,
  });
}

// Sum commissions from userTrades rows for the given order ids.
// Only USDT commissions fold into fee_usdt; other assets (e.g. BNB fee
// discount) are surfaced separately so the report can flag them.
function summarizeFees(userTrades = [], orderIds = []) {
  const wanted = new Set((orderIds || []).filter((x) => x != null).map(String));
  let feeUsdt = 0;
  const otherAssets = Object.create(null);
  for (const t of Array.isArray(userTrades) ? userTrades : []) {
    if (!t || !wanted.has(String(t.orderId))) continue;
    const c = num(t.commission);
    if (c === null) continue;
    const asset = upper(t.commissionAsset) || "UNKNOWN";
    if (asset === "USDT") feeUsdt += c;
    else otherAssets[asset] = (otherAssets[asset] || 0) + c;
  }
  return Object.freeze({ fee_usdt: feeUsdt, other_assets: Object.freeze(otherAssets) });
}

// Measure realized R + slippage/fees in R units against the paper basis.
//   paper basis: entry at signal_price, exit exactly at stop/target, no fee.
//   risk unit  : |signal_price - stop_price| per contract-unit (paper's R).
// Slippage sign convention: POSITIVE = favorable to us.
function computeLiveRealizedMetrics({
  entryRow = {},
  exitEvent = null,
  entryAvgPrice = null,
  exitAvgPrice = null,
  feeUsdt = 0,
  qty = null,
} = {}) {
  const side = upper(entryRow.side);
  const sig = num(entryRow.signal_price);
  const stop = num(entryRow.stop_price);
  const target = num(entryRow.target_price);
  const entryAvg = num(entryAvgPrice);
  const exitAvg = num(exitAvgPrice);
  const q = num(qty) ?? num(entryRow.qty);
  if (!side || sig === null || stop === null || entryAvg === null || exitAvg === null) return null;
  const riskPerUnit = Math.abs(sig - stop);
  if (!(riskPerUnit > 0)) return null;
  const dir = side === "LONG" ? 1 : -1;

  const grossR = (dir * (exitAvg - entryAvg)) / riskPerUnit;
  const riskUsdt = q !== null && q > 0 ? riskPerUnit * q : null;
  const feeR = riskUsdt ? (num(feeUsdt) || 0) / riskUsdt : null;
  const netR = feeR !== null ? grossR - feeR : grossR;

  // entry slippage: favorable if we entered better than signal_price
  const slipEntryR = (dir * (sig - entryAvg)) / riskPerUnit;
  // exit slippage vs the level the exit_event was supposed to fill at
  const intendedExit = exitEvent === "TP_HIT" ? target : stop;
  const slipExitR = intendedExit !== null ? (dir * (exitAvg - intendedExit)) / riskPerUnit : null;

  const round = (v, d = 6) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return Object.freeze({
    realized_r_gross: round(grossR),
    fee_r: round(feeR),
    realized_r: round(netR),
    slippage_entry_r: round(slipEntryR),
    slippage_exit_r: round(slipExitR),
    risk_usdt: round(riskUsdt, 4),
    fee_usdt: round(num(feeUsdt) || 0, 6),
  });
}

// Dry-run rows mirror the paper exit exactly (pipeline health check).
function mirrorDryRunExit(entryRow = {}, paperExitRow = {}) {
  if (!entryRow || !paperExitRow || entryRow.signal_id !== paperExitRow.signal_id) return null;
  if (upper(paperExitRow.status) !== "CLOSED") return null;
  return Object.freeze({
    signal_id: entryRow.signal_id,
    symbol: upper(entryRow.symbol),
    side: upper(entryRow.side),
    dry_run: true,
    status: "CLOSED",
    closed_at: paperExitRow.closed_at || new Date().toISOString(),
    exit_event: paperExitRow.exit_event || null,
    entry_avg_price: num(entryRow.signal_price),
    exit_avg_price: num(paperExitRow.exit_price),
    realized_r_gross: num(paperExitRow.realized_r),
    fee_r: 0,
    realized_r: num(paperExitRow.realized_r),
    slippage_entry_r: 0,
    slippage_exit_r: 0,
    fee_usdt: 0,
    source: "V3_LIVE_EXIT_SYNC_DRY_RUN_MIRROR",
  });
}

module.exports = Object.freeze({
  buildOpenLiveEntries,
  resolveLiveExitFromBracket,
  summarizeFees,
  computeLiveRealizedMetrics,
  mirrorDryRunExit,
});
