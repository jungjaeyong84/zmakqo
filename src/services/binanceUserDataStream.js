"use strict";

const crypto = require("crypto");
const { getFirestore } = require("../storage/firestore");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const {
  createFuturesListenKey,
  keepaliveFuturesListenKey,
  deleteFuturesListenKey,
  getFuturesBaseUrl,
} = require("../exchanges/binanceFuturesPrivate");
const { syncFuturesPositionOnly } = require("../engine/paperBinanceRunner");
const { syncBinanceFuturesFills } = require("./binanceFuturesFillsSync");

const KEEPALIVE_INTERVAL_MS = Math.max(60_000, Number(process.env.BINANCE_USER_STREAM_KEEPALIVE_MS) || (30 * 60 * 1000));
const RECONNECT_DELAY_MS = Math.max(5_000, Number(process.env.BINANCE_USER_STREAM_RECONNECT_MS) || 10_000);
const EVENT_SYNC_DEDUPE_MS = Math.max(1_000, Number(process.env.BINANCE_USER_STREAM_SYNC_DEDUPE_MS) || 5_000);
const USER_STREAM_LEASE_ENABLED = String(process.env.BINANCE_USER_STREAM_LEASE_ENABLED || "1") !== "0";
const USER_STREAM_LEASE_MIN_TTL_MS = Math.max(15_000, Number(process.env.BINANCE_USER_STREAM_LEASE_TTL_MS) || 45_000);
const USER_STREAM_LEASE_DOC = String(
  process.env.BINANCE_USER_STREAM_LEASE_DOC || "runtime/binance_user_stream_leader"
).trim();
const userStreamInstanceId = [
  process.env.K_SERVICE || "local",
  process.env.K_REVISION || "rev",
  process.pid,
  crypto.randomBytes(4).toString("hex"),
].join(":");

let ws = null;
let started = false;
let reconnectTimer = null;
let keepaliveTimer = null;
let leaseHeartbeatTimer = null;
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

