"use strict";

const { WebSocket } = require("ws");
const { getV2Doc, putV2Doc } = require("./storage");

const DEFAULT_STREAM_URL = "wss://fstream.binance.com/ws/!forceOrder@arr";
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBool(value, fallback = false) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return Boolean(fallback);
}

function parseSymbolSet(value) {
  return new Set(String(value || "")
    .split(/[|,]/)
    .map((row) => upper(row))
    .filter(Boolean));
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function hash12(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 12);
}

function parseRawMessage(raw) {
  if (raw === null || raw === undefined) return null;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8"));
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw && typeof raw === "object") return raw;
  return null;
}

function normalizeForceOrderEvent(raw) {
  const payload = raw && raw.data && typeof raw.data === "object" ? raw.data : raw;
  const order = payload && payload.o && typeof payload.o === "object" ? payload.o : null;
  if (!order) return null;
  const symbol = upper(order.s || payload.s);
  const side = upper(order.S);
  const eventTimeMs = toNumberOrNull(payload.E) ?? toNumberOrNull(order.T);
  const tradeTimeMs = toNumberOrNull(order.T) ?? eventTimeMs;
  const originalQty = toNumberOrNull(order.q);
  const lastQty = toNumberOrNull(order.l);
  const accumulatedQty = toNumberOrNull(order.z);
  const avgPrice = toNumberOrNull(order.ap);
  const limitPrice = toNumberOrNull(order.p);
  const qty = accumulatedQty ?? lastQty ?? originalQty;
  const price = avgPrice && avgPrice > 0 ? avgPrice : limitPrice;
  if (!symbol || !side || !(qty > 0) || !(price > 0) || !(eventTimeMs > 0)) return null;
  const liquidationSide = side === "SELL" ? "LONG_LIQUIDATED" : side === "BUY" ? "SHORT_LIQUIDATED" : "UNKNOWN";
  return Object.freeze({
    event_id: `FORCE_ORDER__${symbol}__${eventTimeMs}__${hash12(stableJson(order))}`,
    symbol,
    order_side: side,
    liquidation_side: liquidationSide,
    order_type: trimOrNull(order.o),
    time_in_force: trimOrNull(order.f),
    status: trimOrNull(order.X),
    event_time_ms: eventTimeMs,
    trade_time_ms: tradeTimeMs,
    price,
    quantity: qty,
    notional_quote: price * qty,
    raw_order: Object.freeze({ ...order }),
  });
}

function aggregateLiquidationEvents({
  events,
  symbol,
  nowMs = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
} = {}) {
  const sym = upper(symbol);
  if (!sym) throw new Error("LIQUIDATION_SNAPSHOT_SYMBOL_REQUIRED");
  const cutoffMs = Number(nowMs) - Math.max(1, Number(windowMs) || DEFAULT_WINDOW_MS);
  const rows = (Array.isArray(events) ? events : [])
    .filter((row) => row && row.symbol === sym && Number(row.event_time_ms) >= cutoffMs && Number(row.event_time_ms) <= Number(nowMs));
  const totalNotional = rows.reduce((sum, row) => sum + (toNumberOrNull(row.notional_quote) || 0), 0);
  const longLiquidated = rows
    .filter((row) => row.liquidation_side === "LONG_LIQUIDATED")
    .reduce((sum, row) => sum + (toNumberOrNull(row.notional_quote) || 0), 0);
  const shortLiquidated = rows
    .filter((row) => row.liquidation_side === "SHORT_LIQUIDATED")
    .reduce((sum, row) => sum + (toNumberOrNull(row.notional_quote) || 0), 0);
  const last = rows.reduce((acc, row) => (!acc || row.event_time_ms > acc.event_time_ms ? row : acc), null);
  return Object.freeze({
    symbol: sym,
    source: "BINANCE_FORCE_ORDER_STREAM",
    window_ms: Math.max(1, Number(windowMs) || DEFAULT_WINDOW_MS),
    window_start_ms: cutoffMs,
    window_end_ms: Number(nowMs),
    liquidation_notional_5m_quote: totalNotional,
    liquidation_event_count_5m: rows.length,
    liquidation_long_notional_5m_quote: longLiquidated,
    liquidation_short_notional_5m_quote: shortLiquidated,
    liquidation_imbalance_5m: totalNotional > 0 ? (shortLiquidated - longLiquidated) / totalNotional : null,
    last_event_time_ms: last ? last.event_time_ms : null,
    last_event_id: last ? last.event_id : null,
  });
}

