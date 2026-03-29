const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const upbit = require("../exchanges/upbitPrivate");
const binance = require("../exchanges/binanceFuturesPrivate");
const binancePublic = require("../exchanges/binanceFutures");
const kiwoom = require("../exchanges/kiwoomRest");

const EGRESS_VERBOSE_SUCCESS_LOGS = String(process.env.EGRESS_PROXY_VERBOSE_SUCCESS_LOGS || "0") === "1";
const EGRESS_SUMMARY_INTERVAL_MS = (() => {
  const raw = Number(process.env.EGRESS_PROXY_SUMMARY_INTERVAL_MS || 60000);
  if (Number.isFinite(raw) && raw >= 10000) return Math.floor(raw);
  return 60000;
})();
const egressServerSummary = new Map();

/* ── egress 요청 추적용 request_id 생성 ── */
function buildEgressRequestId() {
  const ms = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return `EGR__${ms}__${rnd}`;
}

function resolveToken() {
  return String(process.env.EGRESS_PROXY_TOKEN || process.env.SCHEDULER_TOKEN || "").trim();
}

function egressSummaryKey(provider, action) {
  return `${String(provider || "").trim().toLowerCase()}::${String(action || "").trim()}`;
}

function flushEgressSummary(key, bucket, now) {
  if (!bucket) return;
  const provider = String(bucket.provider || "").trim().toLowerCase();
  const action = String(bucket.action || "").trim();
  console.log("[egress][SUMMARY]", {
    role: "server",
    provider,
    action,
    success: bucket.success || 0,
    started_at: new Date(bucket.startedAt || now).toISOString(),
    ended_at: new Date(now).toISOString(),
    window_ms: now - (bucket.startedAt || now),
    avg_elapsed_ms: bucket.success > 0 ? Math.round((bucket.totalElapsedMs || 0) / bucket.success) : 0,
  });
  egressServerSummary.set(key, {
    provider,
    action,
    success: 0,
    totalElapsedMs: 0,
    startedAt: now,
  });
}

function noteEgressServerSuccess(provider, action, elapsedMs) {
  const now = Date.now();
  const key = egressSummaryKey(provider, action);
  const bucket = egressServerSummary.get(key) || {
    provider,
    action,
    success: 0,
    totalElapsedMs: 0,
    startedAt: now,
  };
  bucket.success += 1;
  if (Number.isFinite(Number(elapsedMs)) && Number(elapsedMs) >= 0) {
    bucket.totalElapsedMs += Number(elapsedMs);
  }
  if ((now - bucket.startedAt) >= EGRESS_SUMMARY_INTERVAL_MS) {
    flushEgressSummary(key, bucket, now);
    return;
  }
  egressServerSummary.set(key, bucket);
}

