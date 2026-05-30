#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-rr-sweep.js
//
// The feature-selectivity study (analyze-v3-winrate-levers.js) proved that
// no available feature reliably lifts win-rate out-of-sample. The only
// remaining lever to raise WR is mechanical: move the take-profit closer
// (lower RR). This replays every CLOSED v3 paper trade against its real 1m
// price path at several TP distances and reports the resulting WR +
// expectancy per side, so we can see exactly which RR (if any) pushes both
// LONG and SHORT to >= 50% WR while keeping expectancy positive.
//
// Stop distance is held FIXED (risk unit unchanged); only the target moves.
// Tie resolution (same 1m bar touches both) stays conservative = SL, reused
// verbatim from localPaperExitLedger.resolveExitFromCandlePath.
//
// 1m paths are fetched once from Binance FAPI and cached to
// /tmp/v3_rr_sweep_paths.jsonl so re-runs are offline. Polite throttle +
// the runner's own 429 retry keep us under the rate limit.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "ops/runtime/v3_paper_entry_ledger.jsonl");
const EXIT = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");
const CACHE = "/tmp/v3_rr_sweep_paths.jsonl";

const { __test: exitTest } = require("../src/v3/localPaperExitLedger");
const { resolveExitFromCandlePath } = exitTest;
const { __test: runnerTest } = require("../scripts/run-v3-paper-exit-ledger");
const { fetchKlinesForEntry } = runnerTest;

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Scale target to a given RR multiple, keeping stop fixed.
// risk = |signal - stop|; target = signal +/- rr*risk
function targetForRR(entry, rr) {
  const side = String(entry.side).toUpperCase();
  const sig = num(entry.signal_price);
  const stop = num(entry.stop_price);
  if (sig === null || stop === null) return null;
  const risk = Math.abs(sig - stop);
  if (side === "LONG") return sig + rr * risk;
  if (side === "SHORT") return sig - rr * risk;
  return null;
}

function realizedRFromExit(entry, exitEvent, rr) {
  // clean outcomes only: TP_HIT => +rr, SL_HIT => -1
  if (exitEvent === "TP_HIT") return rr;
  if (exitEvent === "SL_HIT") return -1;
  return null;
}

async function loadPaths(entries) {
  // cache keyed by signal_id
  const cached = new Map(readJsonl(CACHE).map((r) => [r.signal_id, r.candles]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let fetched = 0;
  const out = new Map(cached);
  for (const e of entries) {
    if (out.has(e.signal_id)) continue;
    const nowMs = Date.parse(e._closed_at) + 60000; // bound to just past close
    try {
      const candles = await fetchKlinesForEntry(e, nowMs, {});
      out.set(e.signal_id, candles || []);
      fs.appendFileSync(CACHE, JSON.stringify({ signal_id: e.signal_id, candles: candles || [] }) + "\n");
      fetched++;
      if (fetched % 10 === 0) process.stderr.write(`  fetched ${fetched} new paths...\n`);
      await sleep(250); // polite throttle
    } catch (err) {
      process.stderr.write(`  fetch fail ${e.signal_id}: ${err && err.message}\n`);
      out.set(e.signal_id, []);
    }
  }
  return out;
}

function metrics(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, exp: 0, net: 0 };
  const w = rows.filter((r) => r.r > 0).length;
  const net = rows.reduce((s, r) => s + r.r, 0);
  return { n, wr: (w / n) * 100, exp: net / n, net };
}

async function main() {
  const entries = readJsonl(ENTRY);
  const exits = readJsonl(EXIT);
  const entryMap = new Map(entries.map((e) => [e.signal_id, e]));

  // Build closed-trade list with entry levels + closed_at
  const closed = [];
  for (const x of exits) {
    const e = entryMap.get(x.signal_id);
    if (!e) continue;
    if (num(e.signal_price) === null || num(e.stop_price) === null) continue;
    closed.push({ ...e, _closed_at: x.closed_at, _orig_event: x.exit_event, _orig_r: num(x.realized_r) });
  }
  process.stderr.write(`Closed trades to replay: ${closed.length}\n`);

  const paths = await loadPaths(closed);

  const RRS = [0.8, 1.0, 1.2, 1.4, 1.55];
  const result = {};
  let pathMissing = 0, labelMismatch = 0;

  for (const rr of RRS) {
    result[rr] = { LONG: [], SHORT: [] };
  }

  for (const e of closed) {
    const candles = paths.get(e.signal_id) || [];
    if (!candles.length) { pathMissing++; continue; }
    const side = String(e.side).toUpperCase();
    // sanity: replay at original RR 1.55 should match stored label
    const origTarget = targetForRR(e, 1.55);
    const origReplay = resolveExitFromCandlePath({ ...e, target_price: origTarget }, candles);
    if (origReplay && e._orig_event && origReplay.exit_event !== e._orig_event) labelMismatch++;

    for (const rr of RRS) {
      const tgt = targetForRR(e, rr);
      const outcome = resolveExitFromCandlePath({ ...e, target_price: tgt }, candles);
      if (!outcome) continue; // still open at this window — skip
      const r = realizedRFromExit(e, outcome.exit_event, rr);
      if (r === null) continue;
      result[rr][side].push({ r });
    }
  }

  process.stderr.write(`path_missing=${pathMissing} label_mismatch_at_1.55=${labelMismatch}\n\n`);

  console.log("=".repeat(86));
  console.log("V3 RR SWEEP — WR & expectancy per side at each take-profit distance (stop fixed)");
  console.log("=".repeat(86));
  console.log(`${"RR".padStart(5)} | ${"LONG  n / WR / exp / net".padEnd(36)} | SHORT n / WR / exp / net`);
  console.log("-".repeat(86));
  for (const rr of RRS) {
    const L = metrics(result[rr].LONG);
    const S = metrics(result[rr].SHORT);
    const fmt = (m) => `n=${String(m.n).padEnd(3)} WR=${m.wr.toFixed(1).padStart(5)}% exp=${m.exp.toFixed(3).padStart(6)} net=${m.net.toFixed(1).padStart(6)}`;
    const flagL = L.wr >= 50 && L.exp > 0 ? " ✓" : "  ";
    const flagS = S.wr >= 50 && S.exp > 0 ? " ✓" : "  ";
    console.log(`${rr.toFixed(2).padStart(5)} | ${fmt(L)}${flagL} | ${fmt(S)}${flagS}`);
  }
  console.log("-".repeat(86));
  console.log("✓ = WR>=50% AND expectancy>0 for that side at that RR");
}

main().catch((e) => { console.error(e); process.exit(1); });
