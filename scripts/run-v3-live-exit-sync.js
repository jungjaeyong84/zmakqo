#!/usr/bin/env node
"use strict";

// scripts/run-v3-live-exit-sync.js — micro-live exit recorder (increment 2).
//
// For each still-open live entry:
//   real rows    — fetch both bracket orders; if one FILLED, record the close
//                  with REAL avg prices + fees (userTrades), cancel the
//                  surviving sibling leg, and append a CLOSED row with
//                  slippage/fee measurements in R units.
//   dry-run rows — mirror the paper exit for the same signal_id (zero
//                  slippage/fees) so the full pipeline exercises end-to-end
//                  under V3_LIVE_DRY_RUN=1.
//
// Fee lookup: userTrades filtered by the entry + exit order ids. Non-USDT
// commissions (BNB discount) are surfaced in `fee_other_assets` and NOT
// folded into fee_r — the report flags them for manual conversion.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const {
  buildOpenLiveEntries,
  resolveLiveExitFromBracket,
  summarizeFees,
  computeLiveRealizedMetrics,
  mirrorDryRunExit,
} = require("../src/v3/liveExitSync");
const {
  decideBracketRepair,
  buildRepairedEntryRow,
  buildExternalCloseExitRow,
} = require("../src/v3/liveBracketRepair");
const { alertOnce } = require("../src/v3/opsAlert");
const priv = require("../src/exchanges/binanceFuturesPrivate");

const ALERT_STATE = require("path").join(__dirname, "..", "ops/runtime/v3_ops_alert_state.json");

const ROOT = path.resolve(__dirname, "..");
const PAPER_EXIT = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");
const LIVE_ENTRY = path.join(ROOT, "ops/runtime/v3_live_entry_ledger.jsonl");
const LIVE_EXIT = path.join(ROOT, "ops/runtime/v3_live_exit_ledger.jsonl");

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
function appendJsonl(p, row) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + "\n", "utf8");
}
function resolveKeys() {
  return {
    apiKey: String(process.env.V3_LIVE_BINANCE_API_KEY || "").trim(),
    apiSecret: String(process.env.V3_LIVE_BINANCE_API_SECRET || "").trim(),
  };
}

// qty-weighted average fill price from userTrades rows of one order
function weightedAvgFromTrades(trades = [], orderId = null) {
  if (orderId == null) return null;
  let notional = 0, qty = 0;
  for (const t of trades) {
    if (!t || String(t.orderId) !== String(orderId)) continue;
    const p = Number(t.price), q = Number(t.qty);
    if (!Number.isFinite(p) || !Number.isFinite(q) || q <= 0) continue;
    notional += p * q; qty += q;
  }
  return qty > 0 ? notional / qty : null;
}

