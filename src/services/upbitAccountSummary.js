const { fetchAccounts } = require("../exchanges/upbitPrivate");

const CACHE_TTL_MS = 30_000;
let cache = { ts: 0, data: null };

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

async function fetchUpbitTickers(markets) {
  const uniq = Array.from(new Set((markets || []).filter(Boolean)));
  const out = {};
  const chunkSize = 80;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const url = "https://api.upbit.com/v1/ticker?markets=" + encodeURIComponent(chunk.join(","));
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`UPBIT_TICKER_${res.status}: ${text.slice(0, 200)}`);
    }
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) continue;
    rows.forEach((r) => {
      const mk = String(r.market || "");
      const price = Number(r.trade_price);
      if (mk && Number.isFinite(price)) out[mk] = price;
    });
  }
  return out;
}

async function fetchUpbitMarketList() {
  const url = "https://api.upbit.com/v1/market/all?isDetails=false";
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`UPBIT_MARKET_${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = JSON.parse(text);
  const set = new Set();
  if (Array.isArray(rows)) {
    rows.forEach((r) => {
      const mk = String(r.market || "");
      if (mk.startsWith("KRW-")) set.add(mk);
    });
  }
  return set;
}

async function buildUpbitAccountSummary({ accessKey, secretKey }) {
  const accounts = await fetchAccounts({ accessKey, secretKey });
  const list = Array.isArray(accounts) ? accounts : [];
  let cashKrw = 0;
  const holdings = [];

  for (const a of list) {
    const currency = String(a.currency || "").toUpperCase();
    const unit = String(a.unit_currency || "").toUpperCase();
    const balance = num(a.balance);
    const locked = num(a.locked);
    const total = balance + locked;
    if (!currency || total <= 0) continue;
    if (currency === "KRW") {
      cashKrw += total;
      continue;
    }
    if (unit !== "KRW") continue;
    holdings.push({ currency, balance, locked, total, market: `KRW-${currency}` });
  }

  let validMarkets = null;
  try {
    validMarkets = await fetchUpbitMarketList();
  } catch (_) {
    validMarkets = null;
  }

  const validHoldings = validMarkets
    ? holdings.filter((h) => validMarkets.has(h.market))
    : holdings;
  const invalidHoldings = validMarkets
    ? holdings.filter((h) => !validMarkets.has(h.market))
    : [];

  const markets = validHoldings.map((h) => h.market);
  const priceMap = await fetchUpbitTickers(markets);
  let holdingsValue = 0;
  const missing = invalidHoldings.map((h) => h.market);

  validHoldings.forEach((h) => {
    const price = priceMap[h.market];
    if (!Number.isFinite(price)) {
      missing.push(h.market);
      return;
    }
    holdingsValue += h.total * price;
  });

  const totalKrw = cashKrw + holdingsValue;

  return {
    total_krw: totalKrw,
    cash_krw: cashKrw,
    holdings_n: holdings.length,
    missing_markets: missing,
    updated_at: new Date().toISOString(),
  };
}

async function getUpbitAccountSummary({ accessKey, secretKey }) {
  if (!accessKey || !secretKey) {
    throw new Error("UPBIT_KEYS_MISSING");
  }
  const now = Date.now();
  if (cache.data && (now - cache.ts) <= CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  const summary = await buildUpbitAccountSummary({ accessKey, secretKey });
  cache = { ts: now, data: summary };
  return summary;
}

module.exports = { getUpbitAccountSummary };
