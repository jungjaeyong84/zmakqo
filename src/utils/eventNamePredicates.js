"use strict";

// 2026-04-29 P1-1.3 — third stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three event-name predicates that classify the upper-cased event
// label string emitted by the Pine v6.1.1.0 strategy port and the
// V2 server-native signal generator:
//
//   isPrimaryLongShortEventName  — "LONG" | "SHORT"
//   isPreRealEventName           — "PRE_REAL_*"
//   isCoreOrRealEvent            — primary OR "CORE_*" OR pre-real OR "REAL_*"
//
// They are pure: case normalization + string check, no I/O, no
// async, no module-level state. The runner used to host them
// inline at lines 1807, 1819, and 3453 of paperBinanceRunner.js;
// `isCoreOrRealEvent` calls the other two so they form a tight
// semantic unit. Already covered by
// src/tests/opposite-transition-entry-scope.test.js via the
// runner's __test surface (lines 7, 9-14), which continues to
// pass unchanged because the runner re-exports the SAME function
// references (no fork).
//
// Why this group is the next safe cohesive unit after P1-1.2:
//   - Pure functions, single-responsibility (event-label
//     classification — nothing else).
//   - Self-contained call graph: isCoreOrRealEvent → the other two,
//     no transitive imports back into runner internals.
//   - Tiny blast radius: only ~15 LOC moved, but consolidating the
//     "what counts as a real signal" rule into one named module
//     makes the future signalEngine extraction (where similar
//     normalization logic lives in src/services/signalEngine.js)
//     easier to audit for divergence.

// isPrimaryLongShortEventName — true iff the event is the bare
// directional primitive "LONG" or "SHORT". Case-insensitive.
function isPrimaryLongShortEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev === "LONG" || ev === "SHORT";
}

// isPreRealEventName — true iff the event is the "pre-real"
// pre-confirmation tier (e.g. PRE_REAL_LONG, PRE_REAL_SHORT,
// PRE_REAL_CORE_LONG). Case-insensitive prefix check.
function isPreRealEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("PRE_REAL_");
}

// isCoreOrRealEvent — the canonical "this counts as a tradable
// real signal" classifier used by the opposite-transition entry
// scope, the canonical decision engine, and several other call
// sites. True for: bare LONG/SHORT, CORE_*, PRE_REAL_*, REAL_*.
// Anything else (EARLY_*, legacy aliases) is treated as out of
// scope.
function isCoreOrRealEvent(event) {
  const ev = String(event || "").toUpperCase();
  return (
    isPrimaryLongShortEventName(ev)
    || ev.startsWith("CORE_")
    || isPreRealEventName(ev)
    || ev.startsWith("REAL_")
  );
}

module.exports = {
  isPrimaryLongShortEventName,
  isPreRealEventName,
  isCoreOrRealEvent,
};
