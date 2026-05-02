"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CACHE_FILE = path.join(process.cwd(), "ops", "daily", "cache", "firestore_recent", "fills_paper.json");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function parseSymbolSet(value) {
  const out = new Set();
  for (const token of String(value || "").split(/[|,\s]+/)) {
    const symbol = upper(token);
    if (symbol) out.add(symbol);
  }
  return out;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function timestampMs(row) {
  const direct = toNumberOrNull(row && (row.created_at_ms || row.ts_ms || row.time_ms || row.bar_close_time_utc_ms));
  if (direct !== null) return direct;
  const text = trimOrNull(row && (row.created_at || row.updated_at || row.filled_at || row.time));
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function realizedPnlNet(row) {
  const gross = toNumberOrNull(row && (
    row.realized_pnl
    ?? row.external_realized_pnl
    ?? row.realizedPnl
    ?? row.pnl
  ));
  if (gross === null) return null;
  const fee = toNumberOrNull(row && (row.fee_value ?? row.commission ?? row.fee));
  return gross - (fee || 0);
}

function isRealizedExitRow(row) {
  const pnl = realizedPnlNet(row);
  if (pnl === null || pnl === 0) return false;
  const action = upper(row && (row.action || row.event || row.canonical_exit_event));
  if (!action) return false;
  return action.startsWith("EXIT_") || action === "SYNC_FILL";
}

function tradeGroupKey(row) {
  const symbol = upper(row && (row.symbol || row.market || row.pair)) || "UNKNOWN";
  return trimOrNull(row && (
    row.entry_event_id
    || row.position_cycle_id
    || row.canonical_exit_chain_key
    || row.authoritative_exit_chain_key
    || row.signal_id
    || row.signal_doc_id
  )) || `${symbol}__${timestampMs(row) || trimOrNull(row && row.id) || "UNKNOWN"}`;
}

function summarizeRecentRealizedPerformance({
  fills = [],
  nowMs = Date.now(),
  lookbackHours = 72,
} = {}) {
  const sinceMs = nowMs - Math.max(1, Number(lookbackHours) || 72) * 60 * 60 * 1000;
  const groups = new Map();
  for (const row of asArray(fills)) {
    if (!isRealizedExitRow(row)) continue;
    const ms = timestampMs(row);
    if (!Number.isFinite(ms) || ms < sinceMs || ms > nowMs + 60_000) continue;
    const key = tradeGroupKey(row);
    const current = groups.get(key) || {
      key,
      symbol: upper(row && (row.symbol || row.market || row.pair)) || "UNKNOWN",
      pnl: 0,
      exit_n: 0,
      sl_n: 0,
      tp_n: 0,
      external_n: 0,
      latest_ms: 0,
    };
    const action = upper(row && (row.action || row.event || row.canonical_exit_event)) || "";
    current.pnl += realizedPnlNet(row) || 0;
    current.exit_n += 1;
    current.latest_ms = Math.max(current.latest_ms, ms);
    if (action.includes("SL")) current.sl_n += 1;
    if (action.includes("TP") || action.includes("TRAIL")) current.tp_n += 1;
    if (action.includes("EXTERNAL") || action.includes("UNVERIFIED")) current.external_n += 1;
    groups.set(key, current);
  }

  const bySymbol = {};
  for (const group of groups.values()) {
    const symbol = group.symbol || "UNKNOWN";
    bySymbol[symbol] = bySymbol[symbol] || {
      symbol,
      trade_n: 0,
      win_n: 0,
      loss_n: 0,
      net_pnl_quote: 0,
      sl_n: 0,
      tp_n: 0,
      external_n: 0,
    };
    const row = bySymbol[symbol];
    row.trade_n += 1;
    row.net_pnl_quote += group.pnl;
    row.sl_n += group.sl_n > 0 ? 1 : 0;
    row.tp_n += group.tp_n > 0 ? 1 : 0;
    row.external_n += group.external_n > 0 ? 1 : 0;
    if (group.pnl > 0) row.win_n += 1;
    if (group.pnl < 0) row.loss_n += 1;
  }
  for (const row of Object.values(bySymbol)) {
    row.win_rate_pct = row.trade_n > 0 ? (row.win_n / row.trade_n) * 100 : null;
    row.net_pnl_quote = Number(row.net_pnl_quote.toFixed(8));
  }
  return Object.freeze({
    group_n: groups.size,
    by_symbol: Object.freeze(Object.fromEntries(Object.entries(bySymbol).map(([symbol, row]) => [symbol, Object.freeze(row)]))),
  });
}

function readCacheFills(cacheFile = DEFAULT_CACHE_FILE) {
  if (!fs.existsSync(cacheFile)) return null;
  const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.docs)) return parsed.docs.map((row) => row && row.data ? row.data : row);
  return null;
}

