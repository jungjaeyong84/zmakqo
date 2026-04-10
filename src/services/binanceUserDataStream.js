"use strict";

const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const {
  createFuturesListenKey,
  keepaliveFuturesListenKey,
  deleteFuturesListenKey,
  getFuturesBaseUrl,
} = require("../exchanges/binanceFuturesPrivate");
const { syncFuturesPositionOnly } = require("../engine/paperUpbitRunner");
const { syncBinanceFuturesFills } = require("./binanceFuturesFillsSync");

const KEEPALIVE_INTERVAL_MS = Math.max(60_000, Number(process.env.BINANCE_USER_STREAM_KEEPALIVE_MS) || (30 * 60 * 1000));
const RECONNECT_DELAY_MS = Math.max(5_000, Number(process.env.BINANCE_USER_STREAM_RECONNECT_MS) || 10_000);
const EVENT_SYNC_DEDUPE_MS = Math.max(1_000, Number(process.env.BINANCE_USER_STREAM_SYNC_DEDUPE_MS) || 5_000);

let ws = null;
let started = false;
let reconnectTimer = null;
let keepaliveTimer = null;
let currentListenKey = null;
let currentApiKey = null;
let stopRequested = false;
const recentEventSyncAt = new Map();

function getWebSocketCtor() {
  try {
    return require("ws");
  } catch (_) {}
  if (typeof WebSocket !== "undefined") return WebSocket;
  return null;
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase() || null;
}

function resolveUserDataStreamBaseUrl() {
  const explicit = String(process.env.BINANCE_USER_STREAM_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  try {
    const raw = new URL(getFuturesBaseUrl());
    const wsProtocol = raw.protocol === "https:" ? "wss:" : "ws:";
    const hostname = raw.hostname.replace(/^fapi\./, "fstream.");
    return `${wsProtocol}//${hostname}/ws`;
  } catch (_) {
    return "wss://fstream.binance.com/ws";
  }
}

function buildUserDataStreamUrl(listenKey) {
  const key = String(listenKey || "").trim();
  if (!key) return null;
  return `${resolveUserDataStreamBaseUrl()}/${key}`;
}

function dedupeSymbols(rows = []) {
  return Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => normalizeSymbol(row)).filter(Boolean)));
}

function extractSymbolsFromUserDataEvent(payload = {}) {
  const eventType = String(payload && payload.e || "").trim().toUpperCase();
  if (eventType === "ORDER_TRADE_UPDATE") {
    return dedupeSymbols([payload && payload.o && payload.o.s]);
  }
  if (eventType === "ACCOUNT_UPDATE") {
    const positions = Array.isArray(payload && payload.a && payload.a.P) ? payload.a.P : [];
    return dedupeSymbols(positions.map((row) => row && row.s));
  }
  return [];
}

function isTradeExecutionUpdate(payload = {}) {
  const eventType = String(payload && payload.e || "").trim().toUpperCase();
  if (eventType !== "ORDER_TRADE_UPDATE") return false;
  const executionType = String(payload && payload.o && payload.o.x || "").trim().toUpperCase();
  return executionType === "TRADE";
}

function shouldSkipRecentSync(symbol, nowMs = Date.now()) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return true;
  const lastAt = Number(recentEventSyncAt.get(sym));
  if (Number.isFinite(lastAt) && (nowMs - lastAt) < EVENT_SYNC_DEDUPE_MS) {
    return true;
  }
  recentEventSyncAt.set(sym, nowMs);
  if (recentEventSyncAt.size > 256) {
    for (const [key, value] of recentEventSyncAt.entries()) {
      if (!Number.isFinite(value) || (nowMs - value) > (EVENT_SYNC_DEDUPE_MS * 20)) {
        recentEventSyncAt.delete(key);
      }
    }
  }
  return false;
}

function clearRecentSyncMark(symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return false;
  return recentEventSyncAt.delete(sym);
}

async function syncSymbolsForEvent(payload = {}, {
  syncPosition = syncFuturesPositionOnly,
  syncFills = syncBinanceFuturesFills,
} = {}) {
  const symbols = extractSymbolsFromUserDataEvent(payload);
  const eventType = String(payload && payload.e || "").trim().toUpperCase();
  const tradeExecution = isTradeExecutionUpdate(payload);
  const results = [];

  for (const symbol of symbols) {
    const now = Date.now();
    if (shouldSkipRecentSync(symbol, now)) {
      results.push({ symbol, ok: true, skipped: true, reason: "DEDUPED" });
      continue;
    }
    try {
      let fills = null;
      if (tradeExecution) {
        fills = await syncFills({
          markets: [symbol],
          force: true,
          minIntervalMs: 0,
        });
      }
      const sync = await syncPosition({
        runId: `RUN__USER_STREAM_SYNC__BINANCEFUT__${symbol}__${now}`,
        exchange: "BINANCEFUT",
        symbol,
      });
      if (!sync || sync.ok === false) {
        clearRecentSyncMark(symbol);
      }
      results.push({ symbol, ok: true, eventType, fills, sync });
    } catch (e) {
      clearRecentSyncMark(symbol);
      results.push({ symbol, ok: false, eventType, error: e && e.message ? e.message : String(e) });
    }
  }

  return {
    ok: true,
    eventType,
    tradeExecution,
    symbol_n: symbols.length,
    results,
  };
}

