const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { toNum, computeUnrealized, computeOverall } = require("../utils/overall");
const { getAiSettingsForProvider } = require("../storage/settings");
const { getMarketsExpected, getEffectiveExchangesSettings, getRiskBudgetForProvider, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { resolveExchangeFromReq, resolveRuntimeMarketsForExchange, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { evalLatestId, matchesEvalTf } = require("../utils/evalDoc");
const { getPnlScopeDays, getPnlSourcePolicy, getScopeFromMs, loadRealizedRowsForMarket } = require("../services/pnlPolicy");
const { loadBinanceIncomePnlRows } = require("../services/binanceIncomePnl");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { buildKpiLatestByMarket } = require("../utils/kpiLatestView");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { checkCharterConsistency } = require("../services/charterCheck");
const { buildTailSummary } = require("../utils/tailSummary");
const { toKstString } = require("../utils/timeKst");
const { listExchangePositionReadViews } = require("../services/positionReadModel");
const {
  resolvePositionLeverage,
  resolvePositionLeverageReason,
  resolveLeverageTier,
  buildLeverageSummary,
} = require("../utils/leverageView");
const { resolvePositionBudgetUsedKrw } = require("../utils/budgetUsageView");
const { resolveIntentStatusFamilyForView } = require("../utils/intentView");
const {
  SIGNAL_KPI_MIN_N,
  SIGNAL_KPI_MIN_EVAL_N,
  SIGNAL_KPI_KEEP_WR,
  SIGNAL_KPI_KEEP_EV,
  SIGNAL_KPI_DROP_EV,
} = require("../config/frozen");

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}
function normalizeExchange(raw) {
  const ex = String(raw || "").trim().toUpperCase();
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function deriveAiBudget(aiRunLatest, exchange, marketsExpected) {
  if (!aiRunLatest) return null;
  const byMarket = (aiRunLatest.next_by_market && typeof aiRunLatest.next_by_market === "object")
    ? aiRunLatest.next_by_market
    : (aiRunLatest.current_by_market && typeof aiRunLatest.current_by_market === "object")
      ? aiRunLatest.current_by_market
      : null;
  if (!byMarket) return null;
  const totalRaw = Number(aiRunLatest.target_total_krw ?? aiRunLatest.base_total_krw ?? 0);
  const totalMax = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;
  const count = Array.isArray(marketsExpected) && marketsExpected.length
    ? marketsExpected.length
    : Object.keys(byMarket || {}).length;
  const defaultMax = (totalMax && count > 0) ? (totalMax / count) : null;
  return {
    enabled: true,
    total_max_krw: totalMax,
    default_max_krw: defaultMax,
    by_market: byMarket,
    unit: String(exchange || "").includes("BINANCE") ? "USDT" : "KRW",
    source: "ai_allocation",
    virtual: true,
    updated_at: aiRunLatest.created_at || null,
  };
}

async function getLatestAiRun(db, provider) {
  const prov = String(provider || "").toUpperCase();
  let snap = null;
  let fallbackSnap = null;
  if (prov) {
    try {
      snap = await db.collection("ai_allocation_runs")
        .where("provider", "==", prov)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
    } catch (_) {
      snap = null;
    }
  }
  if ((!snap || snap.empty) && prov) {
    try {
      // Fallback without composite index: filter in memory.
      fallbackSnap = await db.collection("ai_allocation_runs")
        .orderBy("created_at", "desc")
        .limit(50)
        .get();
    } catch (_) {
      fallbackSnap = null;
    }
  }
  if ((!snap || snap.empty) && (!fallbackSnap || fallbackSnap.empty)) return null;
  let picked = null;
  if (prov) {
    const docs = (snap && snap.docs && snap.docs.length)
      ? snap.docs
      : (fallbackSnap && fallbackSnap.docs ? fallbackSnap.docs : []);
    for (const doc of docs) {
      const data = doc.data() || {};
      const p = String(data.provider || "").toUpperCase();
      if (p === prov) { picked = data; break; }
    }
    if (!picked) return null;
  } else {
    picked = snap.docs[0].data() || {};
  }
  const d = picked;
  return {
    created_at: d.created_at || null,
    mode: d.mode || null,
    confidence: (d.mode_confidence === undefined ? null : d.mode_confidence),
    reason: d.mode_reason || null,
    news_ok: d.news_ok === true,
    news_count: d.news_count ?? null,
    news_provider: d.news_provider || null,
    news_reason: d.news_reason || null,
    news_cached: d.news_cached === true,
    gpt_ok: d.gpt_ok === true,
    gpt_attempted: d.gpt_attempted === true,
    router_ok: d.router_ok === true,
    router_confidence: d.router_confidence ?? null,
    router_model: d.router_model || null,
    final_model: d.final_model || null,
    applied: d.applied === true,
    apply_reason: d.apply_reason || null,
    base_total_krw: d.base_total_krw ?? null,
    target_total_krw: d.target_total_krw ?? null,
    current_by_market: (d.current_by_market && typeof d.current_by_market === "object") ? d.current_by_market : null,
    next_by_market: (d.next_by_market && typeof d.next_by_market === "object") ? d.next_by_market : null,
    provider: d.provider || null,
  };
}

const REPORT_CACHE_MS = Number(process.env.REPORT_CACHE_MS || 60000);
const reportCache = new Map();

function getReportCache(key) {
  const hit = reportCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > REPORT_CACHE_MS) {
    reportCache.delete(key);
    return null;
  }
  return hit.data;
}

function setReportCache(key, data) {
  reportCache.set(key, { at: Date.now(), data });
}

async function resolveMarketsExpected(exchange) {
  const markets = await resolveRuntimeMarketsForExchange(exchange, 2000);
  return markets && markets.length ? markets : await getMarketsExpected(2000);
}

async function getBinanceIncomeCreds(exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return null;
  if (String(process.env.BINANCE_PNL_INCOME_API_DISABLED || "0") === "1") return null;
  try {
    const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
    const apiKey = String((exCfg && exCfg.api_key) || process.env.BINANCEFUT_API_KEY || "").trim();
    const apiSecret = String((exCfg && exCfg.api_secret) || process.env.BINANCEFUT_API_SECRET || "").trim();
    if (!apiKey || !apiSecret) return null;
    return { apiKey, apiSecret };
  } catch (_) {
    return null;
  }
}

function buildRealizedStatsFromRows(rows, fromMs, toMsVal) {
  const byMarket = new Map();
  let total = 0;
  let hasTotal = false;
  let tradesTotal = 0;

  for (const row of rows || []) {
    const ms = Number(row && row.close_ms);
    if (!Number.isFinite(ms) || ms < fromMs || ms >= toMsVal) continue;
    const market = String(row && (row.market || row.symbol || row.symbol_or_pair_id) || "").toUpperCase();
    if (!market) continue;

    let bucket = byMarket.get(market);
    if (!bucket) {
      bucket = { sum: 0, has: false, trades_n: 0 };
      byMarket.set(market, bucket);
    }
    bucket.trades_n += 1;
    tradesTotal += 1;

    const pnl = Number(row && row.pnl_krw);
    if (!Number.isFinite(pnl)) continue;
    bucket.sum += pnl;
    bucket.has = true;
    total += pnl;
    hasTotal = true;
  }

  return { byMarket, total, hasTotal, tradesTotal };
}

async function loadEvalLatest(db, exchange, execTf) {
  const id = evalLatestId(exchange);
  const snap = await db.collection("eval_latest").doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || null;
  if (!data) return null;
  if (execTf && !matchesEvalTf(data, execTf)) return null;
  return data;
}

function decisionKey(row) {
  const ex = String(row.exchange || "").toUpperCase();
  const sym = String(row.symbol || row.symbol_or_pair_id || row.market || "").trim();
  const tf = String(row.tf || "").trim();
  const side = String(row.side || "").trim();
  const group = String(row.group || "").trim();
  const subtype = String(row.subtype || "").trim();
  return `${ex}__${sym}__${tf}__${side}__${group}__${subtype}`;
}

function fallbackDecision(row) {
  const n = Number(row.n || 0);
  const evalN = Number(row.eval_n || 0);
  const wr = Number(row.win_rate);
  const ev = Number(row.ev);
  if (!Number.isFinite(n) || !Number.isFinite(evalN)) return "NEED_DATA";
  if (n < SIGNAL_KPI_MIN_N || evalN < SIGNAL_KPI_MIN_EVAL_N) return "NEED_DATA";
  if (Number.isFinite(wr) && Number.isFinite(ev) && wr >= SIGNAL_KPI_KEEP_WR && ev >= SIGNAL_KPI_KEEP_EV) return "KEEP";
  if (Number.isFinite(ev) && ev <= SIGNAL_KPI_DROP_EV) return "DROP";
  return "NEED_DATA";
}

function rangeDaily(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function rangeWeekly(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function rangeMonthly(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

async function computeRangePerf({ markets, from, to, budget, exchange, execTf = "15m", fallbackTf = "15m" }) {
  const fromMs = toMs(from);
  const toMsVal = toMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsVal)) {
    return { ok: false, reason: "BAD_RANGE", from, to };
  }
  const pnlScopeDays = getPnlScopeDays();
  const pnlScopeFromMs = getScopeFromMs(Date.now(), pnlScopeDays);
  const effectiveFromMs = Number.isFinite(pnlScopeFromMs) ? Math.max(fromMs, pnlScopeFromMs) : fromMs;
  const fillsLimit = Math.max(50, Math.min(4000, Math.trunc(Number(process.env.DASHBOARD_FILLS_LIMIT || 2000))));

  const maxByMarket = {};
  if (budget && Array.isArray(budget.per_market)) {
    for (const b of budget.per_market) {
      if (b && b.market) maxByMarket[b.market] = Number(b.budget_max_krw || 0) || null;
    }
  }

  const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
  const perMarket = [];
  let total = 0;
  let hasTotal = false;
  let tradesTotal = 0;
  let sourceExternalN = 0;
  let sourceFallbackN = 0;
  let sourceNoneN = 0;

  let incomeRows = null;
  try {
    const creds = await getBinanceIncomeCreds(exchange);
    if (creds) {
      const income = await loadBinanceIncomePnlRows({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        fromMs: effectiveFromMs,
        toMs: toMsVal,
        maxPages: Number(process.env.BINANCE_PNL_MAX_PAGES || 0) || 60,
      });
      if (Array.isArray(income && income.rows)) incomeRows = income.rows;
    }
  } catch (_) {
    incomeRows = null;
  }

  if (incomeRows) {
    const stats = buildRealizedStatsFromRows(incomeRows, fromMs, toMsVal);
    const mkSet = new Set(markets || []);
    const incomeMkSet = new Set(Array.from(stats.byMarket.keys()));
    for (const mk of mkSet) {
      const bucket = stats.byMarket.get(String(mk || "").toUpperCase());
      const budgetMax = maxByMarket[mk] || null;
      const realized = bucket && bucket.has ? bucket.sum : null;
      const growthPct = (budgetMax && budgetMax > 0 && realized != null) ? (realized / budgetMax) : null;
      perMarket.push({
        market: mk,
        realized_krw: realized,
        growth_pct: growthPct,
        trades_n: bucket ? Number(bucket.trades_n || 0) : 0,
      });
    }

    sourceExternalN = incomeMkSet.size;
    sourceFallbackN = 0;
    sourceNoneN = 0;
    total = stats.total;
    hasTotal = stats.hasTotal;
    tradesTotal = stats.tradesTotal;
  } else {

    for (const mk of markets) {
      let sum = 0;
      let has = false;
      let tradesN = 0;
      try {
        const realized = await loadRealizedRowsForMarket({
          exchange,
          symbol: mk,
          tf: execTf || defaultExecTfFromEnv() || "15m",
          fallbackTf,
          limitN: fillsLimit,
          fromMs: effectiveFromMs,
          toMs: toMsVal,
          mode: pnlMode,
        });
        if (realized.source_mode === "EXTERNAL") sourceExternalN += 1;
        else if (realized.source_mode === "NONE") sourceNoneN += 1;
        else sourceFallbackN += 1;

        for (const row of realized.rows || []) {
          const ms = Number(row.close_ms);
          if (!Number.isFinite(ms) || ms < fromMs || ms >= toMsVal) continue;
          tradesN += 1;
          const v = Number(row.pnl_krw);
          if (!Number.isFinite(v)) continue;
          sum += v;
          has = true;
        }
      } catch (_) {
        has = false;
        sourceNoneN += 1;
      }

      const budgetMax = maxByMarket[mk] || null;
      const growthPct = (budgetMax && budgetMax > 0 && has) ? (sum / budgetMax) : null;
      perMarket.push({
        market: mk,
        realized_krw: has ? sum : null,
        growth_pct: growthPct,
        trades_n: tradesN,
      });

      tradesTotal += tradesN;
      if (has) {
        total += sum;
        hasTotal = true;
      }
    }
  }

  const totalMax = budget && Number(budget.total_max_krw);
  const growthTotal = (Number.isFinite(totalMax) && totalMax > 0 && hasTotal)
    ? (total / totalMax)
    : null;

  return {
    ok: true,
    from,
    to,
    effective_from_ms: effectiveFromMs,
    scope_clamped: effectiveFromMs > fromMs,
    pnl_scope_days: pnlScopeDays,
    pnl_source_policy: incomeRows ? "BINANCE_INCOME_API_FIRST_FALLBACK" : getPnlSourcePolicy(),
    realized_source_mode:
      sourceExternalN > 0 && sourceFallbackN > 0 ? "MIXED" :
      sourceExternalN > 0 ? "EXTERNAL" :
      sourceFallbackN > 0 ? "FALLBACK" : "NONE",
    realized_source_breakdown: {
      external_markets: sourceExternalN,
      fallback_markets: sourceFallbackN,
      none_markets: sourceNoneN,
    },
    total_realized_krw: hasTotal ? total : null,
    growth_pct_total: growthTotal,
    trades_n: tradesTotal,
    per_market: perMarket,
  };
}

async function computeIntentStats(db, { from, to, limit = 4000, exchange } = {}) {
  const fromMs = toMs(from);
  const toMsVal = toMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsVal)) {
    return { ok: false, reason: "BAD_RANGE", from, to };
  }

  const snap = await db.collection("order_intents_paper")
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  let total = 0;
  let filled = 0;
  let canceled = 0;
  let pending = 0;
  let expired = 0;
  const cancelReasons = {};

  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const mk = x.symbol_or_pair_id || x.symbol || x.market || "";
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (exchange && (!exResolved || exResolved !== exchange)) return;
    if (!isLiveDocForExchange(exchange, x)) return;
    const createdMs = Date.parse(String(x.created_at || ""));
    if (!Number.isFinite(createdMs)) return;
    if (createdMs < fromMs || createdMs >= toMsVal) return;
    total += 1;
    const st = String(resolveIntentStatusFamilyForView(x, Date.now()) || x.status || "").toUpperCase();
    if (st === "FILLED") filled += 1;
    else if (st === "CANCELED") {
      canceled += 1;
      const r = String(x.cancel_reason || x.status_reason || "UNKNOWN").toUpperCase();
      if (r === "INTENT_EXPIRED") expired += 1;
      cancelReasons[r] = (cancelReasons[r] || 0) + 1;
    } else if (st === "PENDING") pending += 1;
  });

  const successPct = (total > 0) ? (filled / total) : null;
  const cancelPct = (total > 0) ? (canceled / total) : null;
  const pendingPct = (total > 0) ? (pending / total) : null;
  const expiredPct = (total > 0) ? (expired / total) : null;
  const topCancelReasons = Object.entries(cancelReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    ok: true,
    from,
    to,
    scanned_limit: limit,
    total,
    filled,
    canceled,
    pending,
    expired,
    success_pct: successPct,
    cancel_pct: cancelPct,
    pending_pct: pendingPct,
    expired_pct: expiredPct,
    top_cancel_reasons: topCancelReasons,
  };
}

