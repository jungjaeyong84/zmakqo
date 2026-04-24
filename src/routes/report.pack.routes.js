const ensureAuthMaybe = (req, res, next) => {
  // 로컬에서 OAuth 미구성 상태면 기본적으로 인증을 생략
  const isLocalRuntime =
    process.env.RUNTIME_MODE === "local" || process.env.NODE_ENV !== "production";

  const isDevPlaceholder = (v) => {
    const s = String(v || "").trim();
    if (!s) return true;
    return s.toUpperCase() === "REPLACE_ME" || s.toUpperCase() === "CHANGE_ME";
  };

  const oauthMissing =
    isDevPlaceholder(process.env.GOOGLE_CLIENT_ID) ||
    isDevPlaceholder(process.env.GOOGLE_CLIENT_SECRET);

  if (isLocalRuntime && oauthMissing) return next();

  if (String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1") return next();
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
  return next();
};

// ENSURE_AUTH_MAYBE_FOR_PACK_V1
const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const JSZip = require("jszip");

const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("../services/tradesFromFills");
const { computeUnrealized } = require("../utils/overall");
const { computeSignalEval, summariseSignalRows } = require("../services/signalEval");
const { getMarketsExpected, getEffectiveExchangesSettings, getMultiExchangesSettings, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv, normalizeMarketSymbolForProvider, normalizeTf, tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { evalDocId, matchesEvalTf } = require("../utils/evalDoc");
const { getAiSettingsForProvider } = require("../storage/settings");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { kstDateParts } = require("../utils/timeKst");
const { resolvePositionBudgetUsedKrw } = require("../utils/budgetUsageView");
const { resolveRegimeRecord } = require("../utils/regime");
const { listExchangePositionReadViews } = require("../services/positionReadModel");
const {
  SIGNAL_EVAL_VERSION,
  SIGNAL_EVAL_HORIZON_BARS,
  SIGNAL_KPI_MIN_N,
  SIGNAL_KPI_MIN_EVAL_N,
  SIGNAL_KPI_KEEP_WR,
  SIGNAL_KPI_KEEP_EV,
  SIGNAL_KPI_DROP_WR,
  SIGNAL_KPI_DROP_EV,
  SIGNAL_KPI_HARD_STREAK,
  SCHEMA_VERSION,
} = require("../config/frozen");


// ─────────────────────────────────────────
// utils
// ─────────────────────────────────────────
function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}
function normalizeExchange(raw) {
  const ex = String(raw || "").trim().toUpperCase();
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return ex;
}
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function zoneOf(pnlPct) {
  if (pnlPct <= 0) return "L";
  if (pnlPct < 0.03) return "A";
  if (pnlPct < 0.05) return "B";
  return "C";
}
function scoreOfZone(z) {
  if (z === "L") return -2;
  if (z === "A") return 1;
  if (z === "B") return 2;
  if (z === "C") return 3;
  return 0;
}
function normalizeMarketForExchange(raw, exchange) {
  const norm = normalizeMarketSymbolForProvider(raw, exchange);
  return norm || raw || null;
}

// period KPI: 해당 기간 trade 전부로 계산(rolling100 강제 안 함)
function calcPeriodTradeKpi(pnls) {
  const n = pnls.length;
  const wins = pnls.filter((x) => x > 0).length;
  const losses = n - wins;
  const win_rate = n > 0 ? wins / n : null;
  const ev = n > 0 ? mean(pnls) : null;

  const zones = { L: 0, A: 0, B: 0, C: 0 };
  let score = 0;
  for (const r of pnls) {
    const z = zoneOf(r);
    zones[z] += 1;
    score += scoreOfZone(z);
  }

  return {
    n,
    wins,
    losses,
    win_rate,
    ev,
    quality_score: n > 0 ? score : null,
    zones,
  };
}

// periods: [{ trade_kpi }, ...] → weighted roll
function rolling3(periods) {
  let nSum = 0;
  let wrNum = 0;
  let evNum = 0;
  let scoreSum = 0;
  let validPeriods = 0;

  for (const p of periods) {
    const k = p.trade_kpi || {};
    const n = Number(k.n || 0);
    if (n <= 0) continue;

    validPeriods += 1;
    nSum += n;

    if (typeof k.win_rate === "number") wrNum += k.win_rate * n;
    if (typeof k.ev === "number") evNum += k.ev * n;
    if (typeof k.quality_score === "number") scoreSum += k.quality_score;
  }

  return {
    valid_periods: validPeriods,          // 0~3
    n_sum: nSum,
    win_rate_weighted: nSum > 0 ? wrNum / nSum : null,
    ev_weighted: nSum > 0 ? evNum / nSum : null,
    score_sum: validPeriods > 0 ? scoreSum : null, // 단순 합(기간별 합산)
  };
}

function calcDelta(p0, roll) {
  // roll: {win_rate_weighted, ev_weighted, score_sum, valid_periods}
  const out = { win_rate_delta: null, ev_delta: null, score_delta: null };

  if (!p0 || !roll) return out;

  if (typeof p0.win_rate === "number" && typeof roll.win_rate_weighted === "number") {
    out.win_rate_delta = p0.win_rate - roll.win_rate_weighted;
  }
  if (typeof p0.ev === "number" && typeof roll.ev_weighted === "number") {
    out.ev_delta = p0.ev - roll.ev_weighted;
  }
  // score_delta는 roll이 "합"이므로, 비교를 위해 roll 평균(roll.score_sum/valid_periods)을 사용
  if (typeof p0.quality_score === "number" && typeof roll.score_sum === "number" && roll.valid_periods > 0) {
    out.score_delta = p0.quality_score - (roll.score_sum / roll.valid_periods);
  }
  return out;
}

// KST helpers (range 계산용)
function prevMonthRange(range) {
  const fromMs = toMs(range.from);
  const fromDate = new Date(fromMs);
  const { y, m } = kstDateParts(fromDate);

  const prevStartUTC = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const prevStart = new Date(prevStartUTC - 9 * 60 * 60 * 1000);

  const curStartUTC = Date.UTC(y, m, 1, 0, 0, 0);
  const curStart = new Date(curStartUTC - 9 * 60 * 60 * 1000);

  return { from: prevStart.toISOString(), to: curStart.toISOString() };
}
function shiftIsoRangeDays(range, daysDelta) {
  const fromMs = toMs(range.from);
  const toMsVal = toMs(range.to);
  const dms = daysDelta * 24 * 60 * 60 * 1000;
  return {
    from: new Date(fromMs + dms).toISOString(),
    to: new Date(toMsVal + dms).toISOString(),
  };
}

// fills: range 기반 신형 fills만
async function collectNewFillsInRange(db, { fromMs, toMsVal, exchange } = {}) {
  // ✅ 대량 데이터 대비: range query + 페이지네이션(최대 maxDocs)
  const col = db.collection("fills_paper");
  const pageSize = 1000;
  const maxDocs = 50000;

  const norm = (doc) => {
    const x = doc.data() || {};
    const created = x.created_at || null;
    const created_at_ms = Date.parse(String(created || ""));
    const exec_ms = Number(x.exec_bar_close_time_utc_ms);

    return {
      doc_id: doc.id,
      exchange: x.exchange || null,
      market: x.market,
      created_at: created,
      created_at_ms: Number.isFinite(created_at_ms) ? created_at_ms : null,
      side: x.side,
      exec_price: x.exec_price,
      exec_quote_qty: x.exec_quote_qty,
      exec_qty: x.exec_qty,
      fee_paid: x.fee_paid,
      fee_currency: x.fee_currency,
      pnl_quote: x.pnl_quote,
      pnl_pct: x.pnl_pct,
      realized_pnl_quote: x.realized_pnl_quote,
      realized_pnl_pct: x.realized_pnl_pct,
      notional_krw: (x.notional_krw != null ? x.notional_krw : x.notional),
      budget_max_krw: x.budget_max_krw,
      budget_used_krw: x.budget_used_krw,
      qty_fraction: x.qty_fraction,
      exec_price_source: (x.exec_price_source || "LEGACY"),
      exec_bar_close_time_utc_ms: Number.isFinite(exec_ms) ? exec_ms : null,
      exec_bar_close_time_utc: x.exec_bar_close_time_utc,
      execution_mode: x.execution_mode || null,
      signal_reason: x.signal_reason,
      signal_strength: x.signal_strength,
      snapshot_id: x.snapshot_id,
      order_id: x.order_id,
      run_id: x.run_id,
      mode: x.mode,
    };
  };

  const ok = (row) => {
    const ms = Number(row.exec_bar_close_time_utc_ms);
    if (!Number.isFinite(ms)) return false;
    if (!(ms >= fromMs && ms < toMsVal)) return false;
    if (exchange) {
      const ex = String(row.exchange || "").toUpperCase();
      if (!ex || ex !== String(exchange || "").toUpperCase()) return false;
      if (!isLiveDocForExchange(exchange, row)) return false;
    }
    return true;
  };

  try {
    // 1) 1차 시도: exec_bar_close_time_utc_ms 범위 쿼리(정확/빠름)
    let q = col
      .where("exec_bar_close_time_utc_ms", ">=", fromMs)
      .where("exec_bar_close_time_utc_ms", "<", toMsVal)
      .orderBy("exec_bar_close_time_utc_ms", "desc")
      .limit(pageSize);

    let last = null;
    const out = [];

    while (true) {
      const snap = await (last ? q.startAfter(last) : q).get();
      if (snap.empty) break;

      for (const doc of snap.docs) out.push(norm(doc));

      last = snap.docs[snap.docs.length - 1];
      if (out.length >= maxDocs) break;
    }

    return out.filter(ok);
  } catch (e) {
    // 2) fallback: created_at 기준 최신 5000개 스캔 후 범위 필터(기존 방식, 안전망)
    const snap = await col.orderBy("created_at", "desc").limit(5000).get();
    const rows = snap.docs.map(norm);

    // created_at_ms 기준 필터(기존과 동일)
    return rows.filter((x) => {
      if (!Number.isFinite(Number(x.created_at_ms))) return false;
      return (x.created_at_ms >= fromMs && x.created_at_ms < toMsVal);
    });
  }
}

// dropped signals: range 기반 드롭 로그 수집
async function collectSignalDropsInRange(db, { fromMs, toMsVal, exchange } = {}) {
  const snap = await db.collection("signals_dropped").orderBy("created_at", "desc").limit(50000).get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (exchange) {
      const wantEx = String(exchange || "").toUpperCase();
      if (!ex || ex !== wantEx) return;
      if (!isLiveDocForExchange(exchange, x)) return;
    }
    const barMs = Number(x.bar_close_time_utc_ms || 0) || toMs(x.bar_close_time_utc || x.created_at);
    if (!Number.isFinite(barMs)) return;
    if (!(barMs >= fromMs && barMs < toMsVal)) return;
    out.push({
      doc_id: d.id,
      exchange: x.exchange || null,
      market: x.market || x.symbol_or_pair_id || x.symbol || null,
      symbol: x.symbol || x.symbol_or_pair_id || x.market || null,
      tf: x.tf || null,
      side: x.side || null,
      event: x.event || null,
      reason: x.reason || null,
      reason_family: x.reason_family || null,
      drop_reason_code: x.drop_reason_code || null,
      event_intent: x.event_intent || null,
      signal_id: x.signal_id || null,
      bar_close_time_utc_ms: barMs,
      bar_close_time_utc: x.bar_close_time_utc || null,
      created_at: x.created_at || null,
      created_at_ms: toMs(x.created_at),
      features_json: (x.features_json && typeof x.features_json === "object") ? x.features_json : null,
    });
  });
  return out;
}

