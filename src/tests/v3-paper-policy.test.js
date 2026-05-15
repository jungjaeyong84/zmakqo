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
  assert.strictEqual(V3_PAPER_ALLOWED_COHORTS.length, 7);
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
  const allowed = evaluateV3PaperPolicy({
    side: "LONG",
    setup_type: "BREAKOUT_RETEST",
    structural_regime: "TRANSITION",
    edge_cohort: "BUILDABLE_EDGE",
    entry_grade: "EARLY",
  });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.reason, "V3_PAPER_ALLOWED_COHORT");
  assert.strictEqual(allowed.apply_mode, "ACTIVE");
})();

console.log("v3-paper-policy.test.js PASS");
