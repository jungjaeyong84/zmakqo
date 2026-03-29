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
  desc: "v5.6.0.3 search base",
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
  slPct: 1.5,
  tpPct: 3.0,
  trailPct: 1.0,
  leverage: 2,
};

const EXIT_PROFILES = [
  { key: "default", slPct: 1.5, tpPct: 3.0, trailPct: 1.0 },
  { key: "balanced", slPct: 1.25, tpPct: 2.5, trailPct: 0.75 },
  { key: "win50", slPct: 1.0, tpPct: 2.0, trailPct: 0.5 },
  { key: "tight", slPct: 1.0, tpPct: 2.5, trailPct: 0.75 },
];

const LONG_FAMILIES = [
  { key: "full", patch: {} },
  { key: "core_pre", patch: { disableEarlyLong: true } },
  { key: "early_core", patch: { disablePreRealLong: true } },
  { key: "core_only", patch: { disableEarlyLong: true, disablePreRealLong: true } },
  { key: "pre_only", patch: { disableEarlyLong: true, suppressCoreLongTier: true } },
  { key: "early_only", patch: { disableCoreLongFinalOnly: true, disablePreRealLong: true } },
];

const SHORT_FAMILIES = [
  { key: "full", patch: {} },
  { key: "core_pre", patch: { disableEarlyShort: true } },
  { key: "early_core", patch: { disablePreRealShort: true } },
  { key: "core_only", patch: { disableEarlyShort: true, disablePreRealShort: true } },
  { key: "pre_only", patch: { disableEarlyShort: true, suppressCoreShortTier: true } },
  { key: "early_only", patch: { disableCoreShortFinalOnly: true, disablePreRealShort: true } },
];

const LONG_PROFILES = [
  {
    key: "base",
    patch: {},
  },
  {
    key: "medium",
    patch: {
      earlyLongScoreMin: 22,
      earlyLongTransitionScoreMin: 28,
      coreLongScoreMin: 24,
      coreLongPostMin: 0.60,
      longTransitionScoreMin: 27,
      longTransitionPostMin: 0.61,
      preRealLongScoreMin: 28,
      preRealLongPostMin: 0.63,
      coreLongMaxK: 68,
      bullBreakoutLongPosMin: 0.90,
      bullBreakoutLongKMin: 80,
      bullBreakoutLongPostMin: 0.74,
    },
  },
  {
    key: "hard",
    patch: {
      earlyLongScoreMin: 24,
      earlyLongTransitionScoreMin: 30,
      coreLongScoreMin: 26,
      coreLongPostMin: 0.64,
      longTransitionScoreMin: 29,
      longTransitionPostMin: 0.65,
      preRealLongScoreMin: 30,
      preRealLongPostMin: 0.67,
      coreLongMaxK: 64,
      bullBreakoutLongPosMin: 0.92,
      bullBreakoutLongKMin: 85,
      bullBreakoutLongPostMin: 0.76,
    },
  },
];

const SHORT_PROFILES = [
  {
    key: "base",
    patch: {},
  },
  {
    key: "medium",
    patch: {
      earlyShortScoreMin: 20,
      coreShortScoreMin: 20,
      coreShortPostMin: 0.58,
      shortTransitionScoreMin: 18,
      shortTransitionPostMin: 0.56,
      preRealShortScoreMin: 24,
      preRealShortPostMin: 0.60,
      shortRequireBearHtf: true,
    },
  },
  {
    key: "hard",
    patch: {
      earlyShortScoreMin: 22,
      coreShortScoreMin: 22,
      coreShortPostMin: 0.61,
      shortTransitionScoreMin: 20,
      shortTransitionPostMin: 0.59,
      preRealShortScoreMin: 26,
      preRealShortPostMin: 0.63,
      shortRequireBearHtf: true,
    },
  },
];

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

function buildLongMethods() {
  const out = [];
  for (const fam of LONG_FAMILIES) {
    for (const prof of LONG_PROFILES) {
      const sc = clone(BASE);
      Object.assign(sc, fam.patch, prof.patch, {
        key: `LONG__${fam.key}__${prof.key}`,
        disableEarlyShort: true,
        disableCoreShortFinalOnly: true,
        disablePreRealShort: true,
      });
      out.push(sc);
    }
  }
  return out;
}

function buildShortMethods() {
  const out = [];
  for (const fam of SHORT_FAMILIES) {
    for (const prof of SHORT_PROFILES) {
      const sc = clone(BASE);
      Object.assign(sc, fam.patch, prof.patch, {
        key: `SHORT__${fam.key}__${prof.key}`,
        disableEarlyLong: true,
        disableCoreLongFinalOnly: true,
        disablePreRealLong: true,
      });
      out.push(sc);
    }
  }
  return out;
}

