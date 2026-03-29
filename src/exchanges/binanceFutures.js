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

module.exports = {
  fetchBinanceFuturesCandlesInterval,
};
