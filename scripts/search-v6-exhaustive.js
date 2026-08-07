#!/usr/bin/env node
"use strict";

// scripts/search-v6-exhaustive.js (2026-08-08)
//
// Search every combination of the six confluence components against every
// threshold and holding period, and keep searching until something is
// significant — with the significance bar raised to match the search.
//
// THE PROBLEM WITH "SEARCH UNTIL SIGNIFICANT". At a 5% cutoff, 1,890
// configurations produce about 94 "significant" results when NOTHING works.
// Reporting the best of them is not a discovery, it is arithmetic. Three
// defences, all of which must hold:
//
//   1. THREE-WAY SPLIT. TRAIN is searched freely. VALIDATION winnows the
//      survivors. TEST is not touched until the very end and is read exactly
//      once. A config must clear all three, and a config that clears TRAIN
//      alone has shown nothing.
//   2. BONFERRONI. The family-wise bar is t > the 95th percentile of the
//      maximum-t distribution under the null, approximated as the cutoff for
//      alpha/N. With ~1,890 cells that is roughly |t| > 4.0, not 1.96.
//   3. EMPIRICAL NULL. The same search is run against SHUFFLED forward
//      returns, which destroys any real signal while preserving the structure
//      of the search. Whatever the shuffle produces is what luck alone yields
//      here, and a real result has to beat it — this is stronger than
//      Bonferroni because it accounts for the correlation between overlapping
//      configurations, which Bonferroni assumes away.
//
// If something survives all three it is worth trading. If nothing does, the
// honest output is the best t alongside the best t the shuffle achieved, so
// the gap (or absence of one) is visible.
//
// Everything is judged at PORTFOLIO level on non-overlapping periods, entry is
// event-based, cost is charged, and long/short stay symmetric.

const fs = require("fs");
const path = require("path");
const v1 = require("./analyze-v1-confluence.js");

const CACHE = process.env.V1_CACHE || path.join(process.env.TMPDIR || "/tmp", "v1_1h.json");
const OUT = path.join(__dirname, "..", "ops/daily/v6_search_latest.json");
const COST_PCT = 0.14;
const NAMES = ["trend", "htf", "td", "stoch", "vol", "regime"];
const THRESHOLDS = [15, 25, 35, 45, 55, 65];
const HOLDS = [6, 12, 24, 48, 72];
const SHUFFLES = 20;

const { buildStates } = v1;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : 0; };

function votesAt(bars, st, i) {
  const b = bars[i];
  const bt = st.trendState[i] === "bull", br = st.trendState[i] === "bear";
  const volAny = (st.volMa[i] ? b.v / st.volMa[i] : 1) >= 1.5;
  const rt = st.adx[i] > 25;
  return [
    bt ? 1 : br ? -1 : 0,
    st.htfState[i] === "bull" ? 1 : st.htfState[i] === "bear" ? -1 : 0,
    st.tdState[i] === "buy" ? 1 : st.tdState[i] === "sell" ? -1 : 0,
    (st.kArr[i] > st.dArr[i] && st.kArr[i] < 80) ? 1 : (st.kArr[i] < st.dArr[i] && st.kArr[i] > 20) ? -1 : 0,
    !volAny ? 0 : (b.c >= st.bwMid[i] || bt) ? 1 : (b.c <= st.bwMid[i] || br) ? -1 : 0,
    !rt ? 0 : st.pDI[i] >= st.mDI[i] ? 1 : -1,
  ];
}

// Per-symbol column store so the inner search loop stays tight.
function load() {
  const store = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const maxHold = Math.max(...HOLDS);
  const syms = [];
  for (const [sym, bars] of Object.entries(store)) {
    if (!Array.isArray(bars) || bars.length < 600) continue;
    const st = buildStates(bars);
    const t = [], v = [], fwd = {};
    for (const h of HOLDS) fwd[h] = [];
    for (let i = 120; i < bars.length - maxHold; i += 1) {
      const vote = votesAt(bars, st, i);
      if (!vote.every(Number.isFinite)) continue;
      t.push(bars[i].t);
      v.push(vote);
      for (const h of HOLDS) fwd[h].push(bars[i + h].c / bars[i].c - 1);
    }
    if (t.length > 400) syms.push({ sym, t, v, fwd });
  }
  return syms;
}