async function syncRealEntry(entryRow, keys) {
  const symbol = entryRow.symbol;
  const fetchOrder = async (orderId) => {
    if (orderId == null) return null;
    try { return await priv.fetchFuturesOrder({ ...keys, symbol, orderId }); }
    catch (_) { return null; }
  };
  const stopOrder = await fetchOrder(entryRow.stop_order_id);
  const tpOrder = await fetchOrder(entryRow.tp_order_id);
  const resolved = resolveLiveExitFromBracket({ entryRow, stopOrder, tpOrder });
  if (!resolved) return null; // still open

  // fees + true avg prices from user trades (entry order + exit order)
  let trades = [];
  try {
    trades = await priv.fetchFuturesUserTrades({
      ...keys, symbol,
      startTime: Date.parse(entryRow.created_at) - 60 * 1000,
    }) || [];
  } catch (_) { trades = []; }
  const exitOrderId = resolved.exit_order && resolved.exit_order.orderId;
  const fees = summarizeFees(trades, [entryRow.entry_order_id, exitOrderId]);

  // entry avg: recorded at placement > weighted from trades > signal price
  // (exit price is never a fallback for the entry side).
  const entryAvg = Number(entryRow.entry_avg_price)
    || weightedAvgFromTrades(trades, entryRow.entry_order_id)
    || Number(entryRow.signal_price);
  const exitAvg = priv.calcAveragePrice(resolved.exit_order)
    || weightedAvgFromTrades(trades, exitOrderId);

  const metrics = computeLiveRealizedMetrics({
    entryRow,
    exitEvent: resolved.exit_event,
    entryAvgPrice: entryAvg,
    exitAvgPrice: exitAvg,
    feeUsdt: fees.fee_usdt,
    qty: entryRow.qty,
  });

  // cancel the surviving sibling leg (precise, by order id)
  let siblingCancelError = null;
  if (resolved.sibling_order_id != null) {
    try { await priv.cancelFuturesOrder({ ...keys, symbol, orderId: resolved.sibling_order_id }); }
    catch (e) { siblingCancelError = String(e && e.message || e); }
  }

  return {
    signal_id: entryRow.signal_id,
    symbol,
    side: entryRow.side,
    dry_run: false,
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    exit_event: resolved.exit_event,
    entry_avg_price: Number(entryAvg) || null,
    exit_avg_price: Number(exitAvg) || null,
    ...(metrics || { realized_r: null, metrics_error: "METRICS_UNCOMPUTABLE" }),
    fee_other_assets: fees.other_assets,
    anomaly: resolved.anomaly,
    sibling_cancel_error: siblingCancelError,
    source: "V3_LIVE_EXIT_SYNC",
  };
}

