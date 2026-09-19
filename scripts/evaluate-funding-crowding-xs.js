#!/usr/bin/env node
"use strict";

// scripts/evaluate-funding-crowding-xs.js — do crowded perps underperform?
// (2026-09-19)
//
// HYPOTHESIS
// ----------
// Funding is the price of leverage demand. A perp whose longs are paying a lot
// is crowded, and crowded names should underperform the cross-section — the
// same mechanism as wide-retail-crowding-q1 (retail long relative to large
// accounts), measured here on independent data with years of history rather
// than one month. Expected sign: IC < 0.
//
// This is a question about PRICE. Receiving funding by shorting crowded names
// would add carry on top, which is a tradability question for later and is
// reported only as a secondary.
//
// FROZEN SPEC (written before the first run; do not tune)
// -------------------------------------------------------
//   day d     one panel per UTC day. All inputs must be known at d 00:00 UTC.
//   score     sum of funding rates paid over the PREVIOUS UTC day [d-1, d).
//             Summing over the day makes 1h / 4h / 8h funding intervals
//             comparable without annualising.
//   forward   close[daily bar d] / close[daily bar d-1] - 1: from d 00:00 to
//             d+1 00:00. Bars still forming at fetch time are dropped.
//   universe  perps with the previous day's funding, both closes, at least 14
//             prior daily bars (listing noise), and >= 5 of the previous 7 days'
//             quote volume; top 200 by that trailing average. Panels with
//             fewer than 100 eligible names are skipped.
//   gate      src/research/monotonicityGate.js: 5 buckets, Newey-West lag 5,
//             |t| 1.96 — the standing tradability screen
//   split     DISCOVERY  2023-01-15 .. 2025-09-18
//             HOLDOUT    2025-09-19 .. last complete day, read ONCE and only if
//                        discovery passes with the expected sign
//
//   decision  discovery fails               -> REJECTED, holdout left unread
//             discovery passes, IC > 0      -> OPPOSITE_SIGN: a different
//                                              hypothesis, not support; stop
//             discovery passes, holdout fails or flips sign -> REJECTED
//             both pass with IC < 0         -> HOLDOUT_PASS: register for
//                                              forward confirmation. No book.
//
//   secondary (descriptive, no decision, discovery only)
//     total_return  forward minus funding paid during day d (a long perp's
//                   return). High-funding names pay more, so this is expected
//                   to look stronger mechanically — that is why it cannot
//                   decide anything.
//     top100        the 100 most liquid names
//
// KNOWN BIAS: only perps listed on the fetch date have history. Delisted names
// are absent, and they are disproportionately the ones that collapsed.
//
// Usage
//   node scripts/evaluate-funding-crowding-xs.js --data DIR
//
// DIR holds meta.json, funding/SYM.json ([[fundingTime, rate]]), and
// daily/SYM.json ([[openTime, close, quoteVolume]]).

const fs = require("fs");
const path = require("path");
const { evaluateMonotonicity, formatMonotonicityReport } = require("../src/research/monotonicityGate");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const TOP_N = 200;
const MIN_ELIGIBLE = 100;
const MIN_AGE_DAYS = 14;
const VOL_WINDOW = 7;
const VOL_MIN_DAYS = 5;
const BUCKETS = 5;
const NW_LAG = 5;
const T = 1.96;
const DISCOVERY_FROM = Date.parse("2023-01-15T00:00:00Z");
const HOLDOUT_FROM = Date.parse("2025-09-19T00:00:00Z");
// -----------------------------------------------------------------------------

function load(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const fetchedAt = Date.parse(meta.fetched_at);
  const syms = [];
  for (const m of meta.perps) {
    const fp = path.join(dir, "funding", `${m.symbol}.json`);
    const kp = path.join(dir, "daily", `${m.symbol}.json`);
    if (!fs.existsSync(fp) || !fs.existsSync(kp)) continue;
    const funding = new Map();
    for (const [t, r] of JSON.parse(fs.readFileSync(fp, "utf8"))) {
      if (!Number.isFinite(r)) continue;
      const d = Math.floor(t / DAY) * DAY;
      funding.set(d, (funding.get(d) || 0) + r);
    }
    const bars = JSON.parse(fs.readFileSync(kp, "utf8")).filter(([t]) => t + DAY <= fetchedAt);
    const close = new Map(bars.map(([t, c]) => [t, c]));
    const qv = new Map(bars.map(([t, , q]) => [t, q]));
    const firstBar = bars.length ? bars[0][0] : Infinity;
    syms.push({ symbol: m.symbol, funding, close, qv, firstBar });
  }
  return { syms, fetchedAt };
}