// trades: 기간 범위의 fill만 필터해 trade 재구성
async function buildPeriodTrades({ exchange, market, tf, fromMs, toMsVal }) {
  const recentFills = await fetchRecentNewFills({ exchange, symbol: market, tf, limitN: 4000 });

  const filtered = recentFills.filter((f) => {
    const ms = toNum(f.exec_bar_close_time_utc_ms);
    if (ms === null) return false;
    return ms >= fromMs && ms < toMsVal;
  });

  const { trades, closedTradePnls } = await buildTradesFromFillsWithFunding(filtered, { exchange, symbol: market });
  return { trades, pnls: closedTradePnls };
}

// period validity: "데이터 없음"을 명시
function periodValidity(marketTradeKpiMap, minTrades = 1) {
  // marketTradeKpiMap: { KRW-BTC: {n...}, ... }
  const nSum = Object.values(marketTradeKpiMap || {}).reduce((a, k) => a + Number(k.n || 0), 0);
  return {
    period_valid: nSum >= minTrades,
    n_sum: nSum,
  };
}

// rolling validity: 최소 2개 기간이 유효 + 총 trade 20 이상이면 rolling 판단 가능
function rollingValidity(roll, minTotalN = 20, minValidPeriods = 2) {
  if (!roll) return { rolling_valid: false, reason: "no_roll" };
  if (roll.valid_periods < minValidPeriods) return { rolling_valid: false, reason: "valid_periods<2" };
  if (roll.n_sum < minTotalN) return { rolling_valid: false, reason: "n_sum<20" };
  return { rolling_valid: true, reason: "ok" };
}

