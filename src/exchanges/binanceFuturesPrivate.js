const crypto = require("crypto");
const { shouldUseEgressProxy, callEgressProxy } = require("../utils/egressProxy");

const SERVER_TIME_TTL_MS = 60 * 1000;
let serverTimeOffsetMs = 0;
let serverTimeSyncedAt = 0;

function requireKeys({ apiKey, apiSecret }) {
  const key = String(apiKey || "").trim();
  const secret = String(apiSecret || "").trim();
  if (!key || !secret) throw new Error("BINANCEFUT_KEYS_MISSING");
  return { key, secret };
}

function buildQuery(params) {
  if (!params || typeof params !== "object") return "";
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [String(k), String(v)]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function signQuery(query, secret) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

function getFuturesBaseUrl() {
  const raw = String(process.env.BINANCE_FUTURES_BASE_URL || "").trim();
  return raw || "https://fapi.binance.com";
}

function getSpotBaseUrl() {
  const raw = String(process.env.BINANCE_SPOT_BASE_URL || "").trim();
  return raw || "https://api.binance.com";
}

function normalizeRecvWindow(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 5000;
  return Math.min(10000, Math.floor(n));
}

function toBinanceNumberString(v, maxDp = 10) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const fixed = n.toFixed(maxDp);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed || "0";
}

function decimalPlacesFromStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const raw = String(step == null ? "" : step).trim();
  if (raw && !/[eE]/.test(raw)) {
    const idx = raw.indexOf(".");
    if (idx === -1) return 0;
    return raw.slice(idx + 1).replace(/0+$/, "").length;
  }
  for (let p = 0; p <= 12; p += 1) {
    const scaled = n * Math.pow(10, p);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-8) return p;
  }
  return 10;
}

function floorToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return null;
  const precision = decimalPlacesFromStep(s);
  const units = Math.floor((v + (s * 1e-12)) / s);
  const floored = units * s;
  return Number(floored.toFixed(Math.max(0, Math.min(12, precision))));
}

function ceilToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return null;
  const precision = decimalPlacesFromStep(s);
  const units = Math.ceil((v - (s * 1e-12)) / s);
  const ceiled = units * s;
  return Number(ceiled.toFixed(Math.max(0, Math.min(12, precision))));
}

function normalizeFuturesTriggerPriceFromExchangeInfo(price, info, { roundingMode = "floor" } = {}) {
  const raw = Number(price);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  let normalized = raw;
  let maxDp = 10;
  const tickSize = Number(info && info.tickSize);
  const pricePrecision = Number(info && info.pricePrecision);
  if (Number.isFinite(tickSize) && tickSize > 0) {
    const rounded = roundingMode === "ceil"
      ? ceilToStep(raw, tickSize)
      : floorToStep(raw, tickSize);
    if (Number.isFinite(rounded) && rounded > 0) normalized = rounded;
    else normalized = tickSize;
    maxDp = decimalPlacesFromStep(tickSize);
  } else if (Number.isFinite(pricePrecision) && pricePrecision >= 0) {
    const p = Math.max(0, Math.min(12, Math.floor(pricePrecision)));
    normalized = Number(raw.toFixed(p));
    maxDp = p;
  }

  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return toBinanceNumberString(normalized, Math.max(0, Math.min(12, maxDp)));
}

async function normalizeFuturesTriggerPrice(symbol, price, options = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const raw = Number(price);
  if (!sym || !Number.isFinite(raw) || raw <= 0) return null;

  try {
    const info = await fetchFuturesExchangeInfo(sym);
    return normalizeFuturesTriggerPriceFromExchangeInfo(raw, info, options);
  } catch (_) {
    // If exchangeInfo fetch fails, keep raw price and let Binance validate.
    return toBinanceNumberString(raw, 10);
  }
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function sleep(ms) {
  const waitMs = Number(ms);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function resolveRetryConfig() {
  return {
    maxRetries: clampInt(process.env.BINANCE_HTTP_MAX_RETRIES, 2, 0, 5),
    baseMs: clampInt(process.env.BINANCE_HTTP_RETRY_BASE_MS, 250, 50, 10000),
    maxMs: clampInt(process.env.BINANCE_HTTP_RETRY_MAX_MS, 2000, 100, 30000),
    jitterMs: clampInt(process.env.BINANCE_HTTP_RETRY_JITTER_MS, 80, 0, 2000),
  };
}

function parseRetryAfterMs(headers) {
  try {
    const raw = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
    if (!raw) return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
    const at = Date.parse(String(raw));
    if (!Number.isFinite(at)) return null;
    return Math.max(0, at - Date.now());
  } catch (_) {
    return null;
  }
}

function isRetriableHttpStatus(status) {
  const s = Number(status);
  return s === 408 || s === 418 || s === 429 || (s >= 500 && s <= 599);
}

const RETRIABLE_BINANCE_CODES = new Set([
  -1001,
  -1003,
  -1006,
  -1007,
  -1008,
  -1015,
]);

function isRetriableBinanceCode(code) {
  const n = Number(code);
  return Number.isFinite(n) && RETRIABLE_BINANCE_CODES.has(n);
}

function canRetryRequest({ method, path, params }) {
  const m = String(method || "").toUpperCase();
  if (m === "GET" || m === "DELETE") return true;
  if (m !== "POST") return false;
  const p = String(path || "");
  if (p.includes("/fapi/v1/order")) {
    return !!(params && params.newClientOrderId);
  }
  if (p.includes("/fapi/v1/algoOrder")) {
    return !!(params && params.clientAlgoId);
  }
  return false;
}

function computeBackoffMs({ attempt, retryAfterMs, config }) {
  const cfg = config || resolveRetryConfig();
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(cfg.maxMs, Math.max(0, Math.round(retryAfterMs)));
  }
  const expMs = cfg.baseMs * (2 ** Math.max(0, Number(attempt) || 0));
  const jitter = cfg.jitterMs > 0 ? Math.floor(Math.random() * (cfg.jitterMs + 1)) : 0;
  return Math.min(cfg.maxMs, expMs + jitter);
}

function buildRequestError({ status, text, errCode, method, path, url }) {
  const err = new Error(`BINANCEFUT_HTTP_${status}: ${String(text || "").slice(0, 400)}`);
  err.status = Number(status);
  err.body = String(text || "");
  err.method = method;
  err.path = path;
  err.url = url;
  if (errCode !== null && Number.isFinite(Number(errCode))) err.code = Number(errCode);
  return err;
}

function readErrorText(err) {
  if (!err) return "";
  if (typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

function sanitizeClientOrderId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^A-Za-z0-9_.:-]/g, "");
  if (!cleaned) return null;
  return cleaned.slice(0, 36);
}

