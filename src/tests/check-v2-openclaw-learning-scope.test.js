"use strict";

const assert = require("assert");
const { evaluateOpenClawLearningScope } = require("../../scripts/check-v2-openclaw-learning-scope");

function run() {
  const pass = evaluateOpenClawLearningScope({
    summary: {
      learning_scope: "V2_ONLY_OPENCLAW",
      v1_learning_blocked: true,
      filtered_out_v1_or_unscoped_n: 12,
    },
    rows: [
      {
        signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__2000__CORE_SHORT",
        market: "XRPUSDT",
        event: "CORE_SHORT",
        openclaw_learning_evidence: {
          has_v2_openclaw_learning_evidence: true,
          openclaw_decision_id: "OCD__XRPUSDT__2000__SHORT",
        },
        features_json: {
          runtime: "V2 DISCOVERY_CANARY",
        },
      },
    ],
  });
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(pass.reason, "V2_OPENCLAW_LEARNING_SCOPE_PASS");
  assert.strictEqual(pass.filtered_out_v1_or_unscoped_n, 12);

  const missingScope = evaluateOpenClawLearningScope({
    summary: {},
    rows: [],
  });
  assert.strictEqual(missingScope.ok, false);
  assert.ok(missingScope.blockers.includes("OPENCLAW_LEARNING_SCOPE_NOT_V2_ONLY"));
  assert.ok(missingScope.blockers.includes("OPENCLAW_V1_LEARNING_NOT_BLOCKED"));

  const legacyLeak = evaluateOpenClawLearningScope({
    summary: {
      learning_scope: "V2_ONLY_OPENCLAW",
      v1_learning_blocked: true,
    },
    rows: [
      {
        signal_id: "SIG__BINANCEFUT__AXSUSDT__15m__1000__EARLY_LONG",
        market: "AXSUSDT",
        event: "EARLY_LONG",
        openclaw_learning_evidence: {
          has_v2_openclaw_learning_evidence: true,
          openclaw_decision_id: "OCD__AXSUSDT__1000__LONG",
        },
        features_json: {
          _event_mapping_version: "v1",
          strategy_id: "donbeolja_v6.0.3.0",
        },
      },
    ],
  });
  assert.strictEqual(legacyLeak.ok, false);
  assert.ok(legacyLeak.blockers.includes("OPENCLAW_LEARNING_LEGACY_FEATURE_LEAK"));

  const missingEvidence = evaluateOpenClawLearningScope({
    summary: {
      learning_scope: "V2_ONLY_OPENCLAW",
      v1_learning_blocked: true,
    },
    rows: [
      {
        signal_id: "SIG__BINANCEFUT__SOLUSDT__15m__1000__EARLY_LONG",
        market: "SOLUSDT",
        event: "EARLY_LONG",
      },
    ],
  });
  assert.strictEqual(missingEvidence.ok, false);
  assert.ok(missingEvidence.blockers.includes("OPENCLAW_LEARNING_ROW_MISSING_V2_EVIDENCE"));

  console.log("CHECK_V2_OPENCLAW_LEARNING_SCOPE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("CHECK_V2_OPENCLAW_LEARNING_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
