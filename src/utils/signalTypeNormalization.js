"use strict";

// 2026-04-29 P1-1.8 — eighth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three signal-type normalization helpers historically inline at
// paperBinanceRunner.js lines 3396, 3405, 3412:
//
//   normalizeSignalTypeList         array | comma/space-string →
//                                   trimmed/uppercased non-empty
//                                   string array (no dedup; preserves
//                                   caller-supplied order)
//   normalizeTpP1EventForExchange   per-exchange event-name remap
//                                   (specifically: collapses the
//                                   legacy 5%-anchored
//                                   EXIT_TP_P1_5P → EXIT_TP_P1_3P
//                                   on Binance after the 2026-Q1
//                                   ladder retune)
//   filterOutRealSignalTypes        drop "REAL"/"REAL_LONG"/
//                                   "REAL_SHORT" entries (used when
//                                   binance_real_trading_enabled is
//                                   false to scrub the live trading
//                                   types out of a discovery list)
//
// Pure functions: array/string normalization only, no I/O, no
// async, no module-level state. Self-contained call graph (none of
// the three call each other). The runner used to host them inline
// alongside two more entries — `resolveBinanceRealTradingEnabled`
// and `resolveTradeableSignalTypes` — but those two depend on the
// runner-internal `normalizeBool` (not yet extracted), so they
// stay inline in this commit. They will move out together with
// `normalizeBool` in a later P1-1.x sub-step.
//
// AUDIT-SIGNIFICANT: `normalizeTpP1EventForExchange` has THREE
// other identical sibling copies elsewhere in the codebase
// (audited 2026-04-29 by grep + diff):
//
//   src/storage/signals.js
//   src/routes/webhook.routes.js
//   src/services/tradeExecutionAlert.js  (called from 5 sites)
//
// All three sibling bodies are byte-identical to the runner's
// version (and to each other). They were copy-pasted ad-hoc as
// the codebase grew. P1-1.8 only migrates the runner's copy so
// the canonical seam exists; subsequent audit-driven sub-steps
// will collapse the remaining three duplicates one-at-a-time.
// Doing them in one commit would stack three independent risk
// surfaces with no behavioural test coverage for typos in any
// individual migration. Same pattern as P1-1.4 (channelList).

// normalizeSignalTypeList — array OR comma/space-delimited string
// → upper-cased non-empty array. Preserves caller-supplied order
// (no dedup). Returns [] on falsy/non-array/non-string input. The
// runner's call sites depend on the order-preservation contract
// (e.g. when the operator lists "LONG,SHORT,EMO_LONG" the engine
// iterates in that order to apply per-type policy precedence).
function normalizeSignalTypeList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").toUpperCase()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).map((x) => String(x || "").toUpperCase()).filter(Boolean);
  }
  return [];
}

// normalizeTpP1EventForExchange — per-exchange canonical remap of
// TP-P1 event names. Currently handles one well-known case: the
// 2026-Q1 Binance ladder retune renamed EXIT_TP_P1_5P (5% anchor)
// to EXIT_TP_P1_3P (3% anchor); existing in-flight signals from
// the legacy strategy still carry the old name. Pre-existing
// behaviour: for non-Binance exchanges OR for any other event,
// returns the upper-cased event verbatim.
function normalizeTpP1EventForExchange(eventRaw, exchange) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("BINANCE") && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
  return ev;
}

// filterOutRealSignalTypes — drop the three "REAL"-family signal
// types from a list. Used by resolveTradeableSignalTypes when
// binance_real_trading_enabled is false: the signal generator
// emits REAL_* on canary/discovery flows that the production
// stance must not actually trade until the operator turns the
// switch. Returns a new array; non-array input returns [].
function filterOutRealSignalTypes(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => {
    const v = String(x || "").toUpperCase();
    if (!v) return false;
    return v !== "REAL" && v !== "REAL_LONG" && v !== "REAL_SHORT";
  });
}

module.exports = {
  normalizeSignalTypeList,
  normalizeTpP1EventForExchange,
  filterOutRealSignalTypes,
};