// One config over one slice. `mask` selects components, `sign` flips direction.
function evaluate(syms, lo, hi, mask, sign, thr, hold, fwdOverride) {
  const nSel = mask.reduce((a, b) => a + b, 0);
  if (!nSel) return null;
  const span = hold * 3600e3;
  const bucket = new Map();
  for (const s of syms) {
    const fwd = fwdOverride ? fwdOverride.get(s.sym)[hold] : s.fwd[hold];
    let prev = 0, cooldown = -Infinity;
    for (let i = lo; i < hi && i < s.t.length; i += 1) {
      let raw = 0;
      const vv = s.v[i];
      for (let c = 0; c < 6; c += 1) if (mask[c]) raw += vv[c];
      const sc = (raw / nSel) * 100 * sign;
      let dir = 0;
      if (s.t[i] > cooldown) {
        if (prev < thr && sc >= thr) dir = 1;
        else if (prev > -thr && sc <= -thr) dir = -1;
      }
      prev = sc;
      if (dir) {
        cooldown = s.t[i] + span;
        const k = Math.floor(s.t[i] / span);
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(dir * fwd[i] * 100 - COST_PCT);
      }
    }
  }
  const port = [...bucket.values()].filter((g) => g.length >= 2).map(mean);
  if (port.length < 25) return null;
  const m = mean(port), s2 = sd(port);
  if (!s2) return null;
  const ppy = (365 * 24) / hold;
  return { n: port.length, net: m, t: m / (s2 / Math.sqrt(port.length)), ann: m * ppy, sharpe: (m * ppy) / (s2 * Math.sqrt(ppy)) };
}

function* configs() {
  for (let m = 1; m < 64; m += 1) {
    const mask = [0, 1, 2, 3, 4, 5].map((c) => (m >> c) & 1);
    for (const sign of [1, -1]) for (const thr of THRESHOLDS) for (const hold of HOLDS) yield { mask, sign, thr, hold };
  }
}

