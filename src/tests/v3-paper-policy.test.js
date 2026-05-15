"use strict";

const assert = require("assert");

const {
  buildV3PaperCohortKey,
  evaluateV3PaperPolicy,
  V3_PAPER_PHASE,
  V3_PAPER_ALLOWED_COHORTS,
} = require("../v3/paperPolicy");

(() => {
  const allowed = {
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  };
  const key = buildV3PaperCohortKey(allowed);
  assert.strictEqual(key, "LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE");
  const verdict = evaluateV3PaperPolicy(allowed);
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.reason, "V3_PAPER_ALLOWED_COHORT");
  assert.strictEqual(verdict.apply_mode, "ACTIVE");
  assert.strictEqual(verdict.phase, V3_PAPER_PHASE);
})();

(() => {
  // 2026-05-16 phase 1B: 7 → 6 cohorts (LONG_BR_TRANSITION_BUILDABLE_EARLY
  // removed; LONG_MC_TREND_BUILDABLE_CORE and LONG_BR_RANGE_MARGINAL_EARLY
  // demoted to SHADOW but kept in the allowlist).
  assert.strictEqual(V3_PAPER_ALLOWED_COHORTS.length, 6);
  const shortAllowed = evaluateV3PaperPolicy({
    side: "SHORT",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  });
  assert.strictEqual(shortAllowed.ok, true);
  assert.strictEqual(shortAllowed.reason, "V3_PAPER_ALLOWED_COHORT");
})();

(() => {
  const blocked = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "V3_PAPER_LONG_CONTINUATION_ONLY_CORE");
})();

(() => {
  const blocked = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "PULLBACK_RECLAIM",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "V3_PAPER_PULLBACK_RECLAIM_DISABLED");
})();

(() => {
  const blocked = evaluateV3PaperPolicy({
    side: "SHORT",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TRANSITION",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "V3_PAPER_SHORT_BREAKOUT_DISABLED");
})();

(() => {
  // 2026-05-16 phase 1B: LONG_BR_TRANSITION_BUILDABLE_EARLY is no longer
  // in the allowlist at all — n=36 with exp -0.008R was sufficient
  // evidence to fully remove rather than shadow. The cohort now falls
  // through to V3_PAPER_COHORT_NOT_IN_ALLOWLIST.
  const dropped = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TRANSITION",
    edge_cohort: "BUILDABLE_EDGE",
    entry_grade: "EARLY",
  });
  assert.strictEqual(dropped.ok, false);
  assert.strictEqual(dropped.reason, "V3_PAPER_COHORT_NOT_IN_ALLOWLIST");
})();

(() => {
  // SHADOW cohort #1: LONG_MC_TREND_BUILDABLE_CORE (n=8 too small to
  // fully cull). Must be matched in the allowlist but blocked with
  // apply_mode "SHADOW" and a SHADOW-specific reason so drop-count
  // dashboards can track recovery separately.
  const shadow = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "BUILDABLE_EDGE",
    entry_grade: "CORE",
  });
  assert.strictEqual(shadow.ok, false);
  assert.strictEqual(shadow.reason, "V3_PAPER_COHORT_SHADOWED");
  assert.strictEqual(shadow.apply_mode, "SHADOW");
})();

(() => {
  // SHADOW cohort #2: LONG_BR_RANGE_MARGINAL_EARLY (n=2 noise-tier).
  const shadow = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "RANGE",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "EARLY",
  });
  assert.strictEqual(shadow.ok, false);
  assert.strictEqual(shadow.reason, "V3_PAPER_COHORT_SHADOWED");
  assert.strictEqual(shadow.apply_mode, "SHADOW");
})();

console.log("v3-paper-policy.test.js PASS");
