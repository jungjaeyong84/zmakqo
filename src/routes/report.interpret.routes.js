const express = require("express");
const router = express.Router();

function allowLocalNoOauth() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) return false;
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const allowFlag = String(process.env.ALLOW_LOCAL_NO_OAUTH || "").trim() === "1";
  return allowFlag || !hasGoogle;
}


// report.pack.routes.js의 로직을 재사용하지 않고,
// v0는 "리포트 객체(JSON)를 이미 가지고 있다"는 가정으로 해석만 수행한다.
// 다음 단계에서 실제 report 생성(weekly_3w/monthly_3m 포함)을 이 라우트로 연결한다.

function fmtPct(x) {
  if (typeof x !== "number") return null;
  return Math.round(x * 10000) / 100; // 2dp
}

function summarizeMarket({ market, tradeKpi, verdict, posSnap } = {}) {
  const n = tradeKpi?.n ?? null;
  const wr = tradeKpi?.win_rate ?? null;
  const ev = tradeKpi?.ev ?? null;
  const sc = tradeKpi?.quality_score ?? null;

  const u = posSnap?.unrealized_pnl_pct ?? null;

  return {
    market,
    verdict: verdict?.status ?? "INCONCLUSIVE",
    verdict_reason: verdict?.reason ?? null,

    trade_n: n,
    win_rate_pct: typeof wr === "number" ? fmtPct(wr) : null,
    ev: typeof ev === "number" ? ev : null,
    score: typeof sc === "number" ? sc : null,

    position_state: posSnap?.state ?? null,
    unrealized_pnl_pct: typeof u === "number" ? fmtPct(u) : null,
  };
}

// POST /api/report/interpret
// body: { report: <report.json object> }

// POST /api/report/interpret-token
// header: x-scheduler-token, body: { report: <report.json object> }
router.post("/api/report/interpret-token", async (req, res) => {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok:false, error:"SERVER_MISCONFIG", message:"SCHEDULER_TOKEN not set" });
  if (token !== expected) return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });

  try {
    const report = req.body?.report;
    if (!report || typeof report !== "object") {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "missing report object" });
    }

    const markets = Array.isArray(report.markets_expected) ? report.markets_expected : [];
    const verdictMap = report.verdict || {};
    const tradeKpiMap = report.trade_kpi || {};
    const posArr = Array.isArray(report.position_snapshot) ? report.position_snapshot : [];
    const posByMarket = {};
    for (const p of posArr) posByMarket[p.market] = p;

    const market_summaries = markets.map(m => ({
      market: m,
      verdict: verdictMap[m]?.status ?? "INCONCLUSIVE",
      verdict_reason: verdictMap[m]?.reason ?? null,
      trade_n: tradeKpiMap[m]?.n ?? null,
      win_rate_pct: (typeof tradeKpiMap[m]?.win_rate === "number") ? Math.round(tradeKpiMap[m].win_rate*10000)/100 : null,
      ev: (typeof tradeKpiMap[m]?.ev === "number") ? tradeKpiMap[m].ev : null,
      score: (typeof tradeKpiMap[m]?.quality_score === "number") ? tradeKpiMap[m].quality_score : null,
      position_state: posByMarket[m]?.state ?? null,
      unrealized_pnl_pct: (typeof posByMarket[m]?.unrealized_pnl_pct === "number") ? Math.round(posByMarket[m].unrealized_pnl_pct*10000)/100 : null,
    }));

    const verdict_counts = market_summaries.reduce((acc, x) => {
      acc[x.verdict] = (acc[x.verdict] || 0) + 1;
      return acc;
    }, {});

    const change_gate = market_summaries.map(x => ({
      market: x.market,
      verdict: x.verdict,
      change_allowed: (x.verdict !== "INCONCLUSIVE"),
      reason: (x.verdict !== "INCONCLUSIVE") ? "verdict_available" : "insufficient_sample",
    }));

    return res.json({
      ok: true,
      meta: {
        generated_at: new Date().toISOString(),
        phase: report?.meta?.phase || null,
        mode: report?.meta?.mode || null,
        range: report?.meta?.range || null,
      },
      verdict_counts,
      markets: market_summaries,
      change_gate,
      integrity: report.integrity || null,
      note: "facts-only interpret-token v0",
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"INTERPRET_ERROR", message:e.message });
  }
});


router.post("/api/report/interpret", async (req, res) => {
  try {
    const allowLocal = allowLocalNoOauth();
    if (!allowLocal && (!req.isAuthenticated || !req.isAuthenticated())) {
      return res.redirect("/login");
    }

    const report = req.body?.report;
    if (!report || typeof report !== "object") {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "missing report object" });
    }

    const markets = Array.isArray(report.markets_expected) ? report.markets_expected : [];
    const verdictMap = report.verdict || {}; // 있을 수도/없을 수도
    const tradeKpiMap = report.trade_kpi || {}; // 있을 수도/없을 수도
    const posArr = Array.isArray(report.position_snapshot) ? report.position_snapshot : [];
    const posByMarket = {};
    for (const p of posArr) posByMarket[p.market] = p;

    // 1) 마켓별 요약
    const market_summaries = markets.map(m => summarizeMarket({
      market: m,
      tradeKpi: tradeKpiMap[m],
      verdict: verdictMap[m],
      posSnap: posByMarket[m],
    }));

    // 2) 상태 요약(사실만)
    const verdictCounts = market_summaries.reduce((acc, x) => {
      acc[x.verdict] = (acc[x.verdict] || 0) + 1;
      return acc;
    }, {});

    // 3) 변경 가능/불가 규칙(헌장 기반, 사실만)
    // - 표본 부족(INCONCLUSIVE)면 변경 불가
    // - FAIL이면 변경 필요가 아니라 "문제 확인 필요"로만 표시(조언 금지)
    const change_gate = market_summaries.map(x => {
      const allowed = (x.verdict !== "INCONCLUSIVE");
      return {
        market: x.market,
        verdict: x.verdict,
        change_allowed: allowed,
        reason: allowed ? "verdict_available" : "insufficient_sample",
      };
    });

    return res.json({
      ok: true,
      meta: {
        generated_at: new Date().toISOString(),
        phase: report?.meta?.phase || null,
        mode: report?.meta?.mode || null,
        range: report?.meta?.range || null,
      },
      verdict_counts: verdictCounts,
      markets: market_summaries,
      change_gate,
      integrity: report.integrity || null,
      note: "facts-only interpret v0",
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: "INTERPRET_ERROR", message: e.message });
  }
});

module.exports = router;
