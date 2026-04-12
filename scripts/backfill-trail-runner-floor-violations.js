#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.TRAIL_RUNNER_FLOOR_BACKFILL_LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(50, Number(process.env.TRAIL_RUNNER_FLOOR_BACKFILL_PAGE_SIZE || 500));
const DRY_RUN = String(process.env.DRY_RUN || "").trim() === "1";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function violationDirection({ positionSide, execPrice, floorPrice }) {
  const side = String(positionSide || "").toUpperCase();
  const exec = toNum(execPrice);
  const floor = toNum(floorPrice);
  if (!Number.isFinite(exec) || !Number.isFinite(floor)) return null;
  if (side === "SHORT") return exec > floor ? "ABOVE_FLOOR_SHORT" : null;
  return exec < floor ? "BELOW_FLOOR_LONG" : null;
}

async function scanTrailRunnerFloorViolations(db) {
  const rows = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (String(data.exchange || "").toUpperCase() !== "BINANCEFUT") continue;
      const createdAt = String(data.created_at || "");
      if (!createdAt || createdAt < sinceIso) continue;
      if (String(data.event || "").toUpperCase() !== "EXIT_TRAIL") continue;
      const fx = data.features_json && typeof data.features_json === "object" ? data.features_json : {};
      if (String(fx.runner_stop_source || "").toUpperCase() !== "RUNNER_FLOOR") continue;
      const positionSide = String(fx.position_side || "");
      const execPrice = toNum(data.exec_price);
      const floorPrice = toNum(fx.runner_floor_px);
      const violation = violationDirection({ positionSide, execPrice, floorPrice });
      if (!violation) continue;
      const gapPct = Number.isFinite(execPrice) && Number.isFinite(floorPrice) && floorPrice !== 0
        ? Number((((execPrice - floorPrice) / floorPrice) * 100).toFixed(4))
        : null;
      rows.push({
        docId: doc.id,
        symbol: String(data.symbol || ""),
        created_at: createdAt,
        position_side: positionSide,
        exec_price: execPrice,
        runner_floor_px: floorPrice,
        floor_gap_pct: gapPct,
        run_id: String(data.run_id || ""),
        live_bar_runner: String(data.run_id || "").startsWith("RUN__BINANCEFUT__15m__"),
        backfilled: !!(data.extra && data.extra.trail_runner_floor_backfilled_at),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function main() {
  const db = getFirestore();
  const rows = await scanTrailRunnerFloorViolations(db);
  let updated = 0;
  let alreadyBackfilled = 0;
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    if (row.backfilled) {
      alreadyBackfilled += 1;
      continue;
    }
    if (DRY_RUN) continue;
    await db.collection("fills_paper").doc(row.docId).set({
      extra: {
        trail_runner_floor_violation: true,
        trail_runner_floor_backfilled_at: nowIso,
        trail_runner_floor_gap_pct: row.floor_gap_pct,
        trail_runner_floor_px: row.runner_floor_px,
        trail_runner_floor_exec_price: row.exec_price,
        trail_runner_floor_position_side: row.position_side,
        trail_runner_floor_run_id: row.run_id || null,
        trail_runner_floor_live_bar_runner: row.live_bar_runner === true,
      },
    }, { merge: true });
    updated += 1;
  }

  const bySymbol = rows.reduce((acc, row) => {
    const key = String(row.symbol || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    lookback_days: LOOKBACK_DAYS,
    violation_total_n: rows.length,
    updated,
    already_backfilled: alreadyBackfilled,
    top_symbols: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 20),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_TRAIL_RUNNER_FLOOR_VIOLATIONS_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
