const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { toNum, computeUnrealized, computeOverall } = require("../utils/overall");
const { getMarketsExpected, getEffectiveExchangesSettings, getMultiExchangesSettings } = require("../utils/exchangeSettings");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { resolveExecTfForExchange, resolveRuntimeMarketsForExchange } = require("../utils/resolveExchange");
const { buildKpiLatestByMarket } = require("../utils/kpiLatestView");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { listExchangePositionReadViews } = require("../services/positionReadModel");

function requireSchedulerAuth(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || "");
  if (!expected) return res.status(500).json({ ok: false, error: "SERVER_MISCONFIG", message: "SCHEDULER_TOKEN not set" });
  if (token !== expected) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  return next();
}

function nowIso() { return new Date().toISOString(); }
function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}
function reportFillsLimit() {
  const v = Number(process.env.REPORT_RUN_FILLS_LIMIT || 1200);
  if (!Number.isFinite(v)) return 1200;
  return Math.max(200, Math.min(10000, Math.trunc(v)));
}

// Rolling range helpers
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

// 신형 fills만 집계
async function collectNewFillsInRange(db, { fromMs, toMsVal, exchange }) {
  const snap = await db.collection("fills_paper")
    .orderBy("created_at", "desc")
    .limit(reportFillsLimit())
    .get();

  let fills_new = 0;
  let sells_new = 0;
  const markets = {};

  snap.forEach(d => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const mk = x.symbol || x.symbol_or_pair_id || x.market || "";
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (exchange && (!exResolved || exResolved !== exchange)) return;
    if (!isLiveDocForExchange(exchange, x)) return;
    const created = Date.parse(String(x.created_at || ""));
    if (!Number.isFinite(created)) return;
    if (created < fromMs || created >= toMsVal) return;
    if (!x.exec_price_source) return;   // 신형만

    fills_new += 1;
    const side = String(x.side || "").toUpperCase();
    if (side === "SELL") sells_new += 1;

    const m = mk || "UNKNOWN";
    markets[m] = (markets[m] || 0) + 1;
  });

  return {
    counts: { fills_new, sells_new, trades_approx: sells_new },
    markets,
    note: "report_run_v1: counts are approximate (new fills only)"
  };
}

// 현재 시점 overall snapshot (briefing과 동일 규칙)
async function resolveMarketsForExchange(exchange) {
  const multi = await getMultiExchangesSettings(2000);
  if (multi && Array.isArray(multi.exchanges)) {
    const found = multi.exchanges.find((x) => String(x.provider || "").toUpperCase() === exchange);
    if (found && Array.isArray(found.markets) && found.markets.length) return found.markets;
  }
  return await getMarketsExpected(2000);
}

async function computeOverallSnapshotNow(db, { exchange }) {
  const exCfg = await getEffectiveExchangesSettings(2000);
  const exchangeWanted = exchange || exCfg.provider || "BINANCEFUT";
  const execTf = await resolveExecTfForExchange(exchangeWanted, (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m", 2000);
  const markets_expected = await resolveRuntimeMarketsForExchange(exchangeWanted, 2000);

  const readPositions = await listExchangePositionReadViews({ exchange: exchangeWanted });
  const posByMarket = {};
  for (const x of readPositions) {
    const ex = String(x.exchange || "").toUpperCase();
    const m = x.symbol_or_pair_id || x.symbol;
    const exResolved = ex || inferExchangeFromMarket(m);
    if (!exResolved || exResolved !== exchangeWanted) continue;
    if (!isLiveDocForExchange(exchangeWanted, x)) continue;
    if (!m) continue;
    if (!String(x.pos_id || x.id).startsWith("POS__")) continue;
    posByMarket[m] = {
      state: x.state || null,
      size_pct: (x.size_pct === undefined ? null : x.size_pct),
      avg_price: (x.avg_price === undefined ? null : x.avg_price),
      position_side: x.position_side || x.side || null,
      updated_at: x.updated_at || null,
    };
  }

  const barsSnap = await db.collection("bars_snapshots")
    .orderBy("created_at", "desc")
    .limit(1500)
    .get();
  const closeByMarket = {};
  barsSnap.forEach(d => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const m = x.symbol || x.symbol_or_pair_id;
    const exResolved = ex || inferExchangeFromMarket(m);
    if (!exResolved || exResolved !== exchangeWanted) return;
    if (!m) return;
    if (closeByMarket[m] !== undefined) return;
    const o = x.ohlcv_json || {};
    const close = toNum(o.close);
    if (close === null) return;
    closeByMarket[m] = close;
  });

  const kpiSnap = await db.collection("kpi_latest")
    .limit(500)
    .get();
  const kpiLatestByMarket = buildKpiLatestByMarket({ snap: kpiSnap, exchange: exchangeWanted, execTf });
  const kpiByMarket = {};
  for (const [market, row] of Object.entries(kpiLatestByMarket)) {
    kpiByMarket[market] = row && row.kpi ? row.kpi : null;
  }

  const markets = markets_expected.map(m => {
    const pos = posByMarket[m] || null;
    const close = (closeByMarket[m] !== undefined) ? closeByMarket[m] : null;
    const unreal = pos ? computeUnrealized(close, pos.avg_price, pos.position_side || pos.side) : null;
    const kpi = kpiByMarket[m] || { status: "INCONCLUSIVE", n: 0 };
    return { market: m, position: pos, close, unrealized_pnl_pct: unreal, kpi };
  });

  return computeOverall(markets);
}

router.post("/scheduler/report-run", requireSchedulerAuth, async (req, res) => {
  try {
    const db = getFirestore();

    const mode = String(req.query.mode || "weekly").toLowerCase();
    let range;
    const now = new Date();
    if (mode === "daily") range = rangeDaily(now);
    else if (mode === "monthly") range = rangeMonthly(now);
    else range = rangeWeekly(now);

    const fromMs = toMs(range.from);
    const toMsVal = toMs(range.to);
    if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
      return res.status(400).json({ ok:false, error:"BAD_RANGE" });
    }

    const requestedExchange = String(req.query.exchange || req.body?.exchange || "").trim().toUpperCase();
    const exCfg = await getEffectiveExchangesSettings(2000);
    let exchange = requestedExchange || exCfg.provider || "BINANCEFUT";
    if (exchange.includes("BINANCE")) exchange = "BINANCEFUT";
    const { counts, markets, note } = await collectNewFillsInRange(db, { fromMs, toMsVal, exchange });
    const overall = await computeOverallSnapshotNow(db, { exchange });

    const docId = `REPORT_RUN__${exchange}__${mode}__${fromMs}__${toMsVal}`;
    const created_at = nowIso();

    const interpret = {
      ok: true,
      mode,
      range,
      overall,
      counts,
      markets,
      note: "facts-only interpret v1 (stored snapshot)"
    };

    await db.collection("report_runs").doc(docId).set({
      created_at,
      mode,
      exchange,
      range,
      counts,
      markets,
      overall,
      interpret,
    }, { merge: true });

    await db.collection("report_latest").doc(`LATEST__${mode}__${exchange}`).set({
      updated_at: created_at,
      doc_id: docId,
      mode,
      exchange,
      range,
      overall,
      interpret,
    }, { merge: true });

    return res.json({ ok: true, doc_id: docId, mode, range, note: "SAVED_report_runs + report_latest" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "REPORT_RUN_ERROR", message: e.message });
  }
});

module.exports = router;
