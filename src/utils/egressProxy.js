const crypto = require("crypto");

const BINANCE_PRIVATE_ACTIONS = new Set([
  "fetchBinanceFuturesAccount",
  "fetchFuturesOpenOrders",
  "fetchFuturesAlgoOpenOrders",
  "fetchFuturesPositionMode",
  "fetchBinanceWalletDeposits",
  "fetchBinanceWalletWithdrawals",
  "fetchBinanceWalletTransfers",
  "placeFuturesMarketOrder",
  "fetchFuturesAlgoOrder",
  "placeFuturesStopMarketOrder",
  "placeFuturesTakeProfitMarketOrder",
  "cancelFuturesOpenOrders",
  "fetchFuturesOrder",
  "fetchFuturesUserTrades",
  "fetchFuturesIncomeHistory",
  "setFuturesLeverage",
  "setFuturesMarginType",
]);

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.EGRESS_PROXY_TIMEOUT_MS || 10000);
  if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
  return 10000;
})();

const EGRESS_VERBOSE_SUCCESS_LOGS = String(process.env.EGRESS_PROXY_VERBOSE_SUCCESS_LOGS || "0") === "1";
const EGRESS_SUMMARY_INTERVAL_MS = (() => {
  const raw = Number(process.env.EGRESS_PROXY_SUMMARY_INTERVAL_MS || 60000);
  if (Number.isFinite(raw) && raw >= 10000) return Math.floor(raw);
  return 60000;
})();
const egressClientSummary = new Map();

/* ── egress 요청 추적용 request_id 생성 ── */
function buildEgressRequestId() {
  const ms = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return `EGR__${ms}__${rnd}`;
}

function shouldUseEgressProxy() {
  const mode = String(process.env.EGRESS_PROXY_MODE || "").trim().toLowerCase();
  const url = String(process.env.EGRESS_PROXY_URL || "").trim();
  return mode === "client" && !!url;
}

function resolveEgressBaseUrl() {
  return String(process.env.EGRESS_PROXY_URL || "").trim().replace(/\/+$/, "");
}

function shouldUsePrivateBinanceEgress(provider, action) {
  const prov = String(provider || "").trim().toLowerCase();
  const act = String(action || "").trim();
  if (prov !== "binancefut") return false;
  if (!BINANCE_PRIVATE_ACTIONS.has(act)) return false;
  const privateUrl = String(
    process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL
      || process.env.EGRESS_PROXY_PRIVATE_URL
      || ""
  ).trim();
  return !!privateUrl;
}

function resolveEgressBaseUrlFor(provider, action) {
  if (shouldUsePrivateBinanceEgress(provider, action)) {
    return String(
      process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL
        || process.env.EGRESS_PROXY_PRIVATE_URL
        || ""
    ).trim().replace(/\/+$/, "");
  }
  return resolveEgressBaseUrl();
}

function resolveEgressToken() {
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
    role: "client",
    provider,
    action,
    success: bucket.success || 0,
    started_at: new Date(bucket.startedAt || now).toISOString(),
    ended_at: new Date(now).toISOString(),
    window_ms: now - (bucket.startedAt || now),
  });
  egressClientSummary.set(key, {
    provider,
    action,
    success: 0,
    startedAt: now,
  });
}

function noteEgressClientSuccess(provider, action) {
  const now = Date.now();
  const key = egressSummaryKey(provider, action);
  const bucket = egressClientSummary.get(key) || {
    provider,
    action,
    success: 0,
    startedAt: now,
  };
  bucket.success += 1;
  if ((now - bucket.startedAt) >= EGRESS_SUMMARY_INTERVAL_MS) {
    flushEgressSummary(key, bucket, now);
    return;
  }
  egressClientSummary.set(key, bucket);
}

async function callEgressProxy({ provider, action, payload, timeoutMs } = {}) {
  const requestId = buildEgressRequestId();
  const base = resolveEgressBaseUrlFor(provider, action);
  if (!base) throw new Error("EGRESS_PROXY_URL_MISSING");
  const prov = String(provider || "").trim().toLowerCase();
  if (!prov) throw new Error("EGRESS_PROXY_PROVIDER_REQUIRED");
  const token = resolveEgressToken();
  if (!token) throw new Error("EGRESS_PROXY_TOKEN_MISSING");

  if (EGRESS_VERBOSE_SUCCESS_LOGS) {
    console.log("[egress][REQUEST]", { request_id: requestId, provider: prov, action });
  }

  const controller = new AbortController();
  const timeoutMsFinal = (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 1000)
    ? Math.floor(Number(timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMsFinal);
  try {
    let res = null;
    try {
      res = await fetch(`${base}/egress/${prov}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-egress-token": token,
          "x-egress-request-id": requestId,
        },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      const msg = String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
      const abortLike = msg === "This operation was aborted" || String(fetchErr && fetchErr.name || "") === "AbortError";
      const err = new Error(
        abortLike
          ? `EGRESS_PROXY_TIMEOUT provider=${prov} action=${action} request_id=${requestId} timeout_ms=${timeoutMsFinal}`
          : `EGRESS_PROXY_FETCH_FAIL provider=${prov} action=${action} request_id=${requestId} msg=${msg}`
      );
      err.code = abortLike ? "EGRESS_PROXY_TIMEOUT" : "EGRESS_PROXY_FETCH_FAIL";
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      err.timeoutMs = timeoutMsFinal;
      err.cause = fetchErr;
      console.error("[egress][RESPONSE_ERROR]", {
        request_id: requestId,
        provider: prov,
        action,
        message: err.message,
        code: err.code,
      });
      throw err;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* noop */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || text || `EGRESS_HTTP_${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = text;
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      console.error("[egress][RESPONSE_ERROR]", { request_id: requestId, provider: prov, action, status: res.status, message: msg });
      throw err;
    }
    if (json && json.ok === false) {
      const msg = json.message || json.error || "EGRESS_ERROR";
      const err = new Error(msg);
      err.status = json.status || 500;
      err.body = json;
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      console.error("[egress][LOGIC_ERROR]", { request_id: requestId, provider: prov, action, message: msg });
      throw err;
    }
    if (EGRESS_VERBOSE_SUCCESS_LOGS) {
      console.log("[egress][RESPONSE_OK]", { request_id: requestId, provider: prov, action, server_request_id: json && json.request_id });
    } else {
      noteEgressClientSuccess(prov, action);
    }
    if (json && Object.prototype.hasOwnProperty.call(json, "data")) return json.data;
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  shouldUseEgressProxy,
  callEgressProxy,
  buildEgressRequestId,
  shouldUsePrivateBinanceEgress,
  resolveEgressBaseUrlFor,
};
