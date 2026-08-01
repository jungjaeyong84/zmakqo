#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-flow-controls.js (2026-08-01)
//
// The flow study produced retail_long IC +0.111 and top_minus_retail IC
// -0.127 at 24h — larger than professional equity factors (0.02-0.05) and
// pointing the OPPOSITE way to the smart-money story (it says follow retail,
// fade the big accounts). Results that good and that counterintuitive are
// usually artifacts. Three specific ways it could be fake, all tested here:
//
//   A. MOMENTUM IN DISGUISE. Retail long-share rises after price rises, so
//      the feature may be a laundered trailing-return. Control: residualize
//      the feature on trailing returns (1h/4h/24h) and re-measure IC.
//   B. OVERLAP INFLATION. 1h bars with 24h forward returns overlap 23/24, so
//      n=8416 is really ~350 independent draws. Control: sample every 24th
//      bar so observations are non-overlapping, and report the standard
//      error that actually applies.
//   C. SYMBOL DRIFT. Pooling raw values lets a coin that simply trended for
//      21 days manufacture the correlation. Control: demean feature AND
//      forward return within each symbol (pure cross-sectional signal).
//
// A feature that survives all three is a genuine lead. One that dies in any
// of them was never information.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT"];
const PERIOD = "1h", LIMIT = 500, F = "https://fapi.binance.com";

const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

async function loadSymbol(sym) {
  const [topPos, global, kl] = await Promise.all([
    getJson(`${F}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${PERIOD}&limit=${LIMIT}`),
    getJson(`${F}/fapi/v1/klines?symbol=${sym}&interval=${PERIOD}&limit=${LIMIT + 30}`),
  ]);
  const m = new Map();
  const put = (ts, k, v) => { const t = Number(ts); if (!Number.isFinite(t) || !Number.isFinite(v)) return; if (!m.has(t)) m.set(t, { ts: t }); m.get(t)[k] = v; };
  for (const r of topPos) put(r.timestamp, "topLong", Number(r.longAccount));
  for (const r of global) put(r.timestamp, "retailLong", Number(r.longAccount));
  for (const r of kl) put(r[0], "close", Number(r[4]));
  return [...m.values()].sort((a, b) => a.ts - b.ts);
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 30) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
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

// OLS residual of y on a set of regressors (with intercept)
function residualize(y, Xcols) {
  const n = y.length, k = Xcols.length + 1;
  const X = [];
  for (let i = 0; i < n; i += 1) X.push([1, ...Xcols.map((c) => c[i])]);
  // normal equations via Gaussian elimination
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let a = 0; a < k; a += 1) {
    for (let b = 0; b < k; b += 1) { let s = 0; for (let i = 0; i < n; i += 1) s += X[i][a] * X[i][b]; A[a][b] = s; }
    let s = 0; for (let i = 0; i < n; i += 1) s += X[i][a] * y[i]; A[a][k] = s;
  }
  for (let c = 0; c < k; c += 1) {
    let p = c; for (let r = c + 1; r < k; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = 0; r < k; r += 1) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j += 1) A[r][j] -= f * A[c][j]; }
  }
  const beta = A.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[k] / row[i]));
  return y.map((v, i) => v - X[i].reduce((s, xv, j) => s + xv * beta[j], 0));
}

async function main() {
  const data = new Map();
  for (const s of SYMS) {
    try { data.set(s, await loadSymbol(s)); } catch (e) { console.error(`skip ${s}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 200));
  }

  // build rows with trailing returns as controls
  const rows = [];
  for (const [sym, arr] of data) {
    for (let i = 24; i < arr.length - 24; i += 1) {
      const r = arr[i];
      if (!r.close || r.retailLong == null || r.topLong == null) continue;
      const p1 = arr[i - 1], p4 = arr[i - 4], p24 = arr[i - 24], fut = arr[i + 24];
      if (!p1?.close || !p4?.close || !p24?.close || !fut?.close) continue;
      rows.push({
        sym, ts: r.ts, i,
        retail_long: r.retailLong,
        top_minus_retail: r.topLong - r.retailLong,
        ret_1h: r.close / p1.close - 1,
        ret_4h: r.close / p4.close - 1,
        ret_24h: r.close / p24.close - 1,
        fwd_24h: fut.close / r.close - 1,
      });
    }
  }
  console.log(`rows: ${rows.length}, symbols: ${data.size}\n`);

  const FEATS = ["retail_long", "top_minus_retail"];

  console.log("=== BASELINE (as reported by the flow study) ===");
  for (const f of FEATS) {
    console.log(`  ${f.padEnd(18)} IC = ${spearman(rows.map((r) => r[f]), rows.map((r) => r.fwd_24h)).toFixed(4)}`);
  }

  console.log("\n=== CONTROL A: residualized on trailing returns (is it just momentum?) ===");
  for (const f of FEATS) {
    const resid = residualize(rows.map((r) => r[f]), [rows.map((r) => r.ret_1h), rows.map((r) => r.ret_4h), rows.map((r) => r.ret_24h)]);
    const ic = spearman(resid, rows.map((r) => r.fwd_24h));
    console.log(`  ${f.padEnd(18)} IC after removing trailing returns = ${ic.toFixed(4)}`);
  }
  // and what does raw trailing return itself predict? (the momentum benchmark)
  console.log(`  ${"[ret_24h itself]".padEnd(18)} IC = ${spearman(rows.map((r) => r.ret_24h), rows.map((r) => r.fwd_24h)).toFixed(4)}   <- the momentum baseline`);

  console.log("\n=== CONTROL B: non-overlapping observations (every 24th bar) ===");
  const nonOverlap = rows.filter((r) => r.i % 24 === 0);
  console.log(`  independent-ish n = ${nonOverlap.length} (vs ${rows.length} overlapping)`);
  const se = 1 / Math.sqrt(Math.max(nonOverlap.length - 1, 1));
  console.log(`  IC standard error at this n ≈ ${se.toFixed(4)}  => |IC| must exceed ~${(1.96 * se).toFixed(4)} for 95% significance`);
  for (const f of FEATS) {
    const ic = spearman(nonOverlap.map((r) => r[f]), nonOverlap.map((r) => r.fwd_24h));
    const sig = ic !== null && Math.abs(ic) > 1.96 * se;
    console.log(`  ${f.padEnd(18)} IC = ${ic === null ? "n/a" : ic.toFixed(4)}  ${sig ? "significant" : "NOT significant"}`);
  }

  console.log("\n=== CONTROL C: symbol-demeaned (pure cross-sectional, kills coin drift) ===");
  const bySym = new Map();
  for (const r of rows) { if (!bySym.has(r.sym)) bySym.set(r.sym, []); bySym.get(r.sym).push(r); }
  for (const f of FEATS) {
    const xs = [], ys = [];
    for (const [, arr] of bySym) {
      const mf = arr.reduce((s, r) => s + r[f], 0) / arr.length;
      const my = arr.reduce((s, r) => s + r.fwd_24h, 0) / arr.length;
      for (const r of arr) { xs.push(r[f] - mf); ys.push(r.fwd_24h - my); }
    }
    console.log(`  ${f.padEnd(18)} IC demeaned = ${spearman(xs, ys).toFixed(4)}`);
  }

  console.log("\n=== VERDICT ===");
  console.log("A feature is a genuine lead only if it survives ALL THREE controls.");
}

main().catch((e) => { console.error(e); process.exit(1); });
