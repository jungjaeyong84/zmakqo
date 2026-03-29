#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  SYMBOLS,
  INTERVAL,
  DAYS_BACK,
  INITIAL_CAPITAL,
  fetchKlines,
  backtest,
  summarizeTrades,
} = require("./tune_v5602_quality");

const BASE = {
  key: "v5603_search_base",
  desc: "v5.6.0.3 strong-long split-exit search",
  earlyLongScoreMin: 20,
  earlyLongTransitionScoreMin: 26,
  disableEarlyLong: false,
  disableEarlyShort: false,
  coreLongScoreMin: 22,
  coreLongPostMin: 0.57,
  longRequireVolOnCore: true,
  longRequireBullHtf: true,
  longTransitionScoreMin: 25,
  longTransitionPostMin: 0.58,
  preRealLongPostMin: 0.59,
  preRealLongScoreMin: 26,
  coreLongMaxK: 72,
  enableBullBreakoutLongPromotion: true,
  bullBreakoutLongPosMin: 0.88,
  bullBreakoutLongKMin: 75,
  bullBreakoutLongVolMin: 0.8,
  bullBreakoutLongPostMin: 0.72,
  earlyShortScoreMin: 18,
  coreShortScoreMin: 18,
  coreShortPostMin: 0.56,
  shortRequireVolOnCore: false,
  shortRequireBearHtf: false,
  shortTransitionScoreMin: 16,
  shortTransitionPostMin: 0.54,
  preRealShortPostMin: 0.57,
  preRealShortScoreMin: 22,
  disableCoreLongFinalOnly: false,
  disableCoreShortFinalOnly: false,
  disablePreRealLong: false,
  disablePreRealShort: false,
  suppressCoreLongTier: false,
  suppressCoreShortTier: false,
  realBlocked: true,
  leverage: 2,
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function emptySignals() { return { EARLY_LONG: 0, EARLY_SHORT: 0, CORE_LONG: 0, CORE_SHORT: 0, PRE_REAL_LONG: 0, PRE_REAL_SHORT: 0, REAL_LONG: 0, REAL_SHORT: 0 }; }
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
    longNet: s.longNet,
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

let seed = 20260306;
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

  sc.earlyLongScoreMin = rint(20, 38);
  sc.earlyLongTransitionScoreMin = Math.max(sc.earlyLongScoreMin, rint(24, 42));
  sc.coreLongScoreMin = rint(20, 40);
  sc.coreLongPostMin = rnum(0.55, 0.90);
  sc.longRequireVolOnCore = pick([true, false]);
  sc.longRequireBullHtf = pick([true, false]);
  sc.longTransitionScoreMin = rint(22, 44);
  sc.longTransitionPostMin = rnum(Math.max(sc.coreLongPostMin, 0.56), 0.92);
  sc.preRealLongScoreMin = rint(Math.max(24, sc.coreLongScoreMin), 48);
  sc.preRealLongPostMin = rnum(Math.max(sc.coreLongPostMin, 0.58), 0.95);
  sc.coreLongMaxK = rint(45, 85);
  sc.enableBullBreakoutLongPromotion = pick([true, false]);
  sc.bullBreakoutLongPosMin = rnum(0.78, 0.96);
  sc.bullBreakoutLongKMin = rint(55, 92);
  sc.bullBreakoutLongVolMin = rnum(0.7, 1.5, 0.05);
  sc.bullBreakoutLongPostMin = rnum(0.62, 0.88);
  sc.longSlPct = rnum(0.7, 2.5, 0.05);
  sc.longTpPct = rnum(0.8, 3.5, 0.05);
  sc.longTrailPct = rnum(0.2, 1.5, 0.05);
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

  sc.earlyShortScoreMin = rint(14, 30);
  sc.coreShortScoreMin = rint(14, 34);
  sc.coreShortPostMin = rnum(0.50, 0.90);
  sc.shortRequireVolOnCore = pick([true, false]);
  sc.shortRequireBearHtf = pick([true, false]);
  sc.shortTransitionScoreMin = rint(12, 36);
  sc.shortTransitionPostMin = rnum(Math.max(sc.coreShortPostMin - 0.06, 0.50), 0.92);
  sc.preRealShortScoreMin = rint(Math.max(16, sc.coreShortScoreMin), 42);
  sc.preRealShortPostMin = rnum(Math.max(sc.coreShortPostMin, 0.53), 0.95);
  sc.shortSlPct = rnum(0.7, 2.5, 0.05);
  sc.shortTpPct = rnum(0.8, 3.5, 0.05);
  sc.shortTrailPct = rnum(0.2, 1.5, 0.05);
  return sc;
}

