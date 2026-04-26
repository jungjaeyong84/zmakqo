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

function normalizeActivePositions(positions) {
  return (Array.isArray(positions) ? positions : []).map((row) => {
    const symbol = String(row && row.symbol || "").trim().toUpperCase();
    const positionAmt = num(row && row.positionAmt);
    const qtyAbs = Math.abs(positionAmt);
    const markPrice = num(row && row.markPrice);
    const notionalRaw = Math.abs(num(row && (row.notional ?? row.positionInitialMargin)));
    const notionalQuote = notionalRaw > 0 ? notionalRaw : (qtyAbs > 0 && markPrice > 0 ? qtyAbs * markPrice : 0);
    return {
      symbol,
      side: positionAmt < 0 ? "SHORT" : "LONG",
      position_amt: positionAmt,
      qty_abs: qtyAbs,
      mark_price: markPrice,
      notional_quote: notionalQuote,
    };
  }).filter((row) => row.symbol && row.qty_abs > 0);
}

async function buildBinanceFuturesAccountSummary({ apiKey, apiSecret }) {
  const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
  const assets = Array.isArray(account && account.assets) ? account.assets : [];
  const positions = normalizeActivePositions(account && account.positions);
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
    active_position_n: positions.length,
    positions,
    updated_at: new Date().toISOString(),
  };
}

async function getBinanceFuturesAccountSummary({ apiKey, apiSecret, forceRefresh = false }) {
  if (!apiKey || !apiSecret) {
    throw new Error("BINANCEFUT_KEYS_MISSING");
  }
  const now = Date.now();
  if (forceRefresh !== true && cache.data && (now - cache.ts) <= CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  const summary = await buildBinanceFuturesAccountSummary({ apiKey, apiSecret });
  cache = { ts: now, data: summary };
  return summary;
}

module.exports = { getBinanceFuturesAccountSummary, __test: { normalizeActivePositions } };
