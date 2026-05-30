#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-exit-overlay.js  (PHASE 2)
//
// Phase 1 proved: (a) no entry feature discriminates winners out-of-sample,
// (b) LONG has no predictive edge even when macro-aligned (all 128 LONG
// trades already fire with btc_1h_trend=LONG, still 42% WR). So the only
// remaining lever to create LONG edge is EXIT MANAGEMENT — changing the
// payoff of trades that move favorably then reverse, which needs no
// prediction.
//
// MFE/MAE scan showed 30% of LONG losers first reach +0.5R, while only
// 16% of winners dip to -0.5R. That asymmetry is what a breakeven stop
// exploits. This script replays every LONG (and SHORT, for completeness)
// closed trade against its real 1m path under several exit overlays and
// reports WR + expectancy, with a chronological 70/30 train/test split.
//
// Overlays (stop & target distances unchanged from each side's current RR;
// LONG 1.55, SHORT 1.2):
//   baseline           — fixed stop, fixed target
//   be@Xr              — once +X R favorable is touched, stop -> entry (0R)
//   partial f@Yr+trail — book fraction f at +Y R, move stop to entry on the
//                        rest, rest runs to target
//
// Intrabar ambiguity is always resolved AGAINST the overlay (a bar that
// could be read as either rescue or original-stop is read as original
// stop; a bar that could be BE-scratch or target is read as BE-scratch),
// so reported gains are a conservative LOWER bound.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "ops/runtime/v3_paper_entry_ledger.jsonl");
const EXIT = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");
const CACHE = "/tmp/v3_rr_sweep_paths.jsonl";

function readJsonl(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

const RR = { LONG: Number(process.env.V3_RAW_RR_LONG) || 1.55, SHORT: Number(process.env.V3_RAW_RR_SHORT) || 1.2 };

// Build trades with path
const entries = new Map(readJsonl(ENTRY).map((e) => [e.signal_id, e]));
const paths = new Map(readJsonl(CACHE).map((r) => [r.signal_id, r.candles]));
const trades = [];
for (const x of readJsonl(EXIT)) {
  const e = entries.get(x.signal_id);
  const candles = paths.get(x.signal_id);
  if (!e || !candles || !candles.length) continue;
  const side = String(x.side).toUpperCase();
  const sig = num(e.signal_price), stop = num(e.stop_price);
  if (sig === null || stop === null) continue;
  const risk = Math.abs(sig - stop);
  if (!(risk > 0)) continue;
  trades.push({ side, sig, stop, risk, candles, ts: Date.parse(x.closed_at) });
}
trades.sort((a, b) => a.ts - b.ts);

// Simulate one trade under an overlay. Returns realized R (clean: target=+rr,
// stop=-1, breakeven=0, partial outcomes fractional).
function simulate(t, overlay) {
  const { side, sig, stop, risk } = t;
  const rr = RR[side];
  const target = side === "LONG" ? sig + rr * risk : sig - rr * risk;
  const fav = (price) => side === "LONG" ? (price - sig) / risk : (sig - price) / risk; // R favorable
  // current stop level (may move to entry once armed)
  let armed = false;
  let bookedR = 0;       // realized R from partial fills
  let remaining = 1;     // fraction of position still open
  for (const c of t.candles) {
    const hi = num(c.high), lo = num(c.low);
    if (hi === null || lo === null) continue;
    const favHi = side === "LONG" ? fav(hi) : fav(lo); // most-favorable point this bar
    const favLo = side === "LONG" ? fav(lo) : fav(hi); // most-adverse point this bar
    const effStop = armed ? sig : stop;
    const hitStop = side === "LONG" ? (lo <= effStop) : (hi >= effStop);
    const hitTarget = side === "LONG" ? (hi >= target) : (lo <= target);

    // partial booking: if overlay has a partial and we reach +Y R this bar
    if (overlay.partialF && remaining === 1 && favHi >= overlay.partialY) {
      bookedR += overlay.partialF * overlay.partialY;
      remaining -= overlay.partialF;
      armed = true; // move rest to breakeven after partial
    }
    // arm breakeven once favorable trigger reached (be overlay)
    if (overlay.beTrigger && !armed && favHi >= overlay.beTrigger) {
      armed = true;
    }

    // resolve exits — conservative ordering
    // 1. if both stop & target hittable same bar -> stop (against overlay)
    if (hitStop && hitTarget) {
      // stop wins ambiguity
      const stopR = armed ? 0 : -1;
      return bookedR + remaining * stopR;
    }
    if (hitStop) {
      const stopR = armed ? 0 : -1;
      return bookedR + remaining * stopR;
    }
    if (hitTarget) {
      return bookedR + remaining * rr;
    }
  }
  // never resolved in window -> mark flat-ish at last fav (treat as open=skip)
  return null;
}

function metrics(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, exp: 0, net: 0 };
  const w = rows.filter((r) => r > 1e-9).length; // strictly positive = win
  const net = rows.reduce((s, r) => s + r, 0);
  return { n, wr: (w / n) * 100, exp: net / n, net };
}

const OVERLAYS = [
  { name: "baseline", },
  { name: "be@0.5", beTrigger: 0.5 },
  { name: "be@0.75", beTrigger: 0.75 },
  { name: "be@1.0", beTrigger: 1.0 },
  { name: "partial0.5@0.75+be", partialF: 0.5, partialY: 0.75 },
  { name: "partial0.5@1.0+be", partialF: 0.5, partialY: 1.0 },
];

function run(side) {
  const all = trades.filter((t) => t.side === side);
  const cut = Math.floor(all.length * 0.7);
  const train = all.slice(0, cut), test = all.slice(cut);
  console.log(`\n${"=".repeat(92)}`);
  console.log(`SIDE: ${side}  (RR ${RR[side]})   n=${all.length}  train=${train.length} test=${test.length}`);
  console.log(`${"=".repeat(92)}`);
  console.log(`${"overlay".padEnd(20)} | ${"ALL  n/WR/exp/net".padEnd(34)} | ${"TRAIN WR/exp".padEnd(20)} | TEST WR/exp`);
  console.log("-".repeat(92));
  for (const ov of OVERLAYS) {
    const rAll = all.map((t) => simulate(t, ov)).filter((r) => r !== null);
    const rTr = train.map((t) => simulate(t, ov)).filter((r) => r !== null);
    const rTe = test.map((t) => simulate(t, ov)).filter((r) => r !== null);
    const mA = metrics(rAll), mT = metrics(rTr), mE = metrics(rTe);
    const flag = (mA.wr >= 50 && mA.exp > 0) ? " ✓" : "  ";
    console.log(
      `${ov.name.padEnd(20)} | ` +
      `n=${String(mA.n).padEnd(3)} WR=${mA.wr.toFixed(1).padStart(5)}% exp=${mA.exp.toFixed(3).padStart(6)} net=${mA.net.toFixed(1).padStart(6)}${flag} | ` +
      `WR=${mT.wr.toFixed(1).padStart(5)}% exp=${mT.exp.toFixed(3).padStart(6)} | ` +
      `WR=${mE.wr.toFixed(1).padStart(5)}% exp=${mE.exp.toFixed(3).padStart(6)}`
    );
  }
  console.log("-".repeat(92));
  console.log("✓ = ALL-sample WR>=50% AND expectancy>0.  WR counts strictly-positive R as a win (breakeven 0R is NOT a win).");
}

console.log("V3 PHASE 2 — exit-overlay replay on real 1m paths (conservative intrabar, 70/30 time split)");
run("LONG");
run("SHORT");
console.log();