async function loadLatest(db, mode, exchange) {
  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const id = mode === "monthly" ? `LATEST__monthly__${ex}` : `LATEST__weekly__${ex}`;
  const snap = await db.collection("report_latest").doc(id).get();
  return snap.exists ? (snap.data() || null) : null;
}

function normalizeLatestSnapshot(latest) {
  if (!latest || typeof latest !== "object") return null;
  const computed_at = latest.computed_at || latest.updated_at || null;
  return {
    ...latest,
    computed_at,
  };
}

function expectedRangeForMode(mode, now = new Date()) {
  if (mode === "monthly") return rangeMonthly(now);
  return rangeWeekly(now);
}

function expectedWindowMsForMode(mode) {
  return mode === "monthly"
    ? 30 * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
}

function latestSnapshotIsFresh(latest, mode, nowMs = Date.now()) {
  const doc = normalizeLatestSnapshot(latest);
  if (!doc || !doc.overall) return false;
  const range = doc.range || {};
  const computedMs = Date.parse(String(doc.computed_at || ""));
  if (!Number.isFinite(computedMs)) return false;
  const staleMs = Number(process.env.REPORT_LATEST_STALE_MS || (6 * 60 * 60 * 1000));
  if ((nowMs - computedMs) > staleMs) return false;

  const fromMs = Date.parse(String(range.from || ""));
  const toMs = Date.parse(String(range.to || ""));
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
    const expectedWindowMs = expectedWindowMsForMode(mode);
    const toleranceMs = Number(process.env.REPORT_LATEST_RANGE_TOLERANCE_MS || (60 * 60 * 60 * 1000));
    if (Math.abs((toMs - fromMs) - expectedWindowMs) > toleranceMs) return false;
  }

  return true;
}

