const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { loadBinanceIncomePnlRows } = require("./binanceIncomePnl");
const { getPnlSourcePolicy, isBinanceFutExchange, loadRealizedRowsForMarket } = require("./pnlPolicy");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeMarket(raw) {
  return String(raw || "").trim().toUpperCase();
}

function uniqMarkets(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const mk = normalizeMarket(raw);
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    out.push(mk);
  }
  return out;
}

function sourceModeFromBreakdown(externalMarkets, fallbackMarkets) {
  if (externalMarkets > 0 && fallbackMarkets > 0) return "MIXED";
  if (externalMarkets > 0) return "EXTERNAL";
  if (fallbackMarkets > 0) return "FALLBACK";
  return "NONE";
}

function appendRow(map, market, row) {
  if (!map.has(market)) map.set(market, []);
  map.get(market).push(row);
}

function summarizeByMarketRows(byMarketRows, targetMarkets) {
  const byMarket = {};
  let total = 0;
  let hasTotal = false;
  let tradesN = 0;
  let externalMarkets = 0;
  let noneMarkets = 0;

  for (const mk of targetMarkets) {
    const rows = (byMarketRows.get(mk) || []).slice();
    rows.sort((a, b) => Number(a.close_ms || 0) - Number(b.close_ms || 0));
    byMarket[mk] = { rows, source_mode: rows.length > 0 ? "EXTERNAL" : "NONE", fills_n: rows.length };
    if (rows.length > 0) externalMarkets += 1;
    else noneMarkets += 1;
    for (const row of rows) {
      const pnl = toNum(row && row.pnl_krw);
      if (pnl == null) continue;
      total += pnl;
      hasTotal = true;
      tradesN += 1;
    }
  }

  return {
    byMarket,
    totalPnlKrw: hasTotal ? total : null,
    tradesN,
    sourceMode: sourceModeFromBreakdown(externalMarkets, 0),
    sourceBreakdown: {
      external_markets: externalMarkets,
      fallback_markets: 0,
      none_markets: noneMarkets,
    },
  };
}

async function loadBinanceIncomeRowsIfEnabled(exchange, fromMs, toMs) {
  if (!isBinanceFutExchange(exchange)) return { used: false, rows: null };
  if (String(process.env.BINANCE_PNL_INCOME_API_DISABLED || "0") === "1") return { used: false, rows: null };
  try {
    const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
    const apiKey = String((exCfg && exCfg.api_key) || process.env.BINANCEFUT_API_KEY || "").trim();
    const apiSecret = String((exCfg && exCfg.api_secret) || process.env.BINANCEFUT_API_SECRET || "").trim();
    if (!apiKey || !apiSecret) return { used: false, rows: null };
    const income = await loadBinanceIncomePnlRows({
      apiKey,
      apiSecret,
      fromMs,
      toMs,
      maxPages: Number(process.env.BINANCE_PNL_MAX_PAGES || 0) || 60,
    });
    return { used: true, rows: Array.isArray(income && income.rows) ? income.rows : [] };
  } catch (_) {
    return { used: false, rows: null };
  }
}

async function resolveRealizedRowsByMarket({
  exchange,
  markets = [],
  tf = defaultExecTfFromEnv() || "15m",
  fallbackTf = defaultExecTfFromEnv() || "15m",
  mode = "EACH_SELL",
  limitN = 2000,
  fromMs = null,
  toMs = null,
  includeFunding = false,
  includeAllIncomeMarkets = false,
} = {}) {
  const from = toNum(fromMs);
  const to = toNum(toMs);
  const configuredMarkets = uniqMarkets(markets);

  const incomeLoad = await loadBinanceIncomeRowsIfEnabled(exchange, from, to);
  if (incomeLoad.used) {
    const byMarketRows = new Map();
    for (const row of incomeLoad.rows || []) {
      const ms = toNum(row && row.close_ms);
      if (ms == null) continue;
      if (from != null && ms < from) continue;
      if (to != null && ms >= to) continue;
      const pnl = toNum(row && row.pnl_krw);
      if (pnl == null) continue;
      const mk = normalizeMarket(row && row.market);
      if (!mk) continue;
      appendRow(byMarketRows, mk, {
        close_ms: ms,
        pnl_krw: pnl,
        notional_krw: toNum(row && row.notional_krw),
        source: "EXTERNAL",
        market: mk,
        income_type: row && row.income_type ? String(row.income_type).toUpperCase() : null,
      });
    }

    const targetSet = new Set(configuredMarkets);
    if (includeAllIncomeMarkets) {
      for (const mk of byMarketRows.keys()) targetSet.add(mk);
    }
    const targetMarkets = Array.from(targetSet);
    const summary = summarizeByMarketRows(byMarketRows, targetMarkets);
    return {
      by_market: summary.byMarket,
      markets: targetMarkets,
      configured_markets: configuredMarkets,
      observed_markets: Array.from(byMarketRows.keys()),
      total_pnl_krw: summary.totalPnlKrw,
      trades_n: summary.tradesN,
      source_policy: "BINANCE_INCOME_API_FIRST_FALLBACK",
      source_mode: summary.sourceMode,
      source_breakdown: summary.sourceBreakdown,
      used_income_api: true,
    };
  }

  const byMarket = {};
  let total = 0;
  let hasTotal = false;
  let tradesN = 0;
  let externalMarkets = 0;
  let fallbackMarkets = 0;
  let noneMarkets = 0;

  for (const mk of configuredMarkets) {
    try {
      const realized = await loadRealizedRowsForMarket({
        exchange,
        symbol: mk,
        tf: tf || fallbackTf || defaultExecTfFromEnv() || "15m",
        fallbackTf: fallbackTf || defaultExecTfFromEnv() || "15m",
        mode,
        limitN,
        fromMs: from,
        toMs: to,
        includeFunding,
      });
      const rows = (realized.rows || []).map((row) => ({
        close_ms: row.close_ms,
        pnl_krw: row.pnl_krw,
        notional_krw: row.notional_krw,
        source: row.source || realized.source_mode || "FALLBACK",
        market: mk,
      }));
      byMarket[mk] = {
        rows,
        source_mode: realized.source_mode || "NONE",
        fills_n: Number(realized.fills_n || 0),
      };
      if (realized.source_mode === "EXTERNAL") externalMarkets += 1;
      else if (realized.source_mode === "NONE") noneMarkets += 1;
      else fallbackMarkets += 1;
      for (const row of rows) {
        const pnl = toNum(row && row.pnl_krw);
        if (pnl == null) continue;
        total += pnl;
        hasTotal = true;
        tradesN += 1;
      }
    } catch (_) {
      byMarket[mk] = { rows: [], source_mode: "NONE", fills_n: 0 };
      noneMarkets += 1;
    }
  }

  return {
    by_market: byMarket,
    markets: configuredMarkets,
    configured_markets: configuredMarkets,
    observed_markets: configuredMarkets.filter((mk) => (byMarket[mk] && (byMarket[mk].rows || []).length > 0)),
    total_pnl_krw: hasTotal ? total : null,
    trades_n: tradesN,
    source_policy: getPnlSourcePolicy(),
    source_mode: sourceModeFromBreakdown(externalMarkets, fallbackMarkets),
    source_breakdown: {
      external_markets: externalMarkets,
      fallback_markets: fallbackMarkets,
      none_markets: noneMarkets,
    },
    used_income_api: false,
  };
}

module.exports = {
  resolveRealizedRowsByMarket,
};
