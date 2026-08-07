#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-composite-score.js (2026-08-07)
//
// A multi-indicator long/short book, built as a COMPOSITE SCORE rather than a
// filter chain. This is architecturally different from v3 and the difference
// is the point.
//
// v3 was an AND-chain: a signal fired, then had to clear filter A, then filter
// B, then C. Two things go wrong with that. Sample collapses multiplicatively,
// so every added condition buys precision with statistical power. And each
// threshold is a free parameter fitted on the same data, which is how 107
// configurations produced roughly five false positives.
//
// A composite scores every bar on every indicator, standardises, and sums.
// Nothing is discarded, no thresholds are fitted per indicator, and a single
// weak indicator cannot veto the rest — it just moves the score a little. That
// is what "judge the indicators together" actually means, and it has not been
// tried here.
//
// DATA CONSTRAINT, stated up front because it shapes everything. Binance's
// /futures/data endpoints (open interest, top-trader and global long/short
// ratios, taker buy/sell) return only ~30 DAYS of history regardless of the
// period requested. Verified, not assumed. Thirty days is one regime; it is
// the same wall the v3 flow study died against. Those indicators are therefore
// EXCLUDED here and are being collected going forward instead.
//
// What has real history: klines (years) and fundingRate (years). Funding is a
// genuine futures-only indicator, not a price transform, so the composite is
// not merely technical analysis with extra steps.
//
// HONESTY MECHANISM. Indicator signs are not chosen by theory and they are not
// chosen by looking at the whole sample. The first half decides which
// indicators to include and with which sign; the second half is untouched
// until the final measurement. An in-sample number here is a diagnostic, and
// only the out-of-sample number is evidence.
//
// SYMMETRY. One score, one threshold, sign-mirrored. Long above +t, short
// below -t. No side gets its own rule.

const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT", "FILUSDT", "INJUSDT",
  "SEIUSDT", "GALAUSDT", "SANDUSDT", "AXSUSDT", "AAVEUSDT", "DOTUSDT",
];
const INTERVAL = "4h";
const BARS_PER_DAY = 6;
const PAGES = 4;                 // 4 x 1000 4h bars ~ 666 days
const HOLD_BARS = 6;             // one day
const COST_PCT = 0.14;           // round trip, matching the measured v3 cost
const MIN_ABS_IC = 0.015;        // in-sample inclusion bar for an indicator

const F = "https://fapi.binance.com";

async function fetchKlines(sym) {
  const out = [];
  let end = Date.now();
  for (let p = 0; p < PAGES; p += 1) {
    const res = await fetch(`${F}/fapi/v1/klines?symbol=${sym}&interval=${INTERVAL}&limit=1000&endTime=${end}`);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows.map((r) => ({
      t: Number(r[0]), o: Number(r[1]), h: Number(r[2]),
      l: Number(r[3]), c: Number(r[4]), v: Number(r[5]),
    })));
    end = Number(rows[0][0]) - 1;
    await new Promise((r) => setTimeout(r, 110));
  }
  const seen = new Set();
  return out.filter((b) => {
    if (seen.has(b.t)) return false;
    seen.add(b.t);
    return Number.isFinite(b.c) && b.c > 0;
  }).sort((a, b) => a.t - b.t);
}

async function fetchFunding(sym) {
  const out = [];
  let end = Date.now();
  for (let p = 0; p < 3; p += 1) {
    const res = await fetch(`${F}/fapi/v1/fundingRate?symbol=${sym}&limit=1000&endTime=${end}`);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows.map((r) => ({ t: Number(r.fundingTime), r: Number(r.fundingRate) })));
    end = Number(rows[0].t || rows[0].fundingTime) - 1;
    await new Promise((r) => setTimeout(r, 110));
  }
  return out.filter((x) => Number.isFinite(x.r)).sort((a, b) => a.t - b.t);
}