async function loadRecentFills({ db = null, limit = 1500, cacheFile = DEFAULT_CACHE_FILE } = {}) {
  if (db && typeof db.collection === "function") {
    const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limit).get();
    const rows = [];
    if (snap && typeof snap.forEach === "function") {
      snap.forEach((doc) => rows.push({ id: doc.id, ...(doc.data() || {}) }));
    } else if (snap && Array.isArray(snap.docs)) {
      for (const doc of snap.docs) rows.push({ id: doc.id, ...(doc.data() || {}) });
    }
    return rows;
  }
  const cached = readCacheFills(cacheFile);
  return Array.isArray(cached) ? cached : [];
}

async function evaluateDiscoveryCanaryRealizedPerformanceGuard({
  env = process.env,
  db = null,
  symbol = null,
  fills = null,
  nowMs = Date.now(),
} = {}) {
  const enabled = parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_ENABLED, false);
  const sym = upper(symbol);
  const quarantine = parseSymbolSet(env.DONBEOLJA_V2_DISCOVERY_CANARY_QUARANTINE_SYMBOLS);
  if (sym && quarantine.has(sym)) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_SYMBOL_QUARANTINED",
      blockers: Object.freeze(["DISCOVERY_CANARY_REALIZED_GUARD:SYMBOL_QUARANTINED"]),
      symbol: sym,
    });
  }
  if (!enabled) {
    return Object.freeze({ ok: true, reason: "V2_DISCOVERY_CANARY_REALIZED_GUARD_DISABLED", symbol: sym });
  }
  if (!sym) {
    return Object.freeze({ ok: false, reason: "V2_DISCOVERY_CANARY_REALIZED_GUARD_SYMBOL_REQUIRED" });
  }

  const lookbackHours = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_LOOKBACK_HOURS) ?? 72;
  const minTrades = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_TRADES) ?? 4;
  const minWinRatePct = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_WIN_RATE_PCT) ?? 35;
  const maxNetLossQuote = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_NET_LOSS_QUOTE) ?? 2;
  const maxSlN = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_SL_N) ?? 4;
  let rows = [];
  try {
    rows = Array.isArray(fills)
      ? fills
      : await loadRecentFills({ db, limit: toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_FILL_LIMIT) || 1500 });
  } catch (error) {
    const requireEvidence = parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_REQUIRE_EVIDENCE, false);
    return Object.freeze({
      ok: requireEvidence !== true,
      reason: requireEvidence === true
        ? "V2_DISCOVERY_CANARY_REALIZED_GUARD_EVIDENCE_UNAVAILABLE"
        : "V2_DISCOVERY_CANARY_REALIZED_GUARD_EVIDENCE_UNAVAILABLE_REPORT_ONLY",
      symbol: sym,
      error: error && error.message ? String(error.message) : String(error),
    });
  }
  const summary = summarizeRecentRealizedPerformance({ fills: rows, nowMs, lookbackHours });
  const stats = summary.by_symbol[sym] || null;
  if (!stats || stats.trade_n < minTrades) {
    return Object.freeze({
      ok: true,
      reason: "V2_DISCOVERY_CANARY_REALIZED_GUARD_INSUFFICIENT_SAMPLE",
      symbol: sym,
      lookback_hours: lookbackHours,
      symbol_stats: stats,
    });
  }
  const blockers = [];
  const netLossBlocked = stats.net_pnl_quote <= -Math.abs(maxNetLossQuote);
  const slClusterBlocked = stats.sl_n >= maxSlN;
  const winRateBlocked = stats.win_rate_pct !== null
    && stats.win_rate_pct < minWinRatePct
    && (netLossBlocked || slClusterBlocked);
  if (netLossBlocked) blockers.push("DISCOVERY_CANARY_REALIZED_GUARD:NET_LOSS_LIMIT");
  if (winRateBlocked) blockers.push("DISCOVERY_CANARY_REALIZED_GUARD:WIN_RATE_BELOW_FLOOR");
  if (slClusterBlocked) blockers.push("DISCOVERY_CANARY_REALIZED_GUARD:SL_CLUSTER");
  if (blockers.length) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_REALIZED_SYMBOL_GUARD_BLOCKED",
      blockers: Object.freeze(blockers),
      symbol: sym,
      lookback_hours: lookbackHours,
      thresholds: Object.freeze({ min_trades: minTrades, min_win_rate_pct: minWinRatePct, max_net_loss_quote: maxNetLossQuote, max_sl_n: maxSlN }),
      symbol_stats: stats,
    });
  }
  return Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_CANARY_REALIZED_GUARD_PASS",
    symbol: sym,
    lookback_hours: lookbackHours,
    symbol_stats: stats,
  });
}

module.exports = {
  evaluateDiscoveryCanaryRealizedPerformanceGuard,
  summarizeRecentRealizedPerformance,
  loadRecentFills,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    parseBool,
    parseSymbolSet,
    timestampMs,
    realizedPnlNet,
    isRealizedExitRow,
    tradeGroupKey,
  },
};
