#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { getPosition } = require("../src/storage/positionsPaper");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");
const { fetchFuturesUserTrades } = require("../src/exchanges/binanceFuturesPrivate");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { reclassifyExternalFillEvent } = require("../src/storage/fillsPaper");
const { __test: liveTrailRepairTest } = require("../src/services/liveTrailingStageRepair");
const { __test: fillsSyncTest } = require("../src/services/binanceFuturesFillsSync");

const APPLY = String(process.env.APPLY || "0").trim() === "1";
const LOOKBACK_DAYS = Math.max(1, Number(process.env.LOOKBACK_DAYS || 7));
const SYMBOLS = String(process.env.SYMBOLS || "ETHUSDT")
  .split(/[,\n]/)
  .map((value) => String(value || "").trim().toUpperCase())
  .filter(Boolean);
const PAGE_SIZE = Math.max(100, Number(process.env.PAGE_SIZE || 1000));

function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildCanonicalStageEvent(stage, rules) {
  if (stage === "TP0") return fillsSyncTest.normalizeExitEventForRules("EXIT_TP_P0", rules);
  if (stage === "TP1") return fillsSyncTest.normalizeExitEventForRules("EXIT_TP_P1", rules);
  if (stage === "TRAIL") return fillsSyncTest.normalizeExitEventForRules("EXIT_TRAIL", rules);
  return null;
}

function resolveForwardSignedQty(trade, positionSide) {
  const side = String(trade && trade.side || "").trim().toUpperCase();
  const qty = Number(trade && trade.qty || 0);
  if (positionSide === "SHORT") return side === "SELL" ? qty : -qty;
  return side === "BUY" ? qty : -qty;
}

function groupTradesWithMembers(trades = []) {
  const grouped = new Map();
  for (const trade of trades || []) {
    const key = [
      String(trade.orderId || "").trim(),
      String(trade.time || "").trim(),
      String(trade.side || "").trim().toUpperCase(),
    ].join("|");
    const current = grouped.get(key) || {
      orderId: trade.orderId || null,
      time: Number(trade.time) || null,
      side: String(trade.side || "").trim().toUpperCase(),
      qty: 0,
      quoteQty: 0,
      realizedPnl: 0,
      minPrice: Infinity,
      maxPrice: 0,
      tradeIds: [],
    };
    current.qty += Number(trade.qty) || 0;
    current.quoteQty += Number(trade.quoteQty) || 0;
    current.realizedPnl += Number(trade.realizedPnl) || 0;
    const price = Number(trade.price) || 0;
    if (price > 0) {
      current.minPrice = Math.min(current.minPrice, price);
      current.maxPrice = Math.max(current.maxPrice, price);
    }
    if (Number.isFinite(Number(trade.id || trade.tradeId))) {
      current.tradeIds.push(Number(trade.id || trade.tradeId));
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      avgPrice: item.qty > 0 ? item.quoteQty / item.qty : null,
      iso: Number.isFinite(item.time) ? new Date(item.time).toISOString() : null,
    }))
    .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
}

function extractActiveCycleTradeGroups(groupedTrades, { positionQty, positionSide } = {}) {
  const currentQty = Number(positionQty);
  if (!Number.isFinite(currentQty) || currentQty <= 0) return null;
  const cycle = [];
  let balance = currentQty;
  for (let idx = groupedTrades.length - 1; idx >= 0; idx -= 1) {
    const trade = groupedTrades[idx];
    const signedQty = resolveForwardSignedQty(trade, positionSide);
    const prevBalance = balance - signedQty;
    cycle.unshift({
      ...trade,
      signedQty,
      balanceAfter: balance,
      balanceBefore: prevBalance,
    });
    balance = prevBalance;
    if (Math.abs(balance) <= 0.02) return cycle;
  }
  return null;
}

