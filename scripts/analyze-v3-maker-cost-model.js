#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-maker-cost-model.js (2026-08-07)
//
// The paper gate currently fails on cost, not on edge:
//   gross expectancy +0.1285 R/trade, cost 0.1249 R/trade, net +0.0036 R.
// The signal has a real edge; the round trip eats essentially all of it. So
// the question worth answering is not "is there alpha" but "is the cost model
// right, and is the cost reducible".
//
// The current model (localPaperExitLedger.computeCostR) charges every trade a
// FLAT 0.10% fee + 0.04% slippage, i.e. taker on both legs plus slippage on
// both legs.
//
// A first draft of this script assumed the take-profit leg was a resting limit
// order and therefore a maker fill. THAT IS WRONG for this codebase, and the
// error flattered the strategy. binanceFuturesPrivate.js:1112 rejects any
// bracket type other than STOP_MARKET / TAKE_PROFIT_MARKET, because Binance's
// `closePosition: true` flag only accepts those two. Both exit legs are
// therefore MARKET orders and both pay taker. The exit leg offers no fee
// saving at all as the system is built today.
//
// So the only leg where maker-first can save anything is the ENTRY, and the
// most it can ever save is the maker/taker spread on one leg: 0.05% - 0.02%
// = 0.03% of price. Two models are reported:
//
//   MODEL A — as built. Entry blended maker/taker, both exits taker market.
//   MODEL B — a redesign in which the take-profit is posted as a reduce-only
//             post-only LIMIT at the target (GTX support already exists at
//             binanceFuturesPrivate.js:881) so winners pay maker on the way
//             out. Losers still stop out at market. B is an upper bound on
//             what any execution change could deliver.
//
// The entry leg is the part that genuinely depends on execution. liveExecutor
// posts at the passive side (BUY joins the bid, SELL joins the ask), waits
// V3_LIVE_MAKER_WAIT_MS (default 5000ms), then falls back to market. Because
// it FALLS BACK rather than cancelling, there is no missed-trade selection
// bias: every signal is entered either way. The entry cost is therefore a
// blend, p*maker + (1-p)*taker, and p — the fraction that fills passively —
// is the one number this dataset cannot measure. 15m klines do not resolve a
// 5-second queue.
//
// So p is treated as a PARAMETER and swept, and the honest output is the
// break-even p: how good execution has to be for the gate to pass. If that
// number is unreachable the idea is dead regardless of the fee arithmetic.
//
// One second-order effect is acknowledged and NOT modelled away: when the
// passive order does not fill in 5s it is usually because price ticked away
// from it, so the taker-fallback subset is very slightly worse than random.
// Over a 5-second window that is sub-basis-point; it is charged as an explicit
// `adverse_bps` parameter rather than assumed to be zero.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXIT_LEDGER = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");

// Binance USDT-M futures standard tier, no BNB discount (conservative).
const MAKER_PCT = 0.02;
const TAKER_PCT = 0.05;
// Slippage charged to a stop-market fill. Stops trigger in fast moves, so this
// is deliberately worse than the flat 0.04% round-trip the old model assumed.
const STOP_SLIP_PCT = Number(process.env.V3_STOP_SLIP_PCT) >= 0
  ? Number(process.env.V3_STOP_SLIP_PCT) : 0.04;
// Cost of the 5s adverse drift on the taker-fallback subset, in bps of price.
const ADVERSE_BPS = Number(process.env.V3_ADVERSE_BPS) >= 0
  ? Number(process.env.V3_ADVERSE_BPS) : 1.0;

// Gate thresholds this must clear (src/v3/validationReport.js).
const GATE_MIN_EXPECTANCY_R = 0.05;
const GATE_MIN_WR_PCT = 48;

function loadClosedExits() {
  const latest = new Map(); // latest row wins — repair rows overwrite originals
  for (const line of fs.readFileSync(EXIT_LEDGER, "utf8").trim().split("\n")) {
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    if (!row || row.realized_r == null) continue;
    latest.set(row.v3_paper_exit_id, row);
  }
  return [...latest.values()]
    .filter((r) => Number.isFinite(Number(r.realized_r)))
    .sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at));
}

// Risk width as a percent of entry price — the denominator that turns a cost
// in price-percent into a cost in R.
function riskPct(row) {
  const sig = Number(row.signal_price);
  const stop = Number(row.stop_price);
  if (!Number.isFinite(sig) || !Number.isFinite(stop) || sig <= 0) return null;
  const w = (Math.abs(sig - stop) / sig) * 100;
  return w > 0 ? w : null;
}

// The model currently in production: flat, path-independent.
function currentCostR(row) {
  const w = riskPct(row);
  return w === null ? null : (0.10 + 0.04) / w;
}

// Exit-path-aware cost. `p` = fraction of entries that fill passively.
// `tpAsLimit` selects MODEL B (take-profit posted as a post-only limit).
function makerCostR(row, p, tpAsLimit = false) {
  const w = riskPct(row);
  if (w === null) return null;
  const halfSpreadPct = (Number(row.spread_bps) || 0) / 2 / 100;
  const isWin = Number(row.realized_r) > 0;

  // ENTRY — blended, because the 5s wait falls back to market rather than
  // cancelling. Passive fills cross no spread; taker fallbacks cross half the
  // spread and eat the small adverse drift that caused the non-fill.
  const entryFee = p * MAKER_PCT + (1 - p) * TAKER_PCT;
  const entrySlip = (1 - p) * (halfSpreadPct + ADVERSE_BPS / 100);

  // EXIT — determined by order type, not by execution skill.
  //   As built: TAKE_PROFIT_MARKET and STOP_MARKET, both taker, both slip.
  //   Model B:  winners rest as a post-only limit -> maker, no slippage.
  let exitFee;
  let exitSlip;
  if (isWin) {
    exitFee = tpAsLimit ? MAKER_PCT : TAKER_PCT;
    exitSlip = tpAsLimit ? 0 : halfSpreadPct;
  } else {
    exitFee = TAKER_PCT;
    exitSlip = STOP_SLIP_PCT;
  }

  return (entryFee + entrySlip + exitFee + exitSlip) / w;
}

