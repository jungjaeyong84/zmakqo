"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function buildV3PaperCohortKey(context = {}) {
  return [
    upper(context.side) || "UNKNOWN",
    upper(context.setup_type) || "UNKNOWN",
    upper(context.structural_regime) || "UNKNOWN",
    upper(context.edge_cohort) || "UNKNOWN",
    upper(context.entry_grade) || "UNKNOWN",
  ].join(" | ");
}

const V3_PAPER_VERSION = "V3_PAPER_BOOTSTRAP_2026_05_16_V3";
const V3_PAPER_PHASE = "PHASE_1B_PRUNED_BUILDABLE_AND_RANGE";

// 2026-05-16 — phase 1B pruning, evidence-driven (bootstrap retained_live R):
//   - LONG | BREAKOUT_RETEST | TRANSITION | BUILDABLE_EDGE | EARLY
//     n=36, WR 38.89%, exp -0.008R, net -0.30R — n large enough to call.
//     Removed entirely (also dropped from V3_SIGNAL_ACTIVE_PROFILES so
//     no raw signal is even emitted for this cohort).
//   - LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE
//     n=8, WR 37.5%, exp -0.044R, net -0.35R — sample too small to
//     fully cull, demoted to SHADOW so signals still flow but entries
//     are blocked.
//   - LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | EARLY
//     n=2, WR 0%, exp -1R, net -2R — noise-tier sample, demoted to
//     SHADOW for the same reason.
// SHADOW cohorts surface in drop counts as `V3_PAPER_COHORT_SHADOWED`
// so the next bootstrap report can see whether the cohort recovers
// without contaminating live R.
const V3_PAPER_ALLOWED_COHORTS = Object.freeze([
  Object.freeze({
    apply_mode: "ACTIVE",
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  }),
  Object.freeze({
    apply_mode: "ACTIVE",
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  }),
  Object.freeze({
    apply_mode: "ACTIVE",
    side: "SHORT",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  }),
  Object.freeze({
    apply_mode: "SHADOW",
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "RANGE",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  }),
  Object.freeze({
    apply_mode: "SHADOW",
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "BUILDABLE_EDGE",
    entry_grade: "CORE",
  }),
  Object.freeze({
    apply_mode: "ACTIVE",
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  }),
]);

const V3_PAPER_ALLOWED_COHORT_KEYS = new Set(
  V3_PAPER_ALLOWED_COHORTS.map((row) => buildV3PaperCohortKey(row))
);

function evaluateV3PaperPolicy(context = {}) {
  const key = buildV3PaperCohortKey(context);
  const matched = V3_PAPER_ALLOWED_COHORTS.find((row) => buildV3PaperCohortKey(row) === key);
  if (matched) {
    // SHADOW cohorts are kept in the allowlist so raw signals still flow
    // and accumulate observability, but their entries are blocked so the
    // live R/USDT mix is not contaminated by underperforming cohorts.
    // Surface them via a distinct reason so dashboards/bootstrap reports
    // can count and watch for recovery separately from
    // V3_PAPER_COHORT_NOT_IN_ALLOWLIST.
    if (matched.apply_mode === "SHADOW") {
      return Object.freeze({
        ok: false,
        reason: "V3_PAPER_COHORT_SHADOWED",
        cohort_key: key,
        apply_mode: "SHADOW",
        phase: V3_PAPER_PHASE,
        version: V3_PAPER_VERSION,
      });
    }
    return Object.freeze({
      ok: true,
      reason: "V3_PAPER_ALLOWED_COHORT",
      cohort_key: key,
      apply_mode: matched.apply_mode || "ACTIVE",
      phase: V3_PAPER_PHASE,
      version: V3_PAPER_VERSION,
    });
  }

  const side = upper(context.side);
  const setupType = upper(context.setup_type);
  const edgeCohort = upper(context.edge_cohort);
  const structuralRegime = upper(context.structural_regime);

  let reason = "V3_PAPER_COHORT_NOT_IN_ALLOWLIST";
  if (setupType === "PULLBACK_RECLAIM") reason = "V3_PAPER_PULLBACK_RECLAIM_DISABLED";
  else if (side === "SHORT" && setupType !== "BREAKOUT_RETEST" && setupType !== "MOMENTUM_CONTINUATION") {
    reason = "V3_PAPER_SHORT_SETUP_DISABLED";
  }
  else if (side === "SHORT" && setupType !== "MOMENTUM_CONTINUATION" && setupType !== "BREAKOUT_RETEST") {
    reason = "V3_PAPER_SHORT_SETUP_DISABLED";
  }
  else if (side === "SHORT" && setupType === "BREAKOUT_RETEST") {
    reason = "V3_PAPER_SHORT_BREAKOUT_DISABLED";
  }
  else if (side === "SHORT" && structuralRegime !== "TREND" && setupType === "MOMENTUM_CONTINUATION") {
    reason = "V3_PAPER_SHORT_CONTINUATION_ONLY_TREND";
  }
  else if (side === "SHORT" && edgeCohort === "BUILDABLE_EDGE") {
    reason = "V3_PAPER_SHORT_BUILDABLE_DISABLED";
  }
  else if (side === "LONG" && setupType === "MOMENTUM_CONTINUATION" && structuralRegime === "TREND" && edgeCohort === "MARGINAL_EDGE") {
    reason = "V3_PAPER_LONG_CONTINUATION_ONLY_CORE";
  }

  return Object.freeze({
    ok: false,
    reason,
    cohort_key: key,
    phase: V3_PAPER_PHASE,
    version: V3_PAPER_VERSION,
  });
}

module.exports = Object.freeze({
  V3_PAPER_VERSION,
  V3_PAPER_PHASE,
  V3_PAPER_ALLOWED_COHORTS,
  buildV3PaperCohortKey,
  evaluateV3PaperPolicy,
});
