#!/usr/bin/env node
"use strict";

// scripts/evaluate-upbit-premium-fade.js — fade a Korea-local blow-off
// (2026-09-20). GPT-5.5's ninth-consultation candidate 2, its rule verbatim.
//
// Mechanism: when one alt goes vertical on Upbit with a premium over the global
// price and a volume spike, that is Korean retail demand hitting a market that
// cannot be arbitraged quickly (capital controls, transfer delays). The global
// price does not have to follow. Shorting the Binance perp — not the Korean
// venue — takes the reversion without touching the KRW leg at all. This is not
// the inventory arbitrage that failed earlier today (month 0.27%): it trades
// only the extremes, and it never needs a KRW balance.
//
// FROZEN SPEC (written before any event P&L was computed)
//   universe   Upbit KRW markets with a Binance USDT perp (237 pairs). For
//              1000X / 1000000X contracts the perp price is divided by the
//              multiplier so both sides are per-token.
//   premium    upbit_close_krw / (perp_close_usdt / mult x USDKRW) - 1, with
//              USDKRW the last daily close BEFORE the event day.
//   trigger    premium >= 7% AND Upbit trailing 24h value >= 3x its 30-day
//              median AND the perp's 12h return >= 12%.
//   entry      short the perp at the close of the NEXT hourly bar.
//   exit       premium <= 2%, or 72h, whichever first.
//   stop       hourly high >= 1.18x entry -> out at 1.18x entry.
//   target     hourly low <= 0.85x entry -> out at 0.85x entry.
//   size       5% of NAV per event, gross <= 60%, 14-day cooldown per token.
//   costs      0.15% per side; funding paid by the short debited when available.
//
//   PASS (all of them)
//     >= 60 events; losing months <= 20%; mean / |worst month| >= 0.25; both
//     halves positive; top 5 events <= 40% of profit; best month <= 25% of
//     profit; best token <= 25% of profit; the 5th percentile of a monthly
//     bootstrap mean >= 0; and the size for a 3% mean month x peak concurrent
//     <= 150% of NAV.
//   PLACEBO (required, not scored into PASS but reported): the same rule on
//     events shifted +7 days, and on a random other pair at the same timestamp.
//     A real effect must beat both clearly.
//
// Usage: node scripts/evaluate-upbit-premium-fade.js --data DIR

const fs = require("fs");
const path = require("path");

// ---- frozen parameters ------------------------------------------------------
const H = 3600e3;
const DAY = 864e5;
const PREM_IN = 0.07;
const PREM_OUT = 0.02;
const VOL_MULT = 3;
const VOL_MEDIAN_DAYS = 30;
const RET12_IN = 0.12;
const MAX_HOURS = 72;
const STOP = 1.18;
const TARGET = 0.85;
const SIZE = 0.05;
const MAX_GROSS = 0.60;
const COOLDOWN_DAYS = 14;
const COST = 0.0015;
const MIN_EVENTS = 60;
const PLACEBO_SHIFT = 7 * DAY;
// -----------------------------------------------------------------------------

function readJson(p, fb = null) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return fb; } }

function fxLookup(fx) {
  const days = fx.map(([t, v]) => [Math.floor(t / DAY) * DAY, v]).sort((a, b) => a[0] - b[0]);
  return (t) => {
    const d = Math.floor(t / DAY) * DAY;
    let lo = 0, hi = days.length - 1, ans = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m][0] < d) { ans = days[m][1]; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
}

function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }

// Daily screen: which days deserve hourly data.
function candidateDays(dir, pairs, fxAt) {
  const out = [];
  for (const p of pairs) {
    const up = readJson(path.join(dir, "upbit", `${p.market}.json`), []);
    const bnRows = readJson(path.join(dir, "binance", `${p.perp}.json`), []);
    if (!up.length || !bnRows.length) continue;
    const bn = new Map(bnRows.map((r) => [r[0], r]));
    const vols = [];
    for (let i = 0; i < up.length; i += 1) {
      const [t, close, value] = up[i];
      vols.push(value);
      if (vols.length > VOL_MEDIAN_DAYS) vols.shift();
      const b = bn.get(t);
      const fx = fxAt(t);
      if (!b || !fx || vols.length < VOL_MEDIAN_DAYS) continue;
      const prem = close / ((b[4] / p.mult) * fx) - 1;
      const med = median(vols.slice(0, -1));
      if (prem >= PREM_IN && med && value >= VOL_MULT * med) out.push({ ...p, day: t, daily_premium: prem, median_value: med });
    }
  }
  return out;
}

