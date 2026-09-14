#!/usr/bin/env node
"use strict";

// scripts/evaluate-wide-positioning-monotonicity.js — does v7's signal keep its
// shape outside the 24 symbols it was found on? (2026-09-14)
//
// WHY
// ---
// v7 ranks 24 symbols on top_ratio - retail_ratio. Measured breadth says 27
// names are about two independent bets, and the wide collector now banks the
// same endpoints for 528. Before any book, cost study or registration, the
// signal has to clear the monotonicity gate on the wider cross-section: IC
// alone was shown to be untradable once (xs-reversal-classic-ta).
//
// Widening is NOT assumed to help. Participation ratio was measured on returns,
// not on this signal, so whether more names add independent signal is exactly
// what is unknown.
//
// FROZEN SPEC (fixed before the first run; do not tune)
// -----------------------------------------------------
//   score     top_pos.top_ratio - global_acct.retail_ratio at flow ts, raw —
//             v7's exact definition
//   forward   close[bar open ts+H] / close[bar open ts] - 1. The flow row for ts
//             is knowable at ts+4h, which is when bar ts closes, so the return
//             runs from ts+4h to ts+4h+H — v7's own timing.
//   universe  at each ts, symbols with score, oi_value and both closes; ranked by
//             oi_value AT THAT ts. The kline cache's 24h volume is a present-day
//             snapshot and would leak today's liquidity into August.
//   window    signal ts >= 2026-08-18T00:00Z. v7's definition was committed
//             2026-08-17 (aee0dd5c), so every panel postdates the signal.
//   gate      5 buckets, Newey-West lag 5, |t| 1.96 (monotonicityGate defaults)
//   expected  IC < 0, as in v7. A PASS with IC > 0 is a different signal and is
//             not counted as support for this one.
//
//   PRIMARY   top 200 by oi_value, H = 4h. Only this tier decides.
//   secondary (descriptive, no decision)
//     top200_ex_v7   top 200 minus v7's 24 — the cross-section v7 never saw
//     top100
//     v7_24          v7's own names — should resemble what v7 already shows
//     top200_h12     H = 12h, panels at ts % 12h == 0 so they do not overlap
//     top200_all_ts  from the first banked ts (2026-08-13), 4 days of which
//                    overlap v7's discovery window
//
// ALIGNMENT PRECONDITION
// ----------------------
// This project has produced false findings three times from misaligned or stale
// data. So before the gate runs, the script rebuilds v7's recorded ledger from
// the wide ledger and the supplied closes: the same longs and shorts at every
// ts, and prior_gross_pct to within rounding. If that does not reproduce, the
// gate is not run and the script exits 2.
//
// Usage
//   node scripts/evaluate-wide-positioning-monotonicity.js --klines path
//
// klines: { fetched_at, bars: { SYM: [[openTs, close], ...] } }, closed bars only.

const fs = require("fs");
const path = require("path");
const { evaluateMonotonicity, formatMonotonicityReport } = require("../src/research/monotonicityGate");

const ROOT = path.resolve(__dirname, "..");
const WIDE = path.join(ROOT, "ops/runtime/wide_flow_history.jsonl");
const V5 = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");
const V7_LEDGER = path.join(ROOT, "ops/runtime/v7_positioning_ledger.jsonl");

// ---- frozen parameters: do not tune ----------------------------------------
const P = 4 * 3600e3;
const WINDOW_FROM = Date.parse("2026-08-18T00:00:00Z");
const BUCKETS = 5;
const NW_LAG = 5;
const T = 1.96;
const V7_K = 6;
const V7_MIN_SYMBOLS = 12;
const GROSS_TOLERANCE_PCT = 0.0002;   // ledger rounds to 1e-4 %
const MIN_ALIGNED_SHARE = 0.95;
// -----------------------------------------------------------------------------

