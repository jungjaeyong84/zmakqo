#!/usr/bin/env node
"use strict";

// scripts/backfill-v7-positioning.js (2026-08-21)
//
// One-time rebuild of the v7 ledger at its intended 4h cadence.
//
// The cycle used to act on `usable[usable.length - 1]` only. The v5 collector
// runs twice a day and banks ~3 new 4h stamps per run, so the lane booked 2
// periods a day out of 6 available — 64% of the sample discarded, and a 12h
// effective holding period against the 4h the backtest measured.
//
// WHY REBUILD RATHER THAN INSERT. Every row's return spans from the PREVIOUS
// row's signal bar to its own, and its equity chains off the previous row's.
// The missed stamps are interleaved between booked ones, so dropping them in
// would leave each neighbouring row measuring the wrong span off the wrong
// predecessor. The chain has to be laid down in timestamp order from the start.
//
// SCOPE. Only stamps from the lane's own first booked period onward. Earlier
// flow history exists — the whole 242-period backtest came from it — but
// replaying that into the LIVE ledger would launder backtest data into paper
// results. The live window starts where the live lane started.
//
// The prior ledger is archived, not deleted: it is a real record of what the
// 12h chain actually did, and the two are worth comparing.

const fs = require("fs");
const path = require("path");
const v7 = require("./run-v7-positioning-cycle.js");

const { buildRebalanceRow, loadFlow, readLedger, fetchCloses, LEDGER } = v7;
const ROOT = path.resolve(__dirname, "..");
const ARCHIVE_DIR = path.join(ROOT, "ops/archive");

async function main() {
  const existing = readLedger(LEDGER);
  if (!existing.length) { console.error("ledger empty — nothing to rebuild"); process.exit(1); }
  const startTs = existing[0].ts;

  const flow = loadFlow();
  const symbols = [...new Set([...flow.values()].map((r) => r.symbol))].sort();
  const stamps = [...new Set([...flow.values()].map((r) => r.ts))].sort((a, b) => a - b);
  const usable = stamps.slice(0, -1).filter((ts) => ts >= startTs);

  console.log(`prior ledger : ${existing.length} rows, ${new Date(startTs).toISOString()} onward`);
  console.log(`usable stamps in that window: ${usable.length} (4h cadence)`);
  console.log(`to recover  : ${usable.length - existing.length}\n`);

  const errors = [];
  const closes = new Map();
  process.stderr.write("fetching prices");
  for (const s of symbols) {
    try {
      closes.set(s, await fetchCloses(s));
      process.stderr.write(".");
      await new Promise((r) => setTimeout(r, 80));
    } catch (e) { errors.push(`${s}: ${e.message}`); }
  }
  process.stderr.write("\n");

  // Verify prices cover the window before touching the ledger: fetchCloses
  // returns 200 bars, and a rebuild that silently drops the early periods for
  // want of a price would be worse than not rebuilding at all.
  const anyCloses = [...closes.values()].find((m) => m.size);
  const earliestPrice = anyCloses ? Math.min(...anyCloses.keys()) : Infinity;
  if (earliestPrice > startTs) {
    console.error(`price history starts ${new Date(earliestPrice).toISOString()}, after the ledger's ${new Date(startTs).toISOString()} — aborting`);
    process.exit(1);
  }

  const rebuilt = [];
  let prev = null;
  for (const ts of usable) {
    const row = buildRebalanceRow(ts, prev, flow, symbols, closes, errors);
    if (!row) continue;
    rebuilt.push(row);
    prev = row;
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const archived = path.join(ARCHIVE_DIR, `v7_positioning_ledger_12h_${stamp}.jsonl`);
  fs.renameSync(LEDGER, archived);
  fs.writeFileSync(LEDGER, rebuilt.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const booked = rebuilt.filter((r) => r.prior_gross_pct !== null);
  const nets = booked.map((r) => r.net_pct);
  const m = nets.reduce((a, b) => a + b, 0) / (nets.length || 1);
  const s = Math.sqrt(nets.reduce((a, b) => a + (b - m) ** 2, 0) / (nets.length || 1));

  console.log(`archived prior ledger -> ${path.relative(ROOT, archived)}`);
  console.log(`rebuilt: ${rebuilt.length} rows, ${booked.length} booked periods`);
  console.log(`equity ${rebuilt[rebuilt.length - 1].equity.toFixed(6)}  mean net ${m.toFixed(4)}%  t ${(m / (s / Math.sqrt(nets.length))).toFixed(2)}`);
  if (errors.length) console.log(`notes: ${errors.length}\n  ${[...new Set(errors)].slice(0, 5).join("\n  ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