function resolveClientOrderId({ clientOrderId, idempotencyKey }) {
  const direct = sanitizeClientOrderId(clientOrderId);
  if (direct) return direct;
  const key = String(idempotencyKey || "").trim();
  if (!key) return null;
  const prefixRaw = String(process.env.BINANCE_CLIENT_ORDER_PREFIX || "dbj").trim();
  const prefix = prefixRaw.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "dbj";
  const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function isDuplicateClientOrderError(err) {
  const code = Number(err && err.code);
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  if (code === -4116 && (msg.includes("duplicated") || body.includes("duplicated") || msg.includes("clientorderid") || body.includes("clientorderid"))) return true;
  if (code === -2010 && (msg.includes("duplicate") || body.includes("duplicate"))) return true;
  if (msg.includes("duplicate order sent") || body.includes("duplicate order sent")) return true;
  if (msg.includes("new client order id") && msg.includes("used")) return true;
  if (body.includes("new client order id") && body.includes("used")) return true;
  return false;
}

function isAlgoOrderRequiredError(err) {
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  return msg.includes("please use the algo order api endpoints instead")
    || body.includes("please use the algo order api endpoints instead")
    || (msg.includes("order type not supported") && msg.includes("algo order"))
    || (body.includes("order type not supported") && body.includes("algo order"));
}

// Binance rejects a GTX (post-only) limit order that would immediately cross
// the book with -5022 "Post Only order will not be executed immediately"
// (and some historical variants). We detect it so the maker-first entry
// helper can fall back to a taker market order instantly instead of retrying.
function isPostOnlyRejectError(err) {
  const code = Number(err && err.code);
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  if (code === -5022) return true;
  if (msg.includes("post only") && (msg.includes("immediately") || msg.includes("taker"))) return true;
  if (body.includes("post only") && (body.includes("immediately") || body.includes("taker"))) return true;
  if (msg.includes("would immediately match") || body.includes("would immediately match")) return true;
  return false;
}

// DELETE /fapi/v1/order may legitimately fail with -2011 "Unknown order sent"
// if the order has already been filled or cancelled between our fetch and
// cancel. That's a no-op from our perspective — caller should treat it as
// "order not cancellable, go check its final state".
function isUnknownOrderError(err) {
  const code = Number(err && err.code);
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  if (code === -2011) return true;
  if (msg.includes("unknown order sent") || body.includes("unknown order sent")) return true;
  if (msg.includes("order does not exist") || body.includes("order does not exist")) return true;
  return false;
}

function isAlgoEndpointUnavailableError(err) {
  const status = Number(err && err.status);
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  if (msg.includes("algo_endpoint_unavailable") || body.includes("algo_endpoint_unavailable")) return true;
  if (msg.includes("invalid endpoint") || body.includes("invalid endpoint")) return true;
  if (status === 404 && (body.includes("<html") || body.includes("error code: 404") || msg.includes("error code: 404"))) return true;
  return false;
}

function normalizeAlgoOpenOrdersResponse(payload) {
  if (Array.isArray(payload)) {
    return {
      orders: payload,
      endpointUnavailable: false,
      note: null,
    };
  }
  if (payload && typeof payload === "object" && payload.endpointUnavailable === true) {
    return {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      endpointUnavailable: true,
      note: String(payload.note || "ALGO_ENDPOINT_UNAVAILABLE"),
    };
  }
  return {
    orders: [],
    endpointUnavailable: false,
    note: null,
  };
}

function isExistingClosePositionOrderConflict(err) {
  const code = Number(err && err.code);
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  const body = String(err && err.body ? err.body : "").toLowerCase();
  if (code === -4130) return true;
  return (msg.includes("open stop or take profit order") && msg.includes("closeposition"))
    || (body.includes("open stop or take profit order") && body.includes("closeposition"));
}

function normalizeExistingClosePositionConflict({ orderType, symbol, side, via } = {}) {
  return {
    ok: true,
    skipped: true,
    reason: "EXISTING_CLOSE_PROTECTION_ORDER",
    sourceType: String(via || "ORDER"),
    orderType: String(orderType || "").toUpperCase() || null,
    symbol: String(symbol || "").toUpperCase() || null,
    side: String(side || "").toUpperCase() || null,
  };
}

function normalizeAlgoOrderResponse(order) {
  if (!order || typeof order !== "object") return order;
  const algoId = order.algoId ?? order.algo_id;
  const normalized = {
    ...order,
    sourceType: "ALGO_ORDER",
  };
  if (Number.isFinite(Number(algoId))) {
    normalized.orderId = String(algoId);
    normalized.order_id = String(algoId);
  }
  if (normalized.orderType != null) {
    if (normalized.type == null) normalized.type = normalized.orderType;
    if (normalized.origType == null) normalized.origType = normalized.orderType;
  }
  if (normalized.triggerPrice != null) {
    if (normalized.stopPrice == null) normalized.stopPrice = normalized.triggerPrice;
    if (normalized.activatePrice == null) normalized.activatePrice = normalized.triggerPrice;
  }
  if (normalized.algoStatus != null && normalized.status == null) {
    normalized.status = normalized.algoStatus;
  }
  return normalized;
}

async function syncServerTimeOffset() {
  const now = Date.now();
  if (now - serverTimeSyncedAt < SERVER_TIME_TTL_MS) return serverTimeOffsetMs;
  const res = await fetch(`${getFuturesBaseUrl()}/fapi/v1/time`);
  const text = await res.text();
  if (!res.ok) return serverTimeOffsetMs;
  const json = parseJsonSafe(text);
  const serverTime = json && Number(json.serverTime);
  if (Number.isFinite(serverTime)) {
    serverTimeOffsetMs = serverTime - now;
    serverTimeSyncedAt = now;
  }
  return serverTimeOffsetMs;
}

function getSignedTimestamp() {
  return Date.now() + serverTimeOffsetMs;
}

async function binanceRequest({ method, path, params, apiKey, apiSecret, retry = true, baseUrl, signal = null }) {
  const { key, secret } = requireKeys({ apiKey, apiSecret });
  const root = baseUrl || getFuturesBaseUrl();
  const retryCfg = resolveRetryConfig();
  const allowRetry = retry !== false;
  const maxRetries = allowRetry ? retryCfg.maxRetries : 0;
  const retrySafe = canRetryRequest({ method, path, params });
  let requestParams = params && typeof params === "object" ? { ...params } : {};
  let timeSyncRetried = false;

  for (let attempt = 0; ; attempt += 1) {
    const query = buildQuery(requestParams);
    const sig = signQuery(query, secret);
    const url = `${root}${path}?${query}&signature=${sig}`;
    let res = null;
    let text = "";

    try {
      res = await fetch(url, {
        method,
        headers: {
          "X-MBX-APIKEY": key,
          Accept: "application/json",
        },
        signal: signal || undefined,
      });
      text = await res.text();
    } catch (fetchErr) {
      const abortLike = (signal && signal.aborted)
        || String(fetchErr && fetchErr.name || "") === "AbortError"
        || String(fetchErr && fetchErr.message || "") === "This operation was aborted";
      const canRetryNetwork = !abortLike && allowRetry && retrySafe && attempt < maxRetries;
      if (canRetryNetwork) {
        const waitMs = computeBackoffMs({ attempt, config: retryCfg });
        await sleep(waitMs);
        continue;
      }
      const err = new Error(`${abortLike ? "BINANCEFUT_REQUEST_ABORTED" : "BINANCEFUT_NETWORK_FAIL"}: ${readErrorText(fetchErr)}`);
      if (abortLike) err.code = "BINANCEFUT_REQUEST_ABORTED";
      err.method = method;
      err.path = path;
      err.cause = fetchErr;
      throw err;
    }

    if (res.ok) {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        const canRetryInvalidJson = allowRetry && retrySafe && attempt < maxRetries;
        if (canRetryInvalidJson) {
          const waitMs = computeBackoffMs({ attempt, config: retryCfg });
          await sleep(waitMs);
          continue;
        }
        const err = new Error(`BINANCEFUT_JSON_PARSE_FAIL: ${String(text).slice(0, 400)}`);
        err.status = Number(res.status);
        err.body = String(text || "");
        err.method = method;
        err.path = path;
        err.url = url;
        err.cause = parseErr;
        throw err;
      }
    }

    const errJson = parseJsonSafe(text);
    const errCode = errJson && Number.isFinite(Number(errJson.code)) ? Number(errJson.code) : null;
    const canRetryWithTimeSync = allowRetry
      && !timeSyncRetried
      && errCode === -1021
      && requestParams
      && requestParams.timestamp;
    if (canRetryWithTimeSync) {
      await syncServerTimeOffset();
      requestParams = { ...requestParams, timestamp: getSignedTimestamp() };
      timeSyncRetried = true;
      continue;
    }

    const canRetryHttp = allowRetry
      && attempt < maxRetries
      && retrySafe
      && (isRetriableHttpStatus(res.status) || isRetriableBinanceCode(errCode));
    if (canRetryHttp) {
      const waitMs = computeBackoffMs({
        attempt,
        retryAfterMs: parseRetryAfterMs(res.headers),
        config: retryCfg,
      });
      await sleep(waitMs);
      continue;
    }

    throw buildRequestError({
      status: res.status,
      text,
      errCode,
      method,
      path,
      url,
    });
  }
}