// Indicators. Every one is computed from information available AT bar i.
// Orientation is deliberately NOT decided here — the sign is learned in-sample.
function buildFeatures(bars, funding) {
  const n = bars.length;
  const feats = [];
  // funding lookup: most recent funding payment at or before each bar
  let fi = 0;
  for (let i = 60; i < n - HOLD_BARS; i += 1) {
    const b = bars[i];
    while (fi + 1 < funding.length && funding[fi + 1].t <= b.t) fi += 1;
    const fNow = funding.length ? funding[fi].r : 0;
    // trailing mean funding over ~3 days (9 payments at 8h)
    let fSum = 0, fCnt = 0;
    for (let k = Math.max(0, fi - 8); k <= fi; k += 1) { fSum += funding[k].r; fCnt += 1; }
    const fAvg = fCnt ? fSum / fCnt : 0;

    const ret = (a, b2) => bars[a].c / bars[b2].c - 1;
    // realized vol over 30 bars, for normalising
    let s = 0, s2 = 0;
    for (let k = i - 30; k < i; k += 1) { const r = Math.log(bars[k + 1].c / bars[k].c); s += r; s2 += r * r; }
    const mu = s / 30;
    const rv = Math.sqrt(Math.max(s2 / 30 - mu * mu, 0)) || 1e-9;

    let volSum = 0;
    for (let k = i - 30; k < i; k += 1) volSum += bars[k].v;
    const volAvg = volSum / 30 || 1e-9;

    let hi = -Infinity, lo = Infinity;
    for (let k = i - 30; k <= i; k += 1) { hi = Math.max(hi, bars[k].h); lo = Math.min(lo, bars[k].l); }

    const body = Math.abs(b.c - b.o);
    const upper = b.h - Math.max(b.o, b.c);
    const lower = Math.min(b.o, b.c) - b.l;

    feats.push({
      i,
      t: b.t,
      f: {
        mom_1d: ret(i, i - 6) / rv,
        mom_3d: ret(i, i - 18) / rv,
        mom_7d: ret(i, i - 42) / rv,
        vol_regime: rv,
        vol_shock: Math.log(bars[i].v / volAvg),
        range_pos: (b.c - lo) / ((hi - lo) || 1e-9) - 0.5,
        wick_skew: (lower - upper) / ((body + upper + lower) || 1e-9),
        funding_level: fNow,
        funding_dev: fNow - fAvg,
      },
      fwd: bars[i + HOLD_BARS].c / b.c - 1,
    });
  }
  return feats;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1e-9; };

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 30) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const m = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { const a = rx[i] - m, b = ry[i] - m; num += a * b; dx += a * a; dy += b * b; }
  return num / (Math.sqrt(dx * dy) || 1e-12);
}