function resolveEventTimeMs(payload = {}) {
  const order = (payload && payload.o && typeof payload.o === "object") ? payload.o : {};
  const candidates = [payload && payload.E, payload && payload.T, order.T, order.t];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function buildEventSyncDedupeKey(payload = {}, symbol) {
  const sym = normalizeSymbol(symbol);
  const eventType = String(payload && payload.e || "").trim().toUpperCase() || "UNKNOWN";
  const eventTimeMs = resolveEventTimeMs(payload);
  if (!sym) return `${eventType}:NA:${eventTimeMs || "NA"}`;
  if (eventType === "ORDER_TRADE_UPDATE") {
    const order = (payload && payload.o && typeof payload.o === "object") ? payload.o : {};
    const orderId = Number.isFinite(Number(order.i)) ? String(Number(order.i)) : "NA";
    const tradeId = Number.isFinite(Number(order.t)) ? String(Number(order.t)) : "NA";
    return [eventType, sym, orderId, tradeId, eventTimeMs || "NA"].join(":");
  }
  return [eventType, sym, eventTimeMs || "NA"].join(":");
}

function shouldSkipRecentSync(dedupeKey, nowMs = Date.now()) {
  const key = String(dedupeKey || "").trim();
  if (!key) return true;
  const lastAt = Number(recentEventSyncAt.get(key));
  if (Number.isFinite(lastAt) && (nowMs - lastAt) < EVENT_SYNC_DEDUPE_MS) {
    return true;
  }
  recentEventSyncAt.set(key, nowMs);
  if (recentEventSyncAt.size > 256) {
    for (const [entryKey, value] of recentEventSyncAt.entries()) {
      if (!Number.isFinite(value) || (nowMs - value) > (EVENT_SYNC_DEDUPE_MS * 20)) {
        recentEventSyncAt.delete(entryKey);
      }
    }
  }
  return false;
}

function clearRecentSyncMark(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return false;
  let cleared = false;
  if (recentEventSyncAt.delete(raw)) cleared = true;
  const sym = normalizeSymbol(raw);
  if (!sym) return cleared;
  for (const key of Array.from(recentEventSyncAt.keys())) {
    if (String(key).includes(`:${sym}:`) || String(key).endsWith(`:${sym}`)) {
      recentEventSyncAt.delete(key);
      cleared = true;
    }
  }
  return cleared;
}

function shouldRetryUserStreamConnectResult(result) {
  return !result || result.ok !== true;
}

function normalizeUserStreamStartResult(result) {
  if (result && result.skipped && result.reason === "LEASE_HELD") {
    return {
      ok: true,
      waiting: true,
      reason: "LEASE_WAITING",
      holder: result.holder || null,
    };
  }
  return result;
}

async function acquireUserStreamLease({ ttlMs = USER_STREAM_LEASE_MIN_TTL_MS } = {}) {
  if (!USER_STREAM_LEASE_ENABLED) return { ok: true, acquired: true, leaseDisabled: true, holder: userStreamInstanceId };
  const ttl = Math.max(USER_STREAM_LEASE_MIN_TTL_MS, Number(ttlMs) || USER_STREAM_LEASE_MIN_TTL_MS);
  const now = Date.now();
  const leaseUntil = now + ttl;
  const db = getFirestore();
  const ref = db.doc(USER_STREAM_LEASE_DOC);
  try {
    let acquired = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const owner = String(data.owner || "");
      const leaseUntilMs = Number(data.lease_until_ms);
      const heartbeatMs = Number(data.heartbeat_ms);
      const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
      const heartbeatFreshMaxMs = Math.max(ttl * 2, 10000);
      const heartbeatFresh = Number.isFinite(heartbeatMs) && (now - heartbeatMs) <= heartbeatFreshMaxMs;
      const staleHolder = !!owner && owner !== userStreamInstanceId && !expired && !heartbeatFresh;
      if (!owner || owner === userStreamInstanceId || expired || staleHolder) {
        acquired = true;
        tx.set(ref, {
          owner: userStreamInstanceId,
          lease_until_ms: leaseUntil,
          heartbeat_ms: now,
          heartbeat_at: new Date(now).toISOString(),
        }, { merge: true });
      } else {
        holder = owner || null;
      }
    });
    return { ok: true, acquired, holder, leaseUntil };
  } catch (e) {
    return { ok: false, acquired: false, error: e && e.message ? e.message : String(e) };
  }
}