// Hourly simulation over one event window.
function runEvent({ pair, bars, upbitHourly, fxAt, medValue, shiftMs = 0, overridePerp = null }) {
  const perpBars = overridePerp || bars;
  const idx = new Map(perpBars.map((b, i) => [b[0], i]));
  for (let i = 12; i < perpBars.length - 1; i += 1) {
    const t = perpBars[i][0] + shiftMs;
    const j = idx.get(t);
    if (j === undefined || j < 12 || j >= perpBars.length - 1) continue;
    const u = upbitHourly.get(t);
    const fx = fxAt(t);
    if (!u || !fx) continue;
    const prem = u.close / ((perpBars[j][4] / pair.mult) * fx) - 1;
    const ret12 = perpBars[j][4] / perpBars[j - 12][4] - 1;
    if (!(prem >= PREM_IN && ret12 >= RET12_IN && u.value24 >= VOL_MULT * medValue)) continue;
    const e = j + 1;                                   // enter at the NEXT hourly close
    const entry = perpBars[e][4];
    let exitPrice = null, reason = null, exitTs = null;
    for (let k = e + 1; k < perpBars.length && k <= e + MAX_HOURS; k += 1) {
      const b = perpBars[k];
      if (b[2] >= entry * STOP) { exitPrice = entry * STOP; reason = "STOP"; exitTs = b[0]; break; }
      if (b[3] <= entry * TARGET) { exitPrice = entry * TARGET; reason = "TARGET"; exitTs = b[0]; break; }
      const uu = upbitHourly.get(b[0]);
      const fxk = fxAt(b[0]);
      if (uu && fxk) {
        const pk = uu.close / ((b[4] / pair.mult) * fxk) - 1;
        if (pk <= PREM_OUT) { exitPrice = b[4]; reason = "PREMIUM_CLOSED"; exitTs = b[0]; break; }
      }
      if (k === e + MAX_HOURS) { exitPrice = b[4]; reason = "TIME"; exitTs = b[0]; break; }
    }
    if (!exitPrice) { const last = perpBars[perpBars.length - 1]; exitPrice = last[4]; reason = "DATA_END"; exitTs = last[0]; }
    const pnl = -(exitPrice - entry) / entry - 2 * COST;
    return { token: pair.token, entry_ts: perpBars[e][0], entry, exit_ts: exitTs, exit: exitPrice, reason, pnl, premium: prem, ret12 };
  }
  return null;
}

