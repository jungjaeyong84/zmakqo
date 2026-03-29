#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOrder,
  fetchFuturesUserTrades,
} = require("../src/exchanges/binanceFuturesPrivate");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { normalizeMarketSymbolForProvider } = require("../src/utils/marketConfig");

const ROOT_DIR = path.resolve(__dirname, "..");
const NOYE_DIR = path.join(ROOT_DIR, "noye");

const ROLE_META = {
  ceo: { name: "ceo" },
  pine_dev: { name: "pine_dev" },
  system_dev: { name: "system_dev" },
  qa_manager: { name: "qa_manager" },
  performance_analyst: { name: "performance_analyst" },
  quant_trainer: { name: "quant_trainer" },
  risk_manager: { name: "risk_manager" },
  execution_engineer: { name: "execution_engineer" },
  capital_allocator: { name: "capital_allocator" },
  data_reliability_engineer: { name: "data_reliability_engineer" },
  sre_manager: { name: "sre_manager" },
  security_auditor: { name: "security_auditor" },
  hallucination_auditor: { name: "hallucination_auditor" },
};

const CLIENT_ID_ROLE_RULES = [
  { role_id: "ceo", tests: [/\bceo\b/, /\bjihye\b/, /\bleader\b/] },
  { role_id: "pine_dev", tests: [/\bpine\b/, /\bpinescript\b/, /\bstrategy\b/, /\bstrat\b/] },
  { role_id: "system_dev", tests: [/\bsystem\b/, /\bsys\b/, /\bbackend\b/, /\bengine\b/] },
  { role_id: "qa_manager", tests: [/\bqa\b/, /\bquality\b/, /\btest\b/] },
  { role_id: "performance_analyst", tests: [/\bperformance\b/, /\banalyst\b/, /\bkpi\b/] },
  { role_id: "quant_trainer", tests: [/\bquant\b/, /\btrainer\b/] },
  { role_id: "risk_manager", tests: [/\brisk\b/, /\bstop\b/, /\bsl\b/, /\btp\b/] },
  { role_id: "execution_engineer", tests: [/\bexecution\b/, /\bexec\b/, /\bmicro\b/, /\bfill\b/] },
  { role_id: "capital_allocator", tests: [/\bcapital\b/, /\balloc\b/, /\bportfolio\b/] },
  { role_id: "data_reliability_engineer", tests: [/\bdata\b/, /\breliability\b/, /\bdr\b/] },
  { role_id: "sre_manager", tests: [/\bsre\b/, /\boncall\b/, /\brecovery\b/] },
  { role_id: "security_auditor", tests: [/\bsecurity\b/, /\bsec\b/, /\bauth\b/] },
  { role_id: "hallucination_auditor", tests: [/\bhallucination\b/, /\baudit\b/, /\bverify\b/] },
];

function nowIso() {
  return new Date().toISOString();
}

function toKst(iso) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} KST`;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v == null) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function safeString(v, max = 200) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 12)}...(truncated)`;
}

function round(v, digits = 8) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function normalizeSymbol(raw) {
  const norm = normalizeMarketSymbolForProvider(raw, "BINANCEFUT");
  return String(norm || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseArg(name, fallback = "") {
  const idx = process.argv.findIndex((x) => x === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]);
  return fallback;
}

function parseArgInt(name, fallback) {
  const raw = parseArg(name, "");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function listFromCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJsonl(filePath, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.appendFileSync(filePath, `${body}\n`);
}

function uniqueSortedSymbols(list, maxSymbols) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const sym = normalizeSymbol(raw);
    if (!sym || seen.has(sym)) return;
    if (!sym.endsWith("USDT")) return;
    seen.add(sym);
    out.push(sym);
  });
  return out.slice(0, Math.max(1, maxSymbols));
}

async function resolveApiKeys() {
  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "").trim();
  if (!apiKey || !apiSecret) return { ok: false, reason: "BINANCE_KEYS_MISSING", ex };
  if (!process.env.BINANCEFUT_API_KEY) process.env.BINANCEFUT_API_KEY = apiKey;
  if (!process.env.BINANCEFUT_API_SECRET) process.env.BINANCEFUT_API_SECRET = apiSecret;
  return { ok: true, apiKey, apiSecret, ex };
}

