"use strict";

// 2026-04-29 P1-1.9 — ninth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Two helpers covering the futures exit-profile mode enum
// ("BASE" | "AGGRESSIVE"). Pre-existing inline at
// paperBinanceRunner.js lines 3206 and 3211:
//
//   normalizeFuturesExitProfileMode          raw → "BASE"|"AGGRESSIVE";
//                                            fall back to caller-
//                                            supplied default
//                                            (default "BASE").
//   resolveConfiguredFuturesExitProfileMode  fallback null when raw
//                                            empty AND no fallback
//                                            supplied; otherwise
//                                            normalize.
//
// Pure functions. resolveConfiguredFuturesExitProfileMode calls
// normalizeFuturesExitProfileMode, so the pair travels together
// as one cohesive unit.
//
// Why this group is the next safe cohesive unit after P1-1.8:
//   - Tightest semantic cohesion remaining at this tier — both
//     answer questions about the futures exit-profile mode enum.
//   - Already covered by src/tests/live-exit-profile-config.test.js
//     (lines 5-6) via the runner's __test surface — that
//     integration test continues to pass unchanged because the
//     runner re-exports the SAME function reference (no fork).
//   - Zero non-test external callers (verified by grep on
//     2026-04-29).

// normalizeFuturesExitProfileMode — coerce raw to one of
// "BASE"|"AGGRESSIVE"; fall back to caller-supplied default
// (default "BASE"). The fallback is itself normalized: empty or
// non-recognized fallback → "BASE" sentinel. This double-fallback
// behaviour is pre-existing and intentional — callers can pass an
// operator-supplied `fallback` raw without pre-normalizing.
function normalizeFuturesExitProfileMode(raw, fallback = "BASE") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "BASE" || v === "AGGRESSIVE") return v;
  return String(fallback || "BASE").trim().toUpperCase() || "BASE";
}

// resolveConfiguredFuturesExitProfileMode — three-state branch:
//   raw is empty AND fallback is null/undefined → null
//     (means "operator never configured an exit profile mode";
//     callers fall through to baseline policy)
//   raw is empty AND fallback present → normalize(fallback, "BASE")
//   raw is non-empty                  → normalize(raw, fallback or "BASE")
function resolveConfiguredFuturesExitProfileMode(raw, fallback = null) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback == null ? null : normalizeFuturesExitProfileMode(fallback, "BASE");
  return normalizeFuturesExitProfileMode(text, fallback == null ? "BASE" : fallback);
}

module.exports = {
  normalizeFuturesExitProfileMode,
  resolveConfiguredFuturesExitProfileMode,
};
