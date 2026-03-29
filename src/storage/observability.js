// src/storage/observability.js
const { getFirestore } = require("./firestore");

async function getRecent(collectionName, orderByField, limitN = 200) {
  const db = getFirestore();
  const snap = await db
    .collection(collectionName)
    .orderBy(orderByField, "desc")
    .limit(limitN)
    .get();

  if (snap.empty) return [];
  return snap.docs.map((d) => d.data());
}

async function getRecentRuns(n = 10) {
  return getRecent("system_runs", "started_at", n);
}

async function getRecentGates(n = 10) {
  return getRecent("gate_events", "created_at", n);
}

async function getRecentSnapshots(n = 10) {
  return getRecent("bars_snapshots", "created_at", n);
}

// bar_close_time_utc_ms 기준으로 유니크 봉 만들기
function uniqueBarsByCloseMs(gates) {
  const map = new Map();
  for (const g of gates || []) {
    const ms = Number(g.bar_close_time_utc_ms);
    if (!Number.isFinite(ms)) continue;
    if (!map.has(ms)) map.set(ms, g);
    else {
      const prev = map.get(ms);
      const prevT = Date.parse(prev.created_at || "") || 0;
      const curT = Date.parse(g.created_at || "") || 0;
      if (curT >= prevT) map.set(ms, g);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, v]) => v);
}

async function getBarWindowCounters({ windowBars = 24, gateFetchN = 500 } = {}) {
  const recentGateDocs = await getRecent("gate_events", "created_at", gateFetchN);
  const uniqueBars = uniqueBarsByCloseMs(recentGateDocs).slice(0, windowBars);

  const bars_total = uniqueBars.length;
  const pass_total = uniqueBars.filter((g) => g.status === "PASS").length;
  const fail_total = uniqueBars.filter((g) => g.status === "FAIL").length;
  const fail_soft = uniqueBars.filter((g) => g.status === "FAIL" && g.severity === "SOFT").length;
  const fail_hard = uniqueBars.filter((g) => g.status === "FAIL" && g.severity === "HARD").length;

  const lags = uniqueBars
    .map((g) => Number(g.metrics_json?.lag_ms))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);

  const p50 = lags.length ? lags[Math.floor(lags.length * 0.50)] : null;
  const p90 = lags.length ? lags[Math.floor(lags.length * 0.90)] : null;
  const max = lags.length ? lags[lags.length - 1] : null;

  return {
    window_bars: windowBars,
    bars_total,
    pass_total,
    fail_total,
    fail_soft,
    fail_hard,
    lag_ms_p50: p50,
    lag_ms_p90: p90,
    lag_ms_max: max,
  };
}

// 최근 run 중 paper 메타가 있는 run 1개(가장 최근) 찾기
async function getLatestPaperRun({ lookbackN = 300 } = {}) {
  const runs = await getRecent("system_runs", "started_at", lookbackN);
  for (const r of runs) {
    if (r?.meta?.paper && (r.meta.paper.fills_executed !== undefined || r.meta.paper.intents_created !== undefined)) {
      return r;
    }
  }
  return null;
}

module.exports = {
  getRecentRuns,
  getRecentGates,
  getRecentSnapshots,
  getBarWindowCounters,
  getLatestPaperRun,
};