async function scanRecentExternalExitFills(db, symbolsSet) {
  const rows = new Map();
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...doc.data() };
      if (String(row.created_at || "") < sinceIso) continue;
      const symbol = normalizeSymbol(row.symbol || row.symbol_or_pair_id);
      if (!symbol || !symbolsSet.has(symbol)) continue;
      const fillId = String(row.fill_id || row.id || "").trim();
      if (!fillId.startsWith("EXT__")) continue;
      rows.set(fillId, row);
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function buildSymbolCandidates({ db, keys, symbol, fillsById }) {
  const position = await getPosition({ exchange: "BINANCEFUT", symbol });
  if (!position || String(position.state || "").trim().toUpperCase() !== "ACTIVE") {
    return { symbol, skipped: true, reason: "POSITION_NOT_ACTIVE", candidates: [] };
  }
  const meta = (position.meta && typeof position.meta === "object") ? position.meta : {};
  const qtyBase = Math.abs(Number(position.qty_base || 0));
  const side = String(position.position_side || "").trim().toUpperCase();
  if (!qtyBase || !(side === "LONG" || side === "SHORT")) {
    return { symbol, skipped: true, reason: "POSITION_CONTEXT_INVALID", candidates: [] };
  }
  const rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position });
  const trades = await fetchFuturesUserTrades({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    symbol,
    startTime: Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
    limit: 1000,
  });
  const groupedTrades = groupTradesWithMembers(Array.isArray(trades) ? trades : []);
  const cycleGroups = extractActiveCycleTradeGroups(groupedTrades, { positionQty: qtyBase, positionSide: side });
  if (!Array.isArray(cycleGroups) || !cycleGroups.length) {
    return { symbol, skipped: true, reason: "ACTIVE_CYCLE_NOT_FOUND", candidates: [] };
  }
  const stageInfo = liveTrailRepairTest.inferStageFromCycle(cycleGroups, {
    positionQty: qtyBase,
    tp0QtyRatio: toNum(rules && rules.TP_P0_QTY) || 0.25,
    tp1QtyRatio: toNum(rules && rules.TP_P1_QTY) || 0.5,
  });
  const exitGroups = cycleGroups.filter((row) => Number(row.signedQty) < 0);
  if (!exitGroups.length) {
    return { symbol, skipped: true, reason: "EXIT_GROUPS_EMPTY", candidates: [] };
  }
  const tp1OrTrailConfirmed = meta.tp_p1_done === true || meta.trail_active === true;

  const candidates = [];
  exitGroups.forEach((group, index) => {
    let expectedStage = null;
    if (index === 0) expectedStage = "TP0";
    else if (index === 1 && (stageInfo.stage === "TRAIL" || tp1OrTrailConfirmed)) expectedStage = "TP1";
    else if (index >= 1 && stageInfo.stage === "TP0") expectedStage = null;
    else expectedStage = "TRAIL";
    const expectedEvent = buildCanonicalStageEvent(expectedStage, rules);
    if (!expectedEvent) return;
    for (const tradeId of Array.isArray(group.tradeIds) ? group.tradeIds : []) {
      const fillId = `EXT__BINANCEFUT__${symbol}__${tradeId}`;
      const current = fillsById.get(fillId);
      if (!current) continue;
      const currentEvent = String(current.event || "").trim().toUpperCase();
      if (currentEvent === expectedEvent) continue;
      candidates.push({
        symbol,
        fill_id: fillId,
        trade_id: tradeId,
        order_id: Number(group.orderId),
        created_at: group.iso,
        current_event: currentEvent || null,
        expected_event: expectedEvent,
        qty_base: Number(current.exec_qty_base || 0),
        exec_price: Number(current.exec_price || 0),
        stage_info: stageInfo.stage,
        reason: `LIVE_CYCLE_${expectedStage}_CANONICAL_RECLASSIFY`,
      });
    }
  });
  return {
    symbol,
    skipped: false,
    reason: null,
    stage: stageInfo.stage,
    position_qty: qtyBase,
    exit_group_n: exitGroups.length,
    candidates,
  };
}

async function main() {
  const db = getFirestore();
  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) {
    throw new Error("BINANCE_KEYS_MISSING");
  }
  const symbolsSet = new Set(SYMBOLS);
  const fillsById = await scanRecentExternalExitFills(db, symbolsSet);
  const symbolResults = [];
  const candidates = [];
  for (const symbol of SYMBOLS) {
    const res = await buildSymbolCandidates({ db, keys, symbol, fillsById });
    symbolResults.push({
      symbol: res.symbol,
      skipped: !!res.skipped,
      reason: res.reason || null,
      stage: res.stage || null,
      position_qty: res.position_qty || null,
      exit_group_n: res.exit_group_n || 0,
      candidate_n: Array.isArray(res.candidates) ? res.candidates.length : 0,
    });
    if (Array.isArray(res.candidates)) candidates.push(...res.candidates);
  }

  let updated = 0;
  if (APPLY) {
    for (const candidate of candidates) {
      const result = await reclassifyExternalFillEvent({
        fillId: candidate.fill_id,
        event: candidate.expected_event,
        decisionReason: "LIVE_CYCLE_CANONICAL_RECLASSIFIED",
        reclassifyReason: candidate.reason,
        reclassifyScript: "scripts/backfill-live-cycle-exit-fill-events.js",
      });
      if (result && result.ok === true && result.skipped !== true) updated += 1;
    }
  }

  console.log(JSON.stringify({
    generated_at: nowIso(),
    apply: APPLY,
    lookback_days: LOOKBACK_DAYS,
    symbols: SYMBOLS,
    scanned_external_fill_n: fillsById.size,
    candidate_n: candidates.length,
    updated,
    symbol_results: symbolResults,
    candidates,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_LIVE_CYCLE_EXIT_FILL_EVENTS_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