async function main() {
  const liveEntryRows = readJsonl(LIVE_ENTRY);
  const liveExitRows = readJsonl(LIVE_EXIT);
  const open = buildOpenLiveEntries(liveEntryRows, liveExitRows);

  const results = [];

  // dry-run mirror (no network)
  if (open.dry_run.length) {
    const paperExits = new Map(readJsonl(PAPER_EXIT).map((r) => [r.signal_id, r]));
    for (const e of open.dry_run) {
      const row = mirrorDryRunExit(e, paperExits.get(e.signal_id) || {});
      if (row) { appendJsonl(LIVE_EXIT, row); results.push({ signal_id: row.signal_id, status: "CLOSED", mode: "dry_run" }); }
    }
  }

  // real closes (network) — with naked-position bracket repair
  if (open.real.length) {
    const keys = resolveKeys();
    if (!keys.apiKey || !keys.apiSecret) {
      console.log(JSON.stringify({ ok: false, reason: "V3_LIVE_KEYS_MISSING", open_real_n: open.real.length }));
      process.exit(1);
    }

    // one account snapshot per cycle for repair decisions
    let positionsBySymbol = null;
    const needsRepair = open.real.filter((e) => String(e.status).toUpperCase() === "OPEN_BRACKET_INCOMPLETE");
    if (needsRepair.length) {
      try {
        const account = await priv.fetchBinanceFuturesAccount({ ...keys });
        positionsBySymbol = new Map();
        for (const p of (account && account.positions) || []) {
          const amt = Number(p.positionAmt);
          if (Number.isFinite(amt) && amt !== 0) positionsBySymbol.set(String(p.symbol).toUpperCase(), amt);
        }
      } catch (e) {
        results.push({ step: "REPAIR_ACCOUNT_FETCH", status: "ERROR", error: String(e && e.message || e) });
      }
    }

    for (const e of open.real) {
      try {
        // ---- bracket repair (the naked-position hole) --------------------
        if (String(e.status).toUpperCase() === "OPEN_BRACKET_INCOMPLETE" && positionsBySymbol) {
          const fetchOrder = async (orderId) => {
            if (orderId == null) return null;
            try { return await priv.fetchFuturesOrder({ ...keys, symbol: e.symbol, orderId }); } catch (_) { return null; }
          };
          const decision = decideBracketRepair({
            entryRow: e,
            positionAmt: positionsBySymbol.get(String(e.symbol).toUpperCase()) || 0,
            stopOrder: await fetchOrder(e.stop_order_id),
            tpOrder: await fetchOrder(e.tp_order_id),
          });
          if (decision.action === "CLOSE_EXTERNAL") {
            const row = buildExternalCloseExitRow(e);
            appendJsonl(LIVE_EXIT, row);
            results.push({ signal_id: e.signal_id, status: "CLOSED", exit_event: row.exit_event, needs_review: true });
            await alertOnce({
              stateFile: ALERT_STATE, key: `external_close_${e.signal_id}`, active: true,
              title: "⚠️ v3 live: 외부 종결/미체결 감지", severity: "warn",
              body: `${e.symbol} ${e.side} (${e.signal_id}) — 거래소 플랫인데 원장은 OPEN이었음. 수동 확인 필요.`,
            });
            continue; // superseded — no exit resolution this cycle
          }
          if (decision.action === "ANOMALY") {
            results.push({ signal_id: e.signal_id, status: "REPAIR_ANOMALY", reason: decision.reason });
            await alertOnce({
              stateFile: ALERT_STATE, key: `repair_anomaly_${e.signal_id}`, active: true,
              title: "🚨 v3 live: 브래킷 수리 불가 anomaly", severity: "error",
              body: `${e.symbol} ${e.side} (${e.signal_id}) — ${decision.reason}. 자동수리 금지 조건, 즉시 수동 개입 필요.`,
            });
            continue;
          }
          if (decision.action.startsWith("REPLACE")) {
            const legs = [];
            let newStopId = null, newTpId = null, repairError = null;
            try {
              if (decision.action !== "REPLACE_TP") {
                const o = await priv.placeFuturesStopMarketOrder({
                  ...keys, symbol: e.symbol,
                  side: String(e.side).toUpperCase() === "LONG" ? "SELL" : "BUY",
                  stopPrice: e.stop_price, closePosition: true,
                });
                newStopId = o && o.orderId; legs.push("STOP");
              }
              if (decision.action !== "REPLACE_STOP") {
                const o = await priv.placeFuturesTakeProfitMarketOrder({
                  ...keys, symbol: e.symbol,
                  side: String(e.side).toUpperCase() === "LONG" ? "SELL" : "BUY",
                  stopPrice: e.target_price, closePosition: true,
                });
                newTpId = o && o.orderId; legs.push("TP");
              }
            } catch (err) { repairError = String(err && err.message || err); }
            if (legs.length && !repairError) {
              const repairedRow = buildRepairedEntryRow(e, { stopOrderId: newStopId, tpOrderId: newTpId, repairedLegs: legs });
              appendJsonl(LIVE_ENTRY, repairedRow);
              results.push({ signal_id: e.signal_id, status: "BRACKET_REPAIRED", legs });
            } else {
              results.push({ signal_id: e.signal_id, status: "REPAIR_FAILED", error: repairError });
            }
            await alertOnce({
              stateFile: ALERT_STATE, key: `bracket_repair_${e.signal_id}`, active: true,
              title: repairError ? "🚨 v3 live: 브래킷 수리 실패" : "⚠️ v3 live: 벌거벗은 포지션 수리됨",
              severity: repairError ? "error" : "warn",
              body: `${e.symbol} ${e.side} (${e.signal_id}) — ${decision.reason} → ${repairError ? `수리 실패: ${repairError} — 즉시 수동 개입!` : `레그 재설치: ${legs.join("+")}`}`,
            });
            continue; // exits resolve next cycle against the repaired row
          }
          // decision NONE → legs healthy; append authoritative OPEN row so
          // the incomplete status stops re-triggering repair each cycle
          appendJsonl(LIVE_ENTRY, buildRepairedEntryRow(e, { repairedLegs: [] }));
        }

        const row = await syncRealEntry(e, keys);
        if (row) { appendJsonl(LIVE_EXIT, row); results.push({ signal_id: row.signal_id, status: "CLOSED", exit_event: row.exit_event }); }
      } catch (err) {
        results.push({ signal_id: e.signal_id, status: "SYNC_ERROR", error: String(err && err.message || err) });
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    open_real_n: open.real.length,
    open_dry_run_n: open.dry_run.length,
    closed_this_cycle: results,
  }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("RUN_V3_LIVE_EXIT_SYNC_FAIL", e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}
