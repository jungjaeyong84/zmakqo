const express = require("express");
const router = express.Router();

const { getFirestore } = require("../storage/firestore");
const { resolveExchangeFromReq, resolveRuntimeMarketsForExchange, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { getRiskBudgetForProvider, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { getPnlScopeDays, getPnlSourcePolicy, loadRealizedRowsForMarket } = require("../services/pnlPolicy");
const { loadBinanceIncomePnlRows } = require("../services/binanceIncomePnl");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { toKstString, kstStartOfDay, kstDateKey } = require("../utils/timeKst");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const {
  resolvePositionLeverage,
  resolveLeverageTier,
  resolvePositionLeverageReason,
  buildLeverageSummary,
} = require("../utils/leverageView");

const PROFIT_CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS || 60000);
const profitCache = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 730;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function shiftKstMonthsClamped(dayStartMs, deltaMonths) {
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(deltaMonths)) return dayStartMs;
  const kstDate = new Date(dayStartMs + 9 * 60 * 60 * 1000);
  const srcYear = kstDate.getUTCFullYear();
  const srcMonth = kstDate.getUTCMonth();
  const srcDay = kstDate.getUTCDate();

  const monthIndex = srcMonth + Math.trunc(deltaMonths);
  const targetYear = srcYear + Math.floor(monthIndex / 12);
  let targetMonth = monthIndex % 12;
  if (targetMonth < 0) targetMonth += 12;

  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(srcDay, lastDay);
  const iso = `${targetYear}-${pad2(targetMonth + 1)}-${pad2(targetDay)}T00:00:00+09:00`;
  const out = Date.parse(iso);
  return Number.isFinite(out) ? out : dayStartMs;
}

function parseKstDateToMs(raw, endOfDay = false) {
  const v = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const base = Date.parse(`${v}T00:00:00+09:00`);
  if (!Number.isFinite(base)) return null;
  return endOfDay ? (base + DAY_MS - 1) : base;
}

function getCache(key) {
  const hit = profitCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PROFIT_CACHE_MS) {
    profitCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data) {
  profitCache.set(key, { at: Date.now(), data });
}

function dayKeyFromMs(ms) {
  if (!Number.isFinite(ms)) return null;
  return kstDateKey(new Date(ms).toISOString());
}

function buildRangeAgg(trades, fromMs, toMs) {
  let total = 0;
  let has = false;
  let tradesN = 0;
  let winN = 0;
  let lossN = 0;
  let profitSum = 0;
  let lossSum = 0;
  let notionalSum = 0;

  for (const t of trades) {
    const ms = Number(t.close_ms);
    if (Number.isFinite(fromMs) && ms < fromMs) continue;
    if (Number.isFinite(toMs) && ms >= toMs) continue;
    tradesN += 1;
    const v = Number(t.pnl_krw);
    if (Number.isFinite(v)) {
      total += v;
      has = true;
      if (v > 0) {
        winN += 1;
        profitSum += v;
      } else if (v < 0) {
        lossN += 1;
        lossSum += Math.abs(v);
      }
    }
    const notional = Number(t.notional_krw);
    if (Number.isFinite(notional)) notionalSum += notional;
  }

  const avgProfit = winN > 0 ? (profitSum / winN) : null;
  const avgLoss = lossN > 0 ? (lossSum / lossN) : null;
  const winRate = tradesN > 0 ? (winN / tradesN) : null;
  const plRatio = (avgLoss != null && avgLoss > 0 && avgProfit != null) ? (avgProfit / avgLoss) : null;

  return {
    total: has ? total : null,
    trades_n: tradesN,
    win_rate: winRate,
    win_n: winN,
    loss_n: lossN,
    total_profit: profitSum || 0,
    total_loss: lossSum || 0,
    avg_profit: avgProfit,
    avg_loss: avgLoss,
    pl_ratio: plRatio,
    notional: notionalSum || 0,
    has_total: has,
  };
}

