const { fetchBinanceFuturesCandlesInterval } = require("./binanceFutures");
const { defaultExecTfFromEnv, normalizeTf } = require("../utils/marketConfig");
const { BINANCE_ONLY_PROVIDER } = require("../utils/providerUtils");

function normalizeExchangeId() {
  return BINANCE_ONLY_PROVIDER;
}

async function fetchCandles(_exchange, market, tf = defaultExecTfFromEnv() || "15m", count = 2) {
  const t = normalizeTf(tf || defaultExecTfFromEnv() || "15m") || (defaultExecTfFromEnv() || "15m");
  const interval = t === "60m" ? "1h" : t;
  return fetchBinanceFuturesCandlesInterval(market, interval, count);
}

module.exports = {
  normalizeExchangeId,
  fetchCandles,
};