function ensureEgressAuth(req, res, next) {
  const expected = resolveToken();
  if (!expected) {
    console.error("[egress] missing egress token", {
      path: req.path,
      provider: req.params && req.params.provider,
    });
    return res.status(500).json({ ok: false, error: "EGRESS_TOKEN_MISSING" });
  }
  const token = String(req.get("x-egress-token") || req.get("X-Egress-Token") || "");
  if (token && token === expected) return next();
  console.error("[egress] unauthorized", {
    path: req.path,
    provider: req.params && req.params.provider,
  });
  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

const handlers = {
  upbit: {
    fetchAccounts: (payload) => upbit.fetchAccounts(payload || {}),
    placeMarketBuy: (payload) => upbit.placeMarketBuy(payload || {}),
    placeMarketSell: (payload) => upbit.placeMarketSell(payload || {}),
    fetchOrder: (payload) => upbit.fetchOrder(payload || {}),
  },
  binancefut: {
    fetchBinanceFuturesAccount: (payload) => binance.fetchBinanceFuturesAccount(payload || {}),
    fetchFuturesPositionMode: (payload) => binance.fetchFuturesPositionMode(payload || {}),
    fetchFuturesExchangeInfo: (payload) => binance.fetchFuturesExchangeInfo(payload && payload.symbol),
    fetchFuturesKlines: (payload) =>
      binancePublic.fetchBinanceFuturesCandlesInterval(
        payload && payload.symbol,
        payload && payload.interval,
        payload && payload.limit,
        { useProxy: false }
      ),
    placeFuturesMarketOrder: (payload) => binance.placeFuturesMarketOrder(payload || {}),
    fetchFuturesOrder: (payload) => binance.fetchFuturesOrder(payload || {}),
    fetchFuturesOpenOrders: (payload) => binance.fetchFuturesOpenOrders(payload || {}),
    fetchFuturesAlgoOpenOrders: (payload) => binance.fetchFuturesAlgoOpenOrders(payload || {}),
    fetchFuturesAlgoOrder: (payload) => binance.fetchFuturesAlgoOrder(payload || {}),
    fetchFuturesUserTrades: (payload) => binance.fetchFuturesUserTrades(payload || {}),
    fetchFuturesIncomeHistory: (payload) => binance.fetchFuturesIncomeHistory(payload || {}),
    fetchBinanceWalletDeposits: (payload) => binance.fetchBinanceWalletDeposits(payload || {}),
    fetchBinanceWalletWithdrawals: (payload) => binance.fetchBinanceWalletWithdrawals(payload || {}),
    fetchBinanceWalletTransfers: (payload) => binance.fetchBinanceWalletTransfers(payload || {}),
    setFuturesLeverage: (payload) => binance.setFuturesLeverage(payload || {}),
    setFuturesMarginType: (payload) => binance.setFuturesMarginType(payload || {}),
    placeFuturesStopMarketOrder: (payload) => binance.placeFuturesStopMarketOrder(payload || {}),
    placeFuturesTakeProfitMarketOrder: (payload) => binance.placeFuturesTakeProfitMarketOrder(payload || {}),
    cancelFuturesOpenOrders: (payload) => binance.cancelFuturesOpenOrders(payload || {}),
  },
  kiwoom: {
    getToken: (payload) => kiwoom.getToken(payload && payload.auth ? payload.auth : payload || {}),
    placeOrder: (payload) => kiwoom.placeOrder(payload || {}),
    cancelOrder: (payload) => kiwoom.cancelOrder(payload || {}),
    modifyOrder: (payload) => kiwoom.modifyOrder(payload || {}),
    fetchAccount: (payload) => kiwoom.fetchAccount(payload || {}),
    fetchBars: (payload) => kiwoom.fetchBars(payload || {}),
  },
};

router.post("/egress/:provider", ensureEgressAuth, async (req, res) => {
  const requestId = String(req.get("x-egress-request-id") || "").trim() || buildEgressRequestId();
  try {
    const provider = String(req.params.provider || "").trim().toLowerCase();
    const action = String(req.body && req.body.action || "").trim();
    const payload = req.body && req.body.payload ? req.body.payload : {};

    if (EGRESS_VERBOSE_SUCCESS_LOGS) {
      console.log("[egress][INGRESS]", { request_id: requestId, provider, action, ts: new Date().toISOString() });
    }

    const provHandlers = handlers[provider];
    if (!provHandlers) {
      console.warn("[egress][OUTCOME]", { request_id: requestId, provider, action, status: 400, error: "PROVIDER_NOT_SUPPORTED" });
      return res.status(400).json({ ok: false, error: "PROVIDER_NOT_SUPPORTED", request_id: requestId });
    }
    const fn = provHandlers[action];
    if (!fn) {
      console.warn("[egress][OUTCOME]", { request_id: requestId, provider, action, status: 400, error: "ACTION_NOT_SUPPORTED" });
      return res.status(400).json({ ok: false, error: "ACTION_NOT_SUPPORTED", request_id: requestId });
    }

    const startMs = Date.now();
    const data = await fn(payload);
    const elapsedMs = Date.now() - startMs;
    if (EGRESS_VERBOSE_SUCCESS_LOGS) {
      console.log("[egress][OUTCOME]", { request_id: requestId, provider, action, status: 200, elapsed_ms: elapsedMs });
    } else {
      noteEgressServerSuccess(provider, action, elapsedMs);
    }
    return res.json({ ok: true, data, request_id: requestId });
  } catch (e) {
    const errStatusRaw = Number(e && e.status);
    const errCodeRaw = Number(e && e.code);
    let status = 500;
    if (Number.isFinite(errStatusRaw) && errStatusRaw >= 400 && errStatusRaw < 500) {
      status = errStatusRaw;
    }
    if (errCodeRaw === -2019) {
      status = 409;
    }
    console.error("[egress][OUTCOME]", {
      request_id: requestId,
      provider: String(req.params.provider || "").trim().toLowerCase(),
      action: String(req.body && req.body.action || "").trim(),
      status,
      message: e && e.message,
      code: e && e.code,
      stack: e && e.stack,
    });
    return res.status(status).json({
      ok: false,
      error: "EGRESS_PROXY_ERROR",
      message: e && e.message,
      code: e && e.code,
      request_id: requestId,
    });
  }
});

module.exports = router;