function buildDailySeries(trades, fromMs, toMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  const startRaw = Number.isFinite(fromMs) ? fromMs : null;
  const endRaw = Number.isFinite(toMs) ? toMs : null;
  if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw) || endRaw <= startRaw) return [];

  const start = kstStartOfDay(new Date(startRaw)).getTime();
  const end = kstStartOfDay(new Date(endRaw - 1)).getTime() + dayMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const days = Math.max(1, Math.ceil((end - start) / dayMs));
  const buckets = new Map();

  for (let i = 0; i < days; i += 1) {
    const dayStart = start + i * dayMs;
    const key = dayKeyFromMs(dayStart);
    if (key) buckets.set(key, 0);
  }

  for (const t of trades) {
    const ms = Number(t.close_ms);
    if (!Number.isFinite(ms) || ms < start || ms >= end) continue;
    const key = dayKeyFromMs(ms);
    if (!key || !buckets.has(key)) continue;
    const v = Number(t.pnl_krw);
    if (!Number.isFinite(v)) continue;
    buckets.set(key, buckets.get(key) + v);
  }

  const series = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, pnl]) => ({ day, pnl }));

  const maxAbs = series.reduce((acc, d) => Math.max(acc, Math.abs(Number(d.pnl) || 0)), 0);
  return series.map((d) => {
    const abs = Math.abs(Number(d.pnl) || 0);
    const heightPct = maxAbs > 0 ? Math.round((abs / maxAbs) * 100) : 0;
    const dir = d.pnl > 0 ? "up" : (d.pnl < 0 ? "down" : "flat");
    return { ...d, height_pct: heightPct, dir };
  });
}

function buildCumulativeSeries(series) {
  const out = [];
  for (const d of series) {
    const prev = out.length ? out[out.length - 1].value : 0;
    out.push({ day: d.day, value: prev + Number(d.pnl || 0) });
  }
  return out;
}

function buildDayStats(series) {
  return series.reduce((acc, d) => {
    if (d.pnl > 0) acc.win += 1;
    else if (d.pnl < 0) acc.loss += 1;
    else acc.flat += 1;
    return acc;
  }, { win: 0, loss: 0, flat: 0 });
}

function buildActiveDaySummary(trades, fromMs, toMs) {
  const byDay = new Map();
  for (const t of trades || []) {
    const ms = Number(t && t.close_ms);
    if (!Number.isFinite(ms)) continue;
    if (Number.isFinite(fromMs) && ms < fromMs) continue;
    if (Number.isFinite(toMs) && ms >= toMs) continue;
    const pnl = Number(t && t.pnl_krw);
    if (!Number.isFinite(pnl)) continue;
    const key = dayKeyFromMs(ms);
    if (!key) continue;
    byDay.set(key, (byDay.get(key) || 0) + pnl);
  }

  let win = 0;
  let loss = 0;
  let flat = 0;
  let totalProfit = 0;
  let totalLoss = 0;
  let total = 0;
  for (const dayPnl of byDay.values()) {
    total += dayPnl;
    if (dayPnl > 0) {
      win += 1;
      totalProfit += dayPnl;
    } else if (dayPnl < 0) {
      loss += 1;
      totalLoss += Math.abs(dayPnl);
    } else {
      flat += 1;
    }
  }

  return { win, loss, flat, total, totalProfit, totalLoss, days: win + loss + flat };
}

function buildBinanceCompatAgg(baseAgg, daySummary) {
  const agg = { ...(baseAgg || {}) };
  const summary = daySummary || { win: 0, loss: 0, flat: 0, totalProfit: 0, totalLoss: 0, days: 0 };

  const avgProfit = summary.win > 0 ? (summary.totalProfit / summary.win) : null;
  const avgLoss = summary.loss > 0 ? (summary.totalLoss / summary.loss) : null;
  const winRateDenom = summary.win + summary.loss;
  const winRate = winRateDenom > 0 ? (summary.win / winRateDenom) : null;
  const plRatio = (avgProfit != null && avgLoss != null && avgLoss > 0) ? (avgProfit / avgLoss) : null;

  agg.trades_n = summary.days;
  agg.win_n = summary.win;
  agg.loss_n = summary.loss;
  agg.flat_n = summary.flat;
  agg.total_profit = summary.totalProfit;
  agg.total_loss = summary.totalLoss;
  agg.win_rate = winRate;
  agg.avg_profit = avgProfit;
  agg.avg_loss = avgLoss;
  agg.pl_ratio = plRatio;
  return agg;
}

