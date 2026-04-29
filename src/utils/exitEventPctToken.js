"use strict";

// 2026-04-29 P1-1.18 — eighteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// One pure helper for rendering the percentage-suffix token used
// in canonical exit event names like "EXIT_TP_P1_3P" (the "3P"
// part) and "EXIT_SL_1.5P":
//
//   ratioToPctTokenLocal(ratio) → "3" | "1.5" | null
//
// Pure function: |ratio| × 100, rounded to 2 decimal places, with
// trailing zeros stripped. Returns null on non-finite or non-
// positive input. The runner used to host it inline at line 359
// of paperBinanceRunner.js.
//
// AUDIT-SIGNIFICANT (same pattern as P1-1.4 channelList /
// P1-1.10 openClawCohort / P1-1.12 sleepMs): this function has
// ONE byte-identical sibling at src/services/binanceTickExit.js:130
// (audited 2026-04-29 by direct sed comparison). P1-1.18 only
// migrates the runner's copy so the canonical seam exists; the
// binanceTickExit sibling will be migrated in a follow-up audit-
// driven sub-step.
//
// Why this function gets its own module instead of joining
// alertNumberFormat (P1-1.11)'s formatRatioPctToken: the two are
// adjacent in shape but distinct in contract:
//   formatRatioPctToken: 0.025 → "2.5", sign preserved, abs
//                        opt-in, 2-3dp; consumed by alert-payload
//                        templates ("SL_1.5 / TP1_3 / TRAIL_2R").
//   ratioToPctTokenLocal: |0.025| → "3" (rounded), always
//                         unsigned, integer-when-possible;
//                         consumed by canonical exit event names
//                         ("EXIT_TP_P1_3P"). Different rounding
//                         contract — alert templates need
//                         human-readable precision; event names
//                         must produce a stable suffix that
//                         downstream alert routing recognizes.
// Merging them would introduce a regression risk neither tests
// today.

// ratioToPctTokenLocal — percent token from a signed ratio. The
// trailing-zero stripping uses TWO regex passes by design:
//   .replace(/\.0+$/, "")      — strip "1.00" → "1"
//   .replace(/(\.\d*?)0+$/, "$1") — strip "1.50" → "1.5", but
//                                   leave "1.05" alone
// Together they normalize "1.0", "1.50", "1.05" to "1", "1.5",
// "1.05" respectively. Pin the two-pass behaviour in tests so a
// future "use one regex" simplification can't silently change
// the token (downstream alert routing matches event-name
// suffixes literally).
function ratioToPctTokenLocal(ratio) {
  const n = Math.abs(Number(ratio));
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round(n * 10000) / 100;
  return String(pct).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

module.exports = {
  ratioToPctTokenLocal,
};
