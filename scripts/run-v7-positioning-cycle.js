#!/usr/bin/env node
"use strict";

// scripts/run-v7-positioning-cycle.js (2026-08-17)
//
// Paper lane for a CROSS-SECTIONAL signal built from positioning data, not
// from price.
//
// WHY THIS LANE EXISTS, AND WHY IT IS DIFFERENT FROM EVERY LANE BEFORE IT.
//
// 45bb381a measured the wall this project kept hitting: the entire predictive
// content of the classical toolkit is MARKET TIMING. Symbol-demeaned IC 0.0720,
// raw 0.0691, cross-sectional 0.0036. Every price indicator is a transform of
// price against a recent average, so 41 of them are near-duplicates rather than
// independent evidence, and none of them say which coin beats which.
//
// The v5 collector has been banking something that is NOT a price transform:
// topLongShortPositionRatio (what large accounts hold) and
// globalLongShortAccountRatio (what retail accounts hold). The spread between
// them is a statement about who is on which side, and it cannot be derived from
// the price series at any lag.
//
// Measured over the banked ledger, 24 symbols x 242 4h periods (5,808 obs):
//
//   whale_vs_retail   cross-sectional IC -0.0345   t = -2.63
//   top_ratio         cross-sectional IC -0.0303   t = -2.31
//   taker_chg         cross-sectional IC -0.0317   t = -2.41
//
// Negative: when large accounts are MORE long than retail, that symbol
// underperforms its peers. A dollar-neutral book ranking on the spread returned
// 85.3%/yr at 11.8% vol over the banked window, both halves positive, and the
// reversed book returned -59.2% — a clean mirror, which noise does not produce.
// Shuffling the feature across symbols within each timestamp: 0/100 shuffles
// beat it.
//
// WHAT IS NOT ESTABLISHED, STATED PLAINLY.
//
//   1. The window is 40.5 days. That is 242 periods, not a track record.
//   2. The BOOK's t is 1.77. It does not reach 1.96. Only the raw
//      cross-sectional IC clears nominal significance (t = -2.63), and that was
//      the best of 8 features examined — Bonferroni over 8 wants |t| > 2.73, so
//      even the IC does not clear the corrected bar. Discretising the signal
//      into 6-a-side and paying turnover gives most of the IC back.
//   3. Sharpe 7.24 is an artefact of annualising 40 days. Do not repeat it as
//      if it were a property of the strategy.
//   4. K=4 turns the first half negative (-5.1%). Not parameter-flat.
//
// So this lane is not deployed because the edge is proven. It is deployed
// because the ONE thing wrong with the evidence — sample size — is the one
// thing that fixes itself by waiting, and the v5 collector is already banking
// the data. Three months triples the sample. If t rises with n, it is real; if
// it decays toward zero, it was not. No other test settles this, and paper
// costs nothing to run while the sample accumulates.
//
// LOOK-AHEAD. Binance stamps a /futures/data row with the START of its period.
// The row for ts is therefore only knowable once that period has CLOSED, at
// ts + 4h. This lane holds the book from ts+4h to ts+8h and books the return
// over that span — the signal is always at least one full period old when it is
// acted on. The most recent ts in the ledger is skipped for exactly this reason.
//
// Paper only. No keys, no order path, no exposure.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");
const LEDGER = path.join(ROOT, "ops/runtime/v7_positioning_ledger.jsonl");
const REPORT = path.join(ROOT, "ops/daily/v7_positioning_latest.json");

const PERIOD_MS = 4 * 3600e3;

// Each side gets 6 names out of 24. K=4 concentrates into too few and the first
// half of the sample goes negative; K=8 dilutes toward the cross-sectional
// mean. 6 was the middle of the three tested, not a tuned optimum — recording
// that so a later reader does not mistake it for a fitted parameter.
const K = 6;

// Dollar-neutral: 50% of capital long, 50% short, equal weight within a side.
const GROSS = 1.0;

