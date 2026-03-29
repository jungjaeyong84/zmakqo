// src/exchanges/kiwoomRest.js
// Kiwoom REST Adapter (실구현 · 베타)
// 역할: 내부 표준 요청을 Kiwoom REST 호출로 변환하고 응답을 정규화한다.
// 주의: 실제 키/시크릿이 필요하며, sandbox/mock 도메인은 KRX 한정이다.

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { shouldUseEgressProxy, callEgressProxy } = require("../utils/egressProxy");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

// 인메모리 토큰 캐시 (키별)
const tokenCacheByKey = new Map();
let tokenCache = { access_token: null, expires_at_ms: 0, token_type: "Bearer" };

function nowMs() { return Date.now(); }
function toNumber(x) {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  if (!s) return null;
  const cleaned = s.replace(/[, ]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toPrice(x) {
  const n = toNumber(x);
  if (n == null) return null;
  return Math.abs(n);
}

function currentEnv() {
  return String(process.env.KIWOOM_ENV || "mock").toLowerCase();
}

function baseUrl() {
  const env = currentEnv();
  if (process.env.KIWOOM_BASE_URL) return process.env.KIWOOM_BASE_URL;
  return env === "live" ? "https://api.kiwoom.com" : "https://mockapi.kiwoom.com";
}

function normalizeSymbol(raw) {
  // 내부 심볼: KRX:005930 형태 → 키움은 숫자코드만 필요
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length === 2) return parts[1];
  return s.replace(/[^0-9A-Z]/g, "");
}

const { isKrxMarketOpenKst } = require("../utils/krxCalendar");

// KRX 호가단위(표준) 적용
// KOSPI/KOSDAQ 일반주식 기준:
// <1,000: 1원, <5,000: 5원, <10,000:10원, <50,000:50원,
// <100,000:100원, <500,000:500원, >=500,000:1000원
// 참고: 종목 특성(ETF/ETN/채권 등)별 예외가 있을 수 있어 실제 호가단위는
// 호가 API의 pri_buy_bid_unit / pri_sel_bid_unit 값으로 보정 가능.
function tickSize(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 1;
  if (p < 1_000) return 1;
  if (p < 5_000) return 5;
  if (p < 10_000) return 10;
  if (p < 50_000) return 50;
  if (p < 100_000) return 100;
  if (p < 500_000) return 500;
  return 1_000;
}

function roundToTick(price, side) {
  const t = tickSize(price);
  if (!Number.isFinite(t) || t <= 0) return price;
  // 매수는 호가단위 올림, 매도는 내림 (보수적 체결 보장)
  if (side === "BUY") return Math.ceil(price / t) * t;
  if (side === "SELL") return Math.floor(price / t) * t;
  return Math.round(price / t) * t;
}


function msFromExpires(expires_dt) {
  // expires_dt 예: "20241107083713" (YYYYMMDDHHmmss) 또는 "2026-01-26 12:00:00"
  const raw = String(expires_dt || "").trim();
  if (!raw) return null;
  if (/^\d{14}$/.test(raw)) {
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6));
    const d = Number(raw.slice(6, 8));
    const hh = Number(raw.slice(8, 10));
    const mm = Number(raw.slice(10, 12));
    const ss = Number(raw.slice(12, 14));
    // 키움 표기는 KST 기준으로 가정 → UTC로 변환
    const ms = Date.UTC(y, m - 1, d, hh - 9, mm, ss);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function parseKstYmdHms(raw) {
  const s = String(raw || "").trim();
  if (/^\d{14}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const hh = Number(s.slice(8, 10));
    const mm = Number(s.slice(10, 12));
    const ss = Number(s.slice(12, 14));
    const ms = Date.UTC(y, m - 1, d, hh - 9, mm, ss);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function cacheKey(appkey, secretkey) {
  const k = String(appkey || "");
  const s = String(secretkey || "");
  return `${k}:${s.slice(-4)}`;
}

async function getToken(auth = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "getToken",
      payload: { auth },
    });
  }
  const now = nowMs();
  const appkey = auth.appkey || process.env.KIWOOM_APP_KEY;
  const secretkey = auth.secretkey || process.env.KIWOOM_APP_SECRET;
  const key = cacheKey(appkey, secretkey);
  const cached = tokenCacheByKey.get(key) || tokenCache;
  if (cached.access_token && cached.expires_at_ms - 60_000 > now) {
    return { ok: true, access_token: cached.access_token, token_type: cached.token_type, expires_at_ms: cached.expires_at_ms, source: "cache" };
  }
  if (!appkey || !secretkey) {
    return { ok: false, error: "AUTH_MISSING", message: "KIWOOM_APP_KEY/SECRET 필요" };
  }

  const url = `${baseUrl()}/oauth2/token`;
  const body = { grant_type: "client_credentials", appkey, secretkey };
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "api-id": "au10001",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: "NETWORK_TIMEOUT", message: e.message };
  }
  let json = null;
  try { json = await res.json(); } catch (_) { /* noop */ }
  if (!res.ok) {
    const msg = json?.message || json?.return_msg || json?.return_message || res.statusText;
    return {
      ok: false,
      error: res.status === 401 ? "AUTH_INVALID" : "PROVIDER_5XX",
      message: msg,
      status: res.status,
      return_code: json?.return_code,
      base_url: baseUrl(),
      env: currentEnv(),
      raw: json,
    };
  }
  if (json && typeof json.return_code !== "undefined" && Number(json.return_code) !== 0) {
    return {
      ok: false,
      error: "AUTH_INVALID",
      message: json?.return_msg || json?.return_message || "TOKEN_RETURN_CODE_NOT_OK",
      return_code: json.return_code,
      base_url: baseUrl(),
      env: currentEnv(),
      raw: json,
    };
  }
  const token = json?.access_token || json?.token;
  const tokenTypeRaw = String(json?.token_type || "Bearer");
  const tokenType = tokenTypeRaw.toLowerCase() === "bearer" ? "Bearer" : tokenTypeRaw;
  const expiresMs = msFromExpires(json?.expires_dt) || (now + (json?.expires_in || 3600) * 1000);
  const next = { access_token: token, token_type: tokenType, expires_at_ms: expiresMs };
  tokenCacheByKey.set(key, next);
  tokenCache = next;
  return { ok: true, access_token: token, token_type: next.token_type, expires_at_ms: expiresMs, raw: json, source: "fetch" };
}

