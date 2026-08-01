#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-futures-flow.js (2026-08-01)
//
// v3 tested 107 configurations built ONLY from public klines — price and
// volume. Binance futures publishes information that is NOT derivable from
// price at all, and none of it was ever tested:
//
//   openInterestHist            position build-up / unwind
//   topLongShortPositionRatio   what the largest accounts hold
//   globalLongShortAccountRatio what the retail crowd holds
//   takerlongshortRatio         aggressive order flow
//
// The classic reads this enables:
//   price↑ + OI↑ = new longs (continuation)   price↑ + OI↓ = short covering (fades)
//   price↓ + OI↑ = new shorts                 price↓ + OI↓ = long liquidation (bounce)
//   top-traders vs retail DIVERGENCE = smart money against the crowd
//
// Method: information coefficient (Spearman rank correlation) between each
// feature and FORWARD returns, computed pooled across symbols, plus a
// first-half / second-half split.
//
// HARD LIMIT, stated up front: these endpoints cap at 500 points, so at 1h
// granularity the entire study covers ~21 days — a SINGLE market regime. An
// IC that shows up here is a lead worth forward-testing, never a validated
// edge. The v3 lesson (107 configs, ~5 false positives expected) applies with
// full force: this script reports ALL features tested, not a winner.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT"];
const PERIOD = "1h";
const LIMIT = 500;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const F = "https://fapi.binance.com";

async function loadSymbol(sym) {
  const [oi, topPos, global, taker, kl] = await Promise.all([
    getJson(`${F}/futures/data/openInterestHist?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/futures/data/takerlongshortRatio?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/fapi/v1/klines?symbol=${sym}&interval=${PERIOD}&limit=${LIMIT + 30}`),
  ]);
  const byTs = new Map();
  const put = (ts, k, v) => {
    const t = Number(ts);
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    if (!byTs.has(t)) byTs.set(t, { ts: t });
    byTs.get(t)[k] = v;
  };
  for (const r of oi) put(r.timestamp, "oi", Number(r.sumOpenInterest));
  for (const r of topPos) put(r.timestamp, "topLong", Number(r.longAccount));
  for (const r of global) put(r.timestamp, "retailLong", Number(r.longAccount));
  for (const r of taker) put(r.timestamp, "takerRatio", Number(r.buySellRatio));
  for (const r of kl) put(r[0], "close", Number(r[4]));
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

// Spearman rank correlation
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 30) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
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
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return num / (Math.sqrt(dx * dy) || 1e-9);
}