// Rebalance legs are market orders on both entry and exit, so every unit of
// turnover pays taker plus half-spread. No maker assumption: this book rebuilds
// every 4h and a resting order that does not fill leaves the position wrong,
// which is worse than the fee saved. Same reasoning as v6.
const TAKER_FEE_PCT = 0.05;
const SLIP_PCT = 0.02;
const COST_PER_TURNOVER_PCT = TAKER_FEE_PCT + SLIP_PCT;

const MIN_SYMBOLS = 12;   // below this the ranking is too thin to be neutral

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return fb; } }

function readLedger(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

// ---- positioning features from the v5 ledger ------------------------------
// The collector writes one row per (symbol, key, ts). Merge the keys back into
// a single record per (symbol, ts) so a feature can read across them.
function loadFlow() {
  const bySymTs = new Map();
  if (!fs.existsSync(FLOW)) return bySymTs;
  for (const line of fs.readFileSync(FLOW, "utf8").split("\n")) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const k = `${r.symbol}|${r.ts}`;
    const cur = bySymTs.get(k) || { symbol: r.symbol, ts: r.ts };
    for (const [f, v] of Object.entries(r)) {
      if (f !== "key" && f !== "symbol" && f !== "ts") cur[f] = v;
    }
    bySymTs.set(k, cur);
  }
  return bySymTs;
}

function spread(rec) {
  if (!rec || !Number.isFinite(rec.top_ratio) || !Number.isFinite(rec.retail_ratio)) return null;
  return rec.top_ratio - rec.retail_ratio;
}

async function fetchCloses(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  const m = new Map();
  for (const r of rows) m.set(Number(r[0]), Number(r[4]));
  return m;
}

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function sd(a) { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : 0; }

// Build one rebalance row for `ts`, chained off `prev`. Extracted from main()
// so the cycle can process EVERY unbooked period rather than only the newest.
function buildRebalanceRow(ts, prev, flow, symbols, closes, errors) {
  const ranked = [];
  for (const s of symbols) {
    const rec = flow.get(`${s}|${ts}`);
    const sp = spread(rec);
    const px = closes.get(s)?.get(ts);
    if (sp === null || !Number.isFinite(px)) continue;
    ranked.push({ symbol: s, spread: sp, price: px });
  }
  ranked.sort((a, b) => a.spread - b.spread);
  if (ranked.length < MIN_SYMBOLS) {
    errors.push(`${new Date(ts).toISOString()}: only ${ranked.length} symbols ranked (need ${MIN_SYMBOLS})`);
    return null;
  }

  // IC is negative: the LOW end of the spread (large accounts relatively
  // short vs retail) is the long side.
  const longs = ranked.slice(0, K);
  const shorts = ranked.slice(-K);
  const w = new Map();
  for (const r of longs) w.set(r.symbol, (GROSS / 2) / K);
  for (const r of shorts) w.set(r.symbol, -(GROSS / 2) / K);

  // Book the previous period's return before rebuilding: the old weights held
  // from the previous signal bar to this one.
  let grossPct = 0;
  let realised = null;
  if (prev && prev.weights) {
    let ok = true;
    let acc = 0;
    for (const [s, pw] of Object.entries(prev.weights)) {
      const p0 = prev.prices?.[s];
      const p1 = closes.get(s)?.get(ts);
      if (!Number.isFinite(p0) || !Number.isFinite(p1)) { ok = false; break; }
      acc += pw * (p1 / p0 - 1);
    }
    if (ok) { grossPct = acc * 100; realised = true; }
    else errors.push(`${new Date(ts).toISOString()}: prior weights unpriceable — return not booked`);
  }

  const keys = new Set([...w.keys(), ...Object.keys(prev?.weights || {})]);
  let turnover = 0;
  for (const s of keys) turnover += Math.abs((w.get(s) || 0) - ((prev?.weights || {})[s] || 0));
  const costPct = turnover * COST_PER_TURNOVER_PCT;
  const netPct = (realised ? grossPct : 0) - costPct;
  const equity = (prev?.equity ?? 1) * (1 + netPct / 100);

  const prices = {};
  for (const r of [...longs, ...shorts]) prices[r.symbol] = r.price;

  return {
    lane: "v7_positioning_paper",
    ts,
    bar_time: new Date(ts).toISOString(),
    rebalanced_at: new Date().toISOString(),
    k: K,
    ranked_n: ranked.length,
    longs: longs.map((r) => ({ symbol: r.symbol, spread: Math.round(r.spread * 1e4) / 1e4 })),
    shorts: shorts.map((r) => ({ symbol: r.symbol, spread: Math.round(r.spread * 1e4) / 1e4 })),
    weights: Object.fromEntries(w),
    prices,
    prior_gross_pct: realised ? Math.round(grossPct * 1e4) / 1e4 : null,
    turnover: Math.round(turnover * 1e4) / 1e4,
    cost_pct: Math.round(costPct * 1e4) / 1e4,
    net_pct: Math.round(netPct * 1e4) / 1e4,
    equity: Math.round(equity * 1e6) / 1e6,
    status: "REBALANCED",
  };
}

