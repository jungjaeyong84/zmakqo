/* eslint-disable no-console */
const { getFirestore } = require("../src/storage/firestore");
const { resolveMarketsForExchange } = require("../src/utils/resolveExchange");
const { inferExchangeFromMarket } = require("../src/utils/marketExchange");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");
const { getRiskBudgetForProvider } = require("../src/utils/exchangeSettings");
const { defaultExecTfFromEnv } = require("../src/utils/marketConfig");
const { fetchRecentNewFills, buildTradesFromFills } = require("../src/services/tradesFromFills");
const { computeUnrealized } = require("../src/utils/overall");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeExchange(raw) {
  const ex = String(raw || "").trim().toUpperCase();
  if (!ex) return "UPBIT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  if (ex.includes("KIWOOM")) return "KIWOOM";
  return "UPBIT";
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
      fallbackSnap = await db.collection("ai_allocation_runs")
        .orderBy("created_at", "desc")
        .limit(50)
        .get();
    } catch (_) {
      fallbackSnap = null;
    }
  }
  if ((!snap || snap.empty) && (!fallbackSnap || fallbackSnap.empty)) return null;
  const docs = (snap && snap.docs && snap.docs.length)
    ? snap.docs
    : (fallbackSnap && fallbackSnap.docs ? fallbackSnap.docs : []);
  for (const doc of docs) {
    const data = doc.data() || {};
    const p = String(data.provider || "").toUpperCase();
    if (p === prov) return data;
  }
  return null;
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

async function loadCloseByMarket(db, exchange) {
  const snap = await db.collection("bars_snapshots")
    .select("symbol", "symbol_or_pair_id", "ohlcv_json", "created_at", "exchange")
    .orderBy("created_at", "desc")
    .limit(900)
    .get();
  const closeByMarket = {};
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const mk = x.symbol || x.symbol_or_pair_id;
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (!exResolved || exResolved !== exchange) return;
    if (!mk || closeByMarket[mk] !== undefined) return;
    const o = x.ohlcv_json || {};
    const close = toNum(o.close);
    if (close == null) return;
    closeByMarket[mk] = close;
  });
  return closeByMarket;
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

async function computeRealizedByMarket(exchange, markets, fillsLimit) {
  const realizedByMarket = {};
  const tradesByMarket = {};
  const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
  for (const mk of markets) {
    try {
      const fills = await fetchRecentNewFills({ exchange, symbol: mk, tf: defaultExecTfFromEnv() || "15m", limitN: fillsLimit });
      const { trades } = buildTradesFromFills(fills, { mode: pnlMode });
      let sum = 0;
      let has = false;
      for (const t of trades) {
        const v = Number(t.pnl_krw);
        if (!Number.isFinite(v)) continue;
        sum += v;
        has = true;
      }
      realizedByMarket[mk] = has ? sum : null;
      tradesByMarket[mk] = trades.length || 0;
    } catch (_) {
      realizedByMarket[mk] = null;
      tradesByMarket[mk] = 0;
    }
  }
  return { realizedByMarket, tradesByMarket };
}

function summarizeIssues(row) {
  const issues = [];
  if (row.position_active && row.close == null) issues.push("MISSING_CLOSE");
  if (row.position_active && row.avg_price == null) issues.push("MISSING_AVG_PRICE");
  if (row.position_active && (!Number.isFinite(row.budget_used_krw) || row.budget_used_krw <= 0)) {
    issues.push("MISSING_USED_BUDGET");
  }
  if (!Number.isFinite(row.budget_max_krw)) issues.push("MISSING_BUDGET_MAX");
  if ((row.trades_n || 0) > 0 && row.realized_pnl_krw == null) issues.push("TRADES_NO_REALIZED");
  return issues;
}

