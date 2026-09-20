#!/usr/bin/env node
"use strict";

// scripts/evaluate-residual-reversal-xs.js — does a perp's idiosyncratic move
// over the last three days reverse the next day? (2026-09-19)
//
// ORIGIN
// ------
// Chosen independently by Claude and by GPT-5.5 (two rounds of consultation,
// 2026-09-19) as the one remaining predictive test worth running: it is the
// only candidate with years of history and wide breadth already on disk, and
// it overlaps least with what failed. Both put its chance of surviving at
// roughly 10%, and its payoff if it survives at 0.3-1% a month — not the
// 3-5% the user wants.
//
// Mechanism: liquidity demanders who need to trade now push a name away from
// its factor-implied price; whoever supplies that liquidity is paid by the
// reversal. Expected sign: IC < 0 (high past residual -> low next-day return).
//
// FROZEN SPEC (written before the first run; do not tune)
// -------------------------------------------------------
//   bars      daily perp klines; bar t covers [t, t+1d). R(t) = close[t]/close[t-1d] - 1.
//             Bars still forming at fetch time are dropped.
//   day d     one panel per UTC day; every input is known at d 00:00.
//   betas     per symbol, OLS of R on [1, R_BTC, R_ETH] over bars d-60..d-1
//             (>= 45 valid); residual e(t) = R - a - b1 R_BTC - b2 R_ETH.
//   score     e(d-3) + e(d-2) + e(d-1)                (GPT's choice: 3 days)
//   forward   R(d), raw; the gate demeans per panel.
//   universe  >= 60 prior bars, >= 5 of the previous 7 days' quote volume,
//             top 200 by that average; BTCUSDT and ETHUSDT excluded (they are
//             the factors); panels with < 100 eligible names skipped.
//   gate      monotonicityGate: 5 buckets, NW lag 5, |t| 1.96
//   book      long the lowest-score quintile, short the highest, 0.5 gross per
//             side equal weight, rebalanced daily. Charged: 0.07% per unit of
//             turnover, and funding paid on longs / received on shorts over
//             day d. Book alpha is the intercept of net return on R_BTC.
//   split     calendar: DISCOVERY 2023-03-05 .. 2025-08-26 (first 70%),
//             CONFIRMATION 2025-08-27 .. last complete day (last 30%).
//
//   decision
//     discovery gate fails                          -> REJECTED; confirmation unread
//     gate passes with IC > 0                       -> OPPOSITE_SIGN (momentum, a
//                                                      different hypothesis); stop
//     gate passes, IC < 0, net book mean <= 0       -> REJECTED_COST; confirmation unread
//     then CONFIRMATION, read once:
//       IC < 0, net book NW-t > 1.645, net alpha vs BTC > 0  -> CONFIRM_PASS
//       otherwise                                             -> REJECTED
//     CONFIRM_PASS means: register for forward confirmation. It authorises no book.
//
// KNOWN BIAS: only perps listed on the fetch date have history.
//
// Usage
//   node scripts/evaluate-residual-reversal-xs.js --data DIR
// DIR: meta.json, daily/SYM.json ([[openTime, close, quoteVolume]]),
//      funding/SYM.json ([[fundingTime, rate]]).

const fs = require("fs");
const path = require("path");
const { evaluateMonotonicity, formatMonotonicityReport, neweyWestT } = require("../src/research/monotonicityGate");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const BETA_WINDOW = 60;
const BETA_MIN = 45;
const SIGNAL_DAYS = 3;
const MIN_AGE = 60;
const VOL_WINDOW = 7;
const VOL_MIN_DAYS = 5;
const TOP_N = 200;
const MIN_ELIGIBLE = 100;
const BUCKETS = 5;
const NW_LAG = 5;
const T = 1.96;
const T_CONFIRM = 1.645;
const COST_PER_TURNOVER = 0.0007;
const FACTORS = ["BTCUSDT", "ETHUSDT"];
const DISCOVERY_FROM = Date.parse("2023-03-05T00:00:00Z");
const CONFIRM_FROM = Date.parse("2025-08-27T00:00:00Z");
// -----------------------------------------------------------------------------