async function kiwoomFetch(path, { method = "GET", headers = {}, body = null, apiId = null, auth = null } = {}) {
  const tok = await getToken(auth || {});
  if (!tok.ok) return tok;
  const url = `${baseUrl()}${path}`;
  const reqHeaders = {
    Authorization: `${tok.token_type} ${tok.access_token}`,
    "Content-Type": "application/json",
    ...headers,
  };
  if (apiId) reqHeaders["api-id"] = apiId;

  let res;
  try {
    res = await fetch(url, { method, headers: reqHeaders, body: body ? JSON.stringify(body) : null, timeout: 10_000 });
  } catch (e) {
    return { ok: false, error: "NETWORK_TIMEOUT", message: e.message };
  }
  let json = null;
  try { json = await res.json(); } catch (_) { /* noop */ }
  if (!res.ok) {
    const rc = json?.return_code;
    const msg = json?.message || json?.return_msg || json?.return_message || res.statusText;
    const err = res.status === 401 ? "AUTH_EXPIRED"
      : res.status === 429 ? "RATE_LIMIT"
      : res.status >= 500 ? "PROVIDER_5XX"
      : "ORDER_REJECTED";
    return {
      ok: false,
      error: err,
      status: res.status,
      return_code: rc,
      message: msg,
      base_url: baseUrl(),
      env: currentEnv(),
      raw: json,
    };
  }
  if (json && typeof json.return_code !== "undefined" && Number(json.return_code) !== 0) {
    return {
      ok: false,
      error: "ORDER_REJECTED",
      status: res.status,
      return_code: json.return_code,
      message: json?.return_msg || json?.return_message || "RETURN_CODE_NOT_OK",
      base_url: baseUrl(),
      env: currentEnv(),
      raw: json,
    };
  }
  return { ok: true, status: res.status, data: json };
}

