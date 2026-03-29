#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  SYMBOLS,
  INTERVAL,
  DAYS_BACK,
  INITIAL_CAPITAL,
  LEVERAGE,
  SL_PCT,
  TP_PCT,
  TRAIL_PCT,
  fetchKlines,
  backtest,
  summarizeTrades,
} = require("./tune_v5602_quality");

const CURRENT_V5603 = {
  key: "v5603_current",
  desc: "v5.6.0.3 strongest local split-exit profile",
  earlyLongScoreMin: 21,
  earlyLongTransitionScoreMin: 34,
  disableEarlyLong: false,
  disablePreRealLong: true,
  coreLongScoreMin: 33,
  coreLongPostMin: 0.70,
  longRequireVolOnCore: false,
  longRequireBullHtf: false,
  longTransitionScoreMin: 40,
  longTransitionPostMin: 0.76,
  preRealLongPostMin: 0.83,
  preRealLongScoreMin: 38,
  coreLongMaxK: 63,
  enableBullBreakoutLongPromotion: true,
  bullBreakoutLongPosMin: 0.83,
  bullBreakoutLongKMin: 60,
  bullBreakoutLongVolMin: 0.8,
  bullBreakoutLongPostMin: 0.67,
  longSlPct: 1.6,
  longTpPct: 0.85,
  longTrailPct: 0.2,
  earlyShortScoreMin: 17,
  coreShortScoreMin: 28,
  coreShortPostMin: 0.50,
  shortRequireVolOnCore: false,
  shortRequireBearHtf: true,
  shortTransitionScoreMin: 36,
  shortTransitionPostMin: 0.89,
  preRealShortPostMin: 0.93,
  preRealShortScoreMin: 32,
  shortSlPct: 2.2,
  shortTpPct: 3.4,
  shortTrailPct: 0.2,
  realBlocked: true,
};

function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "N/A";
}

function num(v) {
  return Number.isFinite(v) ? v.toFixed(2) : "N/A";
}

function summarizeBucket(trades, signals) {
  const base = summarizeTrades(trades, signals || {});
  const byExit = { SL: 0, TP: 0, TRAIL: 0 };
  for (const t of trades) byExit[t.exitReason] = (byExit[t.exitReason] || 0) + 1;
  return {
    trades: base.trades,
    signals: base.signals,
    win_rate: base.winRate,
    net_usd: base.netPnl,
    ret_pct: base.retPct,
    pf: base.pf,
    mdd_pct: base.mddPct,
    long_net: base.longNet,
    short_net: base.shortNet,
    exits: byExit,
  };
}

function emptySignals() {
  return { EARLY_LONG: 0, EARLY_SHORT: 0, CORE_LONG: 0, CORE_SHORT: 0, PRE_REAL_LONG: 0, PRE_REAL_SHORT: 0, REAL_LONG: 0, REAL_SHORT: 0 };
}

function signalCountForBucket(allSignals, tier, side) {
  const out = emptySignals();
  const key = side ? `${tier}_${side}` : null;
  if (key) out[key] = allSignals[key] || 0;
  return out;
}

function classifyMarketPhase(trade) {
  const regime = String(trade.entryRegime || "").toLowerCase();
  const trend = String(trade.entryTrend || "").toLowerCase();
  const htf = String(trade.entryHtf || "").toLowerCase();
  if (regime === "range") return "RANGE";
  if (trend === "bull" && htf === "bull") return "BULL";
  if (trend === "bear" && htf === "bear") return "BEAR";
  return "TRANSITION";
}