function load(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const fetchedAt = Date.parse(meta.fetched_at);
  const out = new Map();
  for (const m of meta.perps) {
    const kp = path.join(dir, "daily", `${m.symbol}.json`);
    const fp = path.join(dir, "funding", `${m.symbol}.json`);
    if (!fs.existsSync(kp) || !fs.existsSync(fp)) continue;
    const bars = JSON.parse(fs.readFileSync(kp, "utf8")).filter(([t]) => t + DAY <= fetchedAt);
    const close = new Map(bars.map(([t, c]) => [t, c]));
    const qv = new Map(bars.map(([t, , q]) => [t, q]));
    const ret = new Map();
    for (const [t, c] of bars) {
      const p = close.get(t - DAY);
      if (Number.isFinite(p) && p > 0 && Number.isFinite(c)) ret.set(t, c / p - 1);
    }
    const funding = new Map();
    for (const [t, r] of JSON.parse(fs.readFileSync(fp, "utf8"))) {
      if (!Number.isFinite(r)) continue;
      const d = Math.floor(t / DAY) * DAY;
      funding.set(d, (funding.get(d) || 0) + r);
    }
    out.set(m.symbol, { symbol: m.symbol, ret, qv, funding, firstBar: bars.length ? bars[0][0] : Infinity });
  }
  return { syms: out, fetchedAt };
}

// OLS of y on [1, x1, x2]. Returns { a, b1, b2 } or null.
function ols2(y, x1, x2) {
  const n = y.length;
  if (n < 3) return null;
  let my = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < n; i += 1) { my += y[i]; m1 += x1[i]; m2 += x2[i]; }
  my /= n; m1 /= n; m2 /= n;
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  for (let i = 0; i < n; i += 1) {
    const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my;
    s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c;
  }
  const det = s11 * s22 - s12 * s12;
  if (!(Math.abs(det) > 1e-18)) return null;
  const b1 = (s1y * s22 - s2y * s12) / det;
  const b2 = (s2y * s11 - s1y * s12) / det;
  return { a: my - b1 * m1 - b2 * m2, b1, b2 };
}

// Score for one symbol at day d, using only bars before d.
function scoreAt(s, btc, eth, d) {
  const y = [], x1 = [], x2 = [];
  for (let k = 1; k <= BETA_WINDOW; k += 1) {
    const t = d - k * DAY;
    const r = s.ret.get(t), rb = btc.ret.get(t), re = eth.ret.get(t);
    if (Number.isFinite(r) && Number.isFinite(rb) && Number.isFinite(re)) { y.push(r); x1.push(rb); x2.push(re); }
  }
  if (y.length < BETA_MIN) return null;
  const fit = ols2(y, x1, x2);
  if (!fit) return null;
  let sc = 0;
  for (let k = 1; k <= SIGNAL_DAYS; k += 1) {
    const t = d - k * DAY;
    const r = s.ret.get(t), rb = btc.ret.get(t), re = eth.ret.get(t);
    if (!Number.isFinite(r) || !Number.isFinite(rb) || !Number.isFinite(re)) return null;
    sc += r - fit.a - fit.b1 * rb - fit.b2 * re;
  }
  return sc;
}

function panelAt(d, syms, btc, eth) {
  const rows = [];
  for (const s of syms.values()) {
    if (FACTORS.includes(s.symbol)) continue;
    if ((d - s.firstBar) / DAY < MIN_AGE) continue;
    const fwd = s.ret.get(d);
    if (!Number.isFinite(fwd)) continue;
    let v = 0, c = 0;
    for (let k = 1; k <= VOL_WINDOW; k += 1) {
      const q = s.qv.get(d - k * DAY);
      if (Number.isFinite(q)) { v += q; c += 1; }
    }
    if (c < VOL_MIN_DAYS) continue;
    const sc = scoreAt(s, btc, eth, d);
    if (sc === null || !Number.isFinite(sc)) continue;
    const f = s.funding.get(d);
    rows.push({ symbol: s.symbol, score: sc, fwd, vol: v / c, funding: Number.isFinite(f) ? f : 0 });
  }
  if (rows.length < MIN_ELIGIBLE) return null;
  const band = rows.sort((a, b) => b.vol - a.vol).slice(0, TOP_N);
  return { d, band, scores: band.map((r) => r.score), forwardReturns: band.map((r) => r.fwd), n: band.length };
}

