#!/usr/bin/env node
"use strict";

// scripts/run-v3-live-executor.js — micro-live execution runner (2026-07-15).
//
// Consumes freshly-admitted rows from the PAPER entry ledger (the single
// admission authority) and mirrors them as micro live orders on Binance
// USDT-M futures. Defaults are maximally safe: V3_LIVE_ENABLED=0 and
// V3_LIVE_DRY_RUN=1 — with no env changes this runner only logs what it
// would have done. See src/v3/liveExecutor.js for the full safety model.
//
// Env (in addition to the executor's):
//   V3_LIVE_BINANCE_API_KEY / V3_LIVE_BINANCE_API_SECRET  — trading key.
//     NOTE: the old GCP NAT egress IP was released on 2026-07-02; if the key
//     is IP-allowlisted it must be updated for this machine's IP first.
//   BINANCE_FUTURES_BASE_URL — set to https://testnet.binancefuture.com for
//     the testnet validation phase (transport respects it natively).
//
// Exit recording (increment 2) reconciles closes; brackets placed here
// (closePosition STOP_MARKET + TAKE_PROFIT_MARKET) enforce the exit on-
// exchange even if the local machine dies.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const { decideLiveOrders } = require("../src/v3/liveExecutor");
const priv = require("../src/exchanges/binanceFuturesPrivate");

const ROOT = path.resolve(__dirname, "..");
const PAPER_ENTRY = path.join(ROOT, "ops/runtime/v3_paper_entry_ledger.jsonl");
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

async function executeIntent(intent, keys) {
  const startedAt = new Date().toISOString();
  const base = {
    signal_id: intent.signal_id,
    symbol: intent.symbol,
    side: intent.side,
    tf: intent.tf,
    rr: intent.rr,
    notional_usdt: intent.notional_usdt,
    leverage: intent.leverage,
    signal_price: intent.signal_price,
    stop_price: intent.stop_price,
    target_price: intent.target_price,
    created_at: startedAt,
    source: "V3_LIVE_EXECUTOR",
  };

  if (intent.dry_run) {
    return { ...base, dry_run: true, status: "DRY_RUN", raw_qty: intent.raw_qty };
  }

  // 1. quantity to exchange precision (LOT_SIZE / MIN_NOTIONAL aware)
  const qty = await priv.normalizeFuturesQuantity(intent.symbol, intent.raw_qty);
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
    return { ...base, dry_run: false, status: "ERROR", error: "QTY_NORMALIZE_FAILED", raw_qty: intent.raw_qty };
  }

  // 2. leverage (deterministic per symbol; micro validation runs 1x)
  try { await priv.setFuturesLeverage({ ...keys, symbol: intent.symbol, leverage: intent.leverage }); }
  catch (e) { /* non-fatal: pre-existing leverage is acceptable */ }

  // 3. market entry
  let entryOrder;
  try {
    entryOrder = await priv.placeFuturesMarketOrder({
      ...keys,
      symbol: intent.symbol,
      side: intent.order_side,
      quantity: qty,
      newClientOrderId: `v3live_${intent.signal_id}`.slice(0, 36),
    });
  } catch (e) {
    return { ...base, dry_run: false, status: "ERROR", error: `ENTRY_ORDER_FAIL: ${e && e.message}`, qty };
  }

  // 4. protective bracket — closePosition orders survive local crashes
  let stopOrder = null, tpOrder = null, bracketError = null;
  try {
    stopOrder = await priv.placeFuturesStopMarketOrder({
      ...keys,
      symbol: intent.symbol,
      side: intent.close_side,
      stopPrice: intent.stop_price,
      closePosition: true,
    });
    tpOrder = await priv.placeFuturesTakeProfitMarketOrder({
      ...keys,
      symbol: intent.symbol,
      side: intent.close_side,
      stopPrice: intent.target_price,
      closePosition: true,
    });
  } catch (e) {
    bracketError = String(e && e.message || e);
  }

  return {
    ...base,
    dry_run: false,
    status: bracketError ? "OPEN_BRACKET_INCOMPLETE" : "OPEN",
    qty,
    entry_order_id: entryOrder && (entryOrder.orderId || entryOrder.order_id) || null,
    entry_avg_price: Number(entryOrder && (entryOrder.avgPrice || entryOrder.avg_price)) || null,
    stop_order_id: stopOrder && stopOrder.orderId || null,
    tp_order_id: tpOrder && tpOrder.orderId || null,
    bracket_error: bracketError,
  };
}

async function main() {
  const paperEntries = readJsonl(PAPER_ENTRY);
  const liveEntryRows = readJsonl(LIVE_ENTRY);
  const liveExitRows = readJsonl(LIVE_EXIT);

  const decision = decideLiveOrders({ paperEntries, liveEntryRows, liveExitRows });

  const keys = resolveKeys();
  const sending = decision.intents.some((i) => !i.dry_run);
  if (sending && (!keys.apiKey || !keys.apiSecret)) {
    console.log(JSON.stringify({ ok: false, reason: "V3_LIVE_KEYS_MISSING", intents_n: decision.intents.length }));
    process.exit(1);
  }
  if (sending) {
    // hedge-mode check: closePosition bracket semantics assume one-way mode
    try {
      const mode = await priv.fetchFuturesPositionMode({ ...keys });
      if (mode && (mode.dualSidePosition === true || mode.dual_side_position === true)) {
        console.log(JSON.stringify({ ok: false, reason: "HEDGE_MODE_UNSUPPORTED" }));
        process.exit(1);
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: false, reason: `POSITION_MODE_CHECK_FAIL: ${e && e.message}` }));
      process.exit(1);
    }
  }

  const results = [];
  for (const intent of decision.intents) {
    const row = await executeIntent(intent, keys);
    appendJsonl(LIVE_ENTRY, row);
    results.push({ signal_id: row.signal_id, status: row.status });
  }

  console.log(JSON.stringify({
    ok: true,
    live_enabled: decision.config.live_enabled,
    dry_run: decision.config.dry_run,
    base_url: priv.getFuturesBaseUrl(),
    paper_entry_n: paperEntries.length,
    intents_n: decision.intents.length,
    executed: results,
    skipped: decision.skipped,
    live_open_total: decision.live_open_total,
    live_today_realized_r: decision.live_today_realized_r,
    live_kill_active: decision.live_kill_active,
  }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("RUN_V3_LIVE_EXECUTOR_FAIL", e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}

module.exports = { __test: { readJsonl, resolveKeys } };