async function handleUserDataMessage(message, deps = {}) {
  let payload = null;
  try {
    payload = JSON.parse(String(message || ""));
  } catch (_) {
    return { ok: false, skipped: true, reason: "INVALID_JSON" };
  }
  const eventType = String(payload && payload.e || "").trim().toUpperCase();
  if (!eventType) return { ok: true, skipped: true, reason: "NO_EVENT_TYPE" };
  if (eventType === "listenKeyExpired") {
    return { ok: false, expired: true, reason: "LISTEN_KEY_EXPIRED" };
  }
  if (eventType !== "ORDER_TRADE_UPDATE" && eventType !== "ACCOUNT_UPDATE") {
    return { ok: true, skipped: true, reason: "IGNORED_EVENT", eventType };
  }
  return syncSymbolsForEvent(payload, deps);
}

async function clearCurrentListenKey() {
  if (!currentListenKey || !currentApiKey) return;
  try {
    await deleteFuturesListenKey({ apiKey: currentApiKey, listenKey: currentListenKey });
  } catch (_) {
    // Best effort cleanup only.
  }
}

function scheduleReconnect() {
  if (stopRequested || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectOnce().catch((e) => {
      console.warn("[BINANCE_USER_STREAM_RECONNECT_FAIL]", e && e.message ? e.message : String(e));
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

async function connectOnce() {
  const WebSocketCtor = getWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, reason: "WS_UNAVAILABLE" };
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  if (!keys || !keys.apiKey || !keys.apiSecret) return { ok: false, reason: "BINANCEFUT_KEYS_MISSING" };

  currentApiKey = keys.apiKey;
  const listenKeyRes = await createFuturesListenKey({ apiKey: keys.apiKey });
  const listenKey = String(listenKeyRes && listenKeyRes.listenKey || "").trim();
  if (!listenKey) return { ok: false, reason: "LISTEN_KEY_MISSING" };
  currentListenKey = listenKey;

  const url = buildUserDataStreamUrl(listenKey);
  ws = new WebSocketCtor(url);

  const onOpen = () => {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (!currentListenKey || !currentApiKey) return;
      keepaliveFuturesListenKey({ apiKey: currentApiKey, listenKey: currentListenKey }).catch((e) => {
        console.warn("[BINANCE_USER_STREAM_KEEPALIVE_FAIL]", e && e.message ? e.message : String(e));
      });
    }, KEEPALIVE_INTERVAL_MS);
    console.log(`[BINANCE_USER_STREAM] connected ${url}`);
  };

  const onMessage = (evt) => {
    const data = evt && evt.data ? evt.data : evt;
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
    handleUserDataMessage(text).then((result) => {
      if (result && result.expired) {
        try { ws && ws.close(); } catch (_) {}
      }
    }).catch((e) => {
      console.warn("[BINANCE_USER_STREAM_MESSAGE_FAIL]", e && e.message ? e.message : String(e));
    });
  };

  const onError = (e) => {
    console.warn("[BINANCE_USER_STREAM_ERROR]", e && e.message ? e.message : String(e));
  };

  const onClose = () => {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    ws = null;
    clearCurrentListenKey().catch(() => {});
    currentListenKey = null;
    if (!stopRequested) scheduleReconnect();
  };

  if (ws && ws.on) {
    ws.on("open", onOpen);
    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  } else {
    ws.onopen = onOpen;
    ws.onmessage = onMessage;
    ws.onerror = onError;
    ws.onclose = onClose;
  }

  return { ok: true, listenKey, url };
}

async function startBinanceUserDataStream({ enabled } = {}) {
  const envEnabled = String(process.env.BINANCE_USER_STREAM_ENABLED || "1") !== "0";
  const finalEnabled = enabled === undefined ? envEnabled : enabled === true;
  if (!finalEnabled) return { ok: false, skipped: true, reason: "DISABLED" };
  if (String(process.env.EGRESS_PROXY_ONLY || "0") === "1") {
    return { ok: false, skipped: true, reason: "EGRESS_ONLY" };
  }
  if (started) return { ok: true, reason: "ALREADY_STARTED" };
  started = true;
  stopRequested = false;
  return connectOnce();
}

async function stopBinanceUserDataStream() {
  stopRequested = true;
  started = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  try {
    if (ws && typeof ws.close === "function") ws.close();
  } catch (_) {}
  ws = null;
  await clearCurrentListenKey();
  currentListenKey = null;
  currentApiKey = null;
  recentEventSyncAt.clear();
  return { ok: true, stopped: true };
}

module.exports = {
  startBinanceUserDataStream,
  stopBinanceUserDataStream,
  __test: {
    resolveUserDataStreamBaseUrl,
    buildUserDataStreamUrl,
    extractSymbolsFromUserDataEvent,
    isTradeExecutionUpdate,
    clearRecentSyncMark,
    syncSymbolsForEvent,
    handleUserDataMessage,
  },
};