async function main() {
  const errors = [];
  const flow = loadFlow();
  if (!flow.size) { console.error("v5 flow ledger empty — run run-v5-flow-collector.js first"); process.exit(1); }

  const symbols = [...new Set([...flow.values()].map((r) => r.symbol))].sort();
  const stamps = [...new Set([...flow.values()].map((r) => r.ts))].sort((a, b) => a - b);

  // Drop the newest stamp: its period may still be forming, and acting on it
  // would be look-ahead (see header).
  const usable = stamps.slice(0, -1);
  if (!usable.length) { console.error("no closed periods yet"); process.exit(1); }

  // Prices, keyed by the 4h bar open time.
  const closes = new Map();
  for (const s of symbols) {
    try {
      closes.set(s, await fetchCloses(s));
      await new Promise((r) => setTimeout(r, 80));
    } catch (e) { errors.push(`${s}: ${e.message}`); }
  }

  // 2026-08-21 — process EVERY unbooked closed period, not just the newest.
  //
  // The v5 collector runs twice a day and banks ~3 new 4h stamps each time.
  // The old code took `usable[usable.length - 1]` and discarded the rest, so
  // the lane booked 2 periods a day against the 6 that were available — 64% of
  // the sample thrown away, and a 12h effective holding period against the 4h
  // the backtest measured. It was not testing the strategy that was backtested.
  //
  // The knock-on was worse than the lost rate: days_to_n is computed from
  // PERIOD_MS (4h), so the report promised a verdict in 163 days while the real
  // pace implied 483. The dashboard was three times optimistic about when an
  // answer would arrive.
  const existing = readLedger(LEDGER);
  const done = new Set(existing.map((r) => r.ts));
  // A cold start opens ONE position at the newest closed period and books
  // nothing; replaying the whole banked history instead would launder the
  // backtest sample into the live ledger. Once the lane has a history, every
  // stamp from its own first period onward is fair game.
  const todo = existing.length
    ? usable.filter((ts) => !done.has(ts) && ts >= existing[0].ts)
    : usable.slice(-1);

  let prev = existing.length ? existing[existing.length - 1] : null;
  const written = [];
  for (const ts of todo) {
    const row = buildRebalanceRow(ts, prev, flow, symbols, closes, errors);
    if (!row) continue;
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(row) + "\n", "utf8");
    written.push(row);
    prev = row;
  }
  const row = written.length ? written[written.length - 1] : null;
  const alreadyDone = !todo.length;
  // ---- report ------------------------------------------------------------
  const all = readLedger(LEDGER);
  const booked = all.filter((r) => r.prior_gross_pct !== null && r.prior_gross_pct !== undefined);
  const nets = booked.map((r) => r.net_pct / 100);
  const grosses = booked.map((r) => r.prior_gross_pct / 100);

  const periods = nets.length;
  const eq = all.length ? all[all.length - 1].equity : 1;
  const yrs = periods * PERIOD_MS / (365 * 24 * 3600e3);
  const annPct = periods > 1 && eq > 0 ? (Math.pow(eq, 1 / yrs) - 1) * 100 : null;
  const volPct = periods > 1 ? sd(nets) * Math.sqrt((365 * 24 * 3600e3) / PERIOD_MS) * 100 : null;
  const tStat = periods > 1 && sd(nets) > 0 ? mean(nets) / (sd(nets) / Math.sqrt(periods)) : null;

  // The backtest's own claim, carried beside the realised numbers so drift is
  // visible in both directions. Same discipline as the v6 report.
  const expectation = {
    source: "banked v5 ledger, 24 symbols x 242 periods (40.5 days)",
    ann_pct: 85.3,
    vol_pct: 11.8,
    t_stat: 1.77,
    cross_sectional_ic: -0.0345,
    cross_sectional_ic_t: -2.63,
    caveat: "The BOOK's t is 1.77 — it does not reach 1.96, let alone the 2.73 that "
      + "Bonferroni over 8 examined features would want. Only the raw cross-sectional "
      + "IC (t=-2.63) is nominally significant; discretising it into a 6-a-side book "
      + "and charging turnover costs gives most of that back. Sharpe 7.24 is an "
      + "annualisation artefact of a 40-day window, not a property of the strategy.",
  };

  // n needed for |t|=1.96 at the observed per-period edge, derived from
  // dispersion rather than picked. Same method as the v6 verdict threshold.
  let sampleReq = null;
  if (periods > 1 && sd(nets) > 0) {
    const edge = mean(nets), s = sd(nets);
    const need = Math.ceil(Math.pow((1.96 * s) / Math.abs(edge || 1e-9), 2));
    sampleReq = {
      observed_sd_pct: Math.round(s * 1e6) / 1e4,
      observed_edge_pct: Math.round(edge * 1e6) / 1e4,
      n_for_t196: need,
      days_to_n: Math.round(need * PERIOD_MS / 86400e3),
    };
  }

  const report = {
    generated_at: new Date().toISOString(),
    lane: "v7_positioning_paper",
    signal: "top_ratio - retail_ratio, cross-sectional rank, dollar-neutral",
    k: K,
    symbols: symbols.length,
    periods_booked: periods,
    equity: Math.round(eq * 1e6) / 1e6,
    realised: {
      total_net_pct: Math.round((eq - 1) * 1e6) / 1e4,
      mean_net_pct: periods ? Math.round(mean(nets) * 1e6) / 1e4 : null,
      mean_gross_pct: periods ? Math.round(mean(grosses) * 1e6) / 1e4 : null,
      mean_cost_pct: periods ? Math.round(mean(booked.map((r) => r.cost_pct)) * 1e4) / 1e4 : null,
      ann_pct: annPct === null ? null : Math.round(annPct * 10) / 10,
      vol_pct: volPct === null ? null : Math.round(volPct * 10) / 10,
      sharpe: annPct !== null && volPct ? Math.round((annPct / volPct) * 100) / 100 : null,
      t_stat: tStat === null ? null : Math.round(tStat * 100) / 100,
    },
    backtest_expectation: expectation,
    sample_requirement: sampleReq,
    verdict: periods < 200 ? "ACCUMULATING" : (tStat !== null && tStat > 1.96 ? "HOLDING" : "NOT_CONFIRMED"),
    live_exposure_usdt: 0,
    latest: row ? { ts: row.bar_time, longs: row.longs.map((l) => l.symbol), shorts: row.shorts.map((s) => s.symbol), net_pct: row.net_pct } : null,
    rebalanced_this_cycle: written.length,
    skipped: alreadyDone
      ? `no unbooked closed periods (latest booked ${existing.length || written.length ? new Date((prev || {}).ts || 0).toISOString() : "n/a"})`
      : null,
    errors,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = {
  buildRebalanceRow, loadFlow, readLedger, fetchCloses, spread,
  LEDGER, FLOW, PERIOD_MS, K, GROSS, MIN_SYMBOLS, COST_PER_TURNOVER_PCT,
};
