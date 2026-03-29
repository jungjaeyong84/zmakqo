const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { getFirestore } = require("../storage/firestore");
const { buildTradesFromFillsWithFunding } = require("../services/tradesFromFills");
const { calcKpi } = require("../services/kpiCalc");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

function daysAgoIso(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}

function keyOf(rule, symbol, tf, signalType) {
  return `${rule}||${symbol}||${tf}||${signalType}`;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

router.get("/api/report/tier-health", async (req, res) => {
  try {
    const exchange = String(req.query.exchange || "BINANCEFUT").trim().toUpperCase();
    const tf = String(req.query.tf || defaultExecTfFromEnv() || "15m").trim().toLowerCase();
    const refresh = String(req.query.refresh || "0").trim() === "1";
    const root = process.cwd();
    const latestPath = path.join(root, "ops", "daily", "tier_health_latest.json");
    const scriptPath = path.join(root, "scripts", "report-tier-health.js");

    let payload = readJsonSafe(latestPath);
    let source = "file";

    if (refresh || !payload) {
      const out = execFileSync(
        process.execPath,
        [scriptPath, `--exchange=${exchange}`, `--tf=${tf}`, "--windows=24,72"],
        { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
      );
      const parsed = JSON.parse(out);
      payload = parsed && typeof parsed === "object" ? parsed : null;
      source = "recompute";
    }

    if (!payload) {
      return res.status(500).json({ ok: false, error: "TIER_HEALTH_NOT_FOUND", message: "tier health report unavailable" });
    }

    return res.json({
      ok: true,
      source,
      payload,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "TIER_HEALTH_API_ERROR",
      message: err && err.message ? err.message : "unknown",
    });
  }
});

// 운영 요약: 최근 system_runs + gate_events 묶어서 반환
router.get("/report/latest", async (req, res) => {
  try {
    const db = getFirestore();
    const n = Math.min(Math.max(Number(req.query.n || 10), 1), 50);

    const runsSnap = await db
      .collection("system_runs")
      .orderBy("started_at", "desc")
      .limit(n)
      .get();

    const runs = [];
    runsSnap.forEach((doc) => runs.push({ id: doc.id, ...doc.data() }));

    // 최근 run_id 목록
    const runIds = runs
      .map((r) => r.run_id)
      .filter(Boolean)
      .slice(0, n);

    // gate_events는 run_id로 묶어서 최근 것만 추출
    // (Firestore where-in은 10개 제한이 있을 수 있어, n을 10으로 압축)
    const runIdsForGate = runIds.slice(0, 10);

    let gates = [];
    if (runIdsForGate.length > 0) {
      const gatesSnap = await db
        .collection("gate_events")
        .where("run_id", "in", runIdsForGate)
        .get();
      gatesSnap.forEach((doc) => gates.push({ id: doc.id, ...doc.data() }));
    }

    // run_id별 gate 요약
    const gateByRun = {};
    for (const g of gates) {
      const rid = g.run_id || "UNKNOWN";
      if (!gateByRun[rid]) gateByRun[rid] = { pass: 0, fail: 0, none: 0, symbols: [] };

      const st = String(g.status || "").toUpperCase();
      if (st === "PASS") gateByRun[rid].pass += 1;
      else if (st === "FAIL") gateByRun[rid].fail += 1;
      else gateByRun[rid].none += 1;

      if (g.symbol) gateByRun[rid].symbols.push(g.symbol);
    }

    const out = runs.map((r) => {
      const rid = r.run_id || null;
      const g = rid && gateByRun[rid] ? gateByRun[rid] : { pass: 0, fail: 0, none: 0, symbols: [] };
      return {
        run_id: rid,
        status: r.status || null,
        started_at: r.started_at || null,
        ended_at: r.ended_at || null,
        runtime_mode: r.runtime_mode || null,
        engine_version: r.engine_version || null,
        gate_status: r.gate_status || null,
        gate_severity: r.gate_severity || null,
        gates: g,
      };
    });

    res.json({
      ok: true,
      now: new Date().toISOString(),
      n,
      runs: out,
      note: "gate_events는 run_id in(최대 10개) 제한을 고려해 최근 10개 run만 묶어 조회함",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "REPORT_LATEST_ERROR", message: e.message });
  }
});

// 기존 주간 리포트 유지
router.get("/report/weekly", async (req, res) => {
  try {
    const db = getFirestore();
    const exCfg = await getEffectiveExchangesSettings(2000);
    const exchangeParam = String(req.query.exchange || "").trim().toUpperCase();
    const exchange = exchangeParam || String(exCfg.provider || "BINANCEFUT").toUpperCase();
    const since = daysAgoIso(7);
    const sinceMs = toMs(since);

    const snap = await db
      .collection("fills_paper")
      .where("created_at", ">=", since)
      .get();

    const rows = [];
    snap.forEach((doc) => rows.push(doc.data()));

    const fillsForKpi = rows
      .map((r) => ({
        ...r,
        exec_bar_close_time_utc_ms: Number(r.exec_bar_close_time_utc_ms),
        exec_price: Number(r.exec_price),
        qty_pct: Number(r.qty_pct),
      }))
      .filter((r) => {
        const mk = r.symbol || r.symbol_or_pair_id || r.market || "";
        const ex = String(r.exchange || "").toUpperCase();
        const exResolved = ex || inferExchangeFromMarket(mk);
        if (exchange && (!exResolved || exResolved !== exchange)) return false;
        if (!isLiveDocForExchange(exchange, r)) return false;
        const side = String(r.side || "").toUpperCase();
        if (side !== "BUY" && side !== "SELL") return false;
        if (!Number.isFinite(r.exec_bar_close_time_utc_ms)) return false;
        if (!Number.isFinite(r.exec_price)) return false;
        if (!Number.isFinite(r.qty_pct)) return false;
        return true;
      })
      .sort((a, b) => a.exec_bar_close_time_utc_ms - b.exec_bar_close_time_utc_ms);

    const { trades } = await buildTradesFromFillsWithFunding(fillsForKpi, {
      mode: process.env.TRADE_PNL_MODE || "FULL_CLOSE",
      exchange,
    });

    const windowTrades = trades.filter((t) => {
      const ms = Number(t.close_ms);
      if (!Number.isFinite(ms)) return false;
      if (sinceMs !== null && ms < sinceMs) return false;
      return true;
    });

    const tradePnls = windowTrades
      .map((t) => Number(t.pnl_pct))
      .filter((x) => Number.isFinite(x));

    const trade_kpi = tradePnls.length
      ? calcKpi({ tradePnls, rollingN: tradePnls.length })
      : {
          status: "NO_TRADES",
          n: 0,
          rollingN: 0,
          win_rate: null,
          ev: null,
          mdd: null,
          quality_score: null,
          zones: { L: 0, A: 0, B: 0, C: 0 },
          tail: { worst: null, avg_worst_q: null },
        };

    let gate_stats = { n: 0, pass: 0, fail: 0, soft: 0, hard: 0, unknown: 0 };
    try {
      const gatesSnap = await db
        .collection("gate_events")
        .where("created_at", ">=", since)
        .get();
      gatesSnap.forEach((doc) => {
        const g = doc.data() || {};
        const gEx = String(g.exchange || "").toUpperCase();
        const gMk = String(g.market || "");
        const gResolved = gEx || inferExchangeFromMarket(gMk);
        if (exchange && (!gResolved || gResolved !== exchange)) return;
        gate_stats.n += 1;
        const st = String(g.status || "").toUpperCase();
        const sev = String(g.severity || "").toUpperCase();
        if (st === "PASS") gate_stats.pass += 1;
        else if (st === "FAIL") gate_stats.fail += 1;
        else gate_stats.unknown += 1;
        if (sev === "SOFT") gate_stats.soft += 1;
        else if (sev === "HARD") gate_stats.hard += 1;
      });
    } catch (e) {
      gate_stats = { ok: false, error: e.message };
    }

    const agg = new Map();

    for (const r of rows) {
      if (!(r.side === "SELL" && typeof r.net_pnl === "number")) continue;

      const rule = r.rule_id || "UNKNOWN";
      const symbol = r.symbol || "UNKNOWN";
      const tf = r.tf || "UNKNOWN";
      const signalType = r.signal_type || "UNKNOWN";

      const k = keyOf(rule, symbol, tf, signalType);

      if (!agg.has(k)) {
        agg.set(k, {
          rule_id: rule,
          symbol,
          tf,
          signal_type: signalType,
          trades: 0,
          wins: 0,
          losses: 0,
          net_pnl_sum: 0,
          best: null,
          worst: null,
        });
      }
      const a = agg.get(k);

      a.trades += 1;
      a.net_pnl_sum += r.net_pnl;

      if (r.net_pnl >= 0) a.wins += 1;
      else a.losses += 1;

      if (a.best === null || r.net_pnl > a.best) a.best = r.net_pnl;
      if (a.worst === null || r.net_pnl < a.worst) a.worst = r.net_pnl;
    }

    const out = Array.from(agg.values())
      .map((a) => {
        const winrate = a.trades > 0 ? (a.wins / a.trades) : 0;
        const ev = a.trades > 0 ? (a.net_pnl_sum / a.trades) : 0;
        return {
          rule_id: a.rule_id,
          symbol: a.symbol,
          tf: a.tf,
          signal_type: a.signal_type,
          trades: a.trades,
          wins: a.wins,
          losses: a.losses,
          winrate: Number((winrate * 100).toFixed(2)),
          ev_krw: Number(ev.toFixed(2)),
          net_pnl_sum_krw: Number(a.net_pnl_sum.toFixed(2)),
          best_krw: a.best,
          worst_krw: a.worst,
        };
      })
      .sort((x, y) => y.net_pnl_sum_krw - x.net_pnl_sum_krw);

    res.json({
      ok: true,
      exchange,
      window_days: 7,
      since,
      rows: out.length,
      results: out,
      trade_kpi,
      gate_stats,
      canonical_pack: {
        endpoint: "/api/report/pack-v4-plus",
        note: "weekly report canonical source is report pack (v4-plus)",
      },
      note: "trade_kpi는 fills_paper 기반의 기간 내 체결로 계산됨",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "REPORT_ERROR", message: e.message });
  }
});

module.exports = router;
