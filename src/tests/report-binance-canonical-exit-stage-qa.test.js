"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-canonical-exit-stage-qa");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(__test.resolveWatchdogCanonicalStage("BETWEEN_TP0_TP1"), "TP0");
  assert.strictEqual(__test.resolveWatchdogCanonicalStage("RUNNER"), "TP1");
  assert.strictEqual(__test.resolveWatchdogCanonicalStage("TRAIL"), "TRAIL");

  const evidenceStage = __test.resolveCanonicalEvidenceStage({
    fill: {
      canonical_exit_stage: "TP1",
      canonical_primary_transition_event: "TRAIL_PARTIAL",
      canonical_transition_events: ["TRAIL_PARTIAL"],
    },
    transition: {
      canonical_transition_event: "TRAIL_PARTIAL",
    },
  });
  assert.strictEqual(evidenceStage, "TRAIL");

  const augmentedMismatch = __test.augmentRowWithCanonicalEvidence({
    symbol: "ETHUSDT",
    canonical_stage: "TRAIL",
    actionable_issue_codes: [],
  }, {
    fill: {
      event: "EXIT_TP_P1_1.65P",
      canonical_exit_event: "EXIT_TP_P1_1.65P",
      canonical_exit_stage: "TP1",
      canonical_transition_events: ["TP1_REACHED"],
    },
    transition: {
      canonical_transition_event: "TP1_REACHED",
      canonical_event: "EXIT_TP_P1_1.65P",
    },
  });
  assert.ok(augmentedMismatch.canonical_evidence_issue_codes.includes("CANONICAL_EVIDENCE_STAGE_MISMATCH"));
  assert.strictEqual(augmentedMismatch.verdict, "FAIL");

  const augmentedPass = __test.augmentRowWithCanonicalEvidence({
    symbol: "ETHUSDT",
    canonical_stage: "TRAIL",
    actionable_issue_codes: [],
  }, {
    fill: {
      event: "EXIT_TP_P1_1.65P",
      canonical_exit_event: "EXIT_TRAIL",
      canonical_exit_stage: "TRAIL",
      canonical_transition_events: ["TRAIL_PARTIAL"],
    },
    transition: {
      canonical_transition_event: "TRAIL_PARTIAL",
      canonical_event: "EXIT_TRAIL",
      canonical_exit_chain_key: "BINANCEFUT__ETHUSDT__ENTRY__ENTRY__ETH",
    },
  });
  assert.deepStrictEqual(augmentedPass.canonical_evidence_issue_codes, []);
  assert.strictEqual(augmentedPass.canonical_evidence_stage, "TRAIL");
  assert.strictEqual(augmentedPass.verdict, "PASS");

  const summary = __test.buildReportSummary([
    augmentedMismatch,
    {
      symbol: "BTCUSDT",
      canonical_stage: "TP1",
      report_issue_codes: ["RUNNER_MIN_GUARANTEE_MISSED", "TRAIL_HARD_EXIT_MISSED"],
      verdict: "FAIL",
    },
    {
      symbol: "XRPUSDT",
      canonical_stage: "TP0",
      report_issue_codes: [],
      verdict: "PASS",
    },
  ]);
  assert.strictEqual(summary.status, "FAIL");
  assert.strictEqual(summary.active_position_n, 3);
  assert.strictEqual(summary.pass_n, 1);
  assert.strictEqual(summary.fail_n, 2);
  assert.strictEqual(summary.stage_counts.TP0, 1);
  assert.strictEqual(summary.stage_counts.TP1, 1);
  assert.strictEqual(summary.stage_counts.TRAIL, 1);
  assert.strictEqual(summary.canonical_evidence_fail_n, 1);
  assert.strictEqual(summary.minimum_guarantee_fail_n, 1);
  assert.strictEqual(summary.trail_hard_exit_missed_n, 1);
  assert.strictEqual(summary.stop_authority_fail_n, 1);
  assert.deepStrictEqual(summary.failing_symbols, ["ETHUSDT", "BTCUSDT"]);
  assert.deepStrictEqual(summary.top_issue_codes[0], { code: "CANONICAL_EVIDENCE_STAGE_MISMATCH", count: 1 });
  assert.ok(__test.QA_FILL_SELECT_FIELDS.includes("canonical_transition_events"));
  assert.ok(__test.QA_TRANSITION_SELECT_FIELDS.includes("canonical_transition_event"));

  console.log("REPORT_BINANCE_CANONICAL_EXIT_STAGE_QA_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("REPORT_BINANCE_CANONICAL_EXIT_STAGE_QA_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