function avg(rows, key) {
  if (!rows.length) return null;
  const vals = rows.map((r) => Number(r[key])).filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function summarizeReason(rows) {
  return {
    count: rows.length,
    win_rate: rows.length ? rows.filter((r) => r.pnlUsd > 0).length / rows.length : null,
    net_usd: rows.reduce((s, r) => s + r.pnlUsd, 0),
    avg_score: avg(rows, "entryScore"),
    avg_post_long: avg(rows, "entryPostLong"),
    avg_post_short: avg(rows, "entryPostShort"),
    avg_vol_ratio: avg(rows, "entryVolRatio"),
    avg_pos_pct: avg(rows, "entryPosPct"),
    avg_k: avg(rows, "entryK"),
  };
}

async function main() {
  const limit = Math.min(DAYS_BACK * 24, 1500);
  const perSymbol = [];
  let allTrades = [];
  const allSignals = emptySignals();

  for (const symbol of SYMBOLS) {
    process.stdout.write(`${symbol} fetch... `);
    const candles = await fetchKlines(symbol, INTERVAL, limit);
    const { trades, signalCounts } = backtest(candles, symbol, CURRENT_V5603);
    console.log(`${candles.length} bars, ${trades.length} trades`);
    perSymbol.push({ symbol, trades, signalCounts });
    allTrades = allTrades.concat(trades);
    for (const [k, v] of Object.entries(signalCounts)) allSignals[k] += v;
  }

  const overall = summarizeBucket(allTrades, allSignals);
  const bySide = {
    LONG: summarizeBucket(allTrades.filter((t) => t.side === "LONG"), {
      EARLY_LONG: allSignals.EARLY_LONG,
      CORE_LONG: allSignals.CORE_LONG,
      PRE_REAL_LONG: allSignals.PRE_REAL_LONG,
      REAL_LONG: allSignals.REAL_LONG,
    }),
    SHORT: summarizeBucket(allTrades.filter((t) => t.side === "SHORT"), {
      EARLY_SHORT: allSignals.EARLY_SHORT,
      CORE_SHORT: allSignals.CORE_SHORT,
      PRE_REAL_SHORT: allSignals.PRE_REAL_SHORT,
      REAL_SHORT: allSignals.REAL_SHORT,
    }),
  };

  const tiers = ["EARLY", "CORE", "PRE_REAL", "REAL"];
  const sides = ["LONG", "SHORT"];
  const byTier = {};
  const byTierSide = {};
  for (const tier of tiers) {
    const tierTrades = allTrades.filter((t) => t.tier === tier);
    byTier[tier] = summarizeBucket(tierTrades, {
      [`${tier}_LONG`]: allSignals[`${tier}_LONG`] || 0,
      [`${tier}_SHORT`]: allSignals[`${tier}_SHORT`] || 0,
    });
    byTierSide[tier] = {};
    for (const side of sides) {
      byTierSide[tier][side] = summarizeBucket(
        allTrades.filter((t) => t.tier === tier && t.side === side),
        signalCountForBucket(allSignals, tier, side),
      );
    }
  }

  const bySymbol = {};
  for (const row of perSymbol) {
    bySymbol[row.symbol] = summarizeBucket(row.trades, row.signalCounts);
  }

  const byPhase = {};
  for (const phase of ["BULL", "BEAR", "RANGE", "TRANSITION"]) {
    const rows = allTrades.filter((t) => classifyMarketPhase(t) === phase);
    byPhase[phase] = summarizeBucket(rows, {});
  }

  const diagnostics = {};
  for (const key of [
    { tier: "CORE", side: "LONG" },
    { tier: "PRE_REAL", side: "LONG" },
  ]) {
    const rows = allTrades.filter((t) => t.tier === key.tier && t.side === key.side);
    const bucket = {};
    for (const phase of ["BULL", "BEAR", "RANGE", "TRANSITION"]) {
      bucket[phase] = summarizeReason(rows.filter((t) => classifyMarketPhase(t) === phase));
    }
    bucket.by_symbol = {};
    for (const symbol of SYMBOLS) {
      bucket.by_symbol[symbol] = summarizeReason(rows.filter((t) => t.symbol === symbol));
    }
    diagnostics[`${key.tier}_${key.side}`] = bucket;
  }

  const report = {
    generated_at: new Date().toISOString(),
    scenario: CURRENT_V5603,
    market: {
      symbols: SYMBOLS,
      interval: INTERVAL,
      days_back: DAYS_BACK,
      capital_usd: INITIAL_CAPITAL,
      leverage: LEVERAGE,
      exit: { sl_pct: SL_PCT, tp1_pct: TP_PCT, trail_pct: TRAIL_PCT },
    },
    overall,
    by_side: bySide,
    by_tier: byTier,
    by_tier_side: byTierSide,
    by_phase: byPhase,
    diagnostics,
    by_symbol: bySymbol,
    raw_signal_counts: allSignals,
  };

  const outDir = "/Users/jeongjaeyong/Projects/donbeolja/ops/analysis";
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "v5603_viability_latest.json");
  const mdPath = path.join(outDir, "v5603_viability_latest.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    "# v5.6.0.3 Viability",
    "",
    `- generated_at: ${report.generated_at}`,
    `- interval: ${INTERVAL}`,
    `- days_back: ${DAYS_BACK}`,
    `- symbols: ${SYMBOLS.join(", ")}`,
    `- exit: SL ${SL_PCT}% / TP1 ${TP_PCT}% / TRAIL ${TRAIL_PCT}% / ${LEVERAGE}x`,
    `- real_blocked: ${CURRENT_V5603.realBlocked}`,
    "",
    "## Overall",
    `- signals: ${overall.signals}`,
    `- trades: ${overall.trades}`,
    `- win_rate: ${pct(overall.win_rate)}`,
    `- net_usd: ${num(overall.net_usd)}`,
    `- ret_pct: ${pct(overall.ret_pct)}`,
    `- pf: ${num(overall.pf)}`,
    `- mdd_pct: ${num(overall.mdd_pct)}%`,
    "",
    "## By Side",
    `- LONG: trades=${bySide.LONG.trades}, signals=${bySide.LONG.signals}, win_rate=${pct(bySide.LONG.win_rate)}, net_usd=${num(bySide.LONG.net_usd)}, pf=${num(bySide.LONG.pf)}`,
    `- SHORT: trades=${bySide.SHORT.trades}, signals=${bySide.SHORT.signals}, win_rate=${pct(bySide.SHORT.win_rate)}, net_usd=${num(bySide.SHORT.net_usd)}, pf=${num(bySide.SHORT.pf)}`,
    "",
    "## By Tier",
    ...tiers.map((tier) => `- ${tier}: trades=${byTier[tier].trades}, signals=${byTier[tier].signals}, win_rate=${pct(byTier[tier].win_rate)}, net_usd=${num(byTier[tier].net_usd)}, pf=${num(byTier[tier].pf)}`),
    "",
    "## Tier x Side",
    ...tiers.flatMap((tier) => sides.map((side) => `- ${tier} ${side}: trades=${byTierSide[tier][side].trades}, signals=${byTierSide[tier][side].signals}, win_rate=${pct(byTierSide[tier][side].win_rate)}, net_usd=${num(byTierSide[tier][side].net_usd)}, pf=${num(byTierSide[tier][side].pf)}`)),
    "",
    "## By Phase",
    ...["BULL", "BEAR", "RANGE", "TRANSITION"].map((phase) => `- ${phase}: trades=${byPhase[phase].trades}, win_rate=${pct(byPhase[phase].win_rate)}, net_usd=${num(byPhase[phase].net_usd)}, pf=${num(byPhase[phase].pf)}`),
    "",
    "## Diagnostics",
    `- CORE_LONG by phase: ${JSON.stringify(diagnostics.CORE_LONG)}`,
    `- PRE_REAL_LONG by phase: ${JSON.stringify(diagnostics.PRE_REAL_LONG)}`,
    "",
    "## By Symbol",
    ...SYMBOLS.map((symbol) => `- ${symbol}: trades=${bySymbol[symbol].trades}, signals=${bySymbol[symbol].signals}, win_rate=${pct(bySymbol[symbol].win_rate)}, net_usd=${num(bySymbol[symbol].net_usd)}, pf=${num(bySymbol[symbol].pf)}`),
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, `${md}\n`);

  console.log("\nOVERALL");
  console.log(`signals=${overall.signals} trades=${overall.trades} win_rate=${pct(overall.win_rate)} net=${num(overall.net_usd)} ret=${pct(overall.ret_pct)} pf=${num(overall.pf)} mdd=${num(overall.mdd_pct)}%`);
  console.log(`LONG net=${num(bySide.LONG.net_usd)} | SHORT net=${num(bySide.SHORT.net_usd)}`);
  console.log(`saved: ${jsonPath}`);
  console.log(`saved: ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