function isStrongLong(metrics) {
  return metrics.trades >= 8 && metrics.winRate >= 0.50 && metrics.netPnl > 0 && ((Number.isFinite(metrics.pf) && metrics.pf >= 1.2) || metrics.netPnl >= 500);
}

function isGoodShort(metrics) {
  return metrics.trades >= 8 && metrics.winRate >= 0.50 && metrics.netPnl > 0;
}

function keepTop(arr, row, limit, cmp) {
  arr.push(row);
  arr.sort(cmp);
  if (arr.length > limit) arr.length = limit;
}

function descByNet(a, b) {
  if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
  if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
  return b.metrics.trades - a.metrics.trades;
}

function compactLong(sc) {
  return {
    disableEarlyLong: !!sc.disableEarlyLong,
    disableCoreLongFinalOnly: !!sc.disableCoreLongFinalOnly,
    disablePreRealLong: !!sc.disablePreRealLong,
    suppressCoreLongTier: !!sc.suppressCoreLongTier,
    earlyLongScoreMin: sc.earlyLongScoreMin,
    earlyLongTransitionScoreMin: sc.earlyLongTransitionScoreMin,
    coreLongScoreMin: sc.coreLongScoreMin,
    coreLongPostMin: sc.coreLongPostMin,
    longRequireVolOnCore: !!sc.longRequireVolOnCore,
    longRequireBullHtf: !!sc.longRequireBullHtf,
    longTransitionScoreMin: sc.longTransitionScoreMin,
    longTransitionPostMin: sc.longTransitionPostMin,
    preRealLongScoreMin: sc.preRealLongScoreMin,
    preRealLongPostMin: sc.preRealLongPostMin,
    coreLongMaxK: sc.coreLongMaxK,
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
  Object.assign(sc, longSc, shortSc, {
    key: `combo__${longSc.key}__${shortSc.key}`,
  });
  sc.disableEarlyShort = !!shortSc.disableEarlyShort;
  sc.disableCoreShortFinalOnly = !!shortSc.disableCoreShortFinalOnly;
  sc.disablePreRealShort = !!shortSc.disablePreRealShort;
  sc.suppressCoreShortTier = !!shortSc.suppressCoreShortTier;
  sc.disableEarlyLong = !!longSc.disableEarlyLong;
  sc.disableCoreLongFinalOnly = !!longSc.disableCoreLongFinalOnly;
  sc.disablePreRealLong = !!longSc.disablePreRealLong;
  sc.suppressCoreLongTier = !!longSc.suppressCoreLongTier;
  return sc;
}

async function main() {
  const market = await loadMarket();

  const longHits = [];
  const shortHits = [];
  let bestLong = null;
  let bestShort = null;

  const longSamples = 12000;
  const shortSamples = 8000;

  for (let i = 0; i < longSamples; i += 1) {
    const sc = buildLongCandidate(i);
    const result = runScenario(market, sc);
    const metrics = sideSummary(result, "LONG");
    if (!bestLong || metrics.winRate > bestLong.metrics.winRate || (metrics.winRate === bestLong.metrics.winRate && metrics.netPnl > bestLong.metrics.netPnl)) {
      bestLong = { scenario: compactLong(sc), metrics };
    }
    if (isStrongLong(metrics)) keepTop(longHits, { scenario: compactLong(sc), metrics }, 50, descByNet);
  }

  for (let i = 0; i < shortSamples; i += 1) {
    const sc = buildShortCandidate(i);
    const result = runScenario(market, sc);
    const metrics = sideSummary(result, "SHORT");
    if (!bestShort || metrics.winRate > bestShort.metrics.winRate || (metrics.winRate === bestShort.metrics.winRate && metrics.netPnl > bestShort.metrics.netPnl)) {
      bestShort = { scenario: compactShort(sc), metrics };
    }
    if (isGoodShort(metrics)) keepTop(shortHits, { scenario: compactShort(sc), metrics }, 50, descByNet);
  }

  const comboHits = [];
  const topLong = longHits.slice(0, 20);
  const topShort = shortHits.slice(0, 20);
  for (const l of topLong) {
    for (const s of topShort) {
      const sc = mergeScenario(l.scenario, s.scenario);
      const result = runScenario(market, sc);
      const longMetrics = sideSummary(result, "LONG");
      const shortMetrics = sideSummary(result, "SHORT");
      if (isStrongLong(longMetrics) && isGoodShort(shortMetrics) && result.metrics.netPnl > 0) {
        keepTop(comboHits, {
          scenario: { long: l.scenario, short: s.scenario },
          metrics: result.metrics,
          longMetrics,
          shortMetrics,
        }, 50, (a, b) => {
          if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
          if (b.longMetrics.netPnl !== a.longMetrics.netPnl) return b.longMetrics.netPnl - a.longMetrics.netPnl;
          return b.shortMetrics.netPnl - a.shortMetrics.netPnl;
        });
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    market: {
      symbols: SYMBOLS,
      interval: INTERVAL,
      days_back: DAYS_BACK,
      capital_usd: INITIAL_CAPITAL,
    },
    targets: {
      long: "winRate >= 50% and net > 0 and (pf >= 1.2 or net >= 500)",
      short: "winRate >= 50% and net > 0",
      combo: "both side targets + total net > 0",
    },
    search_space: {
      long_samples: longSamples,
      short_samples: shortSamples,
      exact_combo_tests: topLong.length * topShort.length,
    },
    best_long_observed: bestLong,
    best_short_observed: bestShort,
    long_hits: longHits,
    short_hits: shortHits,
    combo_hits: comboHits,
  };

  const outDir = "/Users/jeongjaeyong/Projects/donbeolja/ops/analysis";
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "strong_long_split_exit_search.json");
  const mdPath = path.join(outDir, "strong_long_split_exit_search.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push("# Strong Long Split Exit Search");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- long_samples: ${longSamples}`);
  lines.push(`- short_samples: ${shortSamples}`);
  lines.push(`- exact_combo_tests: ${topLong.length * topShort.length}`);
  lines.push(`- long_target: ${report.targets.long}`);
  lines.push(`- short_target: ${report.targets.short}`);
  lines.push("");
  lines.push("## Best Long Observed");
  lines.push(bestLong ? `- win=${(bestLong.metrics.winRate * 100).toFixed(2)}% net=${bestLong.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(bestLong.metrics.pf) ? bestLong.metrics.pf.toFixed(2) : "INF"} trades=${bestLong.metrics.trades} scenario=${JSON.stringify(bestLong.scenario)}` : "- none");
  lines.push("");
  lines.push("## Best Short Observed");
  lines.push(bestShort ? `- win=${(bestShort.metrics.winRate * 100).toFixed(2)}% net=${bestShort.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(bestShort.metrics.pf) ? bestShort.metrics.pf.toFixed(2) : "INF"} trades=${bestShort.metrics.trades} scenario=${JSON.stringify(bestShort.scenario)}` : "- none");
  lines.push("");
  lines.push("## Long Hits");
  if (!longHits.length) lines.push("- none");
  else for (const row of longHits.slice(0, 15)) lines.push(`- win=${(row.metrics.winRate * 100).toFixed(2)}% net=${row.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(row.metrics.pf) ? row.metrics.pf.toFixed(2) : "INF"} trades=${row.metrics.trades} scenario=${JSON.stringify(row.scenario)}`);
  lines.push("");
  lines.push("## Short Hits");
  if (!shortHits.length) lines.push("- none");
  else for (const row of shortHits.slice(0, 15)) lines.push(`- win=${(row.metrics.winRate * 100).toFixed(2)}% net=${row.metrics.netPnl.toFixed(2)} pf=${Number.isFinite(row.metrics.pf) ? row.metrics.pf.toFixed(2) : "INF"} trades=${row.metrics.trades} scenario=${JSON.stringify(row.scenario)}`);
  lines.push("");
  lines.push("## Combo Hits");
  if (!comboHits.length) lines.push("- none");
  else for (const row of comboHits.slice(0, 15)) {
    lines.push(`- total_net=${row.metrics.netPnl.toFixed(2)} total_win=${(row.metrics.winRate * 100).toFixed(2)}% long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% short_win=${(row.shortMetrics.winRate * 100).toFixed(2)}%`);
    lines.push(`  long_net=${row.longMetrics.netPnl.toFixed(2)} long_pf=${Number.isFinite(row.longMetrics.pf) ? row.longMetrics.pf.toFixed(2) : "INF"} long_trades=${row.longMetrics.trades}`);
    lines.push(`  short_net=${row.shortMetrics.netPnl.toFixed(2)} short_pf=${Number.isFinite(row.shortMetrics.pf) ? row.shortMetrics.pf.toFixed(2) : "INF"} short_trades=${row.shortMetrics.trades}`);
    lines.push(`  long=${JSON.stringify(row.scenario.long)}`);
    lines.push(`  short=${JSON.stringify(row.scenario.short)}`);
  }
  fs.writeFileSync(mdPath, lines.join("\n"));

  console.log(`saved: ${jsonPath}`);
  console.log(`saved: ${mdPath}`);
  console.log(`long_hits=${longHits.length} short_hits=${shortHits.length} combo_hits=${comboHits.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