function summarize(rows, costFn) {
  const nets = [];
  for (const r of rows) {
    const c = costFn(r);
    if (c === null) continue;
    nets.push(Number(r.realized_r) - c);
  }
  const n = nets.length;
  const mean = nets.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(nets.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  const se = sd / Math.sqrt(n);
  const costs = rows.map(costFn).filter((c) => c !== null);
  return {
    n,
    expectancy_r: mean,
    net_r: mean * n,
    ci_lo: mean - 1.96 * se,
    ci_hi: mean + 1.96 * se,
    avg_cost_r: costs.reduce((s, v) => s + v, 0) / costs.length,
  };
}

function main() {
  const rows = loadClosedExits();
  const wins = rows.filter((r) => Number(r.realized_r) > 0).length;
  const wrPct = (wins / rows.length) * 100;
  const gross = rows.reduce((s, r) => s + Number(r.realized_r), 0);

  console.log(`closed trades ${rows.length}, win rate ${wrPct.toFixed(2)}%`);
  console.log(`gross R ${gross.toFixed(1)} (${(gross / rows.length).toFixed(4)} R/trade)`);
  console.log(`maker ${MAKER_PCT}% / taker ${TAKER_PCT}% per side, stop slippage ${STOP_SLIP_PCT}%, adverse ${ADVERSE_BPS}bps\n`);

  const cur = summarize(rows, currentCostR);
  console.log("=== CURRENT MODEL (flat 0.10% fee + 0.04% slippage, path-independent) ===");
  console.log(`  avg cost      ${cur.avg_cost_r.toFixed(4)} R/trade`);
  console.log(`  expectancy    ${cur.expectancy_r.toFixed(4)} R  [${cur.ci_lo.toFixed(4)}, ${cur.ci_hi.toFixed(4)}]`);
  console.log(`  net           ${cur.net_r.toFixed(1)} R`);
  console.log(`  gate (>=${GATE_MIN_EXPECTANCY_R} R): ${cur.expectancy_r >= GATE_MIN_EXPECTANCY_R ? "PASS" : "FAIL"}\n`);

  for (const [label, tpAsLimit] of [
    ["MODEL A — AS BUILT (both exits are MARKET orders, taker)", false],
    ["MODEL B — REDESIGN (take-profit posted as post-only LIMIT)", true],
  ]) {
    console.log(`=== ${label}, swept over entry maker fill rate p ===`);
    console.log("p = fraction of entries filled passively within the 5s wait.");
    console.log("p=0 is pure market entry and needs NO execution assumption.\n");
    console.log("   p     avg cost R   expectancy R      95% CI            net R    gate");
    for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
      const s = summarize(rows, (r) => makerCostR(r, p, tpAsLimit));
      const pass = s.expectancy_r >= GATE_MIN_EXPECTANCY_R;
      console.log(
        `${p.toFixed(2).padStart(5)}   ${s.avg_cost_r.toFixed(4).padStart(9)}   ${s.expectancy_r.toFixed(4).padStart(11)}` +
        `   [${s.ci_lo.toFixed(4)}, ${s.ci_hi.toFixed(4)}]   ${s.net_r.toFixed(1).padStart(7)}   ${pass ? "PASS" : "FAIL"}`
      );
    }
    console.log();
  }

  console.log("=== VERDICT ===");
  const aBest = summarize(rows, (r) => makerCostR(r, 1, false));
  const bBest = summarize(rows, (r) => makerCostR(r, 1, true));
  console.log(`  Ceiling on ANY execution improvement:`);
  console.log(`    Model A, p=1 (every entry passive): ${aBest.expectancy_r.toFixed(4)} R  [${aBest.ci_lo.toFixed(4)}, ${aBest.ci_hi.toFixed(4)}]`);
  console.log(`    Model B, p=1 (+ TP as maker limit): ${bBest.expectancy_r.toFixed(4)} R  [${bBest.ci_lo.toFixed(4)}, ${bBest.ci_hi.toFixed(4)}]`);
  console.log(`  Gate needs ${GATE_MIN_EXPECTANCY_R} R.`);
  const anyPass = Math.max(aBest.expectancy_r, bBest.expectancy_r) >= GATE_MIN_EXPECTANCY_R;
  console.log(`  -> ${anyPass ? "reachable, but only under the most optimistic execution assumption" : "UNREACHABLE. Execution is not the binding constraint; the edge is too small."}`);
  console.log(`  -> best-case CI ${bBest.ci_lo > 0 ? "excludes" : "INCLUDES"} zero${bBest.ci_lo > 0 ? "" : " — not statistically distinguishable from breakeven even at the ceiling"}`);
  console.log(`\n  win rate ${wrPct.toFixed(2)}% vs gate floor ${GATE_MIN_WR_PCT}% -> ${wrPct >= GATE_MIN_WR_PCT ? "PASS" : "FAIL"} (this gate is unaffected by cost)`);
}

main();