async function heartbeatUserStreamLease({ ttlMs = USER_STREAM_LEASE_MIN_TTL_MS } = {}) {
  if (!USER_STREAM_LEASE_ENABLED) return { ok: true, leaseDisabled: true };
  const ttl = Math.max(USER_STREAM_LEASE_MIN_TTL_MS, Number(ttlMs) || USER_STREAM_LEASE_MIN_TTL_MS);
  const now = Date.now();
  const leaseUntil = now + ttl;
  const db = getFirestore();
  const ref = db.doc(USER_STREAM_LEASE_DOC);
  try {
    let ok = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const owner = String(data.owner || "");
      if (owner !== userStreamInstanceId) {
        holder = owner || null;
        return;
      }
      ok = true;
      tx.set(ref, {
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
    });
    return { ok, holder, leaseUntil };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function releaseUserStreamLease() {
  if (!USER_STREAM_LEASE_ENABLED) return;
  const db = getFirestore();
  const ref = db.doc(USER_STREAM_LEASE_DOC);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (String(data.owner || "") !== userStreamInstanceId) return;
      tx.set(ref, {
        lease_until_ms: Date.now() - 1,
        released_at: new Date().toISOString(),
      }, { merge: true });
    });
  } catch (_) {}
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
    const dedupeKey = buildEventSyncDedupeKey(payload, symbol);
    if (shouldSkipRecentSync(dedupeKey, now)) {
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
        clearRecentSyncMark(dedupeKey);
      }
      results.push({ symbol, ok: true, eventType, fills, sync });
    } catch (e) {
      clearRecentSyncMark(dedupeKey);
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
    connectOnce().then((result) => {
      if (shouldRetryUserStreamConnectResult(result)) scheduleReconnect();
    }).catch((e) => {
      console.warn("[BINANCE_USER_STREAM_RECONNECT_FAIL]", e && e.message ? e.message : String(e));
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

function stopLeaseHeartbeat() {
  if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
  leaseHeartbeatTimer = null;
}

function startLeaseHeartbeat() {
  stopLeaseHeartbeat();
  if (!USER_STREAM_LEASE_ENABLED) return;
  const everyMs = Math.max(5_000, Math.floor(USER_STREAM_LEASE_MIN_TTL_MS / 3));
  leaseHeartbeatTimer = setInterval(() => {
    heartbeatUserStreamLease({ ttlMs: USER_STREAM_LEASE_MIN_TTL_MS }).then((heartbeat) => {
      if (heartbeat && heartbeat.ok === false) {
        console.warn("[BINANCE_USER_STREAM_LEASE_LOST]", heartbeat.holder || heartbeat.error || "UNKNOWN");
        try { ws && ws.close(); } catch (_) {}
      }
    }).catch(() => {
      try { ws && ws.close(); } catch (_) {}
    });
  }, everyMs);
}

async function connectOnce() {
  const WebSocketCtor = getWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, reason: "WS_UNAVAILABLE" };
  const lease = await acquireUserStreamLease({ ttlMs: USER_STREAM_LEASE_MIN_TTL_MS });
  if (!lease.ok) return { ok: false, reason: "LEASE_FAIL", error: lease.error || "UNKNOWN" };
  if (lease.acquired !== true) {
    return { ok: false, skipped: true, reason: "LEASE_HELD", holder: lease.holder || null };
  }
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  if (!keys || !keys.apiKey || !keys.apiSecret) {
    await releaseUserStreamLease();
    return { ok: false, reason: "BINANCEFUT_KEYS_MISSING" };
  }

  currentApiKey = keys.apiKey;
  const listenKeyRes = await createFuturesListenKey({ apiKey: keys.apiKey });
  const listenKey = String(listenKeyRes && listenKeyRes.listenKey || "").trim();
  if (!listenKey) {
    await releaseUserStreamLease();
    return { ok: false, reason: "LISTEN_KEY_MISSING" };
  }
  currentListenKey = listenKey;

  const url = buildUserDataStreamUrl(listenKey);
  ws = new WebSocketCtor(url);

  const onOpen = () => {
    startLeaseHeartbeat();
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
    stopLeaseHeartbeat();
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    ws = null;
    clearCurrentListenKey().catch(() => {});
    currentListenKey = null;
    releaseUserStreamLease().catch(() => {});
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
  const result = await connectOnce();
  if (shouldRetryUserStreamConnectResult(result)) {
    scheduleReconnect();
  }
  return normalizeUserStreamStartResult(result);
}

async function stopBinanceUserDataStream() {
  stopRequested = true;
  started = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopLeaseHeartbeat();
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  try {
    if (ws && typeof ws.close === "function") ws.close();
  } catch (_) {}
  ws = null;
  await clearCurrentListenKey();
  currentListenKey = null;
  currentApiKey = null;
  await releaseUserStreamLease();
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
    acquireUserStreamLease,
    heartbeatUserStreamLease,
    releaseUserStreamLease,
    USER_STREAM_LEASE_DOC,
    userStreamInstanceId,
    clearRecentSyncMark,
    buildEventSyncDedupeKey,
    shouldRetryUserStreamConnectResult,
    normalizeUserStreamStartResult,
    syncSymbolsForEvent,
    handleUserDataMessage,
  },
};