async function resolveSymbols({ explicitSymbols, ex, apiKey, apiSecret, maxSymbols }) {
  const fromSettings = Array.isArray(ex && ex.markets) ? ex.markets : [];
  const seeds = [...(Array.isArray(explicitSymbols) ? explicitSymbols : []), ...fromSettings];
  let symbols = uniqueSortedSymbols(seeds, maxSymbols);

  if (symbols.length >= Math.max(4, Math.floor(maxSymbols / 2))) return symbols;

  try {
    const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret, recvWindow: 7000 });
    const positions = Array.isArray(account && account.positions) ? account.positions : [];
    const fromPositions = positions
      .filter((p) => Math.abs(toNum(p && p.positionAmt, 0)) > 0 || toNum(p && p.openOrderInitialMargin, 0) > 0)
      .map((p) => String(p && p.symbol ? p.symbol : "").toUpperCase());
    symbols = uniqueSortedSymbols([...symbols, ...fromPositions], maxSymbols);
  } catch {}

  if (!symbols.length) {
    symbols = uniqueSortedSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"], maxSymbols);
  }
  return symbols;
}

function dedupeTrades(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const symbol = normalizeSymbol(row.symbol || "");
    const tradeId = toNum(row.id, NaN);
    const key = `${symbol}:${Number.isFinite(tradeId) ? tradeId : safeString(row.orderId, 40)}:${toNum(row.time, 0)}`;
    if (!symbol) return;
    map.set(key, { ...row, symbol });
  });
  return [...map.values()].sort((a, b) => {
    const ta = toNum(a && a.time, 0);
    const tb = toNum(b && b.time, 0);
    if (ta !== tb) return ta - tb;
    return toNum(a && a.id, 0) - toNum(b && b.id, 0);
  });
}

async function fetchTradesForSymbol({
  apiKey,
  apiSecret,
  symbol,
  startMs,
  endMs,
  limit,
  maxPages,
}) {
  const out = [];
  let cursorMs = startMs;
  let pages = 0;

  while (cursorMs < endMs && pages < maxPages) {
    const rows = await fetchFuturesUserTrades({
      apiKey,
      apiSecret,
      symbol,
      startTime: cursorMs,
      endTime: endMs,
      limit,
      recvWindow: 7000,
    });

    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) break;
    arr.forEach((row) => out.push({ ...row, symbol }));
    pages += 1;

    if (arr.length < limit) break;
    const nextMs = arr.reduce((acc, row) => Math.max(acc, toNum(row && row.time, 0)), cursorMs);
    if (nextMs <= cursorMs) break;
    cursorMs = nextMs + 1;
  }

  return dedupeTrades(out);
}

function inferRoleFromClientOrderId(clientOrderId) {
  const cid = String(clientOrderId || "").toLowerCase();
  if (!cid) return null;
  for (const rule of CLIENT_ID_ROLE_RULES) {
    if (rule.tests.some((re) => re.test(cid))) {
      return { role_id: rule.role_id, tag_source: "client_order_id" };
    }
  }
  return null;
}

function inferRoleFromHeuristic({ orderType, reduceOnly, closePosition, maker, buyer, clientOrderId }) {
  const cid = String(clientOrderId || "").toLowerCase();
  const type = String(orderType || "").toUpperCase();

  if (/\b(exit|close|reduce)\b/.test(cid) || toBool(closePosition, false)) {
    return { role_id: "execution_engineer", tag_source: "heuristic_exit" };
  }
  if (toBool(reduceOnly, false)) {
    return { role_id: "risk_manager", tag_source: "heuristic_reduce_only" };
  }
  if (type.includes("STOP") || type.includes("TAKE_PROFIT")) {
    return { role_id: "risk_manager", tag_source: "heuristic_stop_tp" };
  }
  if (toBool(maker, false)) {
    return { role_id: "execution_engineer", tag_source: "heuristic_maker" };
  }
  if (toBool(buyer, false)) {
    return { role_id: "capital_allocator", tag_source: "heuristic_entry_buy" };
  }
  return { role_id: "system_dev", tag_source: "heuristic_default" };
}

function inferRoleTag(meta) {
  const byClientId = inferRoleFromClientOrderId(meta.clientOrderId);
  if (byClientId) return byClientId;
  return inferRoleFromHeuristic(meta);
}

