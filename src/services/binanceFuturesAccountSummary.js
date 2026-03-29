const { fetchBinanceFuturesAccount } = require("../exchanges/binanceFuturesPrivate");

const CACHE_TTL_MS = 30_000;
let cache = { ts: 0, data: null };

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function pickAsset(assets, symbol) {
  if (!Array.isArray(assets)) return null;
  const target = String(symbol || "").toUpperCase();
  return assets.find((a) => String(a.asset || "").toUpperCase() === target) || null;
}

async function buildBinanceFuturesAccountSummary({ apiKey, apiSecret }) {
  const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
  const assets = Array.isArray(account && account.assets) ? account.assets : [];
  const totalWallet = num(account && account.totalWalletBalance);
  const totalUnreal = num(account && account.totalUnrealizedProfit);
  const totalMargin = num(account && account.totalMarginBalance);
  const totalAvailable = num(account && account.totalAvailableBalance);

  let totalValue = totalMargin;
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    totalValue = totalWallet + totalUnreal;
  }

  let cashValue = totalAvailable;
  if (!Number.isFinite(cashValue) || cashValue <= 0) {
    const usdt = pickAsset(assets, "USDT");
    cashValue = num(usdt && (usdt.availableBalance ?? usdt.available_balance));
  }

  return {
    unit: "USDT",
    total_value: totalValue,
    cash_value: cashValue,
    holdings_n: assets.length,
    updated_at: new Date().toISOString(),
  };
}

async function getBinanceFuturesAccountSummary({ apiKey, apiSecret }) {
  if (!apiKey || !apiSecret) {
    throw new Error("BINANCEFUT_KEYS_MISSING");
  }
  const now = Date.now();
  if (cache.data && (now - cache.ts) <= CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  const summary = await buildBinanceFuturesAccountSummary({ apiKey, apiSecret });
  cache = { ts: now, data: summary };
  return summary;
}

module.exports = { getBinanceFuturesAccountSummary };