async function binanceApiKeyRequest({ method, path, params, apiKey, baseUrl }) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("BINANCEFUT_API_KEY_REQUIRED");
  const root = baseUrl || getFuturesBaseUrl();
  const query = buildQuery(params && typeof params === "object" ? params : {});
  const url = query ? `${root}${path}?${query}` : `${root}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": key,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const errJson = parseJsonSafe(text);
    const errCode = errJson && Number.isFinite(Number(errJson.code)) ? Number(errJson.code) : null;
    throw buildRequestError({ status: res.status, text, errCode, method, path, url });
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function fetchBinanceFuturesAccount({ apiKey, apiSecret, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchBinanceFuturesAccount",
      payload: { apiKey, apiSecret, recvWindow },
    });
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v2/account",
    params: { timestamp: ts, recvWindow: normalizeRecvWindow(recvWindow) },
    apiKey,
    apiSecret,
  });
}

async function fetchFuturesOpenOrders({ apiKey, apiSecret, symbol, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesOpenOrders",
      payload: { apiKey, apiSecret, symbol, recvWindow },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/openOrders",
    params: {
      symbol: sym || undefined,
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
    },
    apiKey,
    apiSecret,
  });
}

async function fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesAlgoOpenOrders",
      payload: { apiKey, apiSecret, symbol, recvWindow },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  const ts = getSignedTimestamp();
  try {
    const rows = await binanceRequest({
      method: "GET",
      path: "/fapi/v1/openAlgoOrders",
      params: {
        symbol: sym,
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
      },
      apiKey,
      apiSecret,
    });
    return Array.isArray(rows) ? rows.map((row) => normalizeAlgoOrderResponse(row)) : rows;
  } catch (e) {
    if (isAlgoEndpointUnavailableError(e)) {
      return {
        orders: [],
        endpointUnavailable: true,
        note: "ALGO_ENDPOINT_UNAVAILABLE",
      };
    }
    throw e;
  }
}

async function fetchFuturesPositionMode({ apiKey, apiSecret, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesPositionMode",
      payload: { apiKey, apiSecret, recvWindow },
    });
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/positionSide/dual",
    params: { timestamp: ts, recvWindow: normalizeRecvWindow(recvWindow) },
    apiKey,
    apiSecret,
  });
}

async function fetchBinanceWalletDeposits({ apiKey, apiSecret, startTime, endTime, coin, status, limit = 1000, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchBinanceWalletDeposits",
      payload: { apiKey, apiSecret, startTime, endTime, coin, status, limit, recvWindow },
    });
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/sapi/v1/capital/deposit/hisrec",
    params: {
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
      startTime,
      endTime,
      coin,
      status,
      limit,
    },
    apiKey,
    apiSecret,
    baseUrl: getSpotBaseUrl(),
  });
}

async function fetchBinanceWalletWithdrawals({ apiKey, apiSecret, startTime, endTime, coin, status, limit = 1000, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchBinanceWalletWithdrawals",
      payload: { apiKey, apiSecret, startTime, endTime, coin, status, limit, recvWindow },
    });
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/sapi/v1/capital/withdraw/history",
    params: {
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
      startTime,
      endTime,
      coin,
      status,
      limit,
    },
    apiKey,
    apiSecret,
    baseUrl: getSpotBaseUrl(),
  });
}

async function fetchBinanceWalletTransfers({ apiKey, apiSecret, type, startTime, endTime, current = 1, size = 100, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchBinanceWalletTransfers",
      payload: { apiKey, apiSecret, type, startTime, endTime, current, size, recvWindow },
    });
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/sapi/v1/asset/transfer",
    params: {
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
      type,
      startTime,
      endTime,
      current,
      size,
    },
    apiKey,
    apiSecret,
    baseUrl: getSpotBaseUrl(),
  });
}

const exchangeInfoCache = new Map();
const EXCHANGE_INFO_TTL_MS = 5 * 60 * 1000;

async function fetchFuturesExchangeInfo(symbol) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesExchangeInfo",
      payload: { symbol },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  const cached = exchangeInfoCache.get(sym);
  if (cached && (Date.now() - cached.at) < EXCHANGE_INFO_TTL_MS) return cached.data;

  const url = `${getFuturesBaseUrl()}/fapi/v1/exchangeInfo?symbol=` + encodeURIComponent(sym);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BINANCEFUT_HTTP_${res.status}: ${text.slice(0, 400)}`);
  }
  const json = text ? JSON.parse(text) : {};
  const info = Array.isArray(json.symbols) ? json.symbols.find((s) => s.symbol === sym) : null;
  if (!info) throw new Error("BINANCEFUT_SYMBOL_INFO_MISSING");

  const filters = Array.isArray(info.filters) ? info.filters : [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE") || filters.find((f) => f.filterType === "MARKET_LOT_SIZE");
  const minNotional = filters.find((f) => f.filterType === "MIN_NOTIONAL");
  const priceFilter = filters.find((f) => f.filterType === "PRICE_FILTER");
  const stepSize = lot ? Number(lot.stepSize) : null;
  const minQty = lot ? Number(lot.minQty) : null;
  const maxQty = lot ? Number(lot.maxQty) : null;
  const minNotionalVal = minNotional ? Number(minNotional.notional) : null;
  const tickSize = priceFilter ? Number(priceFilter.tickSize) : null;
  const pricePrecision = Number(info && info.pricePrecision);

  const data = {
    stepSize,
    minQty,
    maxQty,
    minNotional: minNotionalVal,
    tickSize: Number.isFinite(tickSize) ? tickSize : null,
    pricePrecision: Number.isFinite(pricePrecision) ? pricePrecision : null,
  };
  exchangeInfoCache.set(sym, { at: Date.now(), data });
  return data;
}

