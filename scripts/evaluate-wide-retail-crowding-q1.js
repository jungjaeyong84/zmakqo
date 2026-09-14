#!/usr/bin/env node
"use strict";

// scripts/evaluate-wide-retail-crowding-q1.js — frozen evaluator for a one-tail
// effect found while rejecting something else (2026-09-14).
//
// ORIGIN, STATED FIRST
// --------------------
// This was not a hypothesis. It is what the data showed while v7's signal was
// being rejected on the wide universe (scripts/evaluate-wide-positioning-
// monotonicity.js, frozen verdict FAIL_NONMONOTONE, IC sign opposite to v7's).
// In the top 200 by open interest, the bottom quintile of top_ratio -
// retail_ratio — names where retail is long relative to large accounts —
// underperformed the cross-section over the next 4h, and the other four
// quintiles were flat. It was seen, then named. Nothing about it is evidence
// until data that did not exist when it was seen says the same.
//
// So the confirmation sample is forward only: signal stamps from
// 2026-09-14T08:00Z, whose flow rows had not been published when this was
// written.
//
// WHAT IS KNOWN TO BE WRONG WITH THE DISCOVERY SAMPLE
//   - survivorship: the wide ledger was backfilled on 2026-09-13 from the
//     symbols listed that day, so perps delisted in August are absent
//   - one month, one regime
//   - top 100 shows nothing, so the effect sits in names ranked ~101-200 by
//     open interest, where trading costs are highest
//
// WHAT CONFIRMATION WOULD AND WOULD NOT MEAN
// A one-tail profile cannot pass the monotonicity gate by construction, so that
// gate is not this hypothesis's test. CONFIRMED establishes only that the
// effect exists out of sample. It does not authorise a book: any book needs its
// own registration, cost study and turnover evidence.
//
// FROZEN SPEC (do not tune)
// -------------------------
//   score     top_pos.top_ratio - global_acct.retail_ratio at flow ts
//   universe  at each ts, names with score and oi_value; top 200 by oi_value.
//             The cut is made BEFORE prices are looked up, so a name that
//             later cannot be priced (delisted) is counted as missing instead
//             of silently leaving the universe.
//   forward   close[bar open ts+4h] / close[bar open ts] - 1, i.e. ts+4h to
//             ts+8h, v7's timing
//   q1        per panel: demean forwards across the priced names, sort by
//             score, mean of the lowest floor(n/5) — the same bucketing as
//             src/research/monotonicityGate.js
//   stat      Newey-West t of the q1 series, lag 5, first N_REQUIRED panels only
//
//   CONFIRMED     t < -1.96 and missing share <= 1%
//   REJECTED      design-size effect ruled out: NW t of (q1 + DELTA) > 1.96
//   INCONCLUSIVE  otherwise, including any run where missing share > 1% would
//                 otherwise have confirmed
//
// DELTA and N_REQUIRED are derived, not chosen: DELTA is half the discovery
// mean (the discovery figure was found by looking, so it is assumed inflated),
// and N_REQUIRED gives 80% power at DELTA for a one-sided 0.025 test using the
// discovery long-run sd. Both were computed by `--discovery` on this file's own
// construction and then written in below. One look, no interim.
//
// Usage
//   node scripts/evaluate-wide-retail-crowding-q1.js --discovery --klines path
//   node scripts/evaluate-wide-retail-crowding-q1.js --confirm   --klines path
//
// klines: { fetched_at, bars: { SYM: [[openTs, close], ...] } }, closed bars only,
// spanning the whole window being evaluated. A file that stops short does not
// fail silently: the uncovered names count as missing, which blocks CONFIRMED.
// --confirm exits 1 while fewer than N_REQUIRED panels exist, 2 on bad input.

const fs = require("fs");
const path = require("path");
const { neweyWestT } = require("../src/research/monotonicityGate");

const ROOT = path.resolve(__dirname, "..");
const WIDE = path.join(ROOT, "ops/runtime/wide_flow_history.jsonl");

// ---- frozen parameters: do not tune ----------------------------------------
const P = 4 * 3600e3;
const TOP_N = 200;
const BUCKETS = 5;
const NW_LAG = 5;
const Z = 1.96;
const Z_POWER = 0.8416;
const MAX_MISSING_SHARE = 0.01;
const DISCOVERY_FROM = Date.parse("2026-08-18T00:00:00Z");
const DISCOVERY_TO = Date.parse("2026-09-13T20:00:00Z");
const CONFIRM_FROM = Date.parse("2026-09-14T08:00:00Z");
// From --discovery on 2026-09-14 (klines fetched 06:03:33Z): 162 panels, mean
// q1 -0.1490%, NW t -3.47, long-run sd 0.5464%. DELTA is half |mean|; N is
// ceil(((1.96 + 0.8416) * 0.5464 / 0.0745)^2).
const DELTA = 0.000745;
const N_REQUIRED = 423;
// -----------------------------------------------------------------------------

function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function loadFlow(file) {
  const rec = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    const k = `${r.symbol}|${r.ts}`;
    const cur = rec.get(k) || { symbol: r.symbol, ts: r.ts };
    if (r.key === "top_pos") cur.top_ratio = r.top_ratio;
    else if (r.key === "global_acct") cur.retail_ratio = r.retail_ratio;
    else if (r.key === "oi") cur.oi_value = r.oi_value;
    rec.set(k, cur);
  }
  return rec;
}

