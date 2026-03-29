function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

function maxDrawdown(pnls) {
  let equity = 1.0;
  let peak = 1.0;
  let mdd = 0.0;
  for (const r of pnls) {
    equity *= (1.0 + r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

function tailRisk(pnls, q=0.05) {
  if (!pnls.length) return { worst: null, avg_worst_q: null };
  const sorted = [...pnls].sort((a,b)=>a-b);
  const worst = sorted[0];
  const k = Math.max(1, Math.floor(sorted.length * q));
  const avg = sorted.slice(0,k).reduce((a,b)=>a+b,0)/k;
  return { worst, avg_worst_q: avg };
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

const { getActiveParamSet } = require("../config/paramSets");

function calcKpi({ tradePnls, rollingN=100 } = {}) {
  tradePnls = Array.isArray(tradePnls) ? tradePnls : [];
  const pnls = tradePnls.slice(-rollingN);
  const n = pnls.length;

  if (n < rollingN) {
    return {
      status: "INCONCLUSIVE",
      n,
      rollingN,
      win_rate: null,
      ev: null,
      mdd: null,
      quality_score: null,
      zones: { L:0, A:0, B:0, C:0 },
      tail: { worst: null, avg_worst_q: null },
    };
  }

  const wins = pnls.filter(x=>x>0).length;
  const losses = n - wins;
  const winRate = wins / n;
  const ev = mean(pnls);
  const mdd = maxDrawdown(pnls);
  const tail = tailRisk(pnls, 0.05);

  const zones = { L:0, A:0, B:0, C:0 };
  let score = 0;
  for (const r of pnls) {
    const z = zoneOf(r);
    zones[z] += 1;
    score += scoreOfZone(z);
  }

  // B2_V1: KPI status thresholds + minimum sample size (env-driven)
  const minN = Number(process.env.KPI_MIN_N || 20);
  const thrGreen = Number(process.env.KPI_GREEN_WINRATE || 0.70);
  const thrYellow = Number(process.env.KPI_YELLOW_WINRATE || 0.60);

  let status = "INCONCLUSIVE";
  if (n >= minN) {
    status = "GREEN";
    if (winRate < thrYellow) status = "RED";
    else if (winRate < thrGreen) status = "YELLOW";
  }

  return {
    status,
    n,
    rollingN,
    wins,
    losses,
    win_rate: winRate,
    ev,
    mdd,
    quality_score: score,
    zones,
    tail,
  };
}

module.exports = { calcKpi };