function main(data) {
  // pool all symbols, demeaned per symbol so no coin's drift can manufacture IC
  const all = [];
  for (const [sym, rows] of data) {
    const fwdMean = mean(rows.map((r) => r.fwd));
    for (const r of rows) all.push({ sym, t: r.t, f: r.f, fwd: r.fwd - fwdMean });
  }
  all.sort((a, b) => a.t - b.t);
  const names = Object.keys(all[0].f);
  const half = Math.floor(all.length / 2);
  const IS = all.slice(0, half), OOS = all.slice(half);

  console.log(`symbols ${data.size}, pooled observations ${all.length}, ${INTERVAL} bars, hold ${HOLD_BARS} bars (~1d)`);
  console.log(`forward returns are SYMBOL-DEMEANED (kills coin drift, which is what destroyed the v3 flow signal)`);
  console.log(`in-sample ${IS.length} (${new Date(IS[0].t).toISOString().slice(0, 10)} ~ ${new Date(IS[IS.length - 1].t).toISOString().slice(0, 10)})`);
  console.log(`out-of-sample ${OOS.length} (${new Date(OOS[0].t).toISOString().slice(0, 10)} ~ ${new Date(OOS[OOS.length - 1].t).toISOString().slice(0, 10)})\n`);

  // ---- indicator selection, IN-SAMPLE ONLY --------------------------------
  console.log("=== STEP 1: each indicator alone, IN-SAMPLE (decides sign + inclusion) ===");
  console.log("indicator        IC(in)    IC(out)   sign    included");
  const chosen = [];
  for (const nm of names) {
    const icIn = spearman(IS.map((r) => r.f[nm]), IS.map((r) => r.fwd));
    const icOut = spearman(OOS.map((r) => r.f[nm]), OOS.map((r) => r.fwd));
    const include = icIn !== null && Math.abs(icIn) >= MIN_ABS_IC;
    const sign = icIn >= 0 ? 1 : -1;
    if (include) chosen.push({ nm, sign });
    console.log(
      nm.padEnd(16) + (icIn === null ? "  n/a" : icIn.toFixed(4)).padStart(8) +
      (icOut === null ? "  n/a" : icOut.toFixed(4)).padStart(10) +
      String(sign > 0 ? "+" : "-").padStart(7) +
      (include ? "      yes" : "      no") +
      (include && icIn * icOut < 0 ? "   <- sign FLIPS out of sample" : "")
    );
  }
  console.log(`\nincluded ${chosen.length}/${names.length} indicators at |IC| >= ${MIN_ABS_IC}`);
  if (!chosen.length) { console.log("nothing cleared the bar — no composite to build."); return; }

  // ---- composite ----------------------------------------------------------
  // z-scores computed on IN-SAMPLE moments only, then applied to both halves.
  const stats = {};
  for (const { nm } of chosen) {
    const v = IS.map((r) => r.f[nm]);
    stats[nm] = { m: mean(v), s: sd(v) };
  }
  const score = (r) => chosen.reduce((s, { nm, sign }) => s + sign * ((r.f[nm] - stats[nm].m) / stats[nm].s), 0) / chosen.length;

  console.log("\n=== STEP 2: composite vs its best single ingredient ===");
  const icCompIn = spearman(IS.map(score), IS.map((r) => r.fwd));
  const icCompOut = spearman(OOS.map(score), OOS.map((r) => r.fwd));
  const bestSingleOut = Math.max(...chosen.map(({ nm, sign }) =>
    Math.abs(spearman(OOS.map((r) => sign * r.f[nm]), OOS.map((r) => r.fwd)))));
  console.log(`  composite IC in-sample      ${icCompIn.toFixed(4)}`);
  console.log(`  composite IC OUT-OF-SAMPLE  ${icCompOut.toFixed(4)}   <- the only number that counts`);
  console.log(`  best single ingredient OOS  ${bestSingleOut.toFixed(4)}`);
  console.log(`  -> combining ${Math.abs(icCompOut) > bestSingleOut ? "BEATS" : "does not beat"} the best single indicator`);

  // ---- tradable book, OUT-OF-SAMPLE --------------------------------------
  //
  // TWO measurements of the same book, and the gap between them is the whole
  // lesson. (A) treats every bar as an observation. With a 6-bar hold each
  // 4h bar overlaps the next by 5/6, and at any timestamp 24 symbols correlated
  // ~0.69 all fire together, so the same move is counted many times over.
  // (B) forms an actual portfolio at each non-overlapping rebalance and takes
  // ONE observation per period, which is what a trader would experience.
  //
  // (A) is reported only so the inflation is visible. It is not evidence.
  console.log("\n=== STEP 3: tradable long/short book, OUT-OF-SAMPLE ===");
  console.log("symmetric: long above +t, short below -t, identical threshold both sides");
  console.log("(A) overlapping per-bar observations   (B) non-overlapping portfolio periods\n");
  console.log("   t    (A) n     (A) net%   (A) t   |  (B) n   (B) net%   (B) t    (B) ann%");

  const stamps = [...new Set(OOS.map((r) => r.t))].sort((a, b) => a - b);
  const byT = new Map();
  for (const r of OOS) { if (!byT.has(r.t)) byT.set(r.t, []); byT.get(r.t).push(r); }

  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6]) {
    const lapped = [];
    for (const r of OOS) {
      const s = score(r);
      if (s > t) lapped.push(r.fwd * 100 - COST_PCT);
      else if (s < -t) lapped.push(-r.fwd * 100 - COST_PCT);
    }
    if (lapped.length < 50) continue;
    const mA = mean(lapped);
    const tA = mA / (sd(lapped) / Math.sqrt(lapped.length));

    const port = [];
    for (let k = 0; k < stamps.length; k += HOLD_BARS) {
      const legs = [];
      for (const r of (byT.get(stamps[k]) || [])) {
        const s = score(r);
        if (s > t) legs.push(r.fwd * 100 - COST_PCT);
        else if (s < -t) legs.push(-r.fwd * 100 - COST_PCT);
      }
      if (legs.length >= 3) port.push(mean(legs));
    }
    if (port.length < 20) continue;
    const mB = mean(port);
    const tB = mB / (sd(port) / Math.sqrt(port.length));
    const annB = mB * (365 / (HOLD_BARS / BARS_PER_DAY));

    console.log(
      t.toFixed(1).padStart(5) + String(lapped.length).padStart(9) +
      mA.toFixed(4).padStart(11) + tA.toFixed(2).padStart(8) + "   |" +
      String(port.length).padStart(7) + mB.toFixed(4).padStart(11) +
      tB.toFixed(2).padStart(8) + annB.toFixed(1).padStart(11) +
      (tB > 1.96 ? "  <- significant" : "")
    );
  }
  console.log(`\ncost charged: ${COST_PCT}% round trip on every trade.`);
  console.log("returns are symbol-demeaned, so a rising market cannot flatter the long side.");
  console.log("Only column (B) is evidence. If (A) and (B) disagree, (A) is the artefact.");
}

(async () => {
  const data = new Map();
  for (const sym of UNIVERSE) {
    try {
      const [bars, funding] = await Promise.all([fetchKlines(sym), fetchFunding(sym)]);
      if (bars.length > 500) {
        const f = buildFeatures(bars, funding);
        if (f.length > 200) data.set(sym, f);
      }
    } catch (e) { console.error(`skip ${sym}: ${e.message}`); }
  }
  main(data);
})().catch((e) => { console.error(e); process.exit(1); });