async function placeOrder(req = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "placeOrder",
      payload: req,
    });
  }
  const {
    dmst_stex_tp = "KRX",
    symbol,
    side,
    order_type = "MARKET",
    qty,
    price = null,
    cond_uv = null,
    trde_tp = null,
    appkey,
    secretkey,
    block_if_closed = true,
    min_notional_krw = null,
    auto_adjust_min_notional = false,
    reference_price = null,
    max_qty = null,
  } = req;
  const stk_cd = normalizeSymbol(symbol);
  if (!stk_cd) return { ok: false, error: "SYMBOL_NOT_FOUND", message: "symbol required" };
  if (!qty || qty <= 0) return { ok: false, error: "INVALID_REQUEST", message: "qty required" };
  if (block_if_closed && !isKrxMarketOpenKst()) {
    return { ok: false, error: "MARKET_CLOSED", message: "KRX 장중이 아닙니다." };
  }

  // 최소 주문/호가단위 검증
  const MIN_NOTIONAL = 1000; // KRW
  const MIN_QTY = 1;
  if (qty < MIN_QTY) return { ok: false, error: "ORDER_TOO_SMALL", message: `qty < ${MIN_QTY}` };
  let ordUv = order_type === "LIMIT" ? price : null;
  if (order_type === "LIMIT") {
    if (!Number.isFinite(ordUv) || ordUv <= 0) return { ok: false, error: "INVALID_REQUEST", message: "limit price required" };
    ordUv = roundToTick(ordUv, side);
  }
  const refPrice = Number.isFinite(reference_price) ? Number(reference_price) : ordUv;
  let notional = order_type === "LIMIT" ? ordUv * qty : (Number.isFinite(refPrice) ? refPrice * qty : null);
  const minNotional = (min_notional_krw == null || min_notional_krw === 0) ? MIN_NOTIONAL : Number(min_notional_krw);
  if (Number.isFinite(minNotional) && minNotional > 0 && notional !== null && notional < minNotional) {
    if (auto_adjust_min_notional && Number.isFinite(refPrice) && refPrice > 0) {
      const bumpedQty = Math.ceil(minNotional / refPrice);
      const maxQty = (max_qty == null ? null : Number(max_qty));
      if (Number.isFinite(maxQty) && maxQty > 0 && bumpedQty > maxQty) {
        return { ok: false, error: "ORDER_TOO_SMALL", message: `qty < min_notional (cap)`, min_notional_krw: minNotional };
      }
      notional = refPrice * bumpedQty;
      if (order_type === "LIMIT") {
        // 가격은 이미 호가단위로 보정됨
      }
      return placeOrder({
        ...req,
        qty: bumpedQty,
        auto_adjust_min_notional: false,
      });
    }
    return { ok: false, error: "ORDER_TOO_SMALL", message: `notional < ${minNotional}`, min_notional_krw: minNotional };
  }

  const api_id = side === "SELL" ? "kt10001" : "kt10000";
  const body = {
    dmst_stex_tp,
    stk_cd,
    ord_qty: qty,
    ord_uv: order_type === "LIMIT" ? ordUv : null,
    trde_tp: trde_tp || (order_type === "MARKET" ? "00" : "01"), // 예시 코드: 00=시장가, 01=지정가 (실제 가이드를 맞춰야 함)
    cond_uv: cond_uv || null,
  };

  const res = await kiwoomFetch("/api/dostk/ordr", { method: "POST", apiId: api_id, body, auth: { appkey, secretkey } });
  if (!res.ok) return res;
  const ordNo = res.data?.ord_no;
  return {
    ok: true,
    provider_order_id: ordNo || null,
    status: "ACKED",
    raw: res.data,
  };
}

async function cancelOrder(req = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "cancelOrder",
      payload: req,
    });
  }
  const { api_id = "kt10003", provider_order_id, stk_cd, qty, appkey, secretkey } = req;
  if (!provider_order_id) return { ok: false, error: "INVALID_REQUEST", message: "provider_order_id required" };
  const body = { ord_no: provider_order_id, stk_cd: normalizeSymbol(stk_cd), ord_qty: qty || null };
  const res = await kiwoomFetch("/api/dostk/ordr", { method: "POST", apiId: api_id, body, auth: { appkey, secretkey } });
  if (!res.ok) return res;
  return { ok: true, status: "CANCELED", raw: res.data };
}

async function modifyOrder(req = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "modifyOrder",
      payload: req,
    });
  }
  const { api_id = "kt10002", provider_order_id, stk_cd, new_qty, new_price, appkey, secretkey } = req;
  if (!provider_order_id) return { ok: false, error: "INVALID_REQUEST", message: "provider_order_id required" };
  const body = {
    ord_no: provider_order_id,
    stk_cd: normalizeSymbol(stk_cd),
    ord_qty: new_qty,
    ord_uv: new_price,
  };
  const res = await kiwoomFetch("/api/dostk/ordr", { method: "POST", apiId: api_id, body, auth: { appkey, secretkey } });
  if (!res.ok) return res;
  return { ok: true, status: "ACKED", raw: res.data };
}