function latestSnapshotDocId(symbol) {
  const sym = upper(symbol);
  if (!sym) throw new Error("LIQUIDATION_SNAPSHOT_SYMBOL_REQUIRED");
  return `BINANCEFUT__${sym}__LATEST`;
}

function buildLiquidationSnapshotDoc({ snapshot, nowMs = Date.now() } = {}) {
  const row = snapshot && typeof snapshot === "object" ? snapshot : null;
  const symbol = upper(row && row.symbol);
  if (!symbol) throw new Error("LIQUIDATION_SNAPSHOT_SYMBOL_REQUIRED");
  const docId = latestSnapshotDocId(symbol);
  return Object.freeze({
    liquidation_snapshot_id: docId,
    symbol,
    exchange: "BINANCEFUT",
    source: trimOrNull(row.source) || "BINANCE_FORCE_ORDER_STREAM",
    created_at: new Date(Number(nowMs)).toISOString(),
    updated_at: new Date(Number(nowMs)).toISOString(),
    window_ms: toNumberOrNull(row.window_ms) || DEFAULT_WINDOW_MS,
    window_start_ms: toNumberOrNull(row.window_start_ms),
    window_end_ms: toNumberOrNull(row.window_end_ms) || Number(nowMs),
    liquidation_notional_5m_quote: toNumberOrNull(row.liquidation_notional_5m_quote) || 0,
    liquidation_event_count_5m: toNumberOrNull(row.liquidation_event_count_5m) || 0,
    liquidation_long_notional_5m_quote: toNumberOrNull(row.liquidation_long_notional_5m_quote) || 0,
    liquidation_short_notional_5m_quote: toNumberOrNull(row.liquidation_short_notional_5m_quote) || 0,
    liquidation_imbalance_5m: toNumberOrNull(row.liquidation_imbalance_5m),
    last_event_time_ms: toNumberOrNull(row.last_event_time_ms),
    last_event_id: trimOrNull(row.last_event_id),
  });
}

async function writeLatestLiquidationSnapshot({ db = null, env = process.env, snapshot, nowMs = Date.now() } = {}) {
  const doc = buildLiquidationSnapshotDoc({ snapshot, nowMs });
  return putV2Doc({
    db,
    env,
    collectionKey: "LIQUIDATION_SNAPSHOTS",
    doc,
    merge: true,
  });
}

async function loadLatestLiquidationSnapshot({ db = null, env = process.env, symbol } = {}) {
  const sym = upper(symbol);
  if (!sym) return null;
  const enabled = parseBool(env.DONBEOLJA_V2_LIQUIDATION_SNAPSHOT_READ_ENABLED, true);
  if (!enabled) return null;
  try {
    const result = await getV2Doc({
      db,
      env,
      collectionKey: "LIQUIDATION_SNAPSHOTS",
      docId: latestSnapshotDocId(sym),
    });
    return result && result.ok === true ? result.doc : null;
  } catch (_) {
    return null;
  }
}

function createLiquidationEventBuffer({ retentionMs = DEFAULT_RETENTION_MS } = {}) {
  const rows = [];
  function prune(nowMs = Date.now()) {
    const cutoffMs = Number(nowMs) - Math.max(1, Number(retentionMs) || DEFAULT_RETENTION_MS);
    while (rows.length && Number(rows[0].event_time_ms) < cutoffMs) rows.shift();
  }
  return Object.freeze({
    push(event, nowMs = Date.now()) {
      if (!event) return 0;
      rows.push(event);
      rows.sort((a, b) => Number(a.event_time_ms) - Number(b.event_time_ms));
      prune(nowMs);
      return rows.length;
    },
    rows(nowMs = Date.now()) {
      prune(nowMs);
      return rows.slice();
    },
    size(nowMs = Date.now()) {
      prune(nowMs);
      return rows.length;
    },
  });
}

