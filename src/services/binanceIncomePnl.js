const { fetchFuturesIncomeHistory } = require("../exchanges/binanceFuturesPrivate");

const DEFAULT_TYPES = ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeIncomeTypeSet(rawList) {
  const src = Array.isArray(rawList) && rawList.length
    ? rawList
    : String(process.env.BINANCE_PNL_INCOME_TYPES || "")
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  const base = src.length ? src : DEFAULT_TYPES;
  const out = new Set();
  for (const x of base) {
    const t = String(x || "").trim().toUpperCase();
    if (!t) continue;
    out.add(t);
  }
  return out;
}

async function loadBinanceIncomePnlRows({
  apiKey,
  apiSecret,
  fromMs,
  toMs,
  symbol = null,
  incomeTypes = null,
  pageLimit = 1000,
  maxPages = null,
} = {}) {
  const from = Number(fromMs);
  const to = Number(toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return { rows: [], byType: {}, markets: [] };
  }

  const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(pageLimit) || 1000)));
  const envMaxPages = Math.max(1, Math.floor(Number(process.env.BINANCE_PNL_MAX_PAGES || 0) || 0));
  const pages = Math.max(1, Math.floor(Number(maxPages) || 0) || envMaxPages || 40);
  const includeTypes = normalizeIncomeTypeSet(incomeTypes);
  const endInclusive = to - 1;

  let cursor = from;
  const dedup = new Map();

  for (let i = 0; i < pages; i += 1) {
    if (cursor > endInclusive) break;
    const list = await fetchFuturesIncomeHistory({
      apiKey,
      apiSecret,
      symbol: symbol || undefined,
      startTime: cursor,
      endTime: endInclusive,
      limit: pageSize,
    });
    if (!Array.isArray(list) || list.length === 0) break;

    let maxTime = cursor;
    for (const row of list) {
      const ms = Number(row && row.time);
      if (!Number.isFinite(ms)) continue;
      if (ms < from || ms > endInclusive) continue;
      if (ms > maxTime) maxTime = ms;

      const incomeType = String(row && row.incomeType || "").toUpperCase();
      if (!incomeType || !includeTypes.has(incomeType)) continue;

      const pnl = toNum(row && row.income);
      if (pnl == null) continue;
      const market = String(row && row.symbol || symbol || "").toUpperCase();
      const key = [
        row && row.tranId != null ? String(row.tranId) : "",
        incomeType,
        market,
        String(ms),
        String(pnl),
      ].join("|");

      dedup.set(key, {
        close_ms: ms,
        pnl_krw: pnl,
        notional_krw: null,
        market: market || null,
        source: "BINANCE_INCOME",
        income_type: incomeType,
      });
    }

    if (list.length < pageSize) break;
    if (maxTime < cursor) break;
    cursor = maxTime + 1;
  }

  const rows = Array.from(dedup.values()).sort((a, b) => Number(a.close_ms || 0) - Number(b.close_ms || 0));
  const byType = {};
  const marketSet = new Set();
  for (const row of rows) {
    const t = String(row.income_type || "");
    byType[t] = (byType[t] || 0) + Number(row.pnl_krw || 0);
    const mk = String(row.market || "").toUpperCase();
    if (mk) marketSet.add(mk);
  }

  return {
    rows,
    byType,
    markets: Array.from(marketSet),
  };
}

module.exports = {
  loadBinanceIncomePnlRows,
};

