const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { toNum, computeUnrealized, computeOverall } = require("../utils/overall");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const {
  resolveRuntimeMarketsForExchange,
  resolveExecTfForExchange,
} = require("../utils/resolveExchange");
const { buildKpiLatestByMarket } = require("../utils/kpiLatestView");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { loadTradeQualitySummaryForExchange } = require("../services/tradeQualitySummary");
const { listExchangePositionReadViews } = require("../services/positionReadModel");
const { loadSystemRuntimeGuardView } = require("../services/systemRuntimeGuardView");

function allowLocalNoOauth(req) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) return false;

  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const allowFlag = String(process.env.ALLOW_LOCAL_NO_OAUTH || "") === "1";
  return allowFlag || !hasGoogle;
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

function expectedRangeForMode(mode, now) {
  return mode === "monthly" ? rangeMonthly(now) : rangeWeekly(now);
}

function expectedWindowMsForMode(mode) {
  return mode === "monthly"
    ? 30 * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
}

function normalizeLatestSnapshot(latest) {
  if (!latest || typeof latest !== "object") return null;
  return {
    ...latest,
    computed_at: latest.computed_at || latest.updated_at || null,
  };
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
    const toleranceMs = Number(process.env.REPORT_LATEST_RANGE_TOLERANCE_MS || (60 * 60 * 1000));
    if (Math.abs((toMs - fromMs) - expectedWindowMs) > toleranceMs) return false;
  }

  return true;
}

async function computeOverallSnapshotNow(db, { exchange }) {
  const exCfg = await getEffectiveExchangesSettings(2000);
  const execTf = await resolveExecTfForExchange(exchange, (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m", 2000);
  const marketsExpected = await resolveRuntimeMarketsForExchange(exchange, 2000);

  const readPositions = await listExchangePositionReadViews({ exchange });
  const posByMarket = {};
  for (const x of readPositions) {
    const m = x.symbol_or_pair_id || x.symbol;
    const ex = String(x.exchange || "").toUpperCase() || inferExchangeFromMarket(m);
    if (!m || ex !== exchange) continue;
    if (!isLiveDocForExchange(exchange, x)) continue;
    if (!String(x.pos_id || x.id).startsWith("POS__")) continue;
    posByMarket[m] = {
      state: x.state || null,
      size_pct: x.size_pct == null ? null : x.size_pct,
      avg_price: x.avg_price == null ? null : x.avg_price,
      position_side: x.position_side || x.side || null,
      updated_at: x.updated_at || null,
    };
  }

  const barsSnap = await db.collection("bars_snapshots").orderBy("created_at", "desc").limit(1500).get();
  const closeByMarket = {};
  barsSnap.forEach((d) => {
    const x = d.data() || {};
    const m = x.symbol || x.symbol_or_pair_id;
    const ex = String(x.exchange || "").toUpperCase() || inferExchangeFromMarket(m);
    if (!m || ex !== exchange) return;
    if (closeByMarket[m] !== undefined) return;
    const close = toNum((x.ohlcv_json || {}).close);
    if (close == null) return;
    closeByMarket[m] = close;
  });

  const kpiSnap = await db.collection("kpi_latest").get();
  const kpiLatestByMarket = buildKpiLatestByMarket({ snap: kpiSnap, exchange, execTf });
  const markets = marketsExpected.map((market) => {
    const pos = posByMarket[market] || null;
    const close = closeByMarket[market] !== undefined ? closeByMarket[market] : null;
    const unreal = pos ? computeUnrealized(close, pos.avg_price, pos.position_side || pos.side) : null;
    const row = kpiLatestByMarket[market];
    const kpi = row && row.kpi ? row.kpi : { status: "INCONCLUSIVE", n: 0 };
    return { market, position: pos, close, unrealized_pnl_pct: unreal, kpi };
  });
  return computeOverall(markets);
}

async function buildComputedLatestSnapshot({ db, mode, exchange, nowIso }) {
  const overall = await computeOverallSnapshotNow(db, { exchange });
  const exCfg = await getEffectiveExchangesSettings(2000);
  const execTf = await resolveExecTfForExchange(exchange, (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m", 2000);
  const marketsExpected = await resolveRuntimeMarketsForExchange(exchange, 2000);
  const range = expectedRangeForMode(mode, new Date(nowIso));
  const fromMs = Date.parse(String(range.from || ""));
  const toMs = Date.parse(String(range.to || ""));
  const tradeQuality = await loadTradeQualitySummaryForExchange({
    exchange,
    markets: marketsExpected,
    tf: execTf,
    fallbackTf: defaultExecTfFromEnv() || execTf,
    fromMs: Number.isFinite(fromMs) ? fromMs : null,
    toMs: Number.isFinite(toMs) ? toMs : null,
    topN: 5,
  });
  return {
    mode,
    exchange,
    computed_at: nowIso,
    updated_at: nowIso,
    overall,
    range,
    trade_quality: tradeQuality,
    source: "computed_now",
  };
}

// GET /api/report/latest?mode=weekly|monthly&exchange=BINANCEFUT
router.get("/api/report/latest", async (req, res) => {
  try {
    const allowLocal = allowLocalNoOauth(req);
    if (!allowLocal && (!req.isAuthenticated || !req.isAuthenticated())) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    }

    const mode = String(req.query.mode || "weekly").toLowerCase();
    let exchange = String(req.query.exchange || "").trim().toUpperCase();
    if (!exchange) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = (exCfg && exCfg.provider) ? String(exCfg.provider).toUpperCase() : "BINANCEFUT";
    }
    if (exchange.includes("BINANCE")) exchange = "BINANCEFUT";
    const key = (mode === "monthly") ? `LATEST__monthly__${exchange}` : `LATEST__weekly__${exchange}`;

    const db = getFirestore();
    const snap = await db.collection("report_latest").doc(key).get();
    const raw = snap.exists ? (snap.data() || {}) : null;
    const nowIso = new Date().toISOString();
    const data = latestSnapshotIsFresh(raw, mode)
      ? normalizeLatestSnapshot(raw)
      : await buildComputedLatestSnapshot({ db, mode, exchange, nowIso });
    if (!data.trade_quality) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      const execTf = await resolveExecTfForExchange(exchange, (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m", 2000);
      const marketsExpected = await resolveRuntimeMarketsForExchange(exchange, 2000);
      const fromMs = Date.parse(String(data && data.range && data.range.from || ""));
      const toMs = Date.parse(String(data && data.range && data.range.to || ""));
      data.trade_quality = await loadTradeQualitySummaryForExchange({
        exchange,
        markets: marketsExpected,
        tf: execTf,
        fallbackTf: defaultExecTfFromEnv() || execTf,
        fromMs: Number.isFinite(fromMs) ? fromMs : null,
        toMs: Number.isFinite(toMs) ? toMs : null,
        topN: 5,
      });
    }
    const systemRuntimeGuards = await loadSystemRuntimeGuardView({ exchange });
    return res.json({
      ok: true,
      id: key,
      mode,
      exists: snap.exists,
      data,
      system_runtime_guards: systemRuntimeGuards,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "REPORT_LATEST_ERROR", message: e.message });
  }
});

module.exports = router;