async function checkExchange(exchange) {
  const db = getFirestore();
  const ex = normalizeExchange(exchange);
  const marketsExpected = await resolveMarketsForExchange(ex, 2000);
  const closeByMarket = await loadCloseByMarket(db, ex);
  const posByMarket = await loadPositionsByMarket(db, ex);

  const aiRunLatest = await getLatestAiRun(db, ex);
  let riskBudget = null;
  try {
    const rb = await getRiskBudgetForProvider(ex, 0);
    riskBudget = rb && rb.data ? rb.data : null;
  } catch (_) {
    riskBudget = null;
  }

  let budgetEnabled = riskBudget && riskBudget.enabled === true;
  if (!budgetEnabled) {
    const aiBudget = deriveAiBudget(aiRunLatest, ex, marketsExpected);
    if (aiBudget) {
      riskBudget = aiBudget;
      budgetEnabled = true;
    }
  }
  const budgetDefault = budgetEnabled ? Number(riskBudget.default_max_krw || 0) : null;
  const budgetByMarket = budgetEnabled && typeof riskBudget.by_market === "object" ? riskBudget.by_market : {};

  const { realizedByMarket, tradesByMarket } = await computeRealizedByMarket(ex, marketsExpected, 800);

  const rows = marketsExpected.map((mk) => {
    const pos = posByMarket[mk] || null;
    const close = closeByMarket[mk] !== undefined ? closeByMarket[mk] : null;
    const avgPrice = pos && pos.avg_price != null ? Number(pos.avg_price) : null;
    const positionActive = pos && String(pos.state || "").toUpperCase() === "ACTIVE";
    const sizePct = pos && pos.size_pct != null ? Number(pos.size_pct) : 0;
    const budgetMax = budgetEnabled ? Number((budgetByMarket && budgetByMarket[mk]) || budgetDefault || 0) : null;
    const usedRaw = pos && pos.budget_used_krw != null ? Number(pos.budget_used_krw) : null;
    const used = (budgetMax && budgetMax > 0)
      ? (usedRaw != null ? usedRaw : (sizePct > 0 ? budgetMax * sizePct : null))
      : null;
    const unreal = (avgPrice != null && close != null)
      ? computeUnrealized(close, avgPrice, pos.position_side || pos.side)
      : null;
    const unrealKrw = (used != null && unreal != null) ? used * Number(unreal) : null;
    const realized = realizedByMarket[mk] != null ? Number(realizedByMarket[mk]) : null;
    let totalPnl = null;
    if (Number.isFinite(realized)) totalPnl = realized;
    if (Number.isFinite(unrealKrw)) totalPnl = (totalPnl == null ? 0 : totalPnl) + unrealKrw;

    const row = {
      market: mk,
      close,
      avg_price: avgPrice,
      position_active: positionActive,
      position_state: pos ? pos.state : null,
      size_pct: sizePct,
      budget_max_krw: (budgetMax && budgetMax > 0) ? budgetMax : null,
      budget_used_krw: (used != null) ? used : null,
      realized_pnl_krw: realized,
      unrealized_pnl_krw: unrealKrw,
      total_pnl_krw: totalPnl,
      trades_n: tradesByMarket[mk] || 0,
    };
    row.issues = summarizeIssues(row);
    return row;
  });

  const problematic = rows.filter((r) => r.issues && r.issues.length);
  return { exchange: ex, rows, problematic };
}

async function run() {
  const arg = process.argv.slice(2)[0];
  const mode = String(arg || "ALL").toUpperCase();
  const targets = (mode === "ALL")
    ? ["UPBIT", "BINANCEFUT", "KIWOOM"]
    : [normalizeExchange(mode)];

  for (const ex of targets) {
    const { problematic } = await checkExchange(ex);
    console.log(`\n[${ex}] 문제 가능 마켓 ${problematic.length}개`);
    problematic.slice(0, 50).forEach((r) => {
      console.log(
        `${r.market}\tissues=${r.issues.join(",")}\tpos=${r.position_state || "-"}\t` +
        `used=${r.budget_used_krw != null ? r.budget_used_krw.toFixed(2) : "-"}\t` +
        `close=${r.close != null ? r.close : "-"}\tavg=${r.avg_price != null ? r.avg_price : "-"}\t` +
        `real=${r.realized_pnl_krw != null ? r.realized_pnl_krw.toFixed(2) : "-"}\t` +
        `unreal=${r.unrealized_pnl_krw != null ? r.unrealized_pnl_krw.toFixed(2) : "-"}\t` +
        `total=${r.total_pnl_krw != null ? r.total_pnl_krw.toFixed(2) : "-"}`
      );
    });
  }
}

run().catch((e) => {
  console.error("CHECK_DASH_PNL_FAILED", e);
  process.exit(1);
});