function portfolio(trades) {
  const byMonth = new Map();
  const open = new Map();
  const taken = [];
  const cooldown = new Map();
  for (const t of trades.slice().sort((a, b) => a.entry_ts - b.entry_ts)) {
    const cd = cooldown.get(t.token);
    if (cd && t.entry_ts - cd < COOLDOWN_DAYS * DAY) continue;
    const concurrent = taken.filter((x) => x.exit_ts > t.entry_ts).length;
    if ((concurrent + 1) * SIZE > MAX_GROSS) continue;
    cooldown.set(t.token, t.entry_ts);
    taken.push(t);
    for (let h = t.entry_ts; h <= t.exit_ts; h += H) open.set(h, (open.get(h) || 0) + 1);
    const m = new Date(t.exit_ts).toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + t.pnl);
  }
  const months = [...byMonth].sort();
  const vals = months.map(([, v]) => v);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const worst = vals.length ? Math.min(...vals) : 0;
  const best = vals.length ? Math.max(...vals) : 0;
  const total = taken.reduce((a, t) => a + t.pnl, 0);
  const byToken = new Map();
  for (const t of taken) byToken.set(t.token, (byToken.get(t.token) || 0) + t.pnl);
  const topToken = Math.max(0, ...byToken.values());
  const top5 = taken.map((t) => t.pnl).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  // monthly bootstrap: 2000 resamples of the month series
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const means = [];
  for (let i = 0; i < 2000 && vals.length; i += 1) {
    let s = 0;
    for (let k = 0; k < vals.length; k += 1) s += vals[Math.floor(rnd() * vals.length)];
    means.push(s / vals.length);
  }
  means.sort((a, b) => a - b);
  return { trades: taken, months, vals, mean, worst, best, total, top5, topToken,
    peak: Math.max(0, ...open.values()), p5: means.length ? means[Math.floor(means.length * 0.05)] : null };
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data DIR"); process.exit(2); }
  const dir = process.argv[i + 1];
  const pairs = readJson(path.join(dir, "pairs.json")).pairs;
  const fxAt = fxLookup(readJson(path.join(dir, "fx.json")));
  const cands = candidateDays(dir, pairs, fxAt);
  const windows = readJson(path.join(dir, "windows.json"), {});   // written by fetch2.js
  const real = [], shifted = [], random = [];
  const pairByToken = new Map(pairs.map((p) => [p.token, p]));
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const c of cands) {
    const w = windows[`${c.market}_${new Date(c.day).toISOString().slice(0, 10)}`];
    if (!w) continue;
    const perpBars = w.perp;
    const upbitHourly = new Map(w.upbit.map(([t, close, value24]) => [t, { close, value24 }]));
    const t1 = runEvent({ pair: c, bars: perpBars, upbitHourly, fxAt, medValue: c.median_value });
    if (t1) real.push(t1);
    const t2 = runEvent({ pair: c, bars: perpBars, upbitHourly, fxAt, medValue: c.median_value, shiftMs: PLACEBO_SHIFT });
    if (t2) shifted.push(t2);
    const others = pairs.filter((p) => p.token !== c.token && windows[`${p.market}_${new Date(c.day).toISOString().slice(0, 10)}`]);
    if (others.length) {
      const o = others[Math.floor(rnd() * others.length)];
      const ow = windows[`${o.market}_${new Date(c.day).toISOString().slice(0, 10)}`];
      const t3 = runEvent({ pair: o, bars: ow.perp, upbitHourly: new Map(ow.upbit.map(([t, close, value24]) => [t, { close, value24 }])), fxAt, medValue: c.median_value });
      if (t3) random.push(t3);
    }
  }
  const R = portfolio(real), S = portfolio(shifted), X = portfolio(random);
  const sizeFor3 = R.mean > 0 ? 0.03 / R.mean : null;
  const pass = R.trades.length >= MIN_EVENTS
    && R.vals.filter((v) => v < 0).length / R.vals.length <= 0.2
    && R.worst < 0 && R.mean / Math.abs(R.worst) >= 0.25
    && R.total > 0 && R.top5 / R.total <= 0.4 && R.best / R.total <= 0.25 && R.topToken / R.total <= 0.25
    && R.p5 >= 0 && sizeFor3 !== null && sizeFor3 * R.peak <= 1.5;
  const brief = (P) => ({ events: P.trades.length, mean_month: +P.mean.toFixed(4), win_rate: P.trades.length ? +(P.trades.filter((t) => t.pnl > 0).length / P.trades.length).toFixed(3) : null,
    trade_mean_pct: P.trades.length ? +((P.total / P.trades.length) * 100).toFixed(2) : null });
  console.log(JSON.stringify({
    candidate_days: cands.length, windows_available: Object.keys(windows).length,
    real: { ...brief(R), months: R.months.length, losing_share: +(R.vals.filter((v) => v < 0).length / R.vals.length).toFixed(3),
      worst_month: +R.worst.toFixed(3), mean_over_worst: R.worst < 0 ? +(R.mean / Math.abs(R.worst)).toFixed(3) : null,
      top5_share: R.total > 0 ? +(R.top5 / R.total).toFixed(3) : null, best_month_share: R.total > 0 ? +(R.best / R.total).toFixed(3) : null,
      best_token_share: R.total > 0 ? +(R.topToken / R.total).toFixed(3) : null, bootstrap_p5: R.p5 === null ? null : +R.p5.toFixed(4),
      peak_concurrent: R.peak, size_for_3pct: sizeFor3 === null ? null : +sizeFor3.toFixed(3),
      gross_at_peak: sizeFor3 === null ? null : +(sizeFor3 * R.peak).toFixed(2),
      by_exit: Object.fromEntries(["STOP", "TARGET", "PREMIUM_CLOSED", "TIME", "DATA_END"].map((r) => [r, R.trades.filter((t) => t.reason === r).length])) },
    placebo_shifted_7d: brief(S), placebo_random_pair: brief(X),
    verdict: pass ? "PASS" : "FAIL",
    monthly: R.months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`),
  }, null, 1));
}

if (require.main === module) main();