function createBinanceLiquidationStreamCollector({
  env = process.env,
  db = null,
  WebSocketImpl = WebSocket,
  now = () => Date.now(),
  logger = console,
} = {}) {
  const url = trimOrNull(env.DONBEOLJA_V2_LIQUIDATION_STREAM_URL) || DEFAULT_STREAM_URL;
  const enabled = parseBool(env.DONBEOLJA_V2_LIQUIDATION_STREAM_ENABLED, false);
  const symbols = parseSymbolSet(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS || env.BINANCEFUT_MARKETS);
  const windowMs = toNumberOrNull(env.DONBEOLJA_V2_LIQUIDATION_SNAPSHOT_WINDOW_MS) || DEFAULT_WINDOW_MS;
  const buffer = createLiquidationEventBuffer({
    retentionMs: Math.max(DEFAULT_RETENTION_MS, windowMs * 2),
  });
  let ws = null;
  let closed = false;

  async function writeSnapshotFor(symbol) {
    const snapshot = aggregateLiquidationEvents({
      events: buffer.rows(now()),
      symbol,
      nowMs: now(),
      windowMs,
    });
    await writeLatestLiquidationSnapshot({ db, env, snapshot, nowMs: now() });
    return snapshot;
  }

  async function handleMessage(raw) {
    const parsed = parseRawMessage(raw);
    const event = normalizeForceOrderEvent(parsed);
    if (!event) return Object.freeze({ ok: false, reason: "LIQUIDATION_STREAM_MESSAGE_IGNORED" });
    if (symbols.size && !symbols.has(event.symbol)) {
      return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_SYMBOL_SKIPPED", symbol: event.symbol });
    }
    buffer.push(event, now());
    const snapshot = await writeSnapshotFor(event.symbol);
    return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_SNAPSHOT_WRITTEN", event, snapshot });
  }

  function start() {
    if (!enabled) {
      return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_DISABLED", url, symbols: Array.from(symbols) });
    }
    if (ws) return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_ALREADY_STARTED", url });
    ws = new WebSocketImpl(url);
    ws.on("message", (raw) => {
      handleMessage(raw).catch((error) => {
        if (logger && typeof logger.error === "function") logger.error("[V2_LIQUIDATION_STREAM_MESSAGE_FAIL]", error && error.stack ? error.stack : error);
      });
    });
    ws.on("error", (error) => {
      if (logger && typeof logger.error === "function") logger.error("[V2_LIQUIDATION_STREAM_ERROR]", error && error.message ? error.message : String(error));
    });
    ws.on("close", () => {
      closed = true;
    });
    return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_STARTED", url, symbols: Array.from(symbols) });
  }

  function stop() {
    if (ws && typeof ws.close === "function") ws.close();
    closed = true;
    return Object.freeze({ ok: true, reason: "LIQUIDATION_STREAM_STOPPED" });
  }

  return Object.freeze({
    start,
    stop,
    handleMessage,
    writeSnapshotFor,
    buffer,
    state: () => Object.freeze({ enabled, url, closed, buffered_event_n: buffer.size(now()), symbols: Array.from(symbols) }),
  });
}

module.exports = {
  DEFAULT_STREAM_URL,
  normalizeForceOrderEvent,
  aggregateLiquidationEvents,
  buildLiquidationSnapshotDoc,
  latestSnapshotDocId,
  writeLatestLiquidationSnapshot,
  loadLatestLiquidationSnapshot,
  createLiquidationEventBuffer,
  createBinanceLiquidationStreamCollector,
  __test: {
    parseRawMessage,
    parseSymbolSet,
    hash12,
  },
};