function buildComputedLatestSnapshot({ mode, exchange, overall, nowIso }) {
  return {
    mode,
    exchange,
    computed_at: nowIso,
    updated_at: nowIso,
    overall,
    range: expectedRangeForMode(mode, new Date(nowIso)),
    source: "computed_now",
  };
}

async function computeOverallNow(db, exchangeArg, execTfArg = "15m", fallbackTfArg = "15m") {
  let exchange = String(exchangeArg || "").trim().toUpperCase();
  if (!exchange) {
    const exCfg = await getEffectiveExchangesSettings(2000);
    exchange = exCfg.provider || "BINANCEFUT";
  }
  const markets_expected = await resolveMarketsExpected(exchange);
  const exchangeSettings = await getExchangeSettingsForProvider(exchange, 2000);
  const isBinanceExchange = String(exchange || "").toUpperCase().includes("BINANCE");
  const defaultFuturesLeverage = (() => {
    const lev = Number(exchangeSettings && exchangeSettings.futures_leverage);
    if (Number.isFinite(lev) && lev > 0) return lev;
    return isBinanceExchange ? 2 : 1;
  })();

  const readPositions = await listExchangePositionReadViews({ exchange });
  const posByMarket = {};
  for (const x of readPositions) {
    const posId = String(x && (x.pos_id || x.id) || "");
    if (!posId.startsWith("POS__")) continue;
    const posEx = String(x.exchange || "").toUpperCase();
    const mk = x.symbol_or_pair_id || x.symbol;
    const posResolved = posEx || inferExchangeFromMarket(mk);
    if (!posResolved || posResolved !== exchange) continue;
    if (!isLiveDocForExchange(exchange, x)) continue;
    if (!mk) continue;
    if (markets_expected.length && !markets_expected.includes(mk)) continue;
    const leverage = resolvePositionLeverage(x, {
      fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
    });
    posByMarket[mk] = {
      state: x.state || null,
      size_pct: (x.size_pct === undefined ? null : x.size_pct),
      avg_price: (x.avg_price === undefined ? null : x.avg_price),
      position_side: x.position_side || x.side || null,
      budget_used_krw: (x.budget_used_krw === undefined ? null : x.budget_used_krw),
      leverage,
      leverage_tier: resolveLeverageTier(leverage),
      leverage_reason: resolvePositionLeverageReason(x),
      updated_at: x.updated_at || null,
    };
  }

  const barsSnap = await db.collection("bars_snapshots")
    .select("symbol","symbol_or_pair_id","ohlcv_json","created_at")
    .orderBy("created_at","desc")
    .limit(900)
    .get();

  const closeByMarket = {};
  barsSnap.forEach(d => {
    const x = d.data() || {};
    const mk = x.symbol || x.symbol_or_pair_id;
    if (!mk) return;
    const barEx = String(x.exchange || "").toUpperCase();
    const barResolved = barEx || inferExchangeFromMarket(mk);
    if (!barResolved || barResolved !== exchange) return;
    if (closeByMarket[mk] !== undefined) return;
    const o = x.ohlcv_json || {};
    const close = toNum(o.close);
    if (close === null) return;
    closeByMarket[mk] = close;
  });

  const kpiSnap = await db.collection("kpi_latest")
    .select("market","kpi","updated_at","computed_at","exchange","tf")
    .get();
  const kpiLatestByMarket = buildKpiLatestByMarket({ snap: kpiSnap, exchange, execTf: execTfArg });
  const kpiByMarket = {};
  for (const [market, row] of Object.entries(kpiLatestByMarket)) {
    kpiByMarket[market] = row && row.kpi ? row.kpi : null;
  }

  const markets = markets_expected.map(mk => {
    const pos = posByMarket[mk] || null;
    const close = (closeByMarket[mk] !== undefined) ? closeByMarket[mk] : null;
    const unreal = pos ? computeUnrealized(close, pos.avg_price, pos.position_side || pos.side) : null;
    const kpi = kpiByMarket[mk] || { status: "INCONCLUSIVE", n: 0 };
    return { market: mk, position: pos, close, unrealized_pnl_pct: unreal, kpi };
  });
  const unrealizedByMarket = {};
  for (const m of markets) {
    unrealizedByMarket[m.market] = m.unrealized_pnl_pct;
  }

  const realizedByMarket = {};
  const pnlScopeDays = getPnlScopeDays();
  const pnlScopeFromMs = getScopeFromMs(Date.now(), pnlScopeDays);
  const pnlScopeToMs = Date.now() + 1;
  const fillsLimit = Math.max(50, Math.min(4000, Math.trunc(Number(process.env.DASHBOARD_FILLS_LIMIT || 2000))));
  let realizedSourceExternalN = 0;
  let realizedSourceFallbackN = 0;
  let realizedSourceNoneN = 0;
  let realizedTotalAll = null;
  const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");

  let incomeRows = null;
  try {
    const creds = await getBinanceIncomeCreds(exchange);
    if (creds) {
      const income = await loadBinanceIncomePnlRows({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        fromMs: pnlScopeFromMs,
        toMs: pnlScopeToMs,
        maxPages: Number(process.env.BINANCE_PNL_MAX_PAGES || 0) || 60,
      });
      if (Array.isArray(income && income.rows)) incomeRows = income.rows;
    }
  } catch (_) {
    incomeRows = null;
  }

  if (incomeRows) {
    const stats = buildRealizedStatsFromRows(incomeRows, pnlScopeFromMs, pnlScopeToMs);
    for (const mk of markets_expected) {
      const bucket = stats.byMarket.get(String(mk || "").toUpperCase());
      realizedByMarket[mk] = bucket && bucket.has ? bucket.sum : null;
    }
    realizedTotalAll = stats.hasTotal ? stats.total : null;
    realizedSourceExternalN = stats.byMarket.size;
    realizedSourceFallbackN = 0;
    realizedSourceNoneN = 0;
  } else {
    for (const mk of markets_expected) {
      try {
        const realized = await loadRealizedRowsForMarket({
          exchange,
          symbol: mk,
          tf: execTfArg || defaultExecTfFromEnv() || "15m",
          fallbackTf: fallbackTfArg || defaultExecTfFromEnv() || "15m",
          limitN: fillsLimit,
          fromMs: pnlScopeFromMs,
          toMs: pnlScopeToMs,
          mode: pnlMode,
        });
        if (realized.source_mode === "EXTERNAL") realizedSourceExternalN += 1;
        else if (realized.source_mode === "NONE") realizedSourceNoneN += 1;
        else realizedSourceFallbackN += 1;
        let sum = 0;
        let has = false;
        for (const row of realized.rows || []) {
          const v = Number(row.pnl_krw);
          if (!Number.isFinite(v)) continue;
          sum += v;
          has = true;
        }
        realizedByMarket[mk] = has ? sum : null;
      } catch (_) {
        realizedByMarket[mk] = null;
        realizedSourceNoneN += 1;
      }
    }
  }

  const aiRunLatest = await getLatestAiRun(db, exchange);

  let riskBudget = null;
  try {
    const rb = await getRiskBudgetForProvider(exchange, 0);
    riskBudget = rb && rb.data ? rb.data : null;
  } catch (_) {
    riskBudget = null;
  }

  let budgetUnit = String((riskBudget && riskBudget.unit) || (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW")).toUpperCase();
  let budgetEnabled = riskBudget && riskBudget.enabled === true;
  let budgetDefault = budgetEnabled ? Number(riskBudget.default_max_krw || 0) : null;
  let budgetByMarket = budgetEnabled && typeof riskBudget.by_market === "object" ? riskBudget.by_market : {};
  let totalMaxRaw = budgetEnabled ? Number(riskBudget.total_max_krw || 0) : null;
  let budgetSource = (riskBudget && riskBudget.source) ? String(riskBudget.source) : "risk_budget";
  let budgetVirtual = false;

  if (!budgetEnabled) {
    const aiBudget = deriveAiBudget(aiRunLatest, exchange, markets_expected);
    if (aiBudget) {
      riskBudget = aiBudget;
      budgetEnabled = true;
      budgetUnit = String(aiBudget.unit || budgetUnit).toUpperCase();
      budgetDefault = (aiBudget.default_max_krw && aiBudget.default_max_krw > 0) ? aiBudget.default_max_krw : null;
      budgetByMarket = aiBudget.by_market || {};
      totalMaxRaw = (aiBudget.total_max_krw && aiBudget.total_max_krw > 0) ? aiBudget.total_max_krw : null;
      budgetSource = aiBudget.source || "ai_allocation";
      budgetVirtual = aiBudget.virtual === true;
    }
  }

  let totalUsed = 0;
  let sumMax = 0;
  let totalUnrealized = 0;
  let pnlUsed = 0;
  let totalRealized = 0;
  let hasRealized = false;
  const per_market = markets_expected.map((mk) => {
    const pos = posByMarket[mk] || null;
    const budgetMax = budgetEnabled ? Number((budgetByMarket && budgetByMarket[mk]) || budgetDefault || 0) : null;
    const sizePct = (pos && pos.size_pct != null) ? Number(pos.size_pct) : 0;
    const used = budgetEnabled
      ? resolvePositionBudgetUsedKrw({ exchange, position: pos, budgetMaxKrw: budgetMax })
      : null;
    const posState = pos && pos.state ? String(pos.state).toUpperCase() : "";
    const unreal = (unrealizedByMarket[mk] != null) ? Number(unrealizedByMarket[mk]) : null;
    const realized = (realizedByMarket[mk] != null) ? Number(realizedByMarket[mk]) : null;
    const unrealizedKrw = (used != null && unreal != null) ? (used * unreal) : null;
    let totalPnlKrw = null;
    if (Number.isFinite(realized)) totalPnlKrw = realized;
    if (Number.isFinite(unrealizedKrw)) totalPnlKrw = (totalPnlKrw == null ? 0 : totalPnlKrw) + unrealizedKrw;
    const growthPct = (budgetMax && budgetMax > 0 && totalPnlKrw != null) ? (totalPnlKrw / budgetMax) : null;

    if (used != null) totalUsed += used;
    if (budgetMax && budgetMax > 0) sumMax += budgetMax;
    if (posState === "ACTIVE" && Number.isFinite(used) && Number.isFinite(unreal)) {
      totalUnrealized += used * unreal;
      pnlUsed += used;
    }
    if (Number.isFinite(realized)) {
      totalRealized += realized;
      hasRealized = true;
    }
    return {
      market: mk,
      position_state: posState || null,
      budget_max_krw: (budgetMax && budgetMax > 0) ? budgetMax : null,
      budget_used_krw: (used != null) ? used : null,
      size_pct: sizePct,
      leverage: pos && Number.isFinite(Number(pos.leverage)) ? Number(pos.leverage) : null,
      leverage_tier: pos && pos.leverage_tier ? pos.leverage_tier : null,
      leverage_reason: pos && pos.leverage_reason ? pos.leverage_reason : null,
      realized_pnl_krw: (realized != null) ? realized : null,
      unrealized_pnl_krw: (unrealizedKrw != null) ? unrealizedKrw : null,
      total_pnl_krw: (totalPnlKrw != null) ? totalPnlKrw : null,
      growth_pct: growthPct,
    };
  });
  const leverage_summary = buildLeverageSummary(per_market, { includeFlat: false });
  leverage_summary.default_leverage = isBinanceExchange ? defaultFuturesLeverage : 1;
  leverage_summary.enabled = isBinanceExchange;

  const totalMaxEffective = (totalMaxRaw && totalMaxRaw > 0) ? totalMaxRaw : (sumMax > 0 ? sumMax : null);
  const totalUsedPct = (totalMaxEffective && totalMaxEffective > 0) ? (totalUsed / totalMaxEffective) : null;

  const totalUnrealizedKrw = (budgetEnabled && pnlUsed > 0) ? totalUnrealized : null;
  const totalRealizedKrw = Number.isFinite(realizedTotalAll)
    ? realizedTotalAll
    : (hasRealized ? totalRealized : null);
  const totalPnlKrw = (totalUnrealizedKrw != null || totalRealizedKrw != null)
    ? (Number(totalUnrealizedKrw || 0) + Number(totalRealizedKrw || 0))
    : null;
  const growthPctTotal = (totalMaxEffective && totalMaxEffective > 0 && totalPnlKrw != null)
    ? (totalPnlKrw / totalMaxEffective)
    : null;
  const growthPctUsed = (pnlUsed > 0 && totalPnlKrw != null) ? (totalPnlKrw / pnlUsed) : null;

  return {
    overall: computeOverall(markets),
    kpi_by_market: kpiByMarket,
    budget: {
      enabled: budgetEnabled,
      total_max_krw: totalMaxEffective,
      total_used_krw: (budgetEnabled ? totalUsed : null),
      total_used_pct: totalUsedPct,
      total_max_source: (totalMaxRaw && totalMaxRaw > 0) ? "total_max_krw" : "sum_by_market",
      per_market,
      unit: budgetUnit,
      source: budgetSource,
      virtual: budgetVirtual,
      updated_at: riskBudget && riskBudget.updated_at ? riskBudget.updated_at : null,
      leverage_summary,
    },
    budget_perf: {
      total_unrealized_krw: totalUnrealizedKrw,
      total_realized_krw: totalRealizedKrw,
      total_pnl_krw: totalPnlKrw,
      growth_pct_total: growthPctTotal,
      growth_pct_used: growthPctUsed,
      pnl_used_krw: pnlUsed || null,
      unit: budgetUnit,
      pnl_scope_days: pnlScopeDays,
      pnl_scope_from_ms: pnlScopeFromMs,
      pnl_scope_to_ms: pnlScopeToMs,
      pnl_source_policy: incomeRows ? "BINANCE_INCOME_API_FIRST_FALLBACK" : getPnlSourcePolicy(),
      realized_source_mode:
        realizedSourceExternalN > 0 && realizedSourceFallbackN > 0 ? "MIXED" :
        realizedSourceExternalN > 0 ? "EXTERNAL" :
        realizedSourceFallbackN > 0 ? "FALLBACK" : "NONE",
      realized_source_breakdown: {
        external_markets: realizedSourceExternalN,
        fallback_markets: realizedSourceFallbackN,
        none_markets: realizedSourceNoneN,
      },
    },
  };
}

function aiSummaryLimit(length) {
  const v = String(length || "medium").toLowerCase();
  if (v === "short") return 3;
  if (v === "long") return 8;
  return 5;
}

function gateScore(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PASS" || s === "GREEN") return 3;
  if (s === "WARN" || s === "YELLOW") return 2;
  if (s === "FAIL" || s === "RED") return 1;
  return 0;
}

function formatMetric({ emphasis, ev, mdd, growthPct }) {
  if (emphasis === "MDD") {
    if (typeof mdd !== "number") return "-";
    return (mdd * 100).toFixed(2) + "%";
  }
  if (emphasis === "EV") {
    if (typeof ev !== "number") return "-";
    return ev.toFixed(4);
  }
  if (emphasis === "GATE") {
    return "-";
  }
  if (typeof growthPct === "number") {
    const sign = growthPct > 0 ? "+" : "";
    return sign + (growthPct * 100).toFixed(2) + "%";
  }
  return "-";
}

function buildAiSummary({ settings, markets, kpiByMarket, rangePerf }) {
  const ai = settings || {};
  const language = String(ai.language || "ko").toLowerCase() === "en" ? "en" : "ko";
  const summaryLength = String(ai.summary_length || "medium").toLowerCase();
  const emphasis = String(ai.report_emphasis || "EV").toUpperCase();
  const warningsEnabled = ai.warnings_enabled !== false;
  const tableRatio = Number.isFinite(Number(ai.table_ratio)) ? Number(ai.table_ratio) : 60;

  const rangeMap = {};
  if (rangePerf && Array.isArray(rangePerf.per_market)) {
    for (const r of rangePerf.per_market) {
      if (r && r.market) rangeMap[r.market] = r;
    }
  }

  const rows = (markets || []).map((mk) => {
    const kpi = kpiByMarket && kpiByMarket[mk] ? kpiByMarket[mk] : null;
    const range = rangeMap[mk] || null;
    const ev = (kpi && typeof kpi.ev === "number") ? kpi.ev : null;
    const mdd = (kpi && typeof kpi.mdd === "number") ? kpi.mdd : null;
    const gate = kpi ? kpi.status : null;
    const growthPct = range ? range.growth_pct : null;
    let score = null;

    if (emphasis === "EV" && typeof ev === "number") score = ev;
    else if (emphasis === "MDD" && typeof mdd === "number") score = -Math.abs(mdd);
    else if (emphasis === "GATE") score = gateScore(gate);
    else if (typeof growthPct === "number") score = growthPct;
    else if (typeof ev === "number") score = ev;
    else score = -9999;

    return {
      market: mk,
      ev,
      mdd,
      gate,
      growth_pct: growthPct,
      score,
      metric_label: formatMetric({ emphasis, ev, mdd, growthPct }),
    };
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.market).localeCompare(String(b.market));
  });

  const limit = aiSummaryLimit(summaryLength);
  const top = rows.slice(0, limit);

  const warnings = [];
  if (warningsEnabled) {
    const missing = rows.filter((r) => r.ev == null && r.mdd == null && r.growth_pct == null);
    if (missing.length) {
      warnings.push(language === "en"
        ? `Missing metrics: ${missing.map((m) => m.market).join(", ")}`
        : `지표 누락: ${missing.map((m) => m.market).join(", ")}`);
    }
  }

  const emphasisLabel = (language === "en")
    ? emphasis
    : (emphasis === "EV" ? "EV" : emphasis === "MDD" ? "MDD" : emphasis === "GATE" ? "GATE" : "BALANCED");

  const lineTop = (language === "en")
    ? `Top markets (${emphasisLabel}): ${top.map((t) => `${t.market}(${t.metric_label})`).join(", ")}`
    : `상위 시장 (${emphasisLabel}): ${top.map((t) => `${t.market}(${t.metric_label})`).join(", ")}`;

  const lines = [lineTop];
  if (tableRatio < 50) {
    lines.push(language === "en" ? "Detail mode: narrative focus" : "디테일 모드: 설명 비중 강화");
  }
  for (const w of warnings) lines.push(w);

  return {
    settings: {
      language,
      summary_length: summaryLength,
      report_emphasis: emphasis,
      warnings_enabled: warningsEnabled,
      table_ratio: tableRatio,
    },
    top_markets: top,
    warnings,
    lines,
  };
}

router.get("/dashboard/report", async (req, res) => {
  try {
    const __allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
    if (!__allowLocal) {
      if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
    }

    const db = getFirestore();
    const { exchange, exCfg } = await resolveExchangeFromReq(req, 2000);
    const { signalTf, execTf } = await resolveRuntimeTfContext(req, exchange, {
      fallback: (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m",
      ttlMs: 2000,
    });
    const markets_expected = await resolveMarketsExpected(exchange);
    const mode = String(req.query.mode || "weekly").toLowerCase();

    const hasCustomRange = Boolean(req.query.from) && Boolean(req.query.to);
    let from = String(req.query.from || "");
    let to = String(req.query.to || "");

    if (!from || !to) {
      const now = new Date();
      if (mode === "daily") ({ from, to } = rangeDaily(now));
      else if (mode === "monthly") ({ from, to } = rangeMonthly(now));
      else ({ from, to } = rangeWeekly(now));
    }

    const cacheKey = `${exchange}__${signalTf}__${execTf}__${mode}__${from}__${to}__${String(req.query.market || "")}`;
    const cached = getReportCache(cacheKey);
    if (cached) return res.render("report", cached);

    const overallBundle = await computeOverallNow(db, exchange, execTf, signalTf);
    const overall = overallBundle.overall;
    const budget = overallBundle.budget;
    const budget_perf = overallBundle.budget_perf;
    const tail_summary = buildTailSummary(overallBundle.kpi_by_market || {});
    const charter_check = checkCharterConsistency(exchange);
    const range_perf = await computeRangePerf({
      markets: markets_expected,
      from,
      to,
      budget,
      exchange,
      execTf,
      fallbackTf: signalTf,
    });
    const leverageByMarket = new Map(
      (budget && Array.isArray(budget.per_market) ? budget.per_market : [])
        .map((row) => [String(row.market || ""), row])
        .filter(([mk]) => mk)
    );
    if (range_perf && Array.isArray(range_perf.per_market)) {
      range_perf.per_market = range_perf.per_market.map((row) => {
        const lev = leverageByMarket.get(String(row.market || ""));
        return {
          ...row,
          leverage: lev && Number.isFinite(Number(lev.leverage)) ? Number(lev.leverage) : null,
          leverage_tier: lev && lev.leverage_tier ? lev.leverage_tier : null,
          leverage_reason: lev && lev.leverage_reason ? lev.leverage_reason : null,
        };
      });
    }
    const intent_stats = await computeIntentStats(db, { from, to, limit: 4000, exchange });
    const eval_latest = await loadEvalLatest(db, exchange, execTf);
    const decisionRows = Array.isArray(eval_latest && eval_latest.decision_rows)
      ? eval_latest.decision_rows
      : [];
    const decisionMap = new Map();
    decisionRows.forEach((r) => {
      decisionMap.set(decisionKey(r), String(r.decision || "").toUpperCase() || null);
    });
    const signal_scorecard = Array.isArray(eval_latest && eval_latest.signal_kpi_A)
      ? eval_latest.signal_kpi_A.map((r) => {
        const key = decisionKey(r);
        const decision = decisionMap.get(key) || fallbackDecision(r);
        return { ...r, decision };
      })
      : [];
    signal_scorecard.sort((a, b) => {
      const av = Number(a.ev);
      const bv = Number(b.ev);
      if (Number.isFinite(bv) && Number.isFinite(av) && bv !== av) return bv - av;
      const an = Number(a.eval_n || a.n || 0);
      const bn = Number(b.eval_n || b.n || 0);
      return bn - an;
    });
    const data_quality = eval_latest && eval_latest.diagnostics ? eval_latest.diagnostics : null;
    const focus_market = String(req.query.market || "").trim();

    const latestWeeklyRaw = await loadLatest(db, "weekly", exchange);
    const latestMonthlyRaw = await loadLatest(db, "monthly", exchange);
    const nowIso = new Date().toISOString();
    const latest_weekly = latestSnapshotIsFresh(latestWeeklyRaw, "weekly")
      ? normalizeLatestSnapshot(latestWeeklyRaw)
      : buildComputedLatestSnapshot({ mode: "weekly", exchange, overall, nowIso });
    const latest_monthly = latestSnapshotIsFresh(latestMonthlyRaw, "monthly")
      ? normalizeLatestSnapshot(latestMonthlyRaw)
      : buildComputedLatestSnapshot({ mode: "monthly", exchange, overall, nowIso });
    const latest = (mode === "monthly") ? latest_monthly : (mode === "weekly") ? latest_weekly : null;

    const wO = latest_weekly && latest_weekly.overall ? latest_weekly.overall : null;
    const mO = latest_monthly && latest_monthly.overall ? latest_monthly.overall : null;

    const compare = {
      weekly: wO,
      monthly: mO,
      delta: {
        unrealized_weighted: (wO && wO.unrealized_weighted != null && mO && mO.unrealized_weighted != null)
          ? (Number(wO.unrealized_weighted) - Number(mO.unrealized_weighted))
          : null,
        active_cnt: (wO && wO.active_cnt != null && mO && mO.active_cnt != null)
          ? (Number(wO.active_cnt) - Number(mO.active_cnt))
          : null,
        size_sum: (wO && wO.size_sum != null && mO && mO.size_sum != null)
          ? (Number(wO.size_sum) - Number(mO.size_sum))
          : null,
      }
    };

    const weeks_back = Number(req.query.weeks_back || 8);
    const packUrl = `/api/report/improvement-pack?level=STANDARD&exchange=${encodeURIComponent(exchange)}&tf=${encodeURIComponent(signalTf)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const range = { from, to };
    const aiSettings = (await getAiSettingsForProvider(exchange || "BINANCEFUT", 2000)).data || null;
    const ai_summary = buildAiSummary({
      settings: aiSettings,
      markets: markets_expected,
      kpiByMarket: overallBundle.kpi_by_market || {},
      rangePerf: range_perf,
    });

    const payload = {
      exchange,
      mode,
      range,
      hasCustomRange,
      as_of_kst: toKstString(new Date().toISOString()),
      pnl_scope_days: getPnlScopeDays(),
      pnl_source_policy:
        (budget_perf && budget_perf.pnl_source_policy) ||
        (range_perf && range_perf.pnl_source_policy) ||
        getPnlSourcePolicy(),
      overall,
      budget,
      leverage_summary: budget && budget.leverage_summary ? budget.leverage_summary : null,
      budget_perf,
      tail_summary,
      charter_check,
      range_perf,
      intent_stats,
      signal_scorecard,
      data_quality,
      eval_latest,
      ai_summary,
      focus_market,
      latest,
      latest_weekly,
      latest_monthly,
      compare,
      weeks_back,
      packUrl,
      signal_tf: signalTf,
      exec_tf: execTf,
    };
    setReportCache(cacheKey, payload);
    return res.render("report", payload);
  } catch (e) {
    try {
      return res.status(200).render("report", {
        exchange: req.query.exchange || '',
        mode: null,
        range: null,
        hasCustomRange: false,
        as_of_kst: null,
        pnl_scope_days: null,
        pnl_source_policy: null,
        overall: null,
        budget: null,
        leverage_summary: null,
        budget_perf: null,
        tail_summary: null,
        charter_check: null,
        range_perf: null,
        intent_stats: null,
        signal_scorecard: null,
        data_quality: null,
        eval_latest: null,
        ai_summary: null,
        focus_market: null,
        latest: null,
        latest_weekly: null,
        latest_monthly: null,
        compare: null,
        weeks_back: null,
        packUrl: null,
        signal_tf: null,
        exec_tf: null,
        _error: { code: "REPORT_ROUTE_ERROR", message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      });
    } catch (renderErr) {
      return res.status(500).send("RENDER_FALLBACK_ERROR: " + (renderErr.message || String(renderErr)));
    }
  }
});

module.exports = router;