async function placeFuturesMarketOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  quantity,
  reduceOnly = false,
  recvWindow = 5000,
  clientOrderId,
  idempotencyKey,
  newOrderRespType = "RESULT",
} = {}) {
  const resolvedClientOrderId = resolveClientOrderId({ clientOrderId, idempotencyKey });
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "placeFuturesMarketOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol,
        side,
        quantity,
        reduceOnly,
        recvWindow,
        clientOrderId: resolvedClientOrderId,
        idempotencyKey,
        newOrderRespType,
      },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const qty = String(quantity || "");
  const s = String(side || "").toUpperCase();
  if (!sym || !qty || (s !== "BUY" && s !== "SELL")) {
    throw new Error("BINANCEFUT_ORDER_PARAMS_INVALID");
  }
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol: sym,
        side: s,
        type: "MARKET",
        quantity: qty,
        reduceOnly: reduceOnly ? "true" : "false",
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
        newClientOrderId: resolvedClientOrderId || undefined,
        newOrderRespType: String(newOrderRespType || "").trim().toUpperCase() || undefined,
      },
      apiKey,
      apiSecret,
    });
  } catch (e) {
    if (!resolvedClientOrderId || !isDuplicateClientOrderError(e)) throw e;
    return fetchFuturesOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      origClientOrderId: resolvedClientOrderId,
      recvWindow,
    });
  }
}