async function fetchAccount(req = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "fetchAccount",
      payload: req,
    });
  }
  const { api_id = "ka01690", qry_dt = null, appkey, secretkey } = req;
  const body = { qry_dt: qry_dt || new Date().toISOString().slice(0, 10).replace(/-/g, "") };
  const res = await kiwoomFetch("/api/dostk/acnt", { method: "POST", apiId: api_id, body, auth: { appkey, secretkey } });
  if (!res.ok) return res;
  const d = res.data || {};
  const cash = toNumber(d.dbst_bal);
  const holdingsRaw = Array.isArray(d.day_bal_rt) ? d.day_bal_rt : [];
  const holdings = holdingsRaw.map((h) => ({
    symbol: h.stk_cd ? `KRX:${h.stk_cd}` : null,
    qty: toNumber(h.rmnd_qty),
    avg_price: toPrice(h.buy_uv),
    last_price: toPrice(h.cur_prc),
  })).filter((x) => x.symbol && Number.isFinite(x.qty));

  return {
    ok: true,
    cash_krw: Number.isFinite(cash) ? cash : null,
    holdings,
    raw: d,
  };
}

async function fetchBars(req = {}) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "kiwoom",
      action: "fetchBars",
      payload: req,
    });
  }
  const { api_id = "ka10080", tf = defaultExecTfFromEnv() || "15m", symbol, count = 200, appkey, secretkey } = req;
  const stk_cd = normalizeSymbol(symbol);
  if (!stk_cd) return { ok: false, error: "SYMBOL_NOT_FOUND", message: "symbol required" };
  // TF 매핑 (분봉 API: tic_scope는 분 단위 숫자 문자열)
  const tfRaw = String(tf || defaultExecTfFromEnv() || "15m").trim().toLowerCase();
  let ticScope = "60";
  if (/^\d+$/.test(tfRaw)) ticScope = tfRaw;
  else if (tfRaw.endsWith("m")) ticScope = tfRaw.replace("m", "");
  else if (tfRaw.endsWith("h")) {
    const hrs = Number(tfRaw.replace("h", ""));
    if (Number.isFinite(hrs) && hrs > 0) ticScope = String(hrs * 60);
  }
  const body = {
    stk_cd,
    tic_scope: ticScope,
    upd_stkpc_tp: "1",
  };
  const res = await kiwoomFetch("/api/dostk/chart", { method: "POST", apiId: api_id, body, auth: { appkey, secretkey } });
  if (!res.ok) return res;
  const arr = Array.isArray(res.data?.stk_min_pole_chart_qry)
    ? res.data.stk_min_pole_chart_qry
    : (Array.isArray(res.data?.output) ? res.data.output : []);
  const bars = arr.map((b) => {
    const ms = parseKstYmdHms(b?.cntr_tm || b?.t || b?.x || b?.timestamp);
    const close = toPrice(b?.cur_prc ?? b?.c);
    const open = toPrice(b?.open_pric ?? b?.o);
    const high = toPrice(b?.high_pric ?? b?.h);
    const low = toPrice(b?.low_pric ?? b?.l);
    const volume = toNumber(b?.trde_qty ?? b?.v);
    const closeTimeUtc = Number.isFinite(ms) ? new Date(ms).toISOString().replace(".000Z", "Z") : null;
    return {
      open,
      high,
      low,
      close,
      volume,
      closeTimeUtc,
      closeTimeUtcMs: ms,
      timestamp: ms,
      lastUpdatedMs: ms,
      t: closeTimeUtc,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      raw: b,
    };
  }).filter((b) => Number.isFinite(b.closeTimeUtcMs) && Number.isFinite(b.close));
  bars.sort((a, b) => a.closeTimeUtcMs - b.closeTimeUtcMs);
  const limited = Number.isFinite(Number(count)) ? bars.slice(-Number(count)) : bars;
  return { ok: true, bars: limited, raw: res.data };
}

module.exports = {
  getToken,
  placeOrder,
  cancelOrder,
  modifyOrder,
  fetchAccount,
  fetchBars,
};
