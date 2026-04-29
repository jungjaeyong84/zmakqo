"use strict";

// 2026-04-29 P1-1.15 — fifteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Two pure helpers covering signal-id extraction and signal-claim
// result classification:
//
//   resolveSignalIdFromSignalLike  read signal_id (or signal_doc_id)
//                                  out of a heterogeneous "signal-
//                                  like" row, walking the legacy
//                                  features_json / features key
//                                  shapes in fallback order
//   isSignalClaimAlreadyHandled    classify a tryLockSignal /
//                                  claimSignal result as
//                                  "this signal was already
//                                  consumed/locked" (so callers
//                                  suppress duplicate alerts)
//
// Pure functions: object-property fallback chain + uppercase
// string compare. The runner used to host them inline at lines
// 1431 and 1468.
//
// Why this group is the next safe cohesive unit after P1-1.14:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — both answer "claim handling" questions: get the id,
//     classify the claim outcome.
//   - Self-contained call graph (the two do not call each other,
//     but they bracket every signal-claim flow in the runner).
//   - Zero external callers (verified by grep on 2026-04-29).
//   - The fallback-key chain in resolveSignalIdFromSignalLike is
//     a pre-existing legacy contract — a heterogeneous mix of
//     signal_id and signal_doc_id, both at row top-level and
//     nested inside features_json / features. Pinning that
//     order in a named module makes the migration path explicit
//     for the eventual canonical signal_doc_id-only world.

// resolveSignalIdFromSignalLike — extract a usable signal id from
// any of: row.signal_id, row.signal_doc_id, row.features_json.
// signal_id, row.features_json.signal_doc_id, row.features.
// signal_id, row.features.signal_doc_id. Returns null when no
// non-empty string is found at any of these paths.
function resolveSignalIdFromSignalLike(row = null) {
  return String(
    (row && row.signal_id) ||
    (row && row.signal_doc_id) ||
    (row && row.features_json && row.features_json.signal_id) ||
    (row && row.features_json && row.features_json.signal_doc_id) ||
    (row && row.features && row.features.signal_id) ||
    (row && row.features && row.features.signal_doc_id) ||
    ""
  ).trim() || null;
}

// isSignalClaimAlreadyHandled — true iff the result reports the
// signal was already consumed (ALREADY_CONSUMED) or someone else
// is currently holding the lock (LOCKED). In either case the
// caller should suppress the duplicate alert / progress
// notification rather than surface a "claim failed" error.
function isSignalClaimAlreadyHandled(result = null) {
  const reason = String(result && result.reason || "").trim().toUpperCase();
  return reason === "ALREADY_CONSUMED" || reason === "LOCKED";
}

module.exports = {
  resolveSignalIdFromSignalLike,
  isSignalClaimAlreadyHandled,
};
