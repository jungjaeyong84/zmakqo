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

const V3_PAPER_VERSION = "V3_PAPER_BOOTSTRAP_2026_05_11_V2";
const V3_PAPER_PHASE = "PHASE_1_NO_RECLAIM_ACTIVE_LONG_SHORT";

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
    apply_mode: "ACTIVE",
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "RANGE",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  }),
  Object.freeze({
    apply_mode: "ACTIVE",
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TRANSITION",
    edge_cohort: "BUILDABLE_EDGE",
    entry_grade: "EARLY",
  }),
  Object.freeze({
    apply_mode: "ACTIVE",
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
