"use strict";

// 2026-04-29 P1-1.19 — nineteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three pure price/pnl math helpers historically inline at
// paperBinanceRunner.js lines 2229, 3430, 3782:
//
//   computeExitTriggerPrice         (avgPrice, leverage, side,
//                                    pnlPct) → trigger price
//                                    that produces the requested
//                                    leveraged PnL%
//   computeUnrealizedPnlPct         (position, bar, side) →
//                                    unsigned price-distance pnl
//                                    fraction (NOT leverage-
//                                    multiplied; caller multiplies
//                                    by leverage if needed)
//   computeReplayStopDistancePct    (position, bar, side, rules) →
//                                    replay-side distance from
//                                    current close to the SL
//                                    price, expressed as a signed
//                                    percentage of close price.
//                                    Positive = stop is in the
//                                    direction of the trade
//                                    (favourable side); negative =
//                                    already past the stop.
//
// Pure functions: number coercion + side-aware arithmetic. Self-
// contained call graph (none of the three call each other).
// Composes the already-extracted normalizePositionSide
// (src/utils/positionSide.js).
//
// Why this group is the next safe cohesive unit after P1-1.18:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — all three answer "given the current price, the
//     position's avg price, and the side, compute a numeric
//     price/pnl quantity used by the exit decision flow".
//   - Zero external callers (verified by grep on 2026-04-29).
//   - The leverage/side-aware math (LONG vs. SHORT formulas
//     differ) is a pre-existing trade-engine contract; pinning
//     each formula in tests so a future "unify the long/short
//     branches" refactor must explicitly assert on both directions.

const { normalizePositionSide } = require("./positionSide");

// computeExitTriggerPrice — solve for the price that yields the
// requested leveraged PnL %. Uses the broker-side movement formula
// (price moves by pnlPct/leverage to achieve pnlPct on margin).
// Returns null on non-finite or pathological input (avg≤0,
// SHORT denominator ≤0, etc.).
//
// LONG:  trigger = avg * (1 + move)
// SHORT: trigger = avg / (1 + move)   (note: divide, not subtract,
//                                      to keep symmetry with the
//                                      reverse-direction broker
//                                      math used by the
//                                      paper/live exit engine)
function computeExitTriggerPrice({ avgPrice, leverage, side, pnlPct } = {}) {
  const px = Number(avgPrice);
  const levRaw = Number(leverage);
  const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : 1;
  const pct = Number(pnlPct);
  const sideUpper = String(side || "").toUpperCase();
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(pct)) return null;
  const move = pct / lev;
  if (sideUpper === "SHORT") {
    const den = 1 + move;
    return den > 0 ? (px / den) : null;
  }
  return px * (1 + move);
}

// computeUnrealizedPnlPct — the bar-close-vs-avg fractional
// distance, signed by side: LONG→positive when price up, SHORT→
// positive when price down. NOT multiplied by leverage; caller is
// responsible for leverage-scaling if the caller wants margin-pnl
// rather than price-distance.
function computeUnrealizedPnlPct({ position, bar, positionSide }) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || avg === 0) return null;
  const side = normalizePositionSide(positionSide) || "LONG";
  return side === "SHORT" ? (avg - closePx) / avg : (closePx - avg) / avg;
}

// computeReplayStopDistancePct — backward-looking distance helper
// used by the replay engine's protection-snapshot scoring. Builds
// the SL price from rules.SL and the avg price, then returns the
// signed percentage distance from current close to the stop.
// Positive distance = price still above stop (LONG safe) or below
// stop (SHORT safe); negative = price already breached the stop.
//
// Returns the result as a percentage value (×100), NOT a fraction
// — pre-existing contract used by replay-side telemetry templates
// that print "stop distance: 0.7%" directly.
function computeReplayStopDistancePct({ position, bar, positionSide, rules } = {}) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  const side = normalizePositionSide(positionSide);
  const slPct = Number(rules && rules.SL);
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || closePx <= 0) return null;
  if (!side || !Number.isFinite(slPct)) return null;
  const stopPx = side === "SHORT"
    ? (avg * (1 - slPct))
    : (avg * (1 + slPct));
  if (!Number.isFinite(stopPx)) return null;
  return side === "SHORT"
    ? (((stopPx - closePx) / closePx) * 100)
    : (((closePx - stopPx) / closePx) * 100);
}

module.exports = {
  computeExitTriggerPrice,
  computeUnrealizedPnlPct,
  computeReplayStopDistancePct,
};
