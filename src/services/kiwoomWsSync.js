// src/services/kiwoomWsSync.js
// Kiwoom WebSocket 실시간 체결/잔고 동기화
// - 주문체결(00) + 잔고(04) 실시간 수신
// - fills_paper / positions_paper에 LIVE 동기화 기록

const { getToken } = require("../exchanges/kiwoomRest");
const { getFirestore, idemExists, markIdem } = require("../storage/firestore");
const { upsertFill } = require("../storage/fillsPaper");
const { buildTradeId } = require("../storage/tradesPaper");
const { getPosition, upsertPosition } = require("../storage/positionsPaper");

let ws = null;
let started = false;
let reconnectTimer = null;
let pingTimer = null;

function nowIso() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function toNumber(x) {
  if (x == null) return null;
  const s = String(x).replace(/[+,]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeCode(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  const code = s.replace(/[^0-9A-Z]/g, "").replace(/^A/, "");
  if (!code) return null;
  return code;
}

function toSymbol(code) {
  const c = normalizeCode(code);
  if (!c) return null;
  return `KRX:${c}`;
}

function wsBaseUrl() {
  if (process.env.KIWOOM_WS_URL) return process.env.KIWOOM_WS_URL;
  const env = String(process.env.KIWOOM_ENV || "mock").toLowerCase();
  const host = env === "live" ? "wss://api.kiwoom.com:10000" : "wss://mockapi.kiwoom.com:10000";
  return `${host}/api/dostk/websocket`;
}

function getWebSocketCtor() {
  try { return require("ws"); } catch (_) {}
  if (typeof WebSocket !== "undefined") return WebSocket; // undici (node 18+)
  return null;
}

function buildRegMessage(type) {
  return {
    trnm: "REG",
    grp_no: "1",
    refresh: "1",
    data: [
      {
        item: [""],
        type: [String(type)],
      },
    ],
  };
}

async function handleOrderFill(values) {
  const orderId = String(values["9203"] || "");
  const tradeNo = String(values["909"] || "");
  const status = String(values["913"] || "");
  const fillQty = toNumber(values["911"]);
  const fillPrice = toNumber(values["910"]) || toNumber(values["10"]);
  const sideCode = String(values["907"] || "");
  const side = sideCode === "1" ? "SELL" : (sideCode === "2" ? "BUY" : null);
  const symbol = toSymbol(values["9001"]);

  if (!symbol || !side || !Number.isFinite(fillQty) || fillQty <= 0 || !Number.isFinite(fillPrice)) return;
  if (status && !String(status).includes("체결")) return; // 체결만 기록

  const idemKey = `KIWOOM_WS__${orderId || "NOORDER"}__${tradeNo || "NOTRADE"}__${symbol}__${fillQty}`;
  if (await idemExists(idemKey)) return;

  const execTimeMs = nowMs();
  const linkedTradeId = buildTradeId({
    exchange: "KIWOOM",
    symbol,
    event: "WS_KIWOOM_FILL",
    execBarCloseMs: execTimeMs,
    execMs: execTimeMs,
  });
  await upsertFill({
    intentId: orderId || `KIWOOM_WS_${execTimeMs}`,
    tradeId: linkedTradeId,
    runId: "KIWOOM_WS",
    exchange: "KIWOOM",
    symbol,
    tf: "WS",
    execBarCloseTimeUtc: new Date(execTimeMs).toISOString(),
    execBarCloseTimeUtcMs: execTimeMs,
    side,
    event: "WS_KIWOOM_FILL",
    qtyPct: null,
    execPrice: fillPrice,
    feeBps: null,
    slippageBps: null,
    feeValue: null,
    notional: fillPrice * fillQty,
    notionalKrw: fillPrice * fillQty,
    execPriceSource: "KIWOOM_WS",
    executionMode: "LIVE",
    liveOrderId: orderId || null,
    execQtyBase: fillQty,
    decisionReason: "KIWOOM_WS_FILL",
  });

  await markIdem(idemKey, { exchange: "KIWOOM", symbol, type: "FILL", created_at: nowIso() });

  // 포지션 동기화(체결 기반 보정)
  const pos = await getPosition({ exchange: "KIWOOM", symbol });
  const prevQty = Number(pos && pos.qty_base) || 0;
  const prevAvg = Number(pos && pos.avg_price) || 0;
  let nextQty = prevQty;
  let nextAvg = prevAvg;
  if (side === "BUY") {
    nextQty = prevQty + fillQty;
    nextAvg = nextQty > 0 ? ((prevQty * prevAvg) + (fillQty * fillPrice)) / nextQty : fillPrice;
  } else if (side === "SELL") {
    nextQty = Math.max(0, prevQty - fillQty);
    if (nextQty === 0) nextAvg = null;
  }

  await upsertPosition({
    exchange: "KIWOOM",
    symbol,
    state: nextQty > 0 ? "LONG" : "FLAT",
    sizePct: nextQty > 0 ? 1 : 0,
    avgPrice: nextAvg,
    qtyBase: nextQty,
    positionSide: nextQty > 0 ? "LONG" : null,
    executionMode: "LIVE",
    meta: { source: "KIWOOM_WS", last_fill_at: nowIso() },
  });
}

async function handleBalance(values) {
  const symbol = toSymbol(values["9001"]);
  if (!symbol) return;
  const qty = toNumber(values["930"]);
  const avgPrice = toNumber(values["931"]);
  if (qty == null || qty < 0) return;

  await upsertPosition({
    exchange: "KIWOOM",
    symbol,
    state: qty > 0 ? "LONG" : "FLAT",
    sizePct: qty > 0 ? 1 : 0,
    avgPrice: avgPrice,
    qtyBase: qty,
    positionSide: qty > 0 ? "LONG" : null,
    executionMode: "LIVE",
    meta: { source: "KIWOOM_WS", last_balance_at: nowIso() },
  });
}

async function handleMessage(msg) {
  let json = null;
  try { json = JSON.parse(msg); } catch (_) { return; }
  if (!json || json.trnm !== "REAL") return;
  const rows = Array.isArray(json.data) ? json.data : [];
  for (const r of rows) {
    const type = String(r.type || "").trim();
    const values = r.values || {};
    if (type === "00") {
      await handleOrderFill(values);
    } else if (type === "04") {
      await handleBalance(values);
    }
  }
}

async function connectOnce() {
  const ctor = getWebSocketCtor();
  if (!ctor) {
    console.warn("[KIWOOM_WS] WebSocket 라이브러리를 찾을 수 없습니다. (node 18+ 또는 ws 설치 필요)");
    return;
  }

  const tok = await getToken({});
  if (!tok.ok) {
    console.warn("[KIWOOM_WS] token error:", tok.error);
    return;
  }

  const url = wsBaseUrl();
  const headers = {
    Authorization: `${tok.token_type} ${tok.access_token}`,
    "api-id": "00",
  };

  ws = new ctor(url, { headers });

  const onOpen = () => {
    try {
      ws.send(JSON.stringify(buildRegMessage("00")));
      ws.send(JSON.stringify(buildRegMessage("04")));
    } catch (_) {}
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      try { ws.send(JSON.stringify({ trnm: "PING" })); } catch (_) {}
    }, 30_000);
    console.log("[KIWOOM_WS] connected", url);
  };

  const onMessage = (evt) => {
    const data = evt && evt.data ? evt.data : evt;
    if (typeof data === "string") {
      handleMessage(data).catch(() => {});
    } else if (Buffer.isBuffer(data)) {
      handleMessage(data.toString("utf8")).catch(() => {});
    }
  };

  const onError = (e) => {
    console.warn("[KIWOOM_WS] error", e && (e.message || e));
  };

  const onClose = () => {
    console.warn("[KIWOOM_WS] closed");
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    ws = null;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectOnce().catch(() => {});
    }, 10_000);
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
}

async function startKiwoomWsSync({ enabled } = {}) {
  const flag = (enabled === true) || (String(process.env.KIWOOM_WS_ENABLED || "true").toLowerCase() !== "false");
  if (!flag) return { ok: false, reason: "DISABLED" };
  if (started) return { ok: true, reason: "ALREADY_STARTED" };
  started = true;
  await connectOnce();
  return { ok: true };
}

function stopKiwoomWsSync() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws && ws.close) ws.close();
  ws = null;
  started = false;
}

module.exports = { startKiwoomWsSync, stopKiwoomWsSync };