function compactLong(sc) {
  return {
    key: sc.key,
    earlyLongScoreMin: sc.earlyLongScoreMin,
    earlyLongTransitionScoreMin: sc.earlyLongTransitionScoreMin,
    coreLongScoreMin: sc.coreLongScoreMin,
    coreLongPostMin: sc.coreLongPostMin,
    longTransitionScoreMin: sc.longTransitionScoreMin,
    longTransitionPostMin: sc.longTransitionPostMin,
    preRealLongScoreMin: sc.preRealLongScoreMin,
    preRealLongPostMin: sc.preRealLongPostMin,
    coreLongMaxK: sc.coreLongMaxK,
    disableEarlyLong: !!sc.disableEarlyLong,
    disableCoreLongFinalOnly: !!sc.disableCoreLongFinalOnly,
    disablePreRealLong: !!sc.disablePreRealLong,
    suppressCoreLongTier: !!sc.suppressCoreLongTier,
    bullBreakoutLongPosMin: sc.bullBreakoutLongPosMin,
    bullBreakoutLongKMin: sc.bullBreakoutLongKMin,
    bullBreakoutLongPostMin: sc.bullBreakoutLongPostMin,
  };
}

function compactShort(sc) {
  return {
    key: sc.key,
    earlyShortScoreMin: sc.earlyShortScoreMin,
    coreShortScoreMin: sc.coreShortScoreMin,
    coreShortPostMin: sc.coreShortPostMin,
    shortTransitionScoreMin: sc.shortTransitionScoreMin,
    shortTransitionPostMin: sc.shortTransitionPostMin,
    preRealShortScoreMin: sc.preRealShortScoreMin,
    preRealShortPostMin: sc.preRealShortPostMin,
    shortRequireBearHtf: !!sc.shortRequireBearHtf,
    disableEarlyShort: !!sc.disableEarlyShort,
    disableCoreShortFinalOnly: !!sc.disableCoreShortFinalOnly,
    disablePreRealShort: !!sc.disablePreRealShort,
    suppressCoreShortTier: !!sc.suppressCoreShortTier,
  };
}

function combine(longSc, shortSc, exit) {
  const sc = clone(BASE);
  Object.assign(sc, {
    key: `COMBO__${longSc.key}__${shortSc.key}__${exit.key}`,
    desc: "combined exact search",
    slPct: exit.slPct,
    tpPct: exit.tpPct,
    trailPct: exit.trailPct,
  });
  for (const k of Object.keys(longSc)) {
    if (k.startsWith("earlyLong") || k.startsWith("coreLong") || k.startsWith("long") || k.startsWith("preRealLong") || k.startsWith("bullBreakoutLong") || ["disableEarlyLong", "disableCoreLongFinalOnly", "disablePreRealLong", "suppressCoreLongTier"].includes(k)) sc[k] = longSc[k];
  }
  for (const k of Object.keys(shortSc)) {
    if (k.startsWith("earlyShort") || k.startsWith("coreShort") || k.startsWith("short") || k.startsWith("preRealShort") || ["disableEarlyShort", "disableCoreShortFinalOnly", "disablePreRealShort", "suppressCoreShortTier"].includes(k)) sc[k] = shortSc[k];
  }
  return sc;
}

function rankHits(rows, metricKey = "netPnl") {
  rows.sort((a, b) => {
    if (b.metrics[metricKey] !== a.metrics[metricKey]) return b.metrics[metricKey] - a.metrics[metricKey];
    if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
    if (b.metrics.trades !== a.metrics.trades) return b.metrics.trades - a.metrics.trades;
    return 0;
  });
}

