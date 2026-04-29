const { fetchBinanceFuturesCandlesInterval } = require("./binanceFutures");
const { defaultExecTfFromEnv, normalizeTf } = require("../utils/marketConfig");
const { BINANCE_ONLY_PROVIDER } = require("../utils/providerUtils");

function normalizeExchangeId() {
  return BINANCE_ONLY_PROVIDER;
}

// Map a normalized TF string ("15m", "60m", "240m", "4h", etc.) to the
// canonical Binance Futures klines interval string. Binance only accepts
// the discrete intervals listed at
//   https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-data
// — minute-bucket aliases like "60m"/"120m"/"240m" must be converted to
// their hour-bucket form ("1h"/"2h"/"4h") before the API call. Returning
// the input unchanged for already-canonical forms (e.g. "15m", "4h", "1d")
// keeps the function idempotent.
//
// 2026-04-29 P0-fix-A — production was emitting tf=240(m) for HTF
// refreshes which Binance rejected with code -1120 ("Invalid interval"),
// silently breaking the F2 server-native ENTRY signal generator's HTF
// bias classification for 24h+. The previous mapping only handled
// 60m → 1h. This rewrite covers the full minute→hour set so any future
// HTF bump (240m → 360m / 720m / 1440m) doesn't re-introduce the bug.
function tfToBinanceInterval(t) {
  // Already-canonical interval strings pass through unchanged.
  if (t === "1m" || t === "3m" || t === "5m" || t === "15m" || t === "30m") return t;
  if (t === "1h" || t === "2h" || t === "4h" || t === "6h" || t === "8h" || t === "12h") return t;
  if (t === "1d" || t === "3d" || t === "1w" || t === "1M") return t;
  // Minute-bucket aliases → hour bucket.
  if (t === "60m") return "1h";
  if (t === "120m") return "2h";
  if (t === "240m") return "4h";
  if (t === "360m") return "6h";
  if (t === "480m") return "8h";
  if (t === "720m") return "12h";
  if (t === "1440m") return "1d";
  // Fallthrough: return as-is. Binance will reject with -1120 if the
  // interval is unknown, which is the desired loud failure path
  // (better to fail fast than silently produce empty bars).
  return t;
}

async function fetchCandles(_exchange, market, tf = defaultExecTfFromEnv() || "15m", count = 2) {
  const t = normalizeTf(tf || defaultExecTfFromEnv() || "15m") || (defaultExecTfFromEnv() || "15m");
  const interval = tfToBinanceInterval(t);
  return fetchBinanceFuturesCandlesInterval(market, interval, count);
}

module.exports = {
  normalizeExchangeId,
  fetchCandles,
  tfToBinanceInterval,
};