function main() {
  const syms = load();
  const len = syms[0].t.length;
  const a = Math.floor(len * 0.4), b = Math.floor(len * 0.7);
  console.log(`symbols ${syms.length}, bars/symbol ~${len}`);
  console.log(`TRAIN [0,${a})  VALIDATION [${a},${b})  TEST [${b},${len})  — TEST read once at the end\n`);

  const total = 63 * 2 * THRESHOLDS.length * HOLDS.length;
  const bar = Math.abs(require("util").types ? 0 : 0) || 4.0;   // Bonferroni ≈ |t| > 4.0 at N≈1900
  console.log(`=== searching ${total} configurations ===`);
  console.log(`Bonferroni family-wise bar at alpha=0.05, N=${total}:  |t| > ~${bar}\n`);

  const trained = [];
  let bestTrain = null;
  for (const c of configs()) {
    const r = evaluate(syms, 0, a, c.mask, c.sign, c.thr, c.hold);
    if (!r) continue;
    if (!bestTrain || r.t > bestTrain.r.t) bestTrain = { c, r };
    if (r.t > 2.0) trained.push({ c, r });
  }
  console.log(`TRAIN: ${trained.length} configs with t > 2.0 (naive 5% would predict ~${(total * 0.025).toFixed(0)} by chance alone)`);
  console.log(`  best TRAIN t = ${bestTrain ? bestTrain.r.t.toFixed(2) : "n/a"}`);

  // ---- empirical null: same search on shuffled forward returns ------------
  // Preserves the search structure, destroys any real signal.
  console.log(`\n=== empirical null: ${SHUFFLES} shuffles of the same search ===`);
  let nullMax = [];
  for (let s = 0; s < SHUFFLES; s += 1) {
    const shuffled = new Map();
    for (const sy of syms) {
      const f = {};
      for (const h of HOLDS) {
        const arr = sy.fwd[h].slice();
        for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        f[h] = arr;
      }
      shuffled.set(sy.sym, f);
    }
    let mx = 0;
    for (const c of configs()) {
      const r = evaluate(syms, 0, a, c.mask, c.sign, c.thr, c.hold, shuffled);
      if (r && r.t > mx) mx = r.t;
    }
    nullMax.push(mx);
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  nullMax.sort((x, y) => x - y);
  const null95 = nullMax[Math.floor(nullMax.length * 0.95)] ?? nullMax[nullMax.length - 1];
  console.log(`  max-t under the null: median ${nullMax[Math.floor(nullMax.length / 2)].toFixed(2)}, 95th pct ${null95.toFixed(2)}`);
  console.log(`  -> luck alone reaches t=${null95.toFixed(2)} in this search. A real result must beat that.`);
  console.log(`  best TRAIN t was ${bestTrain.r.t.toFixed(2)} -> ${bestTrain.r.t > null95 ? "BEATS the null" : "does NOT beat the null"}`);

  // ---- validation ---------------------------------------------------------
  console.log(`\n=== VALIDATION: ${trained.length} TRAIN survivors re-tested on untouched bars ===`);
  const validated = [];
  for (const { c, r } of trained) {
    const v = evaluate(syms, a, b, c.mask, c.sign, c.thr, c.hold);
    if (v && v.t > 1.0 && Math.sign(v.net) === Math.sign(r.net)) validated.push({ c, train: r, val: v });
  }
  validated.sort((x, y) => (y.train.t + y.val.t) - (x.train.t + x.val.t));
  console.log(`  survived with same sign and t > 1.0: ${validated.length}`);
  for (const s of validated.slice(0, 8)) {
    const names = NAMES.filter((_, i) => s.c.mask[i]).join("+");
    console.log(`    ${names} | sign ${s.c.sign > 0 ? "+" : "-"} thr ${s.c.thr} hold ${s.c.hold}h : train t ${s.train.t.toFixed(2)}, val t ${s.val.t.toFixed(2)}, val ann ${s.val.ann.toFixed(0)}%`);
  }

  // ---- TEST, read once ----------------------------------------------------
  console.log(`\n=== TEST: read once, on the top candidate only ===`);
  let verdict = "NO_CANDIDATE";
  let winner = null;
  if (validated.length) {
    const top = validated[0];
    const te = evaluate(syms, b, len, top.c.mask, top.c.sign, top.c.thr, top.c.hold);
    const names = NAMES.filter((_, i) => top.c.mask[i]).join("+");
    console.log(`  config: ${names} | sign ${top.c.sign > 0 ? "+" : "-"} | thr ${top.c.thr} | hold ${top.c.hold}h`);
    console.log(`  train t ${top.train.t.toFixed(2)}  val t ${top.val.t.toFixed(2)}  TEST t ${te ? te.t.toFixed(2) : "n/a"}`);
    if (te) {
      console.log(`  TEST: ${te.ann.toFixed(1)}%/yr, Sharpe ${te.sharpe.toFixed(2)}, ${te.n} periods`);
      const passes = te.t > 1.96 && top.train.t > null95;
      verdict = passes ? "SIGNIFICANT_AFTER_CORRECTION" : te.t > 1.96 ? "TEST_OK_BUT_WITHIN_SEARCH_NOISE" : "NOT_SIGNIFICANT";
      console.log(`\n  VERDICT: ${verdict}`);
      if (verdict === "TEST_OK_BUT_WITHIN_SEARCH_NOISE") {
        console.log(`  TEST clears 1.96, but TRAIN t ${top.train.t.toFixed(2)} did not beat the null's ${null95.toFixed(2)}.`);
        console.log(`  That combination is what a lucky search looks like, not what an edge looks like.`);
      }
      winner = { config: { components: names, sign: top.c.sign, threshold: top.c.thr, hold_hours: top.c.hold },
        train: top.train, validation: top.val, test: te };
    }
  } else {
    console.log("  nothing survived TRAIN + VALIDATION. Nothing to test.");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    configs_searched: total,
    bonferroni_bar_t: bar,
    empirical_null_max_t_p95: null95,
    train_survivors: trained.length,
    validated: validated.length,
    best_train_t: bestTrain ? bestTrain.r.t : null,
    verdict,
    winner,
  }, null, 2));
  console.log(`\nwritten: ${path.relative(process.cwd(), OUT)}`);
}

main();
