#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-wr-levers-round2.js
//
// Round 2 of the win-rate lever hunt, on the post-RR-change era (2026-05-30+,
// SHORT RR 1.2 / LONG RR 1.55). Round 1 (analyze-v3-winrate-levers.js) proved
// the six *score* features are dead out-of-sample; this round scans the
// dimensions round 1 never touched:
//
//   A. per-symbol edge (train/test)      — are specific symbols persistent drags?
//   B. funding_rate at entry             — never scanned (crowding proxy)
//   C. spread_bps at entry               — never scanned (liquidity proxy)
//   D. hour-of-day (UTC)                 — session/liquidity effect
//
// Same honesty rules as round 1: chronological 70/30 train/test split; a
// filter only counts if it helps on BOTH; expectancy must stay positive; and
// because we are scanning many cells, treat any single-cell "signal" with
// suspicion — we look for monotone/structural patterns, not lone outliers.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").split("\n").filter(Boolean).map(JSON.parse);

const ERA_START = Date.parse("2026-05-30T12:00:00Z");
const exits = read("ops/runtime/v3_paper_exit_ledger.jsonl");
const raw = new Map(read("ops/runtime/v3_raw_signal_feed.jsonl").map((r) => [r.signal_id, r]));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

const trades = [];
for (const x of exits) {
  const ts = Date.parse(x.closed_at);
  if (!ts || ts < ERA_START) continue;
  const r = raw.get(x.signal_id);
  const f = (r && r.features_json) || {};
  trades.push({
    ts,
    side: x.side,
    symbol: x.symbol,
    r: num(x.realized_r) ?? 0,
    funding: num(f.funding_rate),
    spread: num(f.spread_bps),
    hourUtc: new Date(ts).getUTCHours(),
  });
}
trades.sort((a, b) => a.ts - b.ts);

function metrics(a) {
  const n = a.length;
  if (!n) return { n: 0, wr: 0, exp: 0 };
  const w = a.filter((t) => t.r > 0).length;
  const net = a.reduce((s, t) => s + t.r, 0);
  return { n, wr: (w / n) * 100, exp: net / n };
}
const fmt = (m) => `n=${String(m.n).padEnd(3)} WR=${m.wr.toFixed(1).padStart(5)}% exp=${m.exp.toFixed(3).padStart(6)}`;

function splitTT(a) { const c = Math.floor(a.length * 0.7); return [a.slice(0, c), a.slice(c)]; }

function section(title) { console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`); }

for (const side of ["SHORT", "LONG"]) {
  const S = trades.filter((t) => t.side === side);
  const [tr, te] = splitTT(S);
  section(`SIDE ${side} — era n=${S.length}  (train ${tr.length} / test ${te.length})  baseline ${fmt(metrics(S))}`);

  // A. per-symbol
  console.log("\n--- A. per-symbol (min n>=10 era) — TRAIN vs TEST exp ---");
  const bySym = {};
  for (const t of S) (bySym[t.symbol] ||= []).push(t);
  const rows = Object.entries(bySym).filter(([, a]) => a.length >= 10)
    .map(([sym, a]) => {
      const [strn, ste] = [a.filter((t) => tr.includes(t)), a.filter((t) => te.includes(t))];
      return { sym, all: metrics(a), tr: metrics(strn), te: metrics(ste) };
    }).sort((x, y) => x.all.exp - y.all.exp);
  for (const r of rows) {
    const drag = r.tr.n >= 5 && r.te.n >= 3 && r.tr.exp < 0 && r.te.exp < 0 ? "  << ROBUST DRAG" : "";
    console.log(`  ${r.sym.padEnd(10)} ALL ${fmt(r.all)} | TR exp=${r.tr.exp.toFixed(2).padStart(6)}(n=${r.tr.n}) TE exp=${r.te.exp.toFixed(2).padStart(6)}(n=${r.te.n})${drag}`);
  }

  // B. funding buckets
  console.log("\n--- B. funding_rate at entry ---");
  const withF = S.filter((t) => t.funding !== null);
  const buckets = [
    ["very-neg (<-0.03%)", (t) => t.funding < -0.0003],
    ["mild-neg (-0.03%..0)", (t) => t.funding >= -0.0003 && t.funding < 0],
    ["positive (>=0)", (t) => t.funding >= 0],
  ];
  for (const [label, fn] of buckets) {
    const a = withF.filter(fn);
    const [btr, bte] = [a.filter((t) => tr.includes(t)), a.filter((t) => te.includes(t))];
    console.log(`  ${label.padEnd(22)} ALL ${fmt(metrics(a))} | TR exp=${metrics(btr).exp.toFixed(2)} TE exp=${metrics(bte).exp.toFixed(2)}`);
  }

  // C. spread buckets
  console.log("\n--- C. spread_bps at entry ---");
  const withS = S.filter((t) => t.spread !== null);
  const sb = [
    ["tight (<1.5)", (t) => t.spread < 1.5],
    ["mid (1.5-3)", (t) => t.spread >= 1.5 && t.spread < 3],
    ["wide (>=3)", (t) => t.spread >= 3],
  ];
  for (const [label, fn] of sb) {
    const a = withS.filter(fn);
    const [btr, bte] = [a.filter((t) => tr.includes(t)), a.filter((t) => te.includes(t))];
    console.log(`  ${label.padEnd(22)} ALL ${fmt(metrics(a))} | TR exp=${metrics(btr).exp.toFixed(2)} TE exp=${metrics(bte).exp.toFixed(2)}`);
  }

  // D. hour-of-day (4h blocks, UTC)
  console.log("\n--- D. hour-of-day (4h blocks UTC; KST = UTC+9) ---");
  for (let h = 0; h < 24; h += 4) {
    const a = S.filter((t) => t.hourUtc >= h && t.hourUtc < h + 4);
    const [btr, bte] = [a.filter((t) => tr.includes(t)), a.filter((t) => te.includes(t))];
    const label = `${String(h).padStart(2, "0")}-${String(h + 4).padStart(2, "0")}Z`;
    console.log(`  ${label.padEnd(22)} ALL ${fmt(metrics(a))} | TR exp=${metrics(btr).exp.toFixed(2)} TE exp=${metrics(bte).exp.toFixed(2)}`);
  }
}
console.log();