function readJsonl(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function loadFlow(file) {
  const rec = new Map();   // `${sym}|${ts}` -> { top_ratio, retail_ratio, oi_value }
  for (const r of readJsonl(file)) {
    const k = `${r.symbol}|${r.ts}`;
    const cur = rec.get(k) || {};
    if (r.key === "top_pos") cur.top_ratio = r.top_ratio;
    else if (r.key === "global_acct") cur.retail_ratio = r.retail_ratio;
    else if (r.key === "oi") cur.oi_value = r.oi_value;
    rec.set(k, cur);
  }
  return rec;
}

function score(r) {
  return r && Number.isFinite(r.top_ratio) && Number.isFinite(r.retail_ratio) ? r.top_ratio - r.retail_ratio : null;
}

function closesFrom(klines) {
  const m = new Map();
  for (const [s, bars] of Object.entries(klines.bars)) m.set(s, new Map(bars.map(([t, c]) => [t, c])));
  return m;
}

// ---- alignment: rebuild v7's recorded ledger --------------------------------
function checkAlignment({ wide, closes, v5Symbols, ledger }) {
  let rankChecked = 0;
  let rankMatched = 0;
  let grossChecked = 0;
  let grossMatched = 0;
  const mismatches = [];
  for (let i = 0; i < ledger.length; i += 1) {
    const row = ledger[i];
    const ranked = [];
    for (const s of v5Symbols) {
      const sc = score(wide.get(`${s}|${row.ts}`));
      const px = closes.get(s)?.get(row.ts);
      if (sc === null || !Number.isFinite(px)) continue;
      ranked.push({ s, sc });
    }
    if (ranked.length >= V7_MIN_SYMBOLS) {
      ranked.sort((a, b) => a.sc - b.sc);
      const longs = ranked.slice(0, V7_K).map((x) => x.s).sort().join(",");
      const shorts = ranked.slice(-V7_K).map((x) => x.s).sort().join(",");
      const wantL = row.longs.map((x) => x.symbol).sort().join(",");
      const wantS = row.shorts.map((x) => x.symbol).sort().join(",");
      rankChecked += 1;
      if (longs === wantL && shorts === wantS) rankMatched += 1;
      else if (mismatches.length < 5) mismatches.push({ ts: row.bar_time, kind: "rank" });
    }
    const prev = ledger[i - 1];
    if (prev && prev.weights && row.prior_gross_pct !== null && row.prior_gross_pct !== undefined) {
      let acc = 0;
      let ok = true;
      for (const [s, w] of Object.entries(prev.weights)) {
        const p0 = closes.get(s)?.get(prev.ts);
        const p1 = closes.get(s)?.get(row.ts);
        if (!Number.isFinite(p0) || !Number.isFinite(p1)) { ok = false; break; }
        acc += w * (p1 / p0 - 1);
      }
      if (ok) {
        grossChecked += 1;
        if (Math.abs(acc * 100 - row.prior_gross_pct) <= GROSS_TOLERANCE_PCT) grossMatched += 1;
        else if (mismatches.length < 5) mismatches.push({ ts: row.bar_time, kind: "gross", got: acc * 100, want: row.prior_gross_pct });
      }
    }
  }
  const rankShare = rankChecked ? rankMatched / rankChecked : 0;
  const grossShare = grossChecked ? grossMatched / grossChecked : 0;
  return {
    rank: { checked: rankChecked, matched: rankMatched, share: rankShare },
    gross: { checked: grossChecked, matched: grossMatched, share: grossShare },
    mismatches,
    ok: rankChecked > 100 && grossChecked > 100 && rankShare >= MIN_ALIGNED_SHARE && grossShare >= MIN_ALIGNED_SHARE,
  };
}

// ---- panels -----------------------------------------------------------------
function buildPanels({ wide, closes, symbols, stamps, from, horizonMs, topN, only, every }) {
  const panels = [];
  let skippedThin = 0;
  for (const ts of stamps) {
    if (ts < from) continue;
    if (every && ts % every !== 0) continue;
    const rows = [];
    for (const s of symbols) {
      if (only && !only.has(s)) continue;
      const r = wide.get(`${s}|${ts}`);
      const sc = score(r);
      const c0 = closes.get(s)?.get(ts);
      const c1 = closes.get(s)?.get(ts + horizonMs);
      if (sc === null || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0) continue;
      if (topN && !Number.isFinite(r.oi_value)) continue;
      rows.push({ s, sc, fwd: c1 / c0 - 1, oi: r.oi_value });
    }
    let chosen = rows;
    if (topN) {
      if (rows.length < topN) { skippedThin += 1; continue; }
      chosen = rows.sort((a, b) => b.oi - a.oi).slice(0, topN);
    }
    panels.push({ ts, scores: chosen.map((x) => x.sc), forwardReturns: chosen.map((x) => x.fwd), n: chosen.length });
  }
  return { panels, skippedThin };
}

function run(label, panels, skippedThin) {
  const res = evaluateMonotonicity({ panels, buckets: BUCKETS, neweyWestLag: NW_LAG, tThreshold: T, label });
  return {
    ...res,
    skipped_thin: skippedThin,
    first_ts: panels.length ? new Date(panels[0].ts).toISOString() : null,
    last_ts: panels.length ? new Date(panels[panels.length - 1].ts).toISOString() : null,
    names_per_panel: panels.length ? Math.round(panels.reduce((a, p) => a + p.n, 0) / panels.length) : 0,
    expected_sign: res.ic.mean < 0,
  };
}

function main() {
  const i = process.argv.indexOf("--klines");
  if (i < 0 || !process.argv[i + 1]) {
    console.error("usage: evaluate-wide-positioning-monotonicity.js --klines path");
    process.exit(2);
  }
  const klines = JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8"));
  const closes = closesFrom(klines);
  const wide = loadFlow(WIDE);
  const v5 = loadFlow(V5);
  const v5Symbols = [...new Set([...v5.keys()].map((k) => k.split("|")[0]))].sort();
  const ledger = readJsonl(V7_LEDGER);

  const alignment = checkAlignment({ wide, closes, v5Symbols, ledger });
  if (!alignment.ok) {
    console.log(JSON.stringify({ klines_fetched_at: klines.fetched_at, alignment, gate: "NOT_RUN" }, null, 2));
    process.exit(2);
  }

  const symbols = [...new Set([...wide.keys()].map((k) => k.split("|")[0]))].sort();
  const stamps = [...new Set([...wide.keys()].map((k) => Number(k.split("|")[1])))].sort((a, b) => a - b);
  const v7Set = new Set(v5Symbols);
  const firstTs = stamps[0];

  const tiers = {};
  const primary = buildPanels({ wide, closes, symbols, stamps, from: WINDOW_FROM, horizonMs: P, topN: 200 });
  tiers.PRIMARY_top200_h4 = run("PRIMARY top200 h4", primary.panels, primary.skippedThin);

  // ex-v7: same top-200 band, v7's names removed afterwards.
  const exPanels = [];
  for (const ts of stamps) {
    if (ts < WINDOW_FROM) continue;
    const rows = [];
    for (const s of symbols) {
      const r = wide.get(`${s}|${ts}`);
      const sc = score(r);
      const c0 = closes.get(s)?.get(ts);
      const c1 = closes.get(s)?.get(ts + P);
      if (sc === null || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0 || !Number.isFinite(r.oi_value)) continue;
      rows.push({ s, sc, fwd: c1 / c0 - 1, oi: r.oi_value });
    }
    if (rows.length < 200) continue;
    const band = rows.sort((a, b) => b.oi - a.oi).slice(0, 200).filter((x) => !v7Set.has(x.s));
    exPanels.push({ ts, scores: band.map((x) => x.sc), forwardReturns: band.map((x) => x.fwd), n: band.length });
  }
  tiers.top200_ex_v7 = run("top200 ex-v7", exPanels, 0);

  const t100 = buildPanels({ wide, closes, symbols, stamps, from: WINDOW_FROM, horizonMs: P, topN: 100 });
  tiers.top100_h4 = run("top100 h4", t100.panels, t100.skippedThin);

  const v7only = buildPanels({ wide, closes, symbols, stamps, from: WINDOW_FROM, horizonMs: P, only: v7Set });
  tiers.v7_24_h4 = run("v7 24 h4", v7only.panels.filter((p) => p.n >= 20), 0);

  const h12 = buildPanels({ wide, closes, symbols, stamps, from: WINDOW_FROM, horizonMs: 3 * P, topN: 200, every: 3 * P });
  tiers.top200_h12 = run("top200 h12", h12.panels, h12.skippedThin);

  const allTs = buildPanels({ wide, closes, symbols, stamps, from: firstTs, horizonMs: P, topN: 200 });
  tiers.top200_all_ts = run("top200 all ts", allTs.panels, allTs.skippedThin);

  const p = tiers.PRIMARY_top200_h4;
  const decision = p.passed && p.expected_sign ? "PASS_EXPECTED_SIGN"
    : p.passed ? "PASS_OPPOSITE_SIGN_NOT_SUPPORT"
    : p.verdict;

  for (const t of Object.values(tiers)) {
    console.error(formatMonotonicityReport(t));
    console.error(`  이름/시점 ${t.names_per_panel} · ${t.first_ts} → ${t.last_ts} · 예상 부호(IC<0) ${t.expected_sign}\n`);
  }
  console.log(JSON.stringify({ klines_fetched_at: klines.fetched_at, alignment, decision, tiers }, null, 2));
}

if (require.main === module) main();
