#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { listExchangePositionReadViews } = require("../src/services/positionReadModel");
const {
  getPositionRuntimeObservation,
  resolveTrailObservationSnapshot,
  upsertTrailObservation,
} = require("../src/storage/positionRuntimeObservations");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isActive(row = {}) {
  const qty = toNum(row.qty_base);
  const state = upper(row.position_state || row.state);
  return Number.isFinite(qty) && qty > 0 && state !== "FLAT";
}

async function main() {
  const exchange = "BINANCEFUT";
  const positions = (await listExchangePositionReadViews({ exchange, limit: 2000 })).filter(isActive);
  let updated = 0;
  const rows = [];
  for (const position of positions) {
    const symbol = upper(position.symbol || position.symbol_or_pair_id);
    if (!symbol) continue;
    const observation = await getPositionRuntimeObservation({ exchange, symbol }).catch(() => null);
    const trailObservation = observation && observation.trail_observation && typeof observation.trail_observation === "object"
      ? observation.trail_observation
      : null;
    if (!trailObservation) continue;
    const snapshot = resolveTrailObservationSnapshot({
      meta: position.meta || {},
      observation,
    });
    const beforeSource = upper(trailObservation.chosen_stop_source);
    const beforePrice = toNum(trailObservation.chosen_stop_price);
    const afterSource = upper(snapshot.chosen_stop_source);
    const afterPrice = toNum(snapshot.chosen_stop_price);
    const changed = beforeSource !== afterSource || beforePrice !== afterPrice;
    if (!changed) continue;
    await upsertTrailObservation({
      exchange,
      symbol,
      side: trailObservation.side || position.position_side || null,
      entryEventId: trailObservation.entry_event_id || null,
      entryExecBarMs: trailObservation.entry_exec_bar_ms || null,
      entryPrice: trailObservation.entry_price || null,
      entryRDistance: trailObservation.entry_r_distance || null,
      trailRMultiple: trailObservation.trail_r_multiple || null,
      trailHigh: trailObservation.trail_high || null,
      trailHighAtMs: trailObservation.trail_high_at_ms || null,
      trailLow: trailObservation.trail_low || null,
      trailLowAtMs: trailObservation.trail_low_at_ms || null,
      runnerFloorStop: trailObservation.runner_floor_stop || null,
      computedTrailStop: trailObservation.computed_trail_stop || null,
      trailStopRaw: trailObservation.trail_stop_raw || null,
      trailStopByR: trailObservation.trail_stop_by_r || null,
      trailStopByPct: trailObservation.trail_stop_by_pct || null,
      chosenStopSource: snapshot.chosen_stop_source || null,
      chosenStopPrice: snapshot.chosen_stop_price || null,
      nativeStopPrice: trailObservation.native_stop_price || null,
      nativeStopOrderId: trailObservation.native_stop_order_id || null,
      nativeRefreshStatus: trailObservation.native_refresh_status || null,
      lastRepriceAtMs: trailObservation.last_reprice_at_ms || null,
      runtimeEvalAtMs: trailObservation.runtime_eval_at_ms || null,
      source: trailObservation.source || "NORMALIZATION_BACKFILL",
    });
    updated += 1;
    rows.push({
      symbol,
      before_source: beforeSource,
      after_source: afterSource,
      before_price: beforePrice,
      after_price: afterPrice,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    exchange,
    active_position_n: positions.length,
    updated_n: updated,
    rows,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_TRAIL_OBSERVATION_NORMALIZATION_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