// GTX = "Good-Till-Crossing" (post-only) — if the price would immediately
// cross the book (i.e. act as a taker), Binance rejects with -5022 instead
// of filling. That rejection is the guard the maker-first entry relies on:
// we place LIMIT @ best-bid (BUY) / best-ask (SELL); if the book moved we
// bail out cleanly and fall back to MARKET.
// For ENTRY orders reduceOnly must stay false.
async function placeFuturesLimitOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  quantity,
  price,
  timeInForce = "GTX",
  reduceOnly = false,
  recvWindow = 5000,
  clientOrderId,
  idempotencyKey,
} = {}) {
  const resolvedClientOrderId = resolveClientOrderId({ clientOrderId, idempotencyKey });
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "placeFuturesLimitOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol,
        side,
        quantity,
        price,
        timeInForce,
        reduceOnly,
        recvWindow,
        clientOrderId: resolvedClientOrderId,
        idempotencyKey,
      },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const s = String(side || "").toUpperCase();
  const qty = String(quantity || "");
  const tif = String(timeInForce || "GTX").toUpperCase();
  if (!sym || !qty || (s !== "BUY" && s !== "SELL")) {
    throw new Error("BINANCEFUT_ORDER_PARAMS_INVALID");
  }
  // Price must be normalized to the symbol's tickSize. We use the same
  // helper as stop orders; rounding direction matches maker semantics:
  //   BUY  limit → floor to tick (never above the bid → never a taker)
  //   SELL limit → ceil  to tick (never below the ask → never a taker)
  const pxStr = await normalizeFuturesTriggerPrice(sym, price, {
    roundingMode: s === "BUY" ? "floor" : "ceil",
  });
  if (!pxStr) throw new Error("BINANCEFUT_LIMIT_PRICE_INVALID");
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol: sym,
        side: s,
        type: "LIMIT",
        quantity: qty,
        price: pxStr,
        timeInForce: tif,
        reduceOnly: reduceOnly ? "true" : "false",
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
        newClientOrderId: resolvedClientOrderId || undefined,
      },
      apiKey,
      apiSecret,
    });
  } catch (e) {
    if (!resolvedClientOrderId || !isDuplicateClientOrderError(e)) throw e;
    return fetchFuturesOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      origClientOrderId: resolvedClientOrderId,
      recvWindow,
    });
  }
}

async function cancelFuturesOrder({
  apiKey,
  apiSecret,
  symbol,
  orderId,
  origClientOrderId,
  recvWindow = 5000,
} = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "cancelFuturesOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol,
        orderId,
        origClientOrderId,
        recvWindow,
      },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const id = Number(orderId);
  const clientOrderId = sanitizeClientOrderId(origClientOrderId);
  if (!sym || (!Number.isFinite(id) && !clientOrderId)) {
    throw new Error("BINANCEFUT_ORDER_ID_REQUIRED");
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "DELETE",
    path: "/fapi/v1/order",
    params: {
      symbol: sym,
      orderId: Number.isFinite(id) ? id : undefined,
      origClientOrderId: clientOrderId || undefined,
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
    },
    apiKey,
    apiSecret,
  });
}