function panelFor(d, syms, { topN = TOP_N, totalReturn = false } = {}) {
  const rows = [];
  for (const s of syms) {
    const f = s.funding.get(d - DAY);
    const c0 = s.close.get(d - DAY);
    const c1 = s.close.get(d);
    if (!Number.isFinite(f) || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0) continue;
    if ((d - s.firstBar) / DAY < MIN_AGE_DAYS) continue;
    let v = 0;
    let c = 0;
    for (let k = 1; k <= VOL_WINDOW; k += 1) {
      const q = s.qv.get(d - k * DAY);
      if (Number.isFinite(q)) { v += q; c += 1; }
    }
    if (c < VOL_MIN_DAYS) continue;
    let fwd = c1 / c0 - 1;
    if (totalReturn) {
      const paid = s.funding.get(d);
      if (!Number.isFinite(paid)) continue;
      fwd -= paid;
    }
    rows.push({ score: f, fwd, vol: v / c });
  }
  if (rows.length < MIN_ELIGIBLE) return null;
  const band = rows.sort((a, b) => b.vol - a.vol).slice(0, topN);
  return { d, scores: band.map((r) => r.score), forwardReturns: band.map((r) => r.fwd), n: band.length };
}

function panels(syms, from, to, opts) {
  const out = [];
  let skipped = 0;
  for (let d = from; d < to; d += DAY) {
    const p = panelFor(d, syms, opts);
    if (p) out.push(p); else skipped += 1;
  }
  return { out, skipped };
}

function gate(label, set) {
  const r = evaluateMonotonicity({ panels: set.out, buckets: BUCKETS, neweyWestLag: NW_LAG, tThreshold: T, label });
  return {
    ...r,
    skipped: set.skipped,
    first: set.out.length ? new Date(set.out[0].d).toISOString().slice(0, 10) : null,
    last: set.out.length ? new Date(set.out[set.out.length - 1].d).toISOString().slice(0, 10) : null,
    names_per_panel: set.out.length ? Math.round(set.out.reduce((a, p) => a + p.n, 0) / set.out.length) : 0,
  };
}

function show(r) {
  console.error(formatMonotonicityReport(r));
  console.error(`  기간 ${r.first} → ${r.last} · 종목/일 ${r.names_per_panel} · 건너뜀 ${r.skipped}\n`);
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0 || !process.argv[i + 1]) {
    console.error("usage: evaluate-funding-crowding-xs.js --data DIR");
    process.exit(2);
  }
  const { syms, fetchedAt } = load(process.argv[i + 1]);
  const lastComplete = Math.floor(fetchedAt / DAY) * DAY - DAY;   // bar d must have closed

  const disc = gate("DISCOVERY funding crowding top200 h24", panels(syms, DISCOVERY_FROM, HOLDOUT_FROM));
  show(disc);

  const secondary = {
    total_return: gate("secondary: total return incl. funding", panels(syms, DISCOVERY_FROM, HOLDOUT_FROM, { totalReturn: true })),
    top100: gate("secondary: top100", panels(syms, DISCOVERY_FROM, HOLDOUT_FROM, { topN: 100 })),
  };
  show(secondary.total_return);
  show(secondary.top100);

  let decision;
  let holdout = null;
  if (!disc.passed) decision = "REJECTED";
  else if (disc.ic.mean > 0) decision = "OPPOSITE_SIGN";
  else {
    holdout = gate("HOLDOUT funding crowding top200 h24", panels(syms, HOLDOUT_FROM, lastComplete + DAY));
    show(holdout);
    decision = holdout.passed && holdout.ic.mean < 0 ? "HOLDOUT_PASS" : "REJECTED";
  }

  const strip = (r) => r && ({ verdict: r.verdict, panels: r.panels, first: r.first, last: r.last, names_per_panel: r.names_per_panel,
    bucketMeans: r.bucketMeans, monotone: r.monotone, ic: r.ic, tailSpread: r.tailSpread, signAgreement: r.signAgreement });
  console.log(JSON.stringify({
    symbols: syms.length,
    fetched_at: new Date(fetchedAt).toISOString(),
    decision,
    holdout_read: holdout !== null,
    discovery: strip(disc),
    holdout: strip(holdout),
    secondary: { total_return: strip(secondary.total_return), top100: strip(secondary.top100) },
  }, null, 2));
}

if (require.main === module) main();

module.exports = { panelFor };