// ─────────────────────────────────────────
// GET /api/report/pack?from=...&to=...&mode=weekly|monthly|daily
// ─────────────────────────────────────────
router.get("/api/report/pack", async (req, res) => {
  const __allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
  const __schedToken = String(req.headers["x-scheduler-token"] || "");
  const __schedOk = Boolean(process.env.SCHEDULER_TOKEN) && __schedToken === String(process.env.SCHEDULER_TOKEN);

  if (!__allowLocal && !__schedOk) {
    if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
  }

  try {
    const db = getFirestore();

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const mode = String(req.query.mode || "").toLowerCase();

      const week = String(req.query.week || "").trim(); // daily/weekly/monthly

    const fromMs = toMs(from);
    const toMsVal = toMs(to);

    if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
      return res.status(400).json({ ok: false, error: "BAD_RANGE", message: "from/to must be valid ISO and to > from" });
    }

    const exchangeParam = String(req.query.exchange || "").trim();
    const multi = await getMultiExchangesSettings(2000);
    let exchange = "BINANCEFUT";
    let markets_expected = [];
    let signalTf = normalizeTf(req.query.tf || "") || "";

    if (multi && Array.isArray(multi.exchanges) && multi.exchanges.length) {
      const wanted = exchangeParam ? normalizeExchange(exchangeParam) : null;
      const found = wanted
        ? multi.exchanges.find((x) => normalizeExchange(x.provider) === wanted)
        : multi.exchanges[0];
      exchange = normalizeExchange((found && found.provider) || "BINANCEFUT");
      const mk = Array.isArray(found && found.markets) ? found.markets : [];
      markets_expected = mk.length ? mk : defaultMarketsFromEnv(exchange);
      if (!signalTf) {
        const tfRaw = Array.isArray(found && found.tf_allowlist) ? found.tf_allowlist[0] : "";
        signalTf = normalizeTf(tfRaw || "") || "";
      }
    } else {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = exchangeParam ? normalizeExchange(exchangeParam) : normalizeExchange(exCfg.provider || "BINANCEFUT");
      if (exchangeParam && exchange !== normalizeExchange(exCfg.provider || "BINANCEFUT")) {
        markets_expected = defaultMarketsFromEnv(exchange);
      } else {
        markets_expected = await getMarketsExpected(2000);
      }
      if (!signalTf) {
        const tfRaw = Array.isArray(exCfg && exCfg.tf_allowlist) ? exCfg.tf_allowlist[0] : "";
        signalTf = normalizeTf(tfRaw || "") || "";
      }
    }
    if (Array.isArray(markets_expected) && markets_expected.length) {
      const seen = new Set();
      const normalized = [];
      for (const mk of markets_expected) {
        const norm = normalizeMarketForExchange(mk, exchange);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        normalized.push(norm);
      }
      markets_expected = normalized;
    }
    const tf = signalTf || defaultExecTfFromEnv() || "15m";
    const intervalMs = tfToMs(tf) || (15 * 60 * 1000);

    // position snapshot (now)
    const readPositions = await listExchangePositionReadViews({ exchange });
    const posByMarket = {};
    for (const x of readPositions) {
      if (!String(x.pos_id || x.id || "").startsWith("POS__")) continue;
      const posEx = String(x.exchange || "").toUpperCase();
      if (posEx && posEx !== exchange) continue;
      if (!isLiveDocForExchange(exchange, x)) continue;
      const rawMarket = x.symbol_or_pair_id || x.symbol;
      const m = normalizeMarketForExchange(rawMarket, exchange);
      if (!m) continue;
      posByMarket[m] = {
        market: m,
        state: x.state || null,
        size_pct: x.size_pct ?? null,
        avg_price: x.avg_price ?? null,
        position_side: x.position_side || x.side || null,
        budget_used_krw: x.budget_used_krw ?? null,
        budget_max_krw: x.budget_max_krw ?? null,
        updated_at: x.updated_at || null,
      };
    }

    const barsSnap = await db.collection("bars_snapshots")
      .orderBy("created_at", "desc")
      .limit(800)
      .get();

    const closeByMarket = {};
    const barCloseMsByMarket = {};
    barsSnap.forEach((d) => {
      const x = d.data() || {};
      const barEx = String(x.exchange || "").toUpperCase();
      if (barEx && barEx !== exchange) return;
      const rawMarket = x.symbol || x.symbol_or_pair_id;
      const m = normalizeMarketForExchange(rawMarket, exchange);
      if (!m) return;
      if (closeByMarket[m] !== undefined) return;
      const o = x.ohlcv_json || {};
      const c = toNum(o.close);
      if (c === null) return;
      closeByMarket[m] = c;
      barCloseMsByMarket[m] = x.bar_close_time_utc_ms ?? null;
    });

    const asOf = new Date().toISOString();
    const position_snapshot = markets_expected.map((m) => {
      const p = posByMarket[m] || { market: m, state: "FLAT", size_pct: 0, avg_price: null, updated_at: null };
      const close = closeByMarket[m] ?? null;
      const u = (close !== null && p.avg_price != null)
        ? computeUnrealized(close, p.avg_price, p.position_side || p.side)
        : null;
      return {
        market: m,
        state: p.state,
        size_pct: p.size_pct,
        avg_price: p.avg_price,
        last_close: close,
        bar_close_time_utc_ms: barCloseMsByMarket[m] ?? null,
        unrealized_pnl_pct: u,
        as_of: asOf,
      };
    });

    let budget_snapshot = { enabled: false, total_max_krw: null, total_used_krw: null, total_used_pct: null, per_market: [], unit: null };
    try {
      const rbRes = await getRiskBudgetForProvider(exchange, 0);
      const rb = rbRes && rbRes.data ? rbRes.data : null;
      if (rb && rb.enabled === true) {
        const unit = String(rb.unit || (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW")).toUpperCase();
        const byMarket = (rb.by_market && typeof rb.by_market === "object") ? rb.by_market : {};
        const defaultMax = Number(rb.default_max_krw || 0);
        const totalMaxRaw = Number(rb.total_max_krw || 0);
        let totalUsed = 0;
        let sumMax = 0;
        const per = markets_expected.map((m) => {
          const pos = posByMarket[m] || {};
          const maxKrw = Number(byMarket[m] || defaultMax || 0);
          const used = resolvePositionBudgetUsedKrw({ exchange, position: pos, budgetMaxKrw: maxKrw });
          if (used != null) totalUsed += used;
          if (maxKrw > 0) sumMax += maxKrw;
          return { market: m, budget_max_krw: (maxKrw > 0 ? maxKrw : null), budget_used_krw: used };
        });

        const totalMaxEffective = (totalMaxRaw > 0) ? totalMaxRaw : (sumMax > 0 ? sumMax : null);
        const totalUsedPct = (totalMaxEffective && totalMaxEffective > 0) ? (totalUsed / totalMaxEffective) : null;
        budget_snapshot = {
          enabled: true,
          total_max_krw: totalMaxEffective,
          total_used_krw: totalUsed,
          total_used_pct: totalUsedPct,
          total_max_source: (totalMaxRaw > 0) ? "total_max_krw" : "sum_by_market",
          per_market: per,
          unit,
        };
      }
    } catch (_) {
      // ignore
    }

    // kpi_latest snapshot (raw)
    const kpiLatestSnap = await db.collection("kpi_latest")
      .limit(500)
      .get();
    const kpi_latest_snapshot = [];
    kpiLatestSnap.forEach((d) => {
      const x = d.data() || {};
      kpi_latest_snapshot.push({ id: d.id, ...x });
    });

    // base range fills (new only)
    const fills = await collectNewFillsInRange(db, { fromMs, toMsVal, exchange });
    const signalDrops = await collectSignalDropsInRange(db, { fromMs, toMsVal, exchange });
    const sells_new = fills.filter((x) => String(x.side || "").toUpperCase() === "SELL").length;

    const kpi_summary = {
      fills_new: fills.length,
      signals_dropped: signalDrops.length,
      sells_new,
      trades_approx: sells_new,
      markets_in_fills: Array.from(new Set(fills.map((x) => x.market))).sort(),
    };

    const markets_state = {};
    for (const m of markets_expected) {
      const pos = position_snapshot.find((x) => x.market === m);
      if (!pos) markets_state[m] = "NO_DATA";
      else if (String(pos.state || "").toUpperCase() === "ACTIVE" && Number(pos.size_pct || 0) > 0) markets_state[m] = "ACTIVE";
      else markets_state[m] = "FLAT";
    }

    // ---- multi-period (3w / 3m) ----
    const periods = {};
    const rolling = {};
    const delta = {};
    const validity = {}; // period/rolling validity flags

    if (mode === "weekly") {
      const w0 = { from, to };
      const w1 = shiftIsoRangeDays(w0, -7);
      const w2 = shiftIsoRangeDays(w0, -14);
      const wlist = [
        { name: "w0", range: w0 },
        { name: "w1", range: w1 },
        { name: "w2", range: w2 },
      ];

      const out = {};
      for (const w of wlist) {
        const fms = toMs(w.range.from);
        const tms = toMs(w.range.to);

        const fillsW = await collectNewFillsInRange(db, { fromMs: fms, toMsVal: tms, exchange });

        const marketKpi = {};
        for (const mkt of markets_expected) {
          const { pnls } = await buildPeriodTrades({ exchange, market: mkt, tf, fromMs: fms, toMsVal: tms });
          marketKpi[mkt] = calcPeriodTradeKpi(pnls);
        }

        const pv = periodValidity(marketKpi, 1);

        out[w.name] = {
          range: w.range,
          period_valid: pv.period_valid,
          period_n_sum: pv.n_sum,
          kpi_summary: {
            fills_new: fillsW.length,
            sells_new: fillsW.filter((x) => String(x.side || "").toUpperCase() === "SELL").length,
            trades_approx: fillsW.filter((x) => String(x.side || "").toUpperCase() === "SELL").length,
            markets_in_fills: Array.from(new Set(fillsW.map((x) => x.market))).sort(),
          },
          trade_kpi: marketKpi,
        };
      }

      // rolling_3w per market
      const rolling_3w = {};
      const delta_w0_vs_rolling = {};

      for (const mkt of markets_expected) {
        const p0 = out.w0.trade_kpi[mkt];
        const p1 = out.w1.trade_kpi[mkt];
        const p2 = out.w2.trade_kpi[mkt];

        const r = rolling3([{ trade_kpi: p0 }, { trade_kpi: p1 }, { trade_kpi: p2 }]);
        rolling_3w[mkt] = r;

        const rv = rollingValidity(r, 20, 2);
        validity[`weekly_rolling_${mkt}`] = rv;

        delta_w0_vs_rolling[mkt] = rv.rolling_valid ? calcDelta(p0, r) : { win_rate_delta: null, ev_delta: null, score_delta: null };
      }

      periods.weekly_3w = out;
      rolling.rolling_3w = rolling_3w;
      delta.delta_w0_vs_rolling = delta_w0_vs_rolling;

      // overall validity flags
      validity.weekly_w0_valid = out.w0.period_valid;
      validity.weekly_w1_valid = out.w1.period_valid;
      validity.weekly_w2_valid = out.w2.period_valid;
    }

    if (mode === "monthly") {
      const m0 = { from, to };
      const m1 = prevMonthRange(m0);
      const m2 = prevMonthRange(m1);

      const mlist = [
        { name: "m0", range: m0 },
        { name: "m1", range: m1 },
        { name: "m2", range: m2 },
      ];

      const out = {};
      for (const m of mlist) {
        const fms = toMs(m.range.from);
        const tms = toMs(m.range.to);

        const fillsM = await collectNewFillsInRange(db, { fromMs: fms, toMsVal: tms, exchange });

        const marketKpi = {};
        for (const mkt of markets_expected) {
          const { pnls } = await buildPeriodTrades({ exchange, market: mkt, tf, fromMs: fms, toMsVal: tms });
          marketKpi[mkt] = calcPeriodTradeKpi(pnls);
        }

        const pv = periodValidity(marketKpi, 1);

        out[m.name] = {
          range: m.range,
          period_valid: pv.period_valid,
          period_n_sum: pv.n_sum,
          kpi_summary: {
            fills_new: fillsM.length,
            sells_new: fillsM.filter((x) => String(x.side || "").toUpperCase() === "SELL").length,
            trades_approx: fillsM.filter((x) => String(x.side || "").toUpperCase() === "SELL").length,
            markets_in_fills: Array.from(new Set(fillsM.map((x) => x.market))).sort(),
          },
          trade_kpi: marketKpi,
        };
      }

      const rolling_3m = {};
      const delta_m0_vs_rolling = {};

      for (const mkt of markets_expected) {
        const p0 = out.m0.trade_kpi[mkt];
        const p1 = out.m1.trade_kpi[mkt];
        const p2 = out.m2.trade_kpi[mkt];

        const r = rolling3([{ trade_kpi: p0 }, { trade_kpi: p1 }, { trade_kpi: p2 }]);
        rolling_3m[mkt] = r;

        const rv = rollingValidity(r, 20, 2);
        validity[`monthly_rolling_${mkt}`] = rv;

        delta_m0_vs_rolling[mkt] = rv.rolling_valid ? calcDelta(p0, r) : { win_rate_delta: null, ev_delta: null, score_delta: null };
      }

      periods.monthly_3m = out;
      rolling.rolling_3m = rolling_3m;
      delta.delta_m0_vs_rolling = delta_m0_vs_rolling;

      validity.monthly_m0_valid = out.m0.period_valid;
      validity.monthly_m1_valid = out.m1.period_valid;
      validity.monthly_m2_valid = out.m2.period_valid;
    }

    const integrity = {
      measurement_unit: "TRADE (reconstructed from new fills)",
      range_counts_based_on: "new fills within [from,to)",
      period_trade_kpi: "reconstructed from exec_bar_close_time_utc_ms within each period",
      validity_rules: [
        "period_valid: period trade n_sum >= 1 (any market)",
        "rolling_valid: valid_periods >= 2 AND n_sum >= 20",
        "delta is null unless rolling_valid",
      ],
      known_limitations: [
        "trade reconstruction v0 treats 'trade close' as position size reaching 0",
        "partial sell does not create a closed trade until flat",
        "qty_pct treated as position fraction; KRW notional available via notional_krw when risk budget is enabled",
      ],
    };

    const aiSettings = (await getAiSettingsForProvider(exchange || "BINANCEFUT", 2000)).data || null;

    const report = {
      meta: {
        generated_at: new Date().toISOString(),
        phase: "PHASE0",
        exchange,
        tf,
        mode: mode || null,
        range: { from, to, from_ms: fromMs, to_ms: toMsVal },
        ai_settings: aiSettings,
        note: "unified report with multi-period (3w/3m) + validity + integrity",
      },
      budget_snapshot,
      markets_expected,
      markets_state,
      kpi_summary,
      kpi_latest_snapshot,
      position_snapshot,
      fills,
      periods,
      rolling: Object.keys(rolling).length ? rolling : null,
      delta: Object.keys(delta).length ? delta : null,
      validity,
      integrity,
    };


    // --- Signals eval pack (GPT fine-tuning) ---
    // - 목적: "돈벌자" 각 신호의 승률/EV 개선을 위한 주간 데이터 제공
    // - 출력: summary(JSON) + rows(JSONL)
    let signals_eval_pack = { ok: false, error: "NOT_BUILT" };
    try {
      const sigLimit = Number(process.env.PACK_SIGNALS_LIMIT || 8000);
      const barsLimit = Number(process.env.PACK_BARS_LIMIT || 20000);
      const horizonBars = SIGNAL_EVAL_HORIZON_BARS;
      const horizonMs = horizonBars * intervalMs;

      // 1) signals (range)
      let signals = [];
      try {
        const sigSnap = await db
          .collection("signals")
          .where("bar_close_time_utc_ms", ">=", fromMs)
          .where("bar_close_time_utc_ms", "<", toMsVal)
          .orderBy("bar_close_time_utc_ms", "asc")
          .limit(sigLimit)
          .get();
        sigSnap.forEach((d) => signals.push(d.data()));
      } catch (qErr) {
        // fallback: 최근 N개에서 range 필터링
        const sigSnap = await db.collection("signals").orderBy("created_at", "desc").limit(sigLimit).get();
        sigSnap.forEach((d) => {
          const s = d.data() || {};
          const ms = Number(s.bar_close_time_utc_ms) || Date.parse(s.bar_close_time_utc || "");
          if (Number.isFinite(ms) && ms >= fromMs && ms < toMsVal) signals.push(s);
        });
        signals.sort((a, b) => (Number(a.bar_close_time_utc_ms) || 0) - (Number(b.bar_close_time_utc_ms) || 0));
      }

      // 2) bars_snapshots (range + horizon)
      const barsSnap = await db.collection("bars_snapshots").orderBy("created_at", "desc").limit(barsLimit).get();
      const bars = [];
      barsSnap.forEach((d) => {
        const b = d.data() || {};
        const ms = Number(b.bar_close_time_utc_ms) || Date.parse(b.bar_close_time_utc || "");
        if (!Number.isFinite(ms)) return;
        if (ms < fromMs - intervalMs) return;
        if (ms > toMsVal + horizonMs + intervalMs) return;
        bars.push(b);
      });

      const filteredSignals = signals.filter((s) => {
        const ex = String(s.exchange || "").toUpperCase();
        return !ex || ex === exchange;
      });
      const filteredBars = bars.filter((b) => {
        const ex = String(b.exchange || "").toUpperCase();
        return !ex || ex === exchange;
      });
      const { rawRows } = computeSignalEval({
        signals: filteredSignals,
        barsSnapshots: filteredBars,
        horizonBars,
        intervalMs,
        groupKeyFn: (sig, meta) => {
          const ex = String(sig.exchange || exchange || "BINANCEFUT").toUpperCase();
          const sym = String(sig.symbol_or_pair_id || sig.symbol || sig.market || "UNK");
          const signalTf = String(sig.tf || tf);
          return `${ex}__${sym}__${signalTf}__${meta.side}__${meta.group}__${meta.subtype}`;
        },
      });
      const rows = summariseSignalRows({ rawRows });

      signals_eval_pack = {
        ok: true,
        meta: {
          eval_version: SIGNAL_EVAL_VERSION,
          horizon_bars: horizonBars,
          interval_ms: intervalMs,
          generated_at: new Date().toISOString(),
          range: { from_ms: fromMs, to_ms: toMsVal },
          signals_n: filteredSignals.length,
          bars_n: filteredBars.length,
        },
        rows,
        rows_count: rows.length,
        raw_rows_count: rawRows.length,
        // raw rows는 zip에 JSONL로 별도 저장(메모리/가독성 개선)
        raw_rows_jsonl: rawRows.map((r) => JSON.stringify(r)).join("\n"),
      };
    } catch (e) {
      signals_eval_pack = { ok: false, error: "SIGNAL_EVAL_PACK_FAILED", message: String(e && e.message ? e.message : e) };
    }


      const frozen_kpi = {
        schema_version: SCHEMA_VERSION,
        signal_eval_version: SIGNAL_EVAL_VERSION,
        signal_eval_horizon_bars: SIGNAL_EVAL_HORIZON_BARS,
        bar_interval_ms_60m: intervalMs,
        bar_interval_ms: intervalMs,
        bar_interval_tf: tf,
        min_n: SIGNAL_KPI_MIN_N,
        min_eval_n: SIGNAL_KPI_MIN_EVAL_N,
        keep_wr: SIGNAL_KPI_KEEP_WR,
        keep_ev: SIGNAL_KPI_KEEP_EV,
        drop_wr: SIGNAL_KPI_DROP_WR,
        drop_ev: SIGNAL_KPI_DROP_EV,
        hard_streak: SIGNAL_KPI_HARD_STREAK,
      };

      let eval_weekly = null;
      if (week) {
        try {
          const d = await db.collection("eval_weekly").doc(evalDocId(exchange, week)).get();
          if (d.exists) {
            const data = d.data() || {};
            if (matchesEvalTf(data, tf)) eval_weekly = { id: d.id, ...data };
          }
        } catch (_) {
          // ignore
        }
      }

      let filters_drop_for_week = null;
      if (week) {
        try {
          const q = await db.collection("filters_drop").where("eval_id", "==", `${exchange}__${week}`).get();
          filters_drop_for_week = q.docs
            .map((x) => ({ id: x.id, ...x.data() }))
            .filter((x) => String(x.exchange || "").toUpperCase() === normalizeExchange(exchange));
        } catch (_) {
          // ignore
        }
      }

      let filters_drop_current = null;
      try {
        const q = await db.collection("filters_drop").orderBy("updated_at", "desc").limit(500).get();
        filters_drop_current = q.docs
          .map((x) => ({ id: x.id, ...x.data() }))
          .filter((x) => String(x.exchange || "").toUpperCase() === normalizeExchange(exchange));
      } catch (_) {
        // ignore
      }

      const zip = new JSZip();
      const __fills = (report && Array.isArray(report.fills)) ? report.fills : [];
  const budgetSnap = (report && report.budget_snapshot) ? report.budget_snapshot : null;
  const signal_rows_exec = __fills.map((f, idx) => {
    const ms = (typeof f.exec_bar_close_time_utc_ms === "number") ? f.exec_bar_close_time_utc_ms : null;
    const reason = (f.signal_reason === null || f.signal_reason === undefined) ? "" : String(f.signal_reason);
    const subtype = reason ? String(reason.split("|")[0].split(":")[0]).trim() : "";
    const ret =
      (typeof f.realized_pnl_pct === "number") ? f.realized_pnl_pct :
      (typeof f.pnl_pct === "number") ? f.pnl_pct :
      null;

    const market = f.market || f.symbol || "UNK";
    const msStr = (ms === null) ? "" : String(ms);
    const signal_id = f.signal_id || f.snapshot_id || f.order_id || (market + "__" + msStr + "__" + String(idx));

    return {
      signal_id,
      market,
      side: f.side || null,
      exec_bar_close_time_utc_ms: ms,
      exec_price_source: f.exec_price_source || null,
      budget_total_max_krw: (budgetSnap && budgetSnap.total_max_krw != null) ? budgetSnap.total_max_krw : null,
      budget_total_used_krw: (budgetSnap && budgetSnap.total_used_krw != null) ? budgetSnap.total_used_krw : null,
      budget_total_used_pct: (budgetSnap && budgetSnap.total_used_pct != null) ? budgetSnap.total_used_pct : null,
      signal_strength: (f.signal_strength === undefined ? null : f.signal_strength),
      signal_reason: f.signal_reason || null,
      drop_reason: null,
      drop_reason_code: null,
      subtype: subtype || null,
      regime: resolveRegimeRecord({ features_json: f, regime: f.regime, market_regime: f.market_regime }),
      keep: 1,
      drop: 0,
      ret,
      pnl_quote: (f.pnl_quote === undefined ? null : f.pnl_quote),
      realized_pnl_quote: (f.realized_pnl_quote === undefined ? null : f.realized_pnl_quote),
      run_id: f.run_id || null,
      snapshot_id: f.snapshot_id || null,
      order_id: f.order_id || null,
      mode: f.mode || null
    };
  });

  const signal_rows_drop = signalDrops.map((d, idx) => {
    const ms = Number(d.bar_close_time_utc_ms) || null;
    const dropReason = d.reason ? String(d.reason) : null;
    const dropCode = d.drop_reason_code ? String(d.drop_reason_code) : (dropReason || "DROP_FILTER");
    const subtype = String(d.event || "").toUpperCase() || "DROP";
    const signalId = d.signal_id || d.doc_id || (`DROP__${String(d.market || "UNK")}__${String(ms || "")}__${String(idx)}`);
    return {
      signal_id: signalId,
      market: d.market || d.symbol || "UNK",
      side: d.side || null,
      exec_bar_close_time_utc_ms: ms,
      exec_price_source: null,
      budget_total_max_krw: (budgetSnap && budgetSnap.total_max_krw != null) ? budgetSnap.total_max_krw : null,
      budget_total_used_krw: (budgetSnap && budgetSnap.total_used_krw != null) ? budgetSnap.total_used_krw : null,
      budget_total_used_pct: (budgetSnap && budgetSnap.total_used_pct != null) ? budgetSnap.total_used_pct : null,
      signal_strength: null,
      signal_reason: dropReason,
      drop_reason: dropReason,
      drop_reason_code: dropCode,
      subtype,
      regime: resolveRegimeRecord(d),
      keep: 0,
      drop: 1,
      ret: null,
      pnl_quote: null,
      realized_pnl_quote: null,
      run_id: d.features_json && d.features_json.run_id ? d.features_json.run_id : null,
      snapshot_id: null,
      order_id: null,
      mode: null,
      event_intent: d.event_intent || null,
      event: d.event || null,
    };
  });

  const signal_rows = [...signal_rows_exec, ...signal_rows_drop]
    .sort((a, b) => {
      const ams = Number(a.exec_bar_close_time_utc_ms || 0);
      const bms = Number(b.exec_bar_close_time_utc_ms || 0);
      if (ams !== bms) return ams - bms;
      return Number(a.drop || 0) - Number(b.drop || 0);
    });

  zip.file("signal_rows.json", JSON.stringify({ rows: signal_rows }, null, 2));

  // signals eval (summary + rows)
  const __evalSummary = (signals_eval_pack && typeof signals_eval_pack === "object") ? { ...signals_eval_pack } : { ok: false, error: "NO_EVAL" };
  if (__evalSummary && Object.prototype.hasOwnProperty.call(__evalSummary, "raw_rows_jsonl")) delete __evalSummary.raw_rows_jsonl;
  zip.file("signals_eval_summary.json", JSON.stringify(__evalSummary, null, 2));
  zip.file(
    "signals_eval_rows.jsonl",
    (signals_eval_pack && signals_eval_pack.ok && typeof signals_eval_pack.raw_rows_jsonl === "string") ? signals_eval_pack.raw_rows_jsonl : ""
  );

  zip.file("report.json", JSON.stringify(report, null, 2));
  zip.file("frozen_kpi.json", JSON.stringify(frozen_kpi, null, 2));
  if (eval_weekly) zip.file("eval_weekly.json", JSON.stringify(eval_weekly, null, 2));
  if (filters_drop_for_week) zip.file("filters_drop_week.json", JSON.stringify({ rows: filters_drop_for_week }, null, 2));
  if (filters_drop_current) zip.file("filters_drop_current.json", JSON.stringify({ rows: filters_drop_current }, null, 2));
  zip.file(
    "week_meta.json",
    JSON.stringify(
      {
        week: week || null,
        mode: mode || null,
        exchange,
        tf,
        markets_expected: markets_expected,
        range: {
          from_ms: fromMs,
          to_ms: toMsVal,
          from: new Date(fromMs).toISOString(),
          to: new Date(toMsVal).toISOString(),
        },
        access: { allow_local: __allowLocal, scheduler_ok: __schedOk },
      },
      null,
      2
    )
  );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const filename = `report_pack_v2_${fromMs}_${toMsVal}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "PACK_ERROR", message: e.message });
  }
});

module.exports = router;

// FORCE_LEGACY_FILLS_V4

// FORCE_OK_RANGE_ONLY_V1
