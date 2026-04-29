"use strict";

// 2026-04-29 P1-1.10 — tenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Two OpenClaw / TP1-ladder cohort normalizers:
//
//   normalizeOpenClawCohort      RESCUE | MIXED | KEEP_DROP | HOLD_SAMPLE
//                                or null
//   normalizeTp1LadderProfile    RESCUE | MIXED | BASE or null
//
// Pure functions: case normalization + table lookup. The runner
// used to host them inline at lines 586 and 592.
//
// AUDIT-SIGNIFICANT: `normalizeOpenClawCohort` has ONE sibling
// copy at src/engine/signalEngine.js:210. Verified byte-identical
// to the runner's version (audited 2026-04-29 by direct sed
// comparison). Same pattern as P1-1.4 (channelList) and P1-1.8
// (signalTypeNormalization): P1-1.10 only migrates the runner's
// copy so the canonical seam exists; the signalEngine sibling
// will be migrated in a follow-up audit-driven sub-step.
// `normalizeTp1LadderProfile` has zero siblings (verified).

// normalizeOpenClawCohort — recognize the four OpenClaw cohort
// labels (RESCUE | MIXED | KEEP_DROP | HOLD_SAMPLE) emitted by
// the strategy port. Anything else returns null so callers can
// distinguish "not in the cohort grid" from a default. Case-
// insensitive; trim handled.
function normalizeOpenClawCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

// normalizeTp1LadderProfile — recognize the three TP1-ladder
// profile labels (RESCUE | MIXED | BASE). Note the SET DIFFERS
// from normalizeOpenClawCohort: ladder profile drops KEEP_DROP /
// HOLD_SAMPLE and adds BASE. The two enums are NOT
// interchangeable — they live in different policy axes (cohort
// classification vs. exit-ladder shape). Pinning each function
// to its own enum is intentional.
function normalizeTp1LadderProfile(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "BASE") return upper;
  return null;
}

module.exports = {
  normalizeOpenClawCohort,
  normalizeTp1LadderProfile,
};