async function loadPositionsByMarket(db, exchange) {
  const snap = await db.collection("positions_paper").get();
  const posByMarket = {};
  snap.forEach((d) => {
    const x = d.data() || {};
    const posId = String(x.pos_id || d.id || "");
    if (!posId.startsWith("POS__")) return;
    const mk = x.symbol_or_pair_id || x.symbol;
    if (!mk) return;
    const ex = String(x.exchange || "").toUpperCase();
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (!exResolved || exResolved !== exchange) return;
    if (!isLiveDocForExchange(exchange, x)) return;
    posByMarket[String(mk)] = x;
  });
  return posByMarket;
}

router.get("/dashboard/profit", async (req, res) => {
  const debug = {
    route: "dashboard/profit",
    query: {
      start: String(req.query && req.query.start || "").trim(),
      end: String(req.query && req.query.end || "").trim(),
      exchange: String(req.query && req.query.exchange || "").trim(),
    },
  };
  try {
    const startRaw = debug.query.start;
    const endRaw = debug.query.end;
    const basisRaw = String(req.query && req.query.basis || "").trim().toLowerCase();
    const startMsRaw = parseKstDateToMs(startRaw, false);
    const endMsRaw = parseKstDateToMs(endRaw, false);
    const hasCustom = Number.isFinite(startMsRaw) && Number.isFinite(endMsRaw) && endMsRaw >= startMsRaw;
    let customStartMs = hasCustom ? startMsRaw : null;
    let customEndMs = hasCustom ? (endMsRaw + DAY_MS) : null;
    let rangeWarning = null;
    debug.has_custom = hasCustom;

    if (hasCustom) {
      const maxMs = customStartMs + MAX_CUSTOM_DAYS * DAY_MS;
      if (customEndMs > maxMs) {
        customEndMs = maxMs;
        rangeWarning = `기간이 너무 길어서 ${MAX_CUSTOM_DAYS}일로 자동 제한했습니다.`;
      }
    }

    const { exchange } = await resolveExchangeFromReq(req, 2000);
    const isBinanceExchange = String(exchange || "").toUpperCase().includes("BINANCE");
    const pnlBasis = (basisRaw === "trade" || basisRaw === "binance")
      ? basisRaw
      : (isBinanceExchange ? "binance" : "trade");
    const includeFunding = isBinanceExchange && pnlBasis === "binance";
    debug.exchange = exchange;
    debug.pnl_basis = pnlBasis;
    const marketsConfigured = await resolveRuntimeMarketsForExchange(exchange, 2000);
    let markets_expected = Array.isArray(marketsConfigured) ? marketsConfigured.slice() : [];
    const { signalTf, execTf } = await resolveRuntimeTfContext(req, exchange, { fallback: defaultExecTfFromEnv() || "15m", ttlMs: 2000 });
    const fallbackTf = signalTf || execTf;
    const cacheKey = hasCustom
      ? `${String(exchange || "") || "BINANCEFUT"}:${execTf}:${fallbackTf}:${pnlBasis}:custom:${customStartMs}:${customEndMs}`
      : `${String(exchange || "") || "BINANCEFUT"}:${execTf}:${fallbackTf}:${pnlBasis}`;
    const cached = getCache(cacheKey);
    if (cached) return res.render(String(req.query.legacy || "").trim() === "1" ? "profit.legacy.ejs" : "profit", cached);
    const exchangeSettings = await getExchangeSettingsForProvider(exchange, 2000);
    const defaultFuturesLeverage = (() => {
      const lev = Number(exchangeSettings && exchangeSettings.futures_leverage);
      if (Number.isFinite(lev) && lev > 0) return lev;
      return isBinanceExchange ? 2 : 1;
    })();
    const now = new Date();
    const todayStart = kstStartOfDay(now).getTime();
    const todayEnd = todayStart + DAY_MS;
    const m6From = shiftKstMonthsClamped(todayStart, -6);
    const fetchFromMs = hasCustom ? customStartMs : m6From;
    debug.markets_configured_n = Array.isArray(marketsConfigured) ? marketsConfigured.length : 0;
    debug.exec_tf = execTf;

    let riskBudget = null;
    try {
      const rb = await getRiskBudgetForProvider(exchange, 0);
      riskBudget = rb && rb.data ? rb.data : null;
    } catch (_) {
      riskBudget = null;
    }

    const budgetEnabled = !!(riskBudget && riskBudget.enabled === true);
    const budgetUnit = String((riskBudget && riskBudget.unit) || (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW")).toUpperCase();
    const totalMaxRaw = budgetEnabled ? Number(riskBudget.total_max_krw || 0) : 0;
    const budgetDefault = budgetEnabled ? Number(riskBudget.default_max_krw || 0) : 0;
    const budgetByMarket = (budgetEnabled && typeof riskBudget.by_market === "object") ? riskBudget.by_market : {};

    const db = getFirestore();
    const posByMarket = await loadPositionsByMarket(db, exchange);

    const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
    const fillsLimit = Number(process.env.DASHBOARD_FILLS_LIMIT || 2000);
    debug.fills_limit = fillsLimit;
    const tradesAll = [];
    const tradeByMarket = new Map();
    const pnlMarketSet = new Set(markets_expected);
    let usedBinanceIncomeApi = false;
    const useIncomeApi = isBinanceExchange && pnlBasis === "binance" && String(process.env.BINANCE_PNL_INCOME_API_DISABLED || "0") !== "1";
    if (useIncomeApi) {
      try {
        const apiKey = String((exchangeSettings && exchangeSettings.api_key) || process.env.BINANCEFUT_API_KEY || "").trim();
        const apiSecret = String((exchangeSettings && exchangeSettings.api_secret) || process.env.BINANCEFUT_API_SECRET || "").trim();
        if (apiKey && apiSecret) {
          const income = await loadBinanceIncomePnlRows({
            apiKey,
            apiSecret,
            fromMs: fetchFromMs,
            toMs: Date.now() + 1,
            maxPages: Number(process.env.BINANCE_PNL_MAX_PAGES || 0) || 60,
          });
          for (const row of (income.rows || [])) {
            const mk = String(row.market || "").toUpperCase();
            const rowOut = { ...row, market: mk || row.market || null };
            tradesAll.push(rowOut);
            if (mk) {
              pnlMarketSet.add(mk);
              if (!tradeByMarket.has(mk)) tradeByMarket.set(mk, []);
              tradeByMarket.get(mk).push(rowOut);
            }
          }
          usedBinanceIncomeApi = (income.rows || []).length > 0;
          debug.binance_income_api = {
            rows_n: Array.isArray(income.rows) ? income.rows.length : 0,
            markets_n: Array.isArray(income.markets) ? income.markets.length : 0,
            by_type: income.byType || {},
            used: usedBinanceIncomeApi,
          };
        } else {
          debug.binance_income_api = { used: false, reason: "BINANCEFUT_KEYS_MISSING" };
        }
      } catch (err) {
        debug.binance_income_api = {
          used: false,
          reason: err && err.message ? err.message : String(err),
        };
      }
    }

    if (!usedBinanceIncomeApi) {
      for (const mk of markets_expected) {
        try {
          const realized = await loadRealizedRowsForMarket({
            exchange,
            symbol: mk,
            tf: execTf || fallbackTf,
            limitN: fillsLimit,
            fromMs: fetchFromMs,
            toMs: Date.now() + 1,
            mode: pnlMode,
            fallbackTf,
            includeFunding,
          });
          const rows = (realized.rows || []).map((x) => ({ market: mk, ...x }));
          for (const row of rows) {
            tradesAll.push(row);
            if (!tradeByMarket.has(mk)) tradeByMarket.set(mk, []);
            tradeByMarket.get(mk).push(row);
          }
        } catch (err) {
          console.error("[PROFIT_ROUTE_MARKET_ERROR]", {
            exchange,
            market: mk,
            exec_tf: execTf,
            fallback_tf: fallbackTf,
            fills_limit: fillsLimit,
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          });
        }
      }
    }

    if (pnlMarketSet.size > 0) {
      markets_expected = Array.from(pnlMarketSet);
    }
    debug.markets_pnl_n = Array.isArray(markets_expected) ? markets_expected.length : 0;

    const ranges = {
      today: { from: todayStart, to: todayEnd, label: "오늘" },
      d7: { from: todayStart - 6 * DAY_MS, to: todayEnd, label: "7D" },
      d30: { from: todayStart - 29 * DAY_MS, to: todayEnd, label: "1M" },
      d90: { from: todayStart - 89 * DAY_MS, to: todayEnd, label: "3M" },
      m6: { from: m6From, to: todayEnd, label: "6M" },
    };
    if (hasCustom) {
      ranges.custom = {
        from: customStartMs,
        to: customEndMs,
        label: `${startRaw} ~ ${endRaw}`,
      };
    }

    const rangeAggBase = {
      today: buildRangeAgg(tradesAll, ranges.today.from, ranges.today.to),
      d7: buildRangeAgg(tradesAll, ranges.d7.from, ranges.d7.to),
      d30: buildRangeAgg(tradesAll, ranges.d30.from, ranges.d30.to),
      d90: buildRangeAgg(tradesAll, ranges.d90.from, ranges.d90.to),
      m6: buildRangeAgg(tradesAll, ranges.m6.from, ranges.m6.to),
    };
    if (hasCustom) {
      rangeAggBase.custom = buildRangeAgg(tradesAll, ranges.custom.from, ranges.custom.to);
    }

    const rangeKeys = ["d7", "d30", "d90", "m6"];
    if (hasCustom) rangeKeys.push("custom");
    const dailySeriesByRange = {};
    const cumulativeSeriesByRange = {};
    const dayStatsByRange = {};
    const rangeAgg = {};
    for (const key of rangeKeys) {
      const r = ranges[key];
      const series = buildDailySeries(tradesAll, r.from, r.to);
      dailySeriesByRange[key] = series;
      cumulativeSeriesByRange[key] = buildCumulativeSeries(series);
      const base = rangeAggBase[key];
      if (pnlBasis === "binance") {
        const activeSummary = buildActiveDaySummary(tradesAll, r.from, r.to);
        dayStatsByRange[key] = {
          win: activeSummary.win,
          loss: activeSummary.loss,
          flat: activeSummary.flat,
        };
        rangeAgg[key] = buildBinanceCompatAgg(base, activeSummary);
      } else {
        dayStatsByRange[key] = buildDayStats(series);
        rangeAgg[key] = base;
      }
    }
    if (pnlBasis === "binance") {
      const todaySummary = buildActiveDaySummary(tradesAll, ranges.today.from, ranges.today.to);
      rangeAgg.today = buildBinanceCompatAgg(rangeAggBase.today, todaySummary);
    } else {
      rangeAgg.today = rangeAggBase.today;
    }

    const defaultRangeKey = hasCustom ? "custom" : "d7";

    const topMarketUniverse = tradeByMarket.size > 0 ? Array.from(tradeByMarket.keys()) : markets_expected;
    const topMarkets = topMarketUniverse.map((mk) => {
      const list = tradeByMarket.get(mk) || [];
      let sum = 0;
      for (const t of list) {
        const v = Number(t.pnl_krw);
        if (Number.isFinite(v)) sum += v;
      }
      const pos = posByMarket[mk] || null;
      const leverage = resolvePositionLeverage(pos, {
        fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
      });
      return {
        market: mk,
        pnl_krw: sum,
        leverage,
        leverage_tier: resolveLeverageTier(leverage),
        leverage_reason: resolvePositionLeverageReason(pos),
      };
    }).sort((a, b) => Math.abs(b.pnl_krw) - Math.abs(a.pnl_krw)).slice(0, 5);

    const leverageRows = marketsConfigured.map((mk) => {
      const pos = posByMarket[mk] || null;
      const leverage = resolvePositionLeverage(pos, {
        fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
      });
      return {
        market: mk,
        position_state: String(pos && pos.state ? pos.state : "FLAT"),
        position_leverage: leverage,
      };
    });
    const leverageSummary = buildLeverageSummary(leverageRows, { includeFlat: false });
    leverageSummary.default_leverage = isBinanceExchange ? defaultFuturesLeverage : 1;
    leverageSummary.enabled = isBinanceExchange;

    let totalUsed = 0;
    let sumMax = 0;
    for (const mk of marketsConfigured) {
      const pos = posByMarket[mk];
      const used = pos && pos.budget_used_krw != null ? Number(pos.budget_used_krw) : null;
      const max = budgetEnabled ? Number((budgetByMarket && budgetByMarket[mk]) || budgetDefault || 0) : null;
      if (Number.isFinite(used)) totalUsed += used;
      if (Number.isFinite(max)) sumMax += max;
    }

    const totalMaxEffective = (totalMaxRaw && totalMaxRaw > 0) ? totalMaxRaw : (sumMax > 0 ? sumMax : null);
    const usedPct = (totalMaxEffective && totalMaxEffective > 0) ? (totalUsed / totalMaxEffective) : null;

    const pnlSourcePolicyUsed = usedBinanceIncomeApi
      ? "BINANCE_INCOME_API_FIRST_FALLBACK"
      : getPnlSourcePolicy();

    const payload = {
      exchange,
      markets_expected,
      as_of_kst: toKstString(new Date().toISOString()),
      pnl_scope_days: getPnlScopeDays(),
      pnl_source_policy: pnlSourcePolicyUsed,
      leverage_summary: leverageSummary,
      pnl_basis: pnlBasis,
      customRange: hasCustom ? { start: startRaw, end: endRaw } : null,
      rangeWarning,
      profit: {
        unit: budgetUnit,
        basis: pnlBasis,
        total_max_krw: totalMaxEffective,
        total_used_krw: totalUsed || null,
        total_used_pct: usedPct,
        leverage_summary: leverageSummary,
        ranges,
        rangeAgg,
        dailySeriesByRange,
        cumulativeSeriesByRange,
        dayStatsByRange,
        defaultRangeKey,
        topMarkets,
        customRange: hasCustom ? { start: startRaw, end: endRaw } : null,
        rangeWarning,
      },
    };

    setCache(cacheKey, payload);
    return res.render(String(req.query.legacy || "").trim() === "1" ? "profit.legacy.ejs" : "profit", payload);
  } catch (e) {
    console.error("[PROFIT_ROUTE_ERROR]", {
      ...debug,
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : null,
    });
    try {
      return res.status(200).render(String(req.query.legacy || "").trim() === "1" ? "profit.legacy.ejs" : "profit", {
        exchange: req.query.exchange || '',
        markets_expected: [],
        as_of_kst: null,
        pnl_scope_days: null,
        pnl_source_policy: null,
        leverage_summary: null,
        pnl_basis: null,
        customRange: null,
        rangeWarning: null,
        profit: {
          unit: null,
          basis: null,
          total_max_krw: null,
          total_used_krw: null,
          total_used_pct: null,
          leverage_summary: null,
          ranges: [],
          rangeAgg: {},
          dailySeriesByRange: {},
          cumulativeSeriesByRange: {},
          dayStatsByRange: {},
          defaultRangeKey: null,
          topMarkets: [],
          customRange: null,
          rangeWarning: null,
        },
        _error: { code: "PROFIT_ROUTE_ERROR", message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      });
    } catch (renderErr) {
      return res.status(500).send("RENDER_FALLBACK_ERROR: " + (renderErr.message || String(renderErr)));
    }
  }
});

module.exports = router;
