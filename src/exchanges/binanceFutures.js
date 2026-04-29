// src/exchanges/binanceFutures.js
// Binance USDT-M futures public candle API (no key needed)
const { shouldUseEgressProxy, callEgressProxy } = require("../utils/egressProxy");

function mapCandleRows(rows) {
  const nowMs = Date.now();
  const mapped = rows.map((c) => {
    const closeTimeMs = Number(c[6]);
    // Binance closeTime is end-inclusive (..:59.999). Normalize to bar close (next ms) to match TV time_close.
    const normalizedCloseMs = Number.isFinite(closeTimeMs) ? closeTimeMs + 1 : null;
    const closeTimeUtc = Number.isFinite(normalizedCloseMs) ? new Date(normalizedCloseMs).toISOString() : null;

    return {
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),

      rawCloseTimeMs: Number.isFinite(closeTimeMs) ? closeTimeMs : null,
      closeTimeUtc,
      closeTimeUtcMs: Number.isFinite(normalizedCloseMs) ? normalizedCloseMs : null,
      timestamp: Number.isFinite(normalizedCloseMs) ? normalizedCloseMs : null,
      lastUpdatedMs: Number.isFinite(normalizedCloseMs) ? normalizedCloseMs : null,

      t: closeTimeUtc,
      o: Number(c[1]),
      h: Number(c[2]),
      l: Number(c[3]),
      c: Number(c[4]),
      v: Number(c[5]) || 0,
      raw: c,
    };
  });

  const confirmed = mapped.filter((row) => {
    if (!Number.isFinite(row.rawCloseTimeMs)) return false;
    // Binance returns the in-progress candle with close time in the future.
    return row.rawCloseTimeMs <= nowMs;
  });

  confirmed.sort((a, b) => {
    const ams = Number(a.closeTimeUtcMs || 0);
    const bms = Number(b.closeTimeUtcMs || 0);
    return ams - bms;
  });

  return confirmed;
}

async function fetchBinanceFuturesCandlesInterval(symbol, interval, count = 2, opts = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("BINANCE_SYMBOL_REQUIRED");
  const intervalValue = String(interval || "").trim();
  if (!intervalValue) throw new Error("BINANCE_INTERVAL_REQUIRED");

  const useProxy = opts.useProxy !== false && shouldUseEgressProxy();
  if (useProxy) {
    const data = await callEgressProxy({
      provider: "binancefut",
      action: "fetchFuturesKlines",
      payload: { symbol: sym, interval: intervalValue, limit: count },
    });
    if (!Array.isArray(data)) return [];
    const first = data[0];
    const alreadyMapped = first && (first.closeTimeUtcMs || first.closeTimeUtc || first.t);
    return alreadyMapped ? data : mapCandleRows(data);
  }

  const baseUrl = String(process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com").trim() || "https://fapi.binance.com";
  const url =
    `${baseUrl}/fapi/v1/klines?symbol=` +
    encodeURIComponent(sym) +
    "&interval=" +
    encodeURIComponent(intervalValue) +
    "&limit=" +
    encodeURIComponent(String(count));

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BINANCEFUT_HTTP_${res.status}: ${text}`);
  }

  const data = await res.json();
  const rows = Array.isArray(data) ? data : [];
  return mapCandleRows(rows);
}

// 2026-04-30 P0-fix-E — public ticker price fetcher with egress proxy
// routing.
//
// Background: src/services/binanceTickExit.js' fetchBinanceFuturesPrices
// (called from the V2 Exit Worker tick loop) was using bare fetch() to
// fapi.binance.com. Cloud Run IPs are geo-blocked from Binance's public
// API, which is the entire reason the donbeolja-egress proxy service
// exists. The bare-fetch path fails with `TypeError: fetch failed`
// (undici level), surfaces as a tick-exit failure alert, and prevents
// the exit worker from reading the live tick prices it needs to evaluate
// SL/TP/TRAIL triggers.
//
// This helper mirrors the proven pattern from
// fetchBinanceFuturesCandlesInterval (above): try the egress proxy when
// shouldUseEgressProxy() is true; fall through to direct fetch otherwise
// (test/dev environments). The action name "fetchFuturesPrices" is
// added to the egress proxy route's handler table in
// src/routes/egress.proxy.routes.js as part of the same fix.
//
// Returns an array of `{symbol, price}` objects (Binance's native
// /fapi/v1/ticker/price?symbols=[...] response shape). Caller is
// responsible for keying it into a map.
async function fetchBinanceFuturesPrices(symbols, opts = {}) {
  const list = Array.isArray(symbols)
    ? symbols.map((s) => String(s || "").toUpperCase().trim()).filter(Boolean)
    : [];
  if (!list.length) return [];

  const useProxy = opts.useProxy !== false && shouldUseEgressProxy();
  if (useProxy) {
    try {
      const data = await callEgressProxy({
        provider: "binancefut",
        action: "fetchFuturesPrices",
        payload: { symbols: list },
      });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      // Older egress deploys may not know this action yet — fall
      // through to direct fetch only when the action is genuinely
      // unsupported. Any other error (network, auth, etc.) bubbles
      // up so the caller's failure-alert path can surface it.
      const msg = String(e && e.message ? e.message : "").toLowerCase();
      if (!msg.includes("action_not_supported") && !msg.includes("unknown action")) throw e;
    }
  }

  const baseUrl = String(process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com").trim() || "https://fapi.binance.com";
  const url = `${baseUrl}/fapi/v1/ticker/price?symbols=` + encodeURIComponent(JSON.stringify(list));
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`BINANCEFUT_HTTP_${res.status}: ${text}`);
  const rows = JSON.parse(text);
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  fetchBinanceFuturesCandlesInterval,
  fetchBinanceFuturesPrices,
};
