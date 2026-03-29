// src/exchanges/upbit.js
// Upbit public candle API (no key needed)
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

const TF_MAP = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "60m": "60",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

async function fetchUpbitCandles(market, tf = defaultExecTfFromEnv() || "15m", count = 2) {
  const interval = TF_MAP[String(tf || defaultExecTfFromEnv() || "15m")] || null;
  if (!interval) {
    throw new Error(`UNSUPPORTED_TF: ${tf}`);
  }

  const isMinute = /^\d+$/.test(interval);
  const endpoint = isMinute ? `minutes/${interval}` : String(interval).toLowerCase();
  const url =
    "https://api.upbit.com/v1/candles/" +
    endpoint +
    "?market=" +
    encodeURIComponent(market) +
    "&count=" +
    encodeURIComponent(String(count));

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPBIT_HTTP_${res.status}: ${text}`);
  }

  const data = await res.json();
  const asc = Array.isArray(data) ? data.slice().reverse() : [];

  return asc.map((c) => {
    const closeTimeUtc = c.candle_date_time_utc ? `${c.candle_date_time_utc}Z` : null;
    const closeTimeUtcMs = closeTimeUtc ? Date.parse(closeTimeUtc) : null;
    const lastUpdatedMs = c.timestamp || null;

    return {
      open: c.opening_price,
      high: c.high_price,
      low: c.low_price,
      close: c.trade_price,
      volume: c.candle_acc_trade_volume,

      closeTimeUtc,
      closeTimeUtcMs,
      timestamp: lastUpdatedMs,
      lastUpdatedMs,

      t: closeTimeUtc,
      o: c.opening_price,
      h: c.high_price,
      l: c.low_price,
      c: c.trade_price,
      v: c.candle_acc_trade_volume || 0,

      raw: c,
    };
  });
}

module.exports = { fetchUpbitCandles };