function book(panels, btc) {
  let prev = new Map();
  const net = [], gross = [], cost = [], fund = [], mkt = [];
  let turnSum = 0;
  for (const p of panels) {
    const sorted = p.band.slice().sort((a, b) => a.score - b.score);
    const per = Math.floor(sorted.length / BUCKETS);
    const longs = sorted.slice(0, per), shorts = sorted.slice(-per);
    const w = new Map();
    for (const r of longs) w.set(r.symbol, 0.5 / per);
    for (const r of shorts) w.set(r.symbol, -0.5 / per);
    let g = 0, f = 0;
    for (const r of longs) { g += (0.5 / per) * r.fwd; f -= (0.5 / per) * r.funding; }
    for (const r of shorts) { g -= (0.5 / per) * r.fwd; f += (0.5 / per) * r.funding; }
    let turn = 0;
    for (const k of new Set([...w.keys(), ...prev.keys()])) turn += Math.abs((w.get(k) || 0) - (prev.get(k) || 0));
    const c = turn * COST_PER_TURNOVER;
    gross.push(g); fund.push(f); cost.push(c); net.push(g + f - c); turnSum += turn;
    mkt.push(btc.ret.get(p.d));
    prev = w;
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // alpha: intercept of net on BTC return
  const n = net.length;
  const mx = mean(mkt), my = mean(net);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i += 1) { sxx += (mkt[i] - mx) ** 2; sxy += (mkt[i] - mx) * (net[i] - my); }
  const beta = sxx > 0 ? sxy / sxx : 0;
  const resid = net.map((v, i) => v - beta * mkt[i]);
  return {
    days: n,
    gross_mean_pct: mean(gross) * 100,
    funding_mean_pct: mean(fund) * 100,
    cost_mean_pct: mean(cost) * 100,
    net_mean_pct: mean(net) * 100,
    net_nw_t: neweyWestT(net, NW_LAG),
    gross_nw_t: neweyWestT(gross, NW_LAG),
    avg_turnover: turnSum / n,
    beta_btc: beta,
    alpha_pct: mean(resid) * 100,
    alpha_nw_t: neweyWestT(resid, NW_LAG),
    net_ann_pct: (Math.pow(net.reduce((e, r) => e * (1 + r), 1), 365 / n) - 1) * 100,
  };
}

function build(syms, from, to) {
  const btc = syms.get("BTCUSDT"), eth = syms.get("ETHUSDT");
  const out = [];
  let skipped = 0;
  for (let d = from; d < to; d += DAY) {
    const p = panelAt(d, syms, btc, eth);
    if (p) out.push(p); else skipped += 1;
  }
  return { panels: out, skipped, btc };
}

function assess(label, set) {
  const g = evaluateMonotonicity({ panels: set.panels, buckets: BUCKETS, neweyWestLag: NW_LAG, tThreshold: T, label });
  const b = book(set.panels, set.btc);
  console.error(formatMonotonicityReport(g));
  console.error(`  기간 ${new Date(set.panels[0].d).toISOString().slice(0, 10)} → ${new Date(set.panels[set.panels.length - 1].d).toISOString().slice(0, 10)} · 건너뜀 ${set.skipped}`);
  console.error(`  책(일): 총 ${b.gross_mean_pct.toFixed(4)}% (t ${b.gross_nw_t.toFixed(2)}) 펀딩 ${b.funding_mean_pct.toFixed(4)}% 비용 -${b.cost_mean_pct.toFixed(4)}% → 순 ${b.net_mean_pct.toFixed(4)}% (t ${b.net_nw_t.toFixed(2)}), 연 ${b.net_ann_pct.toFixed(1)}%, 회전 ${b.avg_turnover.toFixed(2)}, BTC 베타 ${b.beta_btc.toFixed(3)}, 알파 ${b.alpha_pct.toFixed(4)}% (t ${b.alpha_nw_t.toFixed(2)})\n`);
  return { gate: g, book: b };
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0 || !process.argv[i + 1]) { console.error("usage: --data DIR"); process.exit(2); }
  const { syms, fetchedAt } = load(process.argv[i + 1]);
  const lastComplete = Math.floor(fetchedAt / DAY) * DAY - DAY;

  const disc = assess("DISCOVERY residual reversal 3d top200 h24", build(syms, DISCOVERY_FROM, CONFIRM_FROM));
  let decision, conf = null;
  if (!disc.gate.passed) decision = "REJECTED";
  else if (disc.gate.ic.mean > 0) decision = "OPPOSITE_SIGN";
  else if (!(disc.book.net_mean_pct > 0)) decision = "REJECTED_COST";
  else {
    conf = assess("CONFIRMATION residual reversal 3d top200 h24", build(syms, CONFIRM_FROM, lastComplete + DAY));
    decision = conf.gate.ic.mean < 0 && conf.book.net_nw_t > T_CONFIRM && conf.book.alpha_pct > 0 ? "CONFIRM_PASS" : "REJECTED";
  }
  const strip = (x) => x && ({ verdict: x.gate.verdict, panels: x.gate.panels, bucketMeans: x.gate.bucketMeans, monotone: x.gate.monotone,
    ic: x.gate.ic, tailSpread: x.gate.tailSpread, signAgreement: x.gate.signAgreement, book: x.book });
  console.log(JSON.stringify({ symbols: syms.size, fetched_at: new Date(fetchedAt).toISOString(), decision,
    confirmation_read: conf !== null, discovery: strip(disc), confirmation: strip(conf) }, null, 2));
}

if (require.main === module) main();

module.exports = { ols2, scoreAt, load };