async function main() {
  const perSymbol = new Map();
  for (const s of SYMS) {
    try { perSymbol.set(s, await loadSymbol(s)); } catch (e) { console.error(`skip ${s}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 220));
  }
  const anyRows = [...perSymbol.values()][0] || [];
  console.log(`symbols ${perSymbol.size}, bars/symbol ~${anyRows.length}, span ~${anyRows.length ? ((anyRows[anyRows.length - 1].ts - anyRows[0].ts) / 864e5).toFixed(1) : 0} days (${PERIOD})\n`);

  // build feature rows pooled across symbols
  const FEATURES = {
    oi_chg_1h: (r, p) => p.oi ? r.oi / p.oi - 1 : null,
    oi_chg_4h: (r, p, h4) => h4 && h4.oi ? r.oi / h4.oi - 1 : null,
    top_long: (r) => r.topLong ?? null,
    top_long_chg_4h: (r, p, h4) => (h4 && h4.topLong != null && r.topLong != null) ? r.topLong - h4.topLong : null,
    retail_long: (r) => r.retailLong ?? null,
    // the classic: largest accounts positioned against the crowd
    top_minus_retail: (r) => (r.topLong != null && r.retailLong != null) ? r.topLong - r.retailLong : null,
    taker_ratio: (r) => r.takerRatio ?? null,
    // price↑+OI↑ = +1 (new longs), price↑+OI↓ = -1 (short covering), etc.
    price_oi_quadrant: (r, p) => {
      if (!p || !p.close || !p.oi) return null;
      const dp = r.close / p.close - 1, doi = r.oi / p.oi - 1;
      if (dp > 0 && doi > 0) return 1;
      if (dp > 0 && doi < 0) return -1;
      if (dp < 0 && doi > 0) return -2;
      return 2; // price down + OI down = long liquidation / capitulation
    },
  };
  const HORIZONS = { fwd_1h: 1, fwd_4h: 4, fwd_24h: 24 };

  const pooled = [];
  for (const [sym, rows] of perSymbol) {
    for (let i = 4; i < rows.length; i += 1) {
      const r = rows[i], p = rows[i - 1], h4 = rows[i - 4];
      if (!r.close || !p) continue;
      const feats = {};
      for (const [name, fn] of Object.entries(FEATURES)) {
        const v = fn(r, p, h4);
        if (v !== null && Number.isFinite(v)) feats[name] = v;
      }
      const fwd = {};
      for (const [name, h] of Object.entries(HORIZONS)) {
        const fut = rows[i + h];
        if (fut && fut.close) fwd[name] = fut.close / r.close - 1;
      }
      pooled.push({ sym, ts: r.ts, feats, fwd });
    }
  }
  console.log(`pooled observations: ${pooled.length}\n`);

  const half = Math.floor(pooled.length / 2);
  const sorted = [...pooled].sort((a, b) => a.ts - b.ts);
  const segs = { ALL: sorted, "1st": sorted.slice(0, half), "2nd": sorted.slice(half) };

  console.log("=== INFORMATION COEFFICIENT (Spearman rank corr, feature vs forward return) ===");
  console.log("interpretation: |IC| < 0.03 is noise; 0.03-0.05 is weak; >0.05 is notable at this sample size");
  console.log();
  console.log("feature".padEnd(20) + "horizon".padEnd(10) + "IC(ALL)".padStart(9) + "IC(1st)".padStart(9) + "IC(2nd)".padStart(9) + "  stable?");
  const results = [];
  for (const fname of Object.keys(FEATURES)) {
    for (const hname of Object.keys(HORIZONS)) {
      const ics = {};
      for (const [segName, seg] of Object.entries(segs)) {
        const xs = [], ys = [];
        for (const row of seg) {
          if (row.feats[fname] === undefined || row.fwd[hname] === undefined) continue;
          xs.push(row.feats[fname]); ys.push(row.fwd[hname]);
        }
        ics[segName] = spearman(xs, ys);
      }
      if (ics.ALL === null) continue;
      const stable = ics["1st"] !== null && ics["2nd"] !== null &&
        Math.sign(ics["1st"]) === Math.sign(ics["2nd"]) && Math.abs(ics.ALL) >= 0.03;
      results.push({ fname, hname, ...ics, stable });
      console.log(
        fname.padEnd(20) + hname.padEnd(10) +
        ics.ALL.toFixed(4).padStart(9) +
        (ics["1st"] === null ? "    -" : ics["1st"].toFixed(4)).padStart(9) +
        (ics["2nd"] === null ? "    -" : ics["2nd"].toFixed(4)).padStart(9) +
        (stable ? "   <<< sign-stable & |IC|>=0.03" : "")
      );
    }
  }

  console.log(`\n=== SUMMARY ===`);
  const stable = results.filter((r) => r.stable);
  console.log(`tested ${results.length} feature x horizon combinations`);
  console.log(`sign-stable with |IC| >= 0.03: ${stable.length}`);
  if (stable.length) {
    for (const s of stable) console.log(`  ${s.fname} @ ${s.hname}: IC ${s.ALL.toFixed(4)} (1st ${s["1st"].toFixed(4)} / 2nd ${s["2nd"].toFixed(4)})`);
  } else {
    console.log("  none — no futures-flow feature shows stable predictive power in this window");
  }
  console.log(`\nexpected false positives at this test count: ~${(results.length * 0.05).toFixed(1)}`);
  console.log("window covers ONE regime (~21 days) — treat any hit as a lead to forward-test, not an edge.");
}

main().catch((e) => { console.error(e); process.exit(1); });
