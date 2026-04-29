"use strict";

// 2026-04-29 P1-1.5 — fifth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Four predicates/normalizers that classify the trading-action
// and side enum strings used throughout the runner:
//
//   allowByTradingMode    — (tradingMode, side) → boolean
//                           gates SELL-only flow when tradingMode=EXIT_ONLY
//   normalizeSideValue    — LONG/SHORT (signal-language) → BUY/SELL
//                           (broker-language); BUY/SELL pass through;
//                           anything else → "HOLD"
//   normalizeActionValue  — uppercase action; null on empty
//   actionAllowsEntry     — true iff action ∈ {ENTRY, ADD}
//
// Pure functions: case normalization + table lookup. No I/O, no
// async, no module-level state. Self-contained call graph (none
// of the four call each other). The runner used to host them
// inline at lines 3305, 3311, 3319, 3326. None had external
// callers prior to this commit (verified by grep on 2026-04-29);
// they were exclusively used by paperBinanceRunner internals.
//
// Why this group is the next safe cohesive unit after P1-1.4:
//   - Tightest semantic cohesion of any candidate left at this
//     extraction tier — all four answer questions about the
//     finite enum sets (action ∈ {ENTRY,ADD,EXIT,DROP},
//     side ∈ {LONG,SHORT,BUY,SELL,HOLD}, tradingMode ∈
//     {RUNNING,EXIT_ONLY}).
//   - Zero external callers → zero blast radius. The runner is
//     the only file that needs to change.
//   - The four are pre-existing call sites in entry-decision,
//     exit-decision, and signal-routing logic; centralizing them
//     here gives the future strategy/execution split (P2-1) a
//     clean leaf import.

// allowByTradingMode — gates whether a directional signal can
// fire under the operator's runtime mode. RUNNING accepts both
// sides; EXIT_ONLY accepts only SELL (close-only); anything else
// rejects.
function allowByTradingMode(tradingMode, side) {
  if (tradingMode === "RUNNING") return true;
  if (tradingMode === "EXIT_ONLY") return side === "SELL";
  return false;
}

// normalizeSideValue — translate signal-language side
// (LONG/SHORT) to broker-language side (BUY/SELL). BUY/SELL pass
// through. Anything unrecognized → "HOLD" (never null) so callers
// can branch on a single sentinel without null-guard sprinkling.
function normalizeSideValue(side) {
  const s = String(side || "").toUpperCase();
  if (s === "LONG") return "BUY";
  if (s === "SHORT") return "SELL";
  if (s === "BUY" || s === "SELL") return s;
  return "HOLD";
}

// normalizeActionValue — uppercase the action enum and pass it
// through. Returns null on empty/missing. The known set is
// {ENTRY, ADD, EXIT, DROP} but unknown actions fall through
// uppercased rather than rejected; the runner's call sites apply
// allowed-action gates downstream where the policy lives.
function normalizeActionValue(action) {
  const s = String(action || "").toUpperCase();
  if (!s) return null;
  if (s === "ENTRY" || s === "ADD" || s === "EXIT" || s === "DROP") return s;
  return s;
}

// actionAllowsEntry — true iff the action increases (or opens)
// position size: ENTRY (open) or ADD (top-up). EXIT/DROP do not.
function actionAllowsEntry(action) {
  return action === "ENTRY" || action === "ADD";
}

module.exports = {
  allowByTradingMode,
  normalizeSideValue,
  normalizeActionValue,
  actionAllowsEntry,
};