function readCursor(cursorPath) {
  const raw = readJson(cursorPath, {});
  return raw && typeof raw === "object"
    ? raw
    : { symbols: {}, updated_at_utc: null };
}

function isNewTradeByCursor(entry, symbolCursor) {
  const cur = symbolCursor && typeof symbolCursor === "object" ? symbolCursor : {};
  const curTime = toNum(cur.time_ms, 0);
  const curTradeId = toNum(cur.trade_id, -1);
  const timeMs = toNum(entry && entry.time_ms, 0);
  const tradeId = toNum(entry && entry.trade_id, -1);
  if (timeMs > curTime) return true;
  if (timeMs === curTime && tradeId > curTradeId) return true;
  return false;
}

function aggregateByRole(entries) {
  const roles = {};
  Object.keys(ROLE_META).forEach((roleId) => {
    roles[roleId] = {
      role_id: roleId,
      role_name: ROLE_META[roleId].name,
      trade_count: 0,
      realized_pnl_usdt: 0,
      commission_usdt: 0,
      notional_usdt: 0,
      maker_count: 0,
      taker_count: 0,
      last_trade_at_utc: null,
      last_trade_at_kst: null,
      tag_source_counts: {},
      symbols: {},
    };
  });

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const roleId = roles[entry.role_id] ? entry.role_id : "system_dev";
    const row = roles[roleId];
    row.trade_count += 1;
    row.realized_pnl_usdt = round(row.realized_pnl_usdt + toNum(entry.realized_pnl, 0), 8);
    row.commission_usdt = round(row.commission_usdt + Math.abs(toNum(entry.commission, 0)), 8);
    row.notional_usdt = round(row.notional_usdt + Math.abs(toNum(entry.quote_qty, 0)), 8);
    if (toBool(entry.maker, false)) row.maker_count += 1;
    else row.taker_count += 1;
    row.symbols[entry.symbol] = (row.symbols[entry.symbol] || 0) + 1;
    const source = safeString(entry.tag_source || "unknown", 50) || "unknown";
    row.tag_source_counts[source] = (row.tag_source_counts[source] || 0) + 1;
    if (!row.last_trade_at_utc || toNum(entry.time_ms, 0) > Date.parse(row.last_trade_at_utc)) {
      row.last_trade_at_utc = entry.time_utc || null;
      row.last_trade_at_kst = entry.time_kst || null;
    }
  });

  return roles;
}

