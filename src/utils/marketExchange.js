const { BINANCE_ONLY_PROVIDER } = require("./providerUtils");

function inferExchangeFromMarket(market) {
  const mk = String(market || "").trim().toUpperCase();
  if (!mk) return "";
  if (mk.endsWith("USDT") || mk.includes("USDT")) return BINANCE_ONLY_PROVIDER;
  return BINANCE_ONLY_PROVIDER;
}

module.exports = { inferExchangeFromMarket };