async function main() {
  const market = await loadMarket();
  const longMethods = buildLongMethods();
  const shortMethods = buildShortMethods();

  const longHits = [];
  for (const method of longMethods) {
    for (const exit of EXIT_PROFILES) {
      const sc = clone(method);
      Object.assign(sc, exit);
      const result = runScenario(market, sc);
      const longMetrics = sideSummary(result, "LONG");
      if (longMetrics.trades >= 8 && longMetrics.winRate >= 0.50 && longMetrics.netPnl > 0) {
        longHits.push({ scenario: sc, metrics: longMetrics, exit });
      }
    }
  }
  rankHits(longHits);

  const shortHits = [];
  for (const method of shortMethods) {
    for (const exit of EXIT_PROFILES) {
      const sc = clone(method);
      Object.assign(sc, exit);
      const result = runScenario(market, sc);
      const shortMetrics = sideSummary(result, "SHORT");
      if (shortMetrics.trades >= 8 && shortMetrics.winRate >= 0.50 && shortMetrics.netPnl > 0) {
        shortHits.push({ scenario: sc, metrics: shortMetrics, exit });
      }
    }
  }
  rankHits(shortHits);

  const comboHits = [];
  for (const longMethod of longMethods) {
    for (const shortMethod of shortMethods) {
      for (const exit of EXIT_PROFILES) {
        const sc = combine(longMethod, shortMethod, exit);
        const result = runScenario(market, sc);
        const longMetrics = sideSummary(result, "LONG");
        const shortMetrics = sideSummary(result, "SHORT");
        if (longMetrics.trades < 8 || shortMetrics.trades < 8) continue;
        if (longMetrics.winRate >= 0.50 && longMetrics.netPnl > 0 && shortMetrics.winRate >= 0.50 && shortMetrics.netPnl > 0 && result.metrics.netPnl > 0) {
          comboHits.push({ scenario: sc, metrics: result.metrics, longMetrics, shortMetrics, exit });
        }
      }
    }
  }
  comboHits.sort((a, b) => {
    if (b.metrics.netPnl !== a.metrics.netPnl) return b.metrics.netPnl - a.metrics.netPnl;
    if (b.longMetrics.winRate !== a.longMetrics.winRate) return b.longMetrics.winRate - a.longMetrics.winRate;
    if (b.shortMetrics.winRate !== a.shortMetrics.winRate) return b.shortMetrics.winRate - a.shortMetrics.winRate;
    return 0;
  });

  const report = {
    generated_at: new Date().toISOString(),
    market: { symbols: SYMBOLS, interval: INTERVAL, days_back: DAYS_BACK, capital_usd: INITIAL_CAPITAL },
    search_space: {
      long_methods: longMethods.length,
      short_methods: shortMethods.length,
      exits: EXIT_PROFILES.length,
      exact_combo_tests: longMethods.length * shortMethods.length * EXIT_PROFILES.length,
    },
    current_base: BASE,
    long_hits: longHits.map((x) => ({ metrics: x.metrics, exit: x.exit, scenario: compactLong(x.scenario) })),
    short_hits: shortHits.map((x) => ({ metrics: x.metrics, exit: x.exit, scenario: compactShort(x.scenario) })),
    combo_hits: comboHits.map((x) => ({
      metrics: x.metrics,
      longMetrics: x.longMetrics,
      shortMetrics: x.shortMetrics,
      exit: x.exit,
      longScenario: compactLong(x.scenario),
      shortScenario: compactShort(x.scenario),
    })),
  };

  const outDir = "/Users/jeongjaeyong/Projects/donbeolja/ops/analysis";
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "win50_methods_search.json");
  const mdPath = path.join(outDir, "win50_methods_search.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "# Win50 Methods Search",
    "",
    `- generated_at: ${report.generated_at}`,
    `- symbols: ${SYMBOLS.join(", ")}`,
    `- interval: ${INTERVAL}`,
    `- days_back: ${DAYS_BACK}`,
    `- long_methods: ${longMethods.length}`,
    `- short_methods: ${shortMethods.length}`,
    `- exits: ${EXIT_PROFILES.length}`,
    `- exact_combo_tests: ${longMethods.length * shortMethods.length * EXIT_PROFILES.length}`,
    "",
    "## Long Hits",
  ];
  if (!longHits.length) lines.push("- none");
  else for (const row of longHits.slice(0, 15)) lines.push(`- win=${(row.metrics.winRate * 100).toFixed(2)}% net=${row.metrics.netPnl.toFixed(2)} trades=${row.metrics.trades} exit=${row.exit.key} scenario=${JSON.stringify(compactLong(row.scenario))}`);
  lines.push("", "## Short Hits");
  if (!shortHits.length) lines.push("- none");
  else for (const row of shortHits.slice(0, 15)) lines.push(`- win=${(row.metrics.winRate * 100).toFixed(2)}% net=${row.metrics.netPnl.toFixed(2)} trades=${row.metrics.trades} exit=${row.exit.key} scenario=${JSON.stringify(compactShort(row.scenario))}`);
  lines.push("", "## Combined Hits");
  if (!comboHits.length) lines.push("- none");
  else for (const row of comboHits.slice(0, 15)) {
    lines.push(`- total_net=${row.metrics.netPnl.toFixed(2)} long_win=${(row.longMetrics.winRate * 100).toFixed(2)}% short_win=${(row.shortMetrics.winRate * 100).toFixed(2)}% long_trades=${row.longMetrics.trades} short_trades=${row.shortMetrics.trades} exit=${row.exit.key}`);
    lines.push(`  long=${JSON.stringify(compactLong(row.scenario))}`);
    lines.push(`  short=${JSON.stringify(compactShort(row.scenario))}`);
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