// Public endpoint — best bid / best ask snapshot. Used by the maker-first
// entry helper to pick a limit price that is guaranteed to rest on the book
// (i.e. act as a maker). No auth / signing required, but we still honour
// the egress proxy when configured so the caller's IP whitelisting stays
// consistent with the private Binance calls made alongside it.
async function fetchFuturesBookTicker({ symbol } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  if (shouldUseEgressProxy()) {
    try {
      return await callEgressProxy({
        provider: "binancefut",
        action: "fetchFuturesBookTicker",
        payload: { symbol: sym },
      });
    } catch (e) {
      // If the egress proxy does not know this action yet (older deploy),
      // silently fall through to the direct public fetch. The direct fetch
      // will only fail if the host is also IP-blocked, in which case the
      // caller's market-fallback path will pick up the slack.
      const msg = String(e && e.message ? e.message : "").toLowerCase();
      if (!msg.includes("action_not_supported") && !msg.includes("unknown action")) throw e;
    }
  }
  const url = `${getFuturesBaseUrl()}/fapi/v1/ticker/bookTicker?symbol=` + encodeURIComponent(sym);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BINANCEFUT_HTTP_${res.status}: ${text.slice(0, 400)}`);
  }
  const json = text ? JSON.parse(text) : {};
  const bid = Number(json && json.bidPrice);
  const ask = Number(json && json.askPrice);
  const bidQty = Number(json && json.bidQty);
  const askQty = Number(json && json.askQty);
  return {
    symbol: sym,
    bidPrice: Number.isFinite(bid) && bid > 0 ? bid : null,
    askPrice: Number.isFinite(ask) && ask > 0 ? ask : null,
    bidQty: Number.isFinite(bidQty) && bidQty >= 0 ? bidQty : null,
    askQty: Number.isFinite(askQty) && askQty >= 0 ? askQty : null,
    at: Date.now(),
  };
}

async function fetchFuturesAlgoOrder({
  apiKey,
  apiSecret,
  symbol,
  algoId,
  clientAlgoId,
  recvWindow = 5000,
} = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesAlgoOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol,
        algoId,
        clientAlgoId,
        recvWindow,
      },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const id = Number(algoId);
  const clientId = sanitizeClientOrderId(clientAlgoId);
  if (!sym || (!Number.isFinite(id) && !clientId)) {
    throw new Error("BINANCEFUT_ALGO_ORDER_ID_REQUIRED");
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/algoOrder",
    params: {
      symbol: sym,
      algoId: Number.isFinite(id) ? id : undefined,
      clientAlgoId: clientId || undefined,
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
    },
    apiKey,
    apiSecret,
  }).then((order) => normalizeAlgoOrderResponse(order));
}

async function placeFuturesConditionalAlgoOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  type,
  triggerPrice,
  closePosition = true,
  quantity,
  reduceOnly = false,
  workingType = "MARK_PRICE",
  priceProtect = true,
  recvWindow = 5000,
  clientAlgoId,
  signal = null,
} = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const s = String(side || "").toUpperCase();
  const orderType = String(type || "").trim().toUpperCase();
  const triggerPx = toBinanceNumberString(triggerPrice);
  const qty = toBinanceNumberString(quantity);
  const clientId = sanitizeClientOrderId(clientAlgoId);
  if (!sym || !triggerPx || (s !== "BUY" && s !== "SELL")) {
    throw new Error("BINANCEFUT_ALGO_ORDER_PARAMS_INVALID");
  }
  if (orderType !== "STOP_MARKET" && orderType !== "TAKE_PROFIT_MARKET") {
    throw new Error("BINANCEFUT_ALGO_ORDER_TYPE_INVALID");
  }
  if (!closePosition && !qty) {
    throw new Error("BINANCEFUT_ALGO_ORDER_QTY_REQUIRED");
  }
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/algoOrder",
      params: {
        symbol: sym,
        side: s,
        algoType: "CONDITIONAL",
        type: orderType,
        triggerPrice: triggerPx,
        closePosition: closePosition ? "true" : "false",
        quantity: closePosition ? undefined : qty,
        reduceOnly: closePosition ? undefined : (reduceOnly ? "true" : "false"),
        workingType: workingType || "MARK_PRICE",
        priceProtect: priceProtect ? "true" : "false",
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
        clientAlgoId: clientId || undefined,
      },
      apiKey,
      apiSecret,
      signal,
    });
  } catch (e) {
    if (closePosition && isExistingClosePositionOrderConflict(e)) {
      return normalizeExistingClosePositionConflict({
        orderType,
        symbol: sym,
        side: s,
        via: "ALGO_ORDER",
      });
    }
    if (!clientId || !isDuplicateClientOrderError(e)) throw e;
    return fetchFuturesAlgoOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      clientAlgoId: clientId,
      recvWindow,
    });
  }
}

async function cancelFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol, recvWindow = 5000, signal = null } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "DELETE",
      path: "/fapi/v1/algoOpenOrders",
      params: {
        symbol: sym,
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
      },
      apiKey,
      apiSecret,
      signal,
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : "");
    const body = String(e && e.body ? e.body : "");
    if ((e && e.code === -2011) || msg.includes("Unknown order sent") || body.includes("Unknown order sent")) {
      return { ok: true, skipped: true, note: "NO_ALGO_OPEN_ORDERS" };
    }
    if (msg.includes("Invalid endpoint") || body.includes("Invalid endpoint")) {
      return { ok: true, skipped: true, note: "ALGO_ENDPOINT_UNAVAILABLE" };
    }
    throw e;
  }
}

async function placeFuturesStopMarketOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  stopPrice,
  closePosition = true,
  workingType = "MARK_PRICE",
  priceProtect = true,
  recvWindow = 5000,
  clientOrderId,
  idempotencyKey,
  signal = null,
} = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const s = String(side || "").toUpperCase();
  const stopPx = await normalizeFuturesTriggerPrice(sym, stopPrice, {
    roundingMode: s === "SELL" ? "ceil" : "floor",
  });
  const resolvedClientOrderId = resolveClientOrderId({ clientOrderId, idempotencyKey });
  if (!sym || !stopPx || (s !== "BUY" && s !== "SELL")) {
    throw new Error("BINANCEFUT_STOP_ORDER_PARAMS_INVALID");
  }
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "placeFuturesStopMarketOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol: sym,
        side: s,
        stopPrice: stopPx,
        closePosition,
        workingType,
        priceProtect,
        recvWindow,
        clientOrderId: resolvedClientOrderId,
        idempotencyKey,
      },
      signal,
    });
  }
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol: sym,
        side: s,
        type: "STOP_MARKET",
        stopPrice: stopPx,
        closePosition: closePosition ? "true" : "false",
        workingType: workingType || "MARK_PRICE",
        priceProtect: priceProtect ? "true" : "false",
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
        newClientOrderId: resolvedClientOrderId || undefined,
      },
      apiKey,
      apiSecret,
      signal,
    });
  } catch (e) {
    if (closePosition && isExistingClosePositionOrderConflict(e)) {
      return normalizeExistingClosePositionConflict({
        orderType: "STOP_MARKET",
        symbol: sym,
        side: s,
        via: "ORDER",
      });
    }
    if (isAlgoOrderRequiredError(e)) {
      const algoOrder = await placeFuturesConditionalAlgoOrder({
        apiKey,
        apiSecret,
        symbol: sym,
        side: s,
        type: "STOP_MARKET",
        triggerPrice: stopPx,
        closePosition,
        workingType,
        priceProtect,
        recvWindow,
        clientAlgoId: resolvedClientOrderId,
        signal,
      });
      return normalizeAlgoOrderResponse(algoOrder);
    }
    if (!resolvedClientOrderId || !isDuplicateClientOrderError(e)) throw e;
    return fetchFuturesOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      origClientOrderId: resolvedClientOrderId,
      recvWindow,
    });
  }
}

async function placeFuturesTakeProfitMarketOrder({
  apiKey,
  apiSecret,
  symbol,
  side,
  stopPrice,
  closePosition = true,
  quantity,
  reduceOnly = false,
  workingType = "MARK_PRICE",
  priceProtect = true,
  recvWindow = 5000,
  clientOrderId,
  idempotencyKey,
  signal = null,
} = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const s = String(side || "").toUpperCase();
  const stopPx = await normalizeFuturesTriggerPrice(sym, stopPrice);
  const qty = toBinanceNumberString(quantity);
  const resolvedClientOrderId = resolveClientOrderId({ clientOrderId, idempotencyKey });
  if (!sym || !stopPx || (s !== "BUY" && s !== "SELL")) {
    throw new Error("BINANCEFUT_TP_ORDER_PARAMS_INVALID");
  }
  if (!closePosition && !qty) {
    throw new Error("BINANCEFUT_TP_ORDER_QTY_REQUIRED");
  }
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "placeFuturesTakeProfitMarketOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol: sym,
        side: s,
        stopPrice: stopPx,
        closePosition,
        quantity: closePosition ? undefined : qty,
        reduceOnly: closePosition ? undefined : !!reduceOnly,
        workingType,
        priceProtect,
        recvWindow,
        clientOrderId: resolvedClientOrderId,
        idempotencyKey,
      },
      signal,
    });
  }
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol: sym,
        side: s,
        type: "TAKE_PROFIT_MARKET",
        stopPrice: stopPx,
        closePosition: closePosition ? "true" : "false",
        quantity: closePosition ? undefined : qty,
        reduceOnly: closePosition ? undefined : (reduceOnly ? "true" : "false"),
        workingType: workingType || "MARK_PRICE",
        priceProtect: priceProtect ? "true" : "false",
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
        newClientOrderId: resolvedClientOrderId || undefined,
      },
      apiKey,
      apiSecret,
      signal,
    });
  } catch (e) {
    if (closePosition && isExistingClosePositionOrderConflict(e)) {
      return normalizeExistingClosePositionConflict({
        orderType: "TAKE_PROFIT_MARKET",
        symbol: sym,
        side: s,
        via: "ORDER",
      });
    }
    if (isAlgoOrderRequiredError(e)) {
      const algoOrder = await placeFuturesConditionalAlgoOrder({
        apiKey,
        apiSecret,
        symbol: sym,
        side: s,
        type: "TAKE_PROFIT_MARKET",
        triggerPrice: stopPx,
        closePosition,
        quantity: closePosition ? undefined : qty,
        reduceOnly,
        workingType,
        priceProtect,
        recvWindow,
        clientAlgoId: resolvedClientOrderId,
        signal,
      });
      return normalizeAlgoOrderResponse(algoOrder);
    }
    if (!resolvedClientOrderId || !isDuplicateClientOrderError(e)) throw e;
    return fetchFuturesOrder({
      apiKey,
      apiSecret,
      symbol: sym,
      origClientOrderId: resolvedClientOrderId,
      recvWindow,
    });
  }
}

async function cancelFuturesOpenOrders({ apiKey, apiSecret, symbol, recvWindow = 5000, signal = null } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "cancelFuturesOpenOrders",
      payload: { apiKey, apiSecret, symbol, recvWindow },
      signal,
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  const ts = getSignedTimestamp();
  let regularResult = null;
  try {
    regularResult = await binanceRequest({
      method: "DELETE",
      path: "/fapi/v1/allOpenOrders",
      params: {
        symbol: sym,
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
      },
      apiKey,
      apiSecret,
      signal,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    const body = e && e.body ? String(e.body) : "";
    if ((e && e.code === -2011) || msg.includes("Unknown order sent") || body.includes("Unknown order sent")) {
      regularResult = { ok: true, skipped: true, note: "NO_OPEN_ORDERS" };
    } else {
      throw e;
    }
  }
  const algoResult = await cancelFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: sym, recvWindow, signal });
  return { ok: true, regular: regularResult, algo: algoResult };
}

async function fetchFuturesOrder({
  apiKey,
  apiSecret,
  symbol,
  orderId,
  origClientOrderId,
  recvWindow = 5000,
} = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesOrder",
      payload: {
        apiKey,
        apiSecret,
        symbol,
        orderId,
        origClientOrderId,
        recvWindow,
      },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const id = Number(orderId);
  const clientOrderId = sanitizeClientOrderId(origClientOrderId);
  if (!sym || (!Number.isFinite(id) && !clientOrderId)) throw new Error("BINANCEFUT_ORDER_ID_REQUIRED");
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/order",
    params: {
      symbol: sym,
      orderId: Number.isFinite(id) ? id : undefined,
      origClientOrderId: clientOrderId || undefined,
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
    },
    apiKey,
    apiSecret,
  });
}

async function fetchFuturesUserTrades({
  apiKey,
  apiSecret,
  symbol,
  startTime,
  endTime,
  fromId,
  limit = 1000,
  recvWindow = 5000,
} = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesUserTrades",
      payload: { apiKey, apiSecret, symbol, startTime, endTime, fromId, limit, recvWindow },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCEFUT_SYMBOL_REQUIRED");
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/userTrades",
    params: {
      symbol: sym,
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
      startTime: (startTime == null ? undefined : Number(startTime)),
      endTime: (endTime == null ? undefined : Number(endTime)),
      fromId: (fromId == null ? undefined : Number(fromId)),
      limit: (limit == null ? undefined : Number(limit)),
    },
    apiKey,
    apiSecret,
  });
}

async function createFuturesListenKey({ apiKey, baseUrl } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "createFuturesListenKey",
      payload: { apiKey, baseUrl },
    });
  }
  return binanceApiKeyRequest({
    method: "POST",
    path: "/fapi/v1/listenKey",
    params: null,
    apiKey,
    baseUrl,
  });
}

async function keepaliveFuturesListenKey({ apiKey, listenKey, baseUrl } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "keepaliveFuturesListenKey",
      payload: { apiKey, listenKey, baseUrl },
    });
  }
  const key = String(listenKey || "").trim();
  if (!key) throw new Error("BINANCEFUT_LISTEN_KEY_REQUIRED");
  return binanceApiKeyRequest({
    method: "PUT",
    path: "/fapi/v1/listenKey",
    params: { listenKey: key },
    apiKey,
    baseUrl,
  });
}

async function deleteFuturesListenKey({ apiKey, listenKey, baseUrl } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "deleteFuturesListenKey",
      payload: { apiKey, listenKey, baseUrl },
    });
  }
  const key = String(listenKey || "").trim();
  if (!key) throw new Error("BINANCEFUT_LISTEN_KEY_REQUIRED");
  return binanceApiKeyRequest({
    method: "DELETE",
    path: "/fapi/v1/listenKey",
    params: { listenKey: key },
    apiKey,
    baseUrl,
  });
}

async function fetchFuturesIncomeHistory({
  apiKey,
  apiSecret,
  symbol,
  incomeType,
  startTime,
  endTime,
  limit = 1000,
  recvWindow = 5000,
} = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesIncomeHistory",
      payload: { apiKey, apiSecret, symbol, incomeType, startTime, endTime, limit, recvWindow },
    });
  }
  const sym = symbol == null ? "" : String(symbol || "").trim().toUpperCase();
  const ts = getSignedTimestamp();
  const params = {
    timestamp: ts,
    recvWindow: normalizeRecvWindow(recvWindow),
    incomeType: incomeType ? String(incomeType) : undefined,
    startTime: (startTime == null ? undefined : Number(startTime)),
    endTime: (endTime == null ? undefined : Number(endTime)),
    limit: (limit == null ? undefined : Number(limit)),
  };
  if (sym) params.symbol = sym;
  return binanceRequest({
    method: "GET",
    path: "/fapi/v1/income",
    params,
    apiKey,
    apiSecret,
  });
}

async function setFuturesLeverage({ apiKey, apiSecret, symbol, leverage, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "setFuturesLeverage",
      payload: { apiKey, apiSecret, symbol, leverage, recvWindow },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const lev = Number(leverage);
  if (!sym || !Number.isFinite(lev) || lev <= 0) {
    throw new Error("BINANCEFUT_LEVERAGE_REQUIRED");
  }
  const ts = getSignedTimestamp();
  return binanceRequest({
    method: "POST",
    path: "/fapi/v1/leverage",
    params: {
      symbol: sym,
      leverage: Math.round(lev),
      timestamp: ts,
      recvWindow: normalizeRecvWindow(recvWindow),
    },
    apiKey,
    apiSecret,
  });
}

async function setFuturesMarginType({ apiKey, apiSecret, symbol, marginType, recvWindow = 5000 } = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "binancefut",
      action: "setFuturesMarginType",
      payload: { apiKey, apiSecret, symbol, marginType, recvWindow },
    });
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const mt = String(marginType || "").trim().toUpperCase();
  if (!sym || (mt !== "ISOLATED" && mt !== "CROSSED")) {
    throw new Error("BINANCEFUT_MARGIN_TYPE_REQUIRED");
  }
  const ts = getSignedTimestamp();
  try {
    return await binanceRequest({
      method: "POST",
      path: "/fapi/v1/marginType",
      params: {
        symbol: sym,
        marginType: mt,
        timestamp: ts,
        recvWindow: normalizeRecvWindow(recvWindow),
      },
      apiKey,
      apiSecret,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    const body = e && e.body ? String(e.body) : "";
    if ((e && e.code === -4046) || msg.includes("No need to change margin type") || body.includes("No need to change margin type")) {
      return { ok: true, skipped: true, note: "MARGIN_TYPE_ALREADY_SET" };
    }
    throw e;
  }
}

function calcAveragePrice(order) {
  if (!order) return null;
  const avg = Number(order.avgPrice || order.avg_price);
  if (Number.isFinite(avg) && avg > 0) return avg;
  const price = Number(order.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

module.exports = {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesAlgoOrder,
  fetchFuturesPositionMode,
  fetchFuturesExchangeInfo,
  placeFuturesMarketOrder,
  placeFuturesLimitOrder,
  cancelFuturesOrder,
  fetchFuturesBookTicker,
  fetchFuturesOrder,
  fetchFuturesUserTrades,
  createFuturesListenKey,
  keepaliveFuturesListenKey,
  deleteFuturesListenKey,
  fetchFuturesIncomeHistory,
  fetchBinanceWalletDeposits,
  fetchBinanceWalletWithdrawals,
  fetchBinanceWalletTransfers,
  setFuturesLeverage,
  setFuturesMarginType,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
  cancelFuturesOpenOrders,
  calcAveragePrice,
  getFuturesBaseUrl,
  getSpotBaseUrl,
  normalizeRecvWindow,
  __test: {
    isDuplicateClientOrderError,
    isAlgoEndpointUnavailableError,
    isPostOnlyRejectError,
    isUnknownOrderError,
    normalizeAlgoOpenOrdersResponse,
    normalizeAlgoOrderResponse,
    sanitizeClientOrderId,
    floorToStep,
    ceilToStep,
    normalizeFuturesTriggerPriceFromExchangeInfo,
  },
};