// One panel's q1 from rows [{ score, oi, c0, c1 }]. Pure, so it can be tested.
function panelQ1(rows) {
  const eligible = rows.filter((r) => Number.isFinite(r.score) && Number.isFinite(r.oi));
  if (eligible.length < TOP_N) return { q1: null, universe: eligible.length, missing: 0, priced: 0 };
  const band = eligible.slice().sort((a, b) => b.oi - a.oi).slice(0, TOP_N);
  const priced = band.filter((r) => Number.isFinite(r.c0) && Number.isFinite(r.c1) && r.c0 > 0);
  const missing = band.length - priced.length;
  if (priced.length < BUCKETS * 2) return { q1: null, universe: eligible.length, missing, priced: priced.length };
  const fwd = priced.map((r) => r.c1 / r.c0 - 1);
  const m = mean(fwd);
  const sorted = priced.map((r, i) => ({ s: r.score, d: fwd[i] - m })).sort((a, b) => a.s - b.s);
  const per = Math.floor(sorted.length / BUCKETS);
  return { q1: mean(sorted.slice(0, per).map((x) => x.d)), universe: eligible.length, missing, priced: priced.length };
}

function buildSeries({ flow, closes, from, to }) {
  const bySt = new Map();
  for (const r of flow.values()) {
    if (r.ts < from || r.ts > to) continue;
    if (!bySt.has(r.ts)) bySt.set(r.ts, []);
    bySt.get(r.ts).push(r);
  }
  const out = [];
  for (const ts of [...bySt.keys()].sort((a, b) => a - b)) {
    const rows = bySt.get(ts).map((r) => ({
      score: Number.isFinite(r.top_ratio) && Number.isFinite(r.retail_ratio) ? r.top_ratio - r.retail_ratio : NaN,
      oi: r.oi_value,
      c0: closes.get(r.symbol)?.get(ts),
      c1: closes.get(r.symbol)?.get(ts + P),
    }));
    const p = panelQ1(rows);
    if (p.q1 === null) continue;
    out.push({ ts, ...p });
  }
  return out;
}

function summarise(series) {
  const q = series.map((s) => s.q1);
  const t = neweyWestT(q, NW_LAG);
  const m = mean(q);
  const se = t !== 0 ? Math.abs(m / t) : null;
  const obs = series.reduce((a, s) => a + s.priced + s.missing, 0);
  const missing = series.reduce((a, s) => a + s.missing, 0);
  return {
    panels: q.length,
    first_ts: q.length ? new Date(series[0].ts).toISOString() : null,
    last_ts: q.length ? new Date(series[series.length - 1].ts).toISOString() : null,
    mean_q1_pct: m * 100,
    nw_t: t,
    nw_se_pct: se === null ? null : se * 100,
    long_run_sd_pct: se === null ? null : se * Math.sqrt(q.length) * 100,
    missing_share: obs ? missing / obs : 0,
  };
}

// Decision on the first N_REQUIRED panels. Pure apart from the constants.
function decide(series, { delta = DELTA, nRequired = N_REQUIRED } = {}) {
  if (!Number.isFinite(delta) || !Number.isInteger(nRequired)) throw new Error("WIDE_Q1_NOT_FROZEN");
  if (series.length < nRequired) return { decision: null, panels: series.length, required: nRequired };
  const window = series.slice(0, nRequired);
  const s = summarise(window);
  const tRuleOut = neweyWestT(window.map((x) => x.q1 + delta), NW_LAG);
  let decision = "INCONCLUSIVE";
  if (s.nw_t < -Z && s.missing_share <= MAX_MISSING_SHARE) decision = "CONFIRMED";
  else if (tRuleOut > Z) decision = "REJECTED";
  return { decision, required: nRequired, ...s, delta_pct: delta * 100, t_rule_out_design_effect: tRuleOut };
}

function main() {
  const mode = process.argv.includes("--discovery") ? "discovery" : process.argv.includes("--confirm") ? "confirm" : null;
  const ki = process.argv.indexOf("--klines");
  if (!mode || ki < 0 || !process.argv[ki + 1]) {
    console.error("usage: evaluate-wide-retail-crowding-q1.js --discovery|--confirm --klines path");
    process.exit(2);
  }
  const klines = JSON.parse(fs.readFileSync(process.argv[ki + 1], "utf8"));
  const closes = new Map(Object.entries(klines.bars).map(([s, b]) => [s, new Map(b)]));
  const flow = loadFlow(WIDE);

  if (mode === "discovery") {
    const s = summarise(buildSeries({ flow, closes, from: DISCOVERY_FROM, to: DISCOVERY_TO }));
    const delta = Math.abs(s.mean_q1_pct / 100) / 2;
    const lrsd = s.long_run_sd_pct / 100;
    const n = Math.ceil(Math.pow(((Z + Z_POWER) * lrsd) / delta, 2));
    console.log(JSON.stringify({
      mode, in_sample: true, klines_fetched_at: klines.fetched_at, ...s,
      derived: { delta_pct: delta * 100, n_required: n, days: Math.round((n * P) / 86400e3 * 10) / 10 },
    }, null, 2));
    return;
  }

  const series = buildSeries({ flow, closes, from: CONFIRM_FROM, to: Infinity });
  const out = decide(series);
  console.log(JSON.stringify({ mode, klines_fetched_at: klines.fetched_at, ...out }, null, 2));
  if (out.decision === null) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("WIDE_Q1_FAIL", e && e.message ? e.message : String(e));
    process.exit(2);
  }
}

module.exports = { panelQ1, buildSeries, summarise, decide, TOP_N, CONFIRM_FROM };
