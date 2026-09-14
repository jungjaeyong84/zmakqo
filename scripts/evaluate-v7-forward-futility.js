#!/usr/bin/env node
"use strict";

// scripts/evaluate-v7-forward-futility.js — frozen stopping rule for the v7
// paper lane (2026-09-14).
//
// WHY THIS EXISTS
// ---------------
// v7's report has one verdict rule: under 200 periods it says ACCUMULATING,
// after that HOLDING if t > 1.96, otherwise NOT_CONFIRMED. That flips a label.
// It stops nothing, and nothing anywhere says when v7 ends. v6 ran 30 days past
// its own retirement for exactly that reason.
//
// Waiting alone does not settle it either. At 169 booked periods the forward
// ledger neither confirms an edge (t -0.46 against zero) nor rejects the
// backtest's (about -1.3 standard errors below it, iid). Detecting the
// backtest's edge against zero at 80% power needs roughly 1,700 periods — and
// that edge was the best of 8 features, so the true one is probably smaller.
//
// So the question is turned around. Not "has v7 proven itself" but "has the
// forward data ruled out what the backtest promised". That is a question the
// data can answer in months, and the forward ledger is genuinely out of sample
// for it: every row was booked after the backtest was fixed on 2026-08-17.
//
// THE RULE (frozen 2026-09-14; do not tune)
// -----------------------------------------
//   mu_bt   backtest net edge per 4h period: 85.3%/yr compounded over 2190
//           periods/yr. 85.3% was net of taker cost on all turnover (commit
//           aee0dd5c), so it is compared with net_pct, like for like. The
//           geometric per-period rate is used; it is the smaller of the two
//           conversions, which makes rejection harder, not easier.
//   series  net_pct of the FIRST n booked rows of the v7 ledger, in ledger
//           order. Later rows are ignored, so re-running after the look gives
//           the same answer.
//   stat    Newey-West t, lag 6 (one day), of (net - mu_bt). Positions persist
//           between rebalances, so iid standard errors would be too narrow.
//
//   look 1  n = 400   z < -1.96  -> REJECTED   (backtest edge ruled out; retire)
//                     otherwise  -> INCONCLUSIVE (not ruled out; go to look 2)
//                     No confirmation at look 1.
//   look 2  n = 800   z < -1.96  -> REJECTED
//                     NW t of net against 0 > 1.96 -> CONFIRMED
//                     otherwise  -> INCONCLUSIVE: unproven, which is not the
//                     same as absent. The rule ends here; running v7 past this
//                     point needs a new registration with its own reason.
//
// Two looks at one-sided 0.025 each keeps the chance of wrongly retiring a lane
// whose backtest edge is real at or below 5% (Bonferroni). The first draft of
// this rule proposed -1.65 per look, which over two looks is ~8%. It was
// tightened before registration — toward NOT rejecting.
//
// The statistic is deliberately withheld until n is reached. Printing it early
// is how a fixed look becomes a running one.
//
// Reads the v7 ledger only. Writes nothing.
//
// Usage
//   node scripts/evaluate-v7-forward-futility.js --look 1|2
//
// Exit 0 with a decision, 1 while the sample is short, 2 on bad input.

const fs = require("fs");
const path = require("path");
const { neweyWestT } = require("../src/research/staticBenchmarkGate");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/v7_positioning_ledger.jsonl");

// ---- frozen parameters: do not tune ----------------------------------------
const PERIOD_MS = 4 * 3600e3;
const PERIODS_PER_YEAR = (365 * 24 * 3600e3) / PERIOD_MS;   // 2190
const BACKTEST_ANN_NET = 0.853;
const MU_BT = Math.pow(1 + BACKTEST_ANN_NET, 1 / PERIODS_PER_YEAR) - 1;
const NW_LAG = 6;
const Z_REJECT = -1.96;
const T_CONFIRM = 1.96;
const LOOKS = { 1: 400, 2: 800 };
// -----------------------------------------------------------------------------

function mean(x) {
  return x.reduce((a, b) => a + b, 0) / x.length;
}

function sd(x) {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) * (b - m), 0) / (x.length - 1));
}

// Booked rows exactly as the v7 cycle defines them: a row books a return only
// when the prior book could be priced.
function bookedNets(rows) {
  let lastTs = -Infinity;
  const nets = [];
  for (const r of rows) {
    if (!(r.ts > lastTs)) throw new Error(`V7_FUTILITY_LEDGER_NOT_INCREASING: ${r.ts}`);
    if (r.ts % PERIOD_MS !== 0) throw new Error(`V7_FUTILITY_LEDGER_OFF_GRID: ${r.ts}`);
    lastTs = r.ts;
    if (r.prior_gross_pct === null || r.prior_gross_pct === undefined) continue;
    const net = Number(r.net_pct);
    if (!Number.isFinite(net)) throw new Error(`V7_FUTILITY_BAD_NET: ${r.ts}`);
    nets.push({ ts: r.ts, net: net / 100 });
  }
  return nets;
}

// Descriptive numbers only — no decision. Exported so registration can record
// what was visible when the rule was frozen.
function describe(nets) {
  const excess = nets.map((v) => v - MU_BT);
  return {
    n: nets.length,
    mean_net_pct: mean(nets) * 100,
    sd_net_pct: sd(nets) * 100,
    mu_bt_pct: MU_BT * 100,
    z_vs_backtest_iid: (mean(excess) / (sd(nets) / Math.sqrt(nets.length))),
    z_vs_backtest_nw: neweyWestT(excess, NW_LAG),
    t_vs_zero_nw: neweyWestT(nets, NW_LAG),
  };
}

function decide({ booked, look }) {
  const n = LOOKS[look];
  if (!n) throw new Error(`V7_FUTILITY_BAD_LOOK: ${look}`);
  if (booked.length < n) {
    return { look, required: n, booked: booked.length, decision: null };
  }
  const window = booked.slice(0, n);
  const stats = describe(window.map((b) => b.net));
  let decision;
  if (stats.z_vs_backtest_nw < Z_REJECT) decision = "REJECTED";
  else if (look === 2 && stats.t_vs_zero_nw > T_CONFIRM) decision = "CONFIRMED";
  else decision = "INCONCLUSIVE";
  return {
    look,
    required: n,
    booked: booked.length,
    first_ts: new Date(window[0].ts).toISOString(),
    last_ts: new Date(window[n - 1].ts).toISOString(),
    ...stats,
    decision,
  };
}

function main() {
  const i = process.argv.indexOf("--look");
  const look = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  if (!LOOKS[look]) {
    console.error("usage: evaluate-v7-forward-futility.js --look 1|2");
    process.exit(2);
  }
  const rows = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const out = decide({ booked: bookedNets(rows), look });
  console.log(JSON.stringify(out, null, 2));
  if (out.decision === null) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("V7_FUTILITY_FAIL", e && e.message ? e.message : String(e));
    process.exit(2);
  }
}

module.exports = { bookedNets, describe, decide, MU_BT, NW_LAG, Z_REJECT, T_CONFIRM, LOOKS };
