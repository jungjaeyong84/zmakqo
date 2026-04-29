"use strict";

// 2026-04-29 P1-1.11 — eleventh stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three human-readable number/percentage formatters used to
// build alert payload strings:
//
//   formatAlertNumber             auto-precision number → string,
//                                 returns "NA" for non-finite
//   formatRatioPctToken           ratio (e.g. 0.025) → percent
//                                 token ("2.5"), returns null for
//                                 non-finite
//   formatExitRulesCompactLocal   exit-rules object → compact
//                                 string ("SL_1.5 / TP1_3 / TRAIL_2R / ...")
//
// Pure functions: number → string, no I/O, no async, no module-
// level state. Self-contained call graph
// (formatExitRulesCompactLocal → formatRatioPctToken). The runner
// used to host them inline at lines 1602, 1610, 1618.
//
// Why this group is the next safe cohesive unit after P1-1.10:
//   - Tightest semantic cohesion remaining at this tier — all
//     three answer "human-readable string formatting for alert
//     payloads".
//   - Zero external callers (verified by grep on 2026-04-29).
//   - Trailing-zero stripping (`/\.?0+$/` regex) is a pre-existing
//     contract used by every alert payload in the system; pinning
//     it in a named module prevents accidental drift if a future
//     formatter wants to share the convention (instead of copy-
//     pasting yet another sibling).

// formatAlertNumber — coerce to number; if non-finite return
// "NA". Otherwise pick a precision based on magnitude:
//   |n| ≥ 1000 → 2 decimal places
//   |n| ≥ 100  → 3
//   |n| ≥ 1    → 4
//   else        → caller's `digits` (default 6)
// Trailing zeros stripped, including a stray dot. The asymmetric
// scale-down at large magnitudes is deliberate: alert payloads
// for KRW/USDT prices over 1000 don't need sub-cent resolution.
function formatAlertNumber(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "NA";
  const abs = Math.abs(n);
  const precision = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : digits;
  return n.toFixed(precision).replace(/\.?0+$/, "");
}

// formatRatioPctToken — convert a ratio (0..1 or signed) to its
// percent token. Returns null on non-finite input. Precision:
//   |pct| ≥ 10 → 2 decimal places
//   else        → 3
// `abs:true` returns |pct|; otherwise the sign is preserved
// (callers that build "SL_-1.5%" use the unsigned form via
// {abs:true} since the SL polarity is already encoded in the
// label "SL").
function formatRatioPctToken(value, { abs = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = (abs ? Math.abs(n) : n) * 100;
  const fixed = pct >= 10 ? pct.toFixed(2) : pct.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

// formatExitRulesCompactLocal — render the operator-facing
// "exit rules" compact summary used by entry/exit alert payloads.
// Returns null if input is not an object or no rule slots are
// present. The rendered shape ("SL_1.5 / TP1_3 / TRAIL_2R /
// RUNNER_MIN_0.5 / BE_0.4") is pre-existing and consumed by
// downstream alert templates; do not change it without auditing
// the templates.
function formatExitRulesCompactLocal(exitRules) {
  if (!exitRules || typeof exitRules !== "object") return null;
  const parts = [];
  const sl = formatRatioPctToken(exitRules.SL, { abs: true });
  const tp1 = formatRatioPctToken(exitRules.TP_P1);
  const trailR = Number(exitRules.TRAIL_R_MULTIPLE);
  const trail = Number.isFinite(trailR) && trailR > 0
    ? `${String(trailR).replace(/\.?0+$/, "")}R`
    : formatRatioPctToken(exitRules.TRAIL_PCT);
  const runnerMin = formatRatioPctToken(exitRules.RUNNER_MIN_PROFIT_PCT);
  const be = formatRatioPctToken(exitRules.BE_PCT);
  if (sl) parts.push(`SL_${sl}`);
  if (tp1) parts.push(`TP1_${tp1}`);
  if (trail) parts.push(`TRAIL_${trail}`);
  if (runnerMin) parts.push(`RUNNER_MIN_${runnerMin}`);
  if (be) parts.push(`BE_${be}`);
  return parts.length ? parts.join(" / ") : null;
}

module.exports = {
  formatAlertNumber,
  formatRatioPctToken,
  formatExitRulesCompactLocal,
};
