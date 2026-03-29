#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  SYMBOLS,
  INTERVAL,
  DAYS_BACK,
  fetchKlines,
  backtest,
  summarizeTrades,
} = require("./tune_v5602_quality");

const BASE = {
  key: "v5602_current_base",
  desc: "v5.6.0.2 approx base with current exits",
  earlyLongScoreMin: 18,
  earlyLongTransitionScoreMin: 18,
  earlyLongRequireBullHtf: false,
  earlyLongMinVol: null,
  earlyLongRangeScoreMin: null,
  disableEarlyLong: false,
  disableEarlyShort: false,
  coreLongScoreMin: 33,
  coreLongPostMin: 0.57,
  longRequireVolOnCore: false,
  longRequireBullHtf: false,
  longTransitionScoreMin: 33,
  longTransitionPostMin: 0.57,
  longRequirePullbackTouchOnCore: false,
  longRequirePrevPullbackTouchOnCore: false,
  preRealLongScoreMin: 34,
  preRealLongPostMin: 0.68,
  preRealLongRequirePullbackTouch: false,
  preRealLongRequirePrevPullbackTouch: false,
  preRealLongRequireCloseResume: false,
  preRealLongMaxK: null,
  preRealLongMaxPosPct: null,
  enableBullBreakoutLongPromotion: false,
  bullBreakoutLongPosMin: 0.93,
  bullBreakoutLongKMin: 85,
  bullBreakoutLongVolMin: 1.0,
  bullBreakoutLongPostMin: 0.72,
  coreLongMaxK: null,
  coreLongMaxPosPct: null,
  earlyShortScoreMin: 18,
  coreShortScoreMin: 33,
  coreShortPostMin: 0.57,
  shortRequireVolOnCore: false,
  shortRequireBearHtf: false,
  shortTransitionScoreMin: 33,
  shortTransitionPostMin: 0.57,
  preRealShortScoreMin: 34,
  preRealShortPostMin: 0.64,
  disableCoreLong: false,
  disableCoreLongFinalOnly: false,
  disableCoreShortFinalOnly: false,
  disablePreRealLong: false,
  disablePreRealShort: false,
  suppressCoreLongTier: false,
  suppressCoreShortTier: false,
  realBlocked: true,
  leverage: 2,
  slPct: 1.65,
  tpPct: 3.25,
  trailPct: 1.0,
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function emptySignals() {
  return {
    EARLY_LONG: 0,
    EARLY_SHORT: 0,
    CORE_LONG: 0,
    CORE_SHORT: 0,
    PRE_REAL_LONG: 0,
    PRE_REAL_SHORT: 0,
    REAL_LONG: 0,
    REAL_SHORT: 0,
  };
}

function summarizeCombo(trades, signals) {
  const s = summarizeTrades(trades, signals);
  return {
    trades: s.trades,
    signals: s.signals,
    winRate: s.winRate,
    netPnl: s.netPnl,
    retPct: s.retPct,
    pf: s.pf,
    mddPct: s.mddPct,
    longTrades: s.longTrades,
    longNet: s.longNet,
    shortTrades: s.shortTrades,
    shortNet: s.shortNet,
  };
}

function sideSummary(result, side) {
  const sideTrades = result.trades.filter((t) => t.side === side);
  const sideSignals = emptySignals();
  for (const [k, v] of Object.entries(result.signals)) {
    if (k.endsWith(`_${side}`)) sideSignals[k] = v;
  }
  return summarizeCombo(sideTrades, sideSignals);
}

function runScenario(market, sc) {
  let allTrades = [];
  const signals = emptySignals();
  for (const symbol of SYMBOLS) {
    const { trades, signalCounts } = backtest(market.get(symbol), symbol, sc);
    allTrades = allTrades.concat(trades);
    for (const [k, v] of Object.entries(signalCounts)) signals[k] += v;
  }
  return { metrics: summarizeCombo(allTrades, signals), signals, trades: allTrades };
}

async function loadMarket() {
  const limit = Math.min(DAYS_BACK * 24, 1500);
  const market = new Map();
  for (const symbol of SYMBOLS) {
    process.stdout.write(`${symbol} fetch... `);
    const candles = await fetchKlines(symbol, INTERVAL, limit);
    console.log(`${candles.length} bars`);
    market.set(symbol, candles);
  }
  return market;
}

let seed = 20260309;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function rint(a, b) { return Math.floor(a + rnd() * (b - a + 1)); }
function rnum(a, b, step = 0.01) {
  const n = Math.round((a + rnd() * (b - a)) / step) * step;
  return Math.round(n * 100) / 100;
}

function compactLong(sc) {
  return {
    disableEarlyLong: !!sc.disableEarlyLong,
    disableCoreLongFinalOnly: !!sc.disableCoreLongFinalOnly,
    disablePreRealLong: !!sc.disablePreRealLong,
    suppressCoreLongTier: !!sc.suppressCoreLongTier,
    earlyLongScoreMin: sc.earlyLongScoreMin,
    earlyLongTransitionScoreMin: sc.earlyLongTransitionScoreMin,
    earlyLongRequireBullHtf: !!sc.earlyLongRequireBullHtf,
    earlyLongMinVol: sc.earlyLongMinVol,
    earlyLongRangeScoreMin: sc.earlyLongRangeScoreMin,
    coreLongScoreMin: sc.coreLongScoreMin,
    coreLongPostMin: sc.coreLongPostMin,
    longRequireVolOnCore: !!sc.longRequireVolOnCore,
    longRequireBullHtf: !!sc.longRequireBullHtf,
    longTransitionScoreMin: sc.longTransitionScoreMin,
    longTransitionPostMin: sc.longTransitionPostMin,
    longRequirePullbackTouchOnCore: !!sc.longRequirePullbackTouchOnCore,
    longRequirePrevPullbackTouchOnCore: !!sc.longRequirePrevPullbackTouchOnCore,
    preRealLongScoreMin: sc.preRealLongScoreMin,
    preRealLongPostMin: sc.preRealLongPostMin,
    preRealLongRequirePullbackTouch: !!sc.preRealLongRequirePullbackTouch,
    preRealLongRequirePrevPullbackTouch: !!sc.preRealLongRequirePrevPullbackTouch,
    preRealLongRequireCloseResume: !!sc.preRealLongRequireCloseResume,
    preRealLongMaxK: sc.preRealLongMaxK,
    preRealLongMaxPosPct: sc.preRealLongMaxPosPct,
    coreLongMaxK: sc.coreLongMaxK,
    coreLongMaxPosPct: sc.coreLongMaxPosPct,
    enableBullBreakoutLongPromotion: !!sc.enableBullBreakoutLongPromotion,
    bullBreakoutLongPosMin: sc.bullBreakoutLongPosMin,
    bullBreakoutLongKMin: sc.bullBreakoutLongKMin,
    bullBreakoutLongVolMin: sc.bullBreakoutLongVolMin,
    bullBreakoutLongPostMin: sc.bullBreakoutLongPostMin,
    longSlPct: sc.longSlPct,
    longTpPct: sc.longTpPct,
    longTrailPct: sc.longTrailPct,
  };
}

function compactShort(sc) {
  return {
    disableEarlyShort: !!sc.disableEarlyShort,
    disableCoreShortFinalOnly: !!sc.disableCoreShortFinalOnly,
    disablePreRealShort: !!sc.disablePreRealShort,
    suppressCoreShortTier: !!sc.suppressCoreShortTier,
    earlyShortScoreMin: sc.earlyShortScoreMin,
    coreShortScoreMin: sc.coreShortScoreMin,
    coreShortPostMin: sc.coreShortPostMin,
    shortRequireVolOnCore: !!sc.shortRequireVolOnCore,
    shortRequireBearHtf: !!sc.shortRequireBearHtf,
    shortTransitionScoreMin: sc.shortTransitionScoreMin,
    shortTransitionPostMin: sc.shortTransitionPostMin,
    preRealShortScoreMin: sc.preRealShortScoreMin,
    preRealShortPostMin: sc.preRealShortPostMin,
    shortSlPct: sc.shortSlPct,
    shortTpPct: sc.shortTpPct,
    shortTrailPct: sc.shortTrailPct,
  };
}

function mergeScenario(longSc, shortSc) {
  const sc = clone(BASE);
  Object.assign(sc, longSc, shortSc, { key: `combo__${longSc.key}__${shortSc.key}` });
  return sc;
}

function longScore(metrics) {
  if (metrics.trades < 8) return -Infinity;
  const pfTerm = Number.isFinite(metrics.pf) ? metrics.pf * 180 : 300;
  return (metrics.netPnl * 1.0) + (metrics.winRate * 1600) + pfTerm - (metrics.mddPct * 20);
}

function shortScore(metrics) {
  if (metrics.trades < 8) return -Infinity;
  const pfTerm = Number.isFinite(metrics.pf) ? metrics.pf * 140 : 250;
  return (metrics.netPnl * 1.0) + (metrics.winRate * 1200) + pfTerm - (metrics.mddPct * 12);
}

function overallScore(metrics, longMetrics, shortMetrics) {
  const totalPf = Number.isFinite(metrics.pf) ? metrics.pf * 300 : 500;
  const longPf = Number.isFinite(longMetrics.pf) ? longMetrics.pf * 240 : 400;
  const shortPf = Number.isFinite(shortMetrics.pf) ? shortMetrics.pf * 120 : 200;
  return (metrics.netPnl * 1.0)
    + (metrics.winRate * 2200)
    + totalPf + longPf + shortPf
    - (metrics.mddPct * 30);
}

function keepTop(arr, row, limit, cmp) {
  arr.push(row);
  arr.sort(cmp);
  if (arr.length > limit) arr.length = limit;
}

function descByLong(a, b) {
  if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
  if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
  const bpf = Number.isFinite(b.metrics.pf) ? b.metrics.pf : 999;
  const apf = Number.isFinite(a.metrics.pf) ? a.metrics.pf : 999;
  return bpf - apf;
}

function descByShort(a, b) {
  if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
  if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
  const bpf = Number.isFinite(b.metrics.pf) ? b.metrics.pf : 999;
  const apf = Number.isFinite(a.metrics.pf) ? a.metrics.pf : 999;
  return bpf - apf;
}

function descByCombo(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
  if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
  return b.longMetrics.netPnl - a.longMetrics.netPnl;
}

function buildLongCandidate(i) {
  const sc = clone(BASE);
  sc.key = `long_${i}`;
  sc.disableEarlyShort = true;
  sc.disableCoreShortFinalOnly = true;
  sc.disablePreRealShort = true;

  const family = pick(["full", "core_pre", "early_core", "core_only", "pre_only", "early_only"]);
  if (family === "core_pre") sc.disableEarlyLong = true;
  if (family === "early_core") sc.disablePreRealLong = true;
  if (family === "core_only") {
    sc.disableEarlyLong = true;
    sc.disablePreRealLong = true;
  }
  if (family === "pre_only") {
    sc.disableEarlyLong = true;
    sc.suppressCoreLongTier = true;
  }
  if (family === "early_only") {
    sc.disableCoreLongFinalOnly = true;
    sc.disablePreRealLong = true;
  }

  sc.earlyLongScoreMin = rint(14, 34);
  sc.earlyLongTransitionScoreMin = Math.max(sc.earlyLongScoreMin, rint(sc.earlyLongScoreMin, 40));
  sc.earlyLongRequireBullHtf = pick([true, false]);
  sc.earlyLongMinVol = pick([null, 0.8, 0.9, 1.0, 1.1]);
  sc.earlyLongRangeScoreMin = pick([null, 18, 20, 22, 24, 26]);
  sc.coreLongScoreMin = rint(20, 44);
  sc.coreLongPostMin = rnum(0.53, 0.86);
  sc.longRequireVolOnCore = pick([true, false]);
  sc.longRequireBullHtf = pick([true, false]);
  sc.longTransitionScoreMin = rint(Math.max(22, sc.coreLongScoreMin), 48);
  sc.longTransitionPostMin = rnum(Math.max(sc.coreLongPostMin, 0.56), 0.92);
  sc.longRequirePullbackTouchOnCore = pick([true, false]);
  sc.longRequirePrevPullbackTouchOnCore = pick([true, false]);
  sc.preRealLongScoreMin = rint(Math.max(26, sc.coreLongScoreMin), 50);
  sc.preRealLongPostMin = rnum(Math.max(sc.coreLongPostMin, 0.60), 0.94);
  sc.preRealLongRequirePullbackTouch = pick([true, false]);
  sc.preRealLongRequirePrevPullbackTouch = pick([true, false]);
  sc.preRealLongRequireCloseResume = pick([true, false]);
  sc.preRealLongMaxK = pick([null, 48, 55, 60, 65, 70, 75]);
  sc.preRealLongMaxPosPct = pick([null, 0.65, 0.70, 0.75, 0.80, 0.85]);
  sc.coreLongMaxK = pick([null, 52, 58, 63, 68, 72, 78]);
  sc.coreLongMaxPosPct = pick([null, 0.70, 0.75, 0.80, 0.85]);
  sc.enableBullBreakoutLongPromotion = pick([true, false]);
  sc.bullBreakoutLongPosMin = rnum(0.80, 0.96);
  sc.bullBreakoutLongKMin = rint(55, 90);
  sc.bullBreakoutLongVolMin = rnum(0.7, 1.4, 0.05);
  sc.bullBreakoutLongPostMin = rnum(0.62, 0.88);
  sc.longSlPct = rnum(0.8, 2.2, 0.05);
  sc.longTpPct = rnum(0.8, 3.6, 0.05);
  sc.longTrailPct = rnum(0.2, 1.2, 0.05);
  return sc;
}

function buildShortCandidate(i) {
  const sc = clone(BASE);
  sc.key = `short_${i}`;
  sc.disableEarlyLong = true;
  sc.disableCoreLongFinalOnly = true;
  sc.disablePreRealLong = true;

  const family = pick(["full", "core_pre", "early_core", "core_only", "pre_only", "early_only"]);
  if (family === "core_pre") sc.disableEarlyShort = true;
  if (family === "early_core") sc.disablePreRealShort = true;
  if (family === "core_only") {
    sc.disableEarlyShort = true;
    sc.disablePreRealShort = true;
  }
  if (family === "pre_only") {
    sc.disableEarlyShort = true;
    sc.suppressCoreShortTier = true;
  }
  if (family === "early_only") {
    sc.disableCoreShortFinalOnly = true;
    sc.disablePreRealShort = true;
  }

  sc.earlyShortScoreMin = rint(14, 28);
  sc.coreShortScoreMin = rint(18, 40);
  sc.coreShortPostMin = rnum(0.50, 0.88);
  sc.shortRequireVolOnCore = pick([true, false]);
  sc.shortRequireBearHtf = pick([true, false]);
  sc.shortTransitionScoreMin = rint(Math.max(18, sc.coreShortScoreMin - 4), 44);
  sc.shortTransitionPostMin = rnum(Math.max(sc.coreShortPostMin, 0.54), 0.95);
  sc.preRealShortScoreMin = rint(Math.max(24, sc.coreShortScoreMin), 46);
  sc.preRealShortPostMin = rnum(Math.max(sc.coreShortPostMin, 0.58), 0.96);
  sc.shortSlPct = rnum(1.0, 2.8, 0.05);
  sc.shortTpPct = rnum(1.8, 4.2, 0.05);
  sc.shortTrailPct = rnum(0.2, 1.0, 0.05);
  return sc;
}

async function main() {
  const market = await loadMarket();
  const baseline = runScenario(market, BASE);
  const baselineLong = sideSummary(baseline, "LONG");
  const baselineShort = sideSummary(baseline, "SHORT");

  const bestLong = [];
  const bestShort = [];
  const longSamples = 14000;
  const shortSamples = 10000;

  for (let i = 0; i < longSamples; i += 1) {
    const sc = buildLongCandidate(i);
    const result = runScenario(market, sc);
    const metrics = sideSummary(result, "LONG");
    if (metrics.trades >= 8 && metrics.netPnl > 0) {
      keepTop(bestLong, { scenario: compactLong(sc), metrics, score: longScore(metrics) }, 80, descByLong);
    }
  }

  for (let i = 0; i < shortSamples; i += 1) {
    const sc = buildShortCandidate(i);
    const result = runScenario(market, sc);
    const metrics = sideSummary(result, "SHORT");
    if (metrics.trades >= 8 && metrics.netPnl > 0) {
      keepTop(bestShort, { scenario: compactShort(sc), metrics, score: shortScore(metrics) }, 80, descByShort);
    }
  }

  const topLong = bestLong.slice(0, 25);
  const topShort = bestShort.slice(0, 25);
  const comboRows = [];

  for (const l of topLong) {
    for (const s of topShort) {
      const sc = mergeScenario(l.scenario, s.scenario);
      const result = runScenario(market, sc);
      const longMetrics = sideSummary(result, "LONG");
      const shortMetrics = sideSummary(result, "SHORT");
      const score = overallScore(result.metrics, longMetrics, shortMetrics);
      comboRows.push({
        score,
        scenario: { long: l.scenario, short: s.scenario },
        metrics: result.metrics,
        longMetrics,
        shortMetrics,
      });
    }
  }

  comboRows.sort(descByCombo);

  const topByNet = [...comboRows].sort((a, b) => b.metrics.netPnl - a.metrics.netPnl).slice(0, 15);
  const topByWin = [...comboRows]
    .filter((x) => x.metrics.netPnl > 0)
    .sort((a, b) => {
      if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
      return b.metrics.netPnl - a.metrics.netPnl;
    })
    .slice(0, 15);
  const topBalanced = comboRows.slice(0, 15);
  const both50Positive = comboRows.filter((x) => x.longMetrics.trades >= 8 && x.shortMetrics.trades >= 8 && x.longMetrics.winRate >= 0.50 && x.shortMetrics.winRate >= 0.50 && x.longMetrics.netPnl > 0 && x.shortMetrics.netPnl > 0 && x.metrics.netPnl > 0);
  const strongLong500 = comboRows.filter((x) => x.longMetrics.netPnl >= 500 && Number.isFinite(x.longMetrics.pf) && x.longMetrics.pf >= 1.2 && x.longMetrics.winRate >= 0.50 && x.shortMetrics.netPnl > 0 && x.metrics.netPnl > 0);

  const report = {
    generated_at: new Date().toISOString(),
    base: BASE,
    search: {
      long_samples: longSamples,
      short_samples: shortSamples,
      exact_combo_tests: topLong.length * topShort.length,
    },
    baseline: {
      overall: baseline.metrics,
      long: baselineLong,
      short: baselineShort,
    },
    top_long: topLong,
    top_short: topShort,
    top_by_net: topByNet,
    top_by_win: topByWin,
    top_balanced: topBalanced,
    both50_positive_count: both50Positive.length,
    both50_positive_top: both50Positive.slice(0, 15),
    strong_long500_count: strongLong500.length,
    strong_long500_top: strongLong500.slice(0, 15),
  };

  const outDir = path.join(process.cwd(), "ops", "analysis");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "v5602_frontier_search.json");
  const mdPath = path.join(outDir, "v5602_frontier_search.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push("# v5.6.0.2 Frontier Search");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- long_samples: ${longSamples}`);
  lines.push(`- short_samples: ${shortSamples}`);
  lines.push(`- exact_combo_tests: ${topLong.length * topShort.length}`);
  lines.push("");
  lines.push("## Baseline");
  lines.push(`- overall: trades=${baseline.metrics.trades} win=${(baseline.metrics.winRate * 100).toFixed(2)}% net=${baseline.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(baseline.metrics.pf) ? baseline.metrics.pf.toFixed(2) : "INF"} mdd=${baseline.metrics.mddPct.toFixed(2)}%`);
  lines.push(`- long: trades=${baselineLong.trades} win=${(baselineLong.winRate * 100).toFixed(2)}% net=${baselineLong.netPnl.toFixed(2)} pf=${Number.isFinite(baselineLong.pf) ? baselineLong.pf.toFixed(2) : "INF"}`);
  lines.push(`- short: trades=${baselineShort.trades} win=${(baselineShort.winRate * 100).toFixed(2)}% net=${baselineShort.netPnl.toFixed(2)} pf=${Number.isFinite(baselineShort.pf) ? baselineShort.pf.toFixed(2) : "INF"}`);
  lines.push("");
  lines.push("## Top By Net");
  for (const row of topByNet.slice(0, 10)) {
    lines.push(`- total_net=${row.metrics.netPnl.toFixed(2)} total_win=${(row.metrics.winRate * 100).toFixed(2)}% pf=${Number.isFinite(row.metrics.pf) ? row.metrics.pf.toFixed(2) : "INF"} mdd=${row.metrics.mddPct.toFixed(2)}%`);
    lines.push(`  long_net=${row.longMetrics.netPnl.toFixed(2)} long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% long_pf=${Number.isFinite(row.longMetrics.pf) ? row.longMetrics.pf.toFixed(2) : "INF"} long_trades=${row.longMetrics.trades}`);
    lines.push(`  short_net=${row.shortMetrics.netPnl.toFixed(2)} short_win=${(row.shortMetrics.winRate * 100).toFixed(2)}% short_pf=${Number.isFinite(row.shortMetrics.pf) ? row.shortMetrics.pf.toFixed(2) : "INF"} short_trades=${row.shortMetrics.trades}`);
    lines.push(`  long=${JSON.stringify(row.scenario.long)}`);
    lines.push(`  short=${JSON.stringify(row.scenario.short)}`);
  }
  lines.push("");
  lines.push("## Top By Win With Positive Net");
  for (const row of topByWin.slice(0, 10)) {
    lines.push(`- total_win=${(row.metrics.winRate * 100).toFixed(2)}% total_net=${row.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(row.metrics.pf) ? row.metrics.pf.toFixed(2) : "INF"} mdd=${row.metrics.mddPct.toFixed(2)}%`);
    lines.push(`  long_net=${row.longMetrics.netPnl.toFixed(2)} long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% long_pf=${Number.isFinite(row.longMetrics.pf) ? row.longMetrics.pf.toFixed(2) : "INF"} long_trades=${row.longMetrics.trades}`);
    lines.push(`  short_net=${row.shortMetrics.netPnl.toFixed(2)} short_win=${(row.shortMetrics.winRate * 100).toFixed(2)}% short_pf=${Number.isFinite(row.shortMetrics.pf) ? row.shortMetrics.pf.toFixed(2) : "INF"} short_trades=${row.shortMetrics.trades}`);
    lines.push(`  long=${JSON.stringify(row.scenario.long)}`);
    lines.push(`  short=${JSON.stringify(row.scenario.short)}`);
  }
  lines.push("");
  lines.push("## Top Balanced");
  for (const row of topBalanced.slice(0, 10)) {
    lines.push(`- score=${row.score.toFixed(2)} total_net=${row.metrics.netPnl.toFixed(2)} total_win=${(row.metrics.winRate * 100).toFixed(2)}% pf=${Number.isFinite(row.metrics.pf) ? row.metrics.pf.toFixed(2) : "INF"} mdd=${row.metrics.mddPct.toFixed(2)}%`);
    lines.push(`  long_net=${row.longMetrics.netPnl.toFixed(2)} long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% long_pf=${Number.isFinite(row.longMetrics.pf) ? row.longMetrics.pf.toFixed(2) : "INF"} long_trades=${row.longMetrics.trades}`);
    lines.push(`  short_net=${row.shortMetrics.netPnl.toFixed(2)} short_win=${(row.shortMetrics.winRate * 100).toFixed(2)}% short_pf=${Number.isFinite(row.shortMetrics.pf) ? row.shortMetrics.pf.toFixed(2) : "INF"} short_trades=${row.shortMetrics.trades}`);
    lines.push(`  long=${JSON.stringify(row.scenario.long)}`);
    lines.push(`  short=${JSON.stringify(row.scenario.short)}`);
  }
  lines.push("");
  lines.push("## Targets");
  lines.push(`- both50_positive_count: ${both50Positive.length}`);
  lines.push(`- strong_long500_count: ${strongLong500.length}`);
  if (strongLong500.length) {
    const row = strongLong500[0];
    lines.push(`- best_strong_long500: total_net=${row.metrics.netPnl.toFixed(2)} long_net=${row.longMetrics.netPnl.toFixed(2)} long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% long_pf=${Number.isFinite(row.longMetrics.pf) ? row.longMetrics.pf.toFixed(2) : "INF"}`);
  }
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);

  console.log(`saved: ${jsonPath}`);
  console.log(`saved: ${mdPath}`);
  console.log(`baseline_net=${baseline.metrics.netPnl.toFixed(2)} baseline_win=${(baseline.metrics.winRate * 100).toFixed(2)}%`);
  console.log(`top_by_net=${topByNet.length} top_by_win=${topByWin.length} top_balanced=${topBalanced.length}`);
  console.log(`both50_positive=${both50Positive.length} strong_long500=${strongLong500.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