async function main() {
  const lookbackHours = Math.max(1, Math.min(168, parseArgInt("hours", toNum(process.env.ROLE_TRADE_LEDGER_LOOKBACK_HOURS, 24))));
  const maxSymbols = Math.max(1, Math.min(80, parseArgInt("max-symbols", toNum(process.env.ROLE_TRADE_LEDGER_MAX_SYMBOLS, 24))));
  const tradeLimit = Math.max(50, Math.min(1000, parseArgInt("limit", toNum(process.env.ROLE_TRADE_LEDGER_LIMIT, 1000))));
  const maxPages = Math.max(1, Math.min(20, parseArgInt("max-pages", toNum(process.env.ROLE_TRADE_LEDGER_MAX_PAGES, 6))));
  const maxEntries = Math.max(100, Math.min(10000, parseArgInt("max-entries", toNum(process.env.ROLE_TRADE_LEDGER_MAX_ENTRIES, 4000))));
  const outLatest = path.resolve(parseArg("out-latest", path.join(NOYE_DIR, "role_trade_ledger_latest.json")));
  const outJsonl = path.resolve(parseArg("out-jsonl", path.join(NOYE_DIR, "role_trade_ledger.jsonl")));
  const cursorPath = path.resolve(parseArg("cursor", path.join(NOYE_DIR, "role_trade_ledger_cursor.json")));
  const symbolsCsv = parseArg("symbols", process.env.ROLE_TRADE_LEDGER_SYMBOLS || "");
  const explicitSymbols = listFromCsv(symbolsCsv);

  const generatedAtUtc = nowIso();
  const generatedAtKst = toKst(generatedAtUtc);
  const startMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  const endMs = Date.now();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const keyInfo = await resolveApiKeys();
  if (!keyInfo.ok) {
    const payload = {
      ok: false,
      error: keyInfo.reason || "BINANCE_KEYS_MISSING",
      generated_at_utc: generatedAtUtc,
      generated_at_kst: generatedAtKst,
      lookback_hours: lookbackHours,
      start_time_utc: startIso,
      end_time_utc: endIso,
      entries: [],
      roles: aggregateByRole([]),
    };
    writeJson(outLatest, payload);
    console.log(JSON.stringify(payload));
    return;
  }

  const { apiKey, apiSecret, ex } = keyInfo;
  const symbols = await resolveSymbols({
    explicitSymbols,
    ex,
    apiKey,
    apiSecret,
    maxSymbols,
  });

  const allTrades = [];
  const errors = [];
  for (const symbol of symbols) {
    try {
      const trades = await fetchTradesForSymbol({
        apiKey,
        apiSecret,
        symbol,
        startMs,
        endMs,
        limit: tradeLimit,
        maxPages,
      });
      trades.forEach((row) => allTrades.push({ ...row, symbol }));
    } catch (error) {
      errors.push({
        symbol,
        error: safeString(error && error.message ? error.message : String(error), 240),
      });
    }
  }

  const trades = dedupeTrades(allTrades);
  const orderCache = new Map();
  const entries = [];
  let orderResolvedCount = 0;

  for (const trade of trades) {
    const symbol = normalizeSymbol(trade && trade.symbol);
    const orderId = toNum(trade && trade.orderId, NaN);
    let order = null;
    let orderError = "";
    if (symbol && Number.isFinite(orderId)) {
      const orderKey = `${symbol}:${orderId}`;
      if (!orderCache.has(orderKey)) {
        try {
          const fetched = await fetchFuturesOrder({
            apiKey,
            apiSecret,
            symbol,
            orderId,
            recvWindow: 7000,
          });
          orderCache.set(orderKey, fetched && typeof fetched === "object" ? fetched : {});
        } catch (error) {
          orderCache.set(orderKey, {
            __error: safeString(error && error.message ? error.message : String(error), 200),
          });
        }
      }
      order = orderCache.get(orderKey);
      if (order && order.__error) orderError = safeString(order.__error, 200);
      else if (order) orderResolvedCount += 1;
    }

    const clientOrderId = safeString(
      order && (order.clientOrderId || order.origClientOrderId || order.client_order_id)
        ? (order.clientOrderId || order.origClientOrderId || order.client_order_id)
        : "",
      80
    );
    const orderType = safeString(order && order.type ? order.type : "", 40).toUpperCase();
    const reduceOnly = toBool(order && order.reduceOnly, false);
    const closePosition = toBool(order && order.closePosition, false);

    const roleTag = inferRoleTag({
      clientOrderId,
      orderType,
      reduceOnly,
      closePosition,
      maker: toBool(trade && trade.maker, false),
      buyer: toBool(trade && trade.buyer, false),
    });
    const roleId = ROLE_META[roleTag.role_id] ? roleTag.role_id : "system_dev";
    const timeMs = toNum(trade && trade.time, 0);
    const timeIso = Number.isFinite(timeMs) && timeMs > 0 ? new Date(timeMs).toISOString() : null;

    entries.push({
      trade_key: `${symbol}:${toNum(trade && trade.id, 0)}`,
      symbol,
      trade_id: toNum(trade && trade.id, 0),
      order_id: Number.isFinite(orderId) ? orderId : null,
      time_ms: timeMs,
      time_utc: timeIso,
      time_kst: toKst(timeIso),
      side: safeString(trade && trade.side ? trade.side : "", 20).toUpperCase() || null,
      position_side: safeString(trade && trade.positionSide ? trade.positionSide : "", 20).toUpperCase() || null,
      buyer: toBool(trade && trade.buyer, false),
      maker: toBool(trade && trade.maker, false),
      price: toNum(trade && trade.price, 0),
      qty: toNum(trade && trade.qty, 0),
      quote_qty: toNum(trade && trade.quoteQty, 0),
      realized_pnl: toNum(trade && trade.realizedPnl, 0),
      commission: toNum(trade && trade.commission, 0),
      commission_asset: safeString(trade && trade.commissionAsset ? trade.commissionAsset : "", 16).toUpperCase() || null,
      order_type: orderType || null,
      reduce_only: reduceOnly,
      close_position: closePosition,
      client_order_id: clientOrderId || null,
      role_id: roleId,
      role_name: ROLE_META[roleId].name,
      tag_source: roleTag.tag_source,
      order_lookup_error: orderError || null,
    });
  }

  entries.sort((a, b) => {
    if (a.time_ms !== b.time_ms) return a.time_ms - b.time_ms;
    return a.trade_id - b.trade_id;
  });

  const roles = aggregateByRole(entries);
  const totalRealized = round(entries.reduce((acc, row) => acc + toNum(row.realized_pnl, 0), 0), 8);
  const totalCommissionAbs = round(entries.reduce((acc, row) => acc + Math.abs(toNum(row.commission, 0)), 0), 8);
  const totalNotional = round(entries.reduce((acc, row) => acc + Math.abs(toNum(row.quote_qty, 0)), 0), 8);

  const cursor = readCursor(cursorPath);
  const nextCursor = {
    symbols: { ...(cursor.symbols && typeof cursor.symbols === "object" ? cursor.symbols : {}) },
    updated_at_utc: generatedAtUtc,
  };
  const newEntries = [];
  entries.forEach((entry) => {
    const symbol = entry.symbol;
    const prev = nextCursor.symbols[symbol] && typeof nextCursor.symbols[symbol] === "object"
      ? nextCursor.symbols[symbol]
      : { time_ms: 0, trade_id: -1 };
    if (isNewTradeByCursor(entry, prev)) {
      newEntries.push({
        collected_at_utc: generatedAtUtc,
        collected_at_kst: generatedAtKst,
        ...entry,
      });
    }
    if (isNewTradeByCursor(entry, prev)) {
      nextCursor.symbols[symbol] = {
        time_ms: entry.time_ms,
        trade_id: entry.trade_id,
      };
    }
  });

  const snapshotTrades24h = entries.length;
  const newTradesSinceLastRun = newEntries.length;
  const syncOrExistingTrades = Math.max(0, snapshotTrades24h - newTradesSinceLastRun);

  const payload = {
    ok: true,
    generated_at_utc: generatedAtUtc,
    generated_at_kst: generatedAtKst,
    source: "binance_futures_user_trades",
    lookback_hours: lookbackHours,
    start_time_utc: startIso,
    end_time_utc: endIso,
    trade_count_semantics: {
      snapshot_trades_24h: "최근 lookback_hours 구간에 조회된 전체 체결 수(동기화 복원/기존 체결 포함 가능)",
      new_trades_since_last_run: "직전 실행 커서 대비 이번 실행에서 새로 확인된 체결 수",
      sync_or_existing_trades: "snapshot_trades_24h - new_trades_since_last_run",
    },
    counts: {
      symbols: symbols.length,
      trades: snapshotTrades24h,
      snapshot_trades_24h: snapshotTrades24h,
      new_trades: newTradesSinceLastRun,
      new_trades_since_last_run: newTradesSinceLastRun,
      sync_or_existing_trades: syncOrExistingTrades,
      order_resolved: orderResolvedCount,
      errors: errors.length,
    },
    totals: {
      realized_pnl_usdt: totalRealized,
      commission_abs_usdt: totalCommissionAbs,
      notional_usdt: totalNotional,
    },
    symbols,
    errors,
    roles,
    entries: entries.slice(-maxEntries),
  };

  writeJson(outLatest, payload);
  writeJson(cursorPath, nextCursor);
  appendJsonl(outJsonl, newEntries);

  const summary = {
    ok: true,
    generated_at_kst: generatedAtKst,
    latest_path: outLatest,
    jsonl_path: outJsonl,
    cursor_path: cursorPath,
    symbols: payload.counts.symbols,
    trades: payload.counts.trades,
    new_trades: payload.counts.new_trades,
    sync_or_existing_trades: payload.counts.sync_or_existing_trades,
    realized_pnl_usdt: totalRealized,
    commission_abs_usdt: totalCommissionAbs,
    errors: payload.counts.errors,
  };
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  const message = safeString(error && error.stack ? error.stack : (error && error.message ? error.message : String(error)), 2000);
  console.error(message);
  process.exit(1);
});
