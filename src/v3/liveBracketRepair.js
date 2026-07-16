"use strict";

// src/v3/liveBracketRepair.js — naked-position repair decision (2026-07-16).
//
// The one real hole in the increment-1 execution layer: if the machine dies
// AFTER the market entry fills but BEFORE the bracket is placed, the ledger
// row stays OPEN_BRACKET_INCOMPLETE and a REAL position sits on the exchange
// with NO stop. This module decides the repair; the exit-sync runner applies
// it and appends a fresh authoritative row (latest-row-wins, see
// liveLedgerView.js).
//
// Decision table, given the entry row + live exchange state:
//   position flat                → CLOSE_EXTERNAL  (entry never filled, or
//                                   position was closed outside our brackets;
//                                   record a needs-review exit row)
//   position open, leg(s) dead   → REPLACE_* (re-place missing legs with the
//                                   ORIGINAL paper levels — repair restores
//                                   protection, it never re-prices)
//   position open, a leg FILLED  → ANOMALY (a filled exit leg with a live
//                                   position contradicts closePosition
//                                   semantics — never auto-repair, alert)
//   position open, legs healthy  → NONE (row was stale, just re-mark OPEN)

function upper(v) { const s = String(v == null ? "" : v).trim(); return s ? s.toUpperCase() : null; }

// A bracket leg is alive if its order exists and is working.
function legAlive(order) {
  if (!order) return false;
  const st = upper(order.status);
  return st === "NEW" || st === "PARTIALLY_FILLED" || st === "UNTRIGGERED";
}
function legFilled(order) {
  return !!order && upper(order.status) === "FILLED";
}

// positionAmt: signed position from the exchange for this symbol
// (positive = long, negative = short), 0/null = flat.
function decideBracketRepair({ entryRow = {}, positionAmt = 0, stopOrder = null, tpOrder = null } = {}) {
  const side = upper(entryRow.side);
  const amt = Number(positionAmt) || 0;
  const hasPosition = Math.abs(amt) > 0;
  const directionMatches = !hasPosition
    || (side === "LONG" && amt > 0)
    || (side === "SHORT" && amt < 0);

  if (!hasPosition) {
    return Object.freeze({ action: "CLOSE_EXTERNAL", reason: "POSITION_FLAT_ON_EXCHANGE" });
  }
  if (!directionMatches) {
    return Object.freeze({ action: "ANOMALY", reason: "POSITION_DIRECTION_MISMATCH" });
  }
  if (legFilled(stopOrder) || legFilled(tpOrder)) {
    return Object.freeze({ action: "ANOMALY", reason: "EXIT_LEG_FILLED_BUT_POSITION_OPEN" });
  }

  const stopAlive = legAlive(stopOrder);
  const tpAlive = legAlive(tpOrder);
  if (stopAlive && tpAlive) return Object.freeze({ action: "NONE", reason: "BRACKET_HEALTHY" });
  if (!stopAlive && !tpAlive) return Object.freeze({ action: "REPLACE_BOTH", reason: "BOTH_LEGS_DEAD" });
  if (!stopAlive) return Object.freeze({ action: "REPLACE_STOP", reason: "STOP_LEG_DEAD" });
  return Object.freeze({ action: "REPLACE_TP", reason: "TP_LEG_DEAD" });
}

// Build the authoritative replacement entry row appended after a repair.
// Carries the same signal_id + paper levels; only order ids change.
function buildRepairedEntryRow(entryRow = {}, { stopOrderId = null, tpOrderId = null, repairedLegs = [] } = {}) {
  return Object.freeze({
    ...entryRow,
    status: "OPEN",
    created_at: new Date().toISOString(),
    stop_order_id: stopOrderId != null ? stopOrderId : entryRow.stop_order_id,
    tp_order_id: tpOrderId != null ? tpOrderId : entryRow.tp_order_id,
    repaired: true,
    repaired_legs: Object.freeze([...repairedLegs]),
    prior_stop_order_id: entryRow.stop_order_id != null ? entryRow.stop_order_id : null,
    prior_tp_order_id: entryRow.tp_order_id != null ? entryRow.tp_order_id : null,
    source: "V3_LIVE_BRACKET_REPAIR",
  });
}

// Exit row recorded when the position turned out to be flat (entry never
// filled, or closed externally) — always flagged for human review because
// realized numbers cannot be derived from our own bracket orders.
function buildExternalCloseExitRow(entryRow = {}) {
  return Object.freeze({
    signal_id: entryRow.signal_id,
    symbol: upper(entryRow.symbol),
    side: upper(entryRow.side),
    dry_run: false,
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    exit_event: "EXTERNAL_OR_UNFILLED",
    realized_r: null,
    needs_review: true,
    source: "V3_LIVE_BRACKET_REPAIR",
  });
}

module.exports = Object.freeze({
  decideBracketRepair,
  buildRepairedEntryRow,
  buildExternalCloseExitRow,
  __test: { legAlive, legFilled },
});
