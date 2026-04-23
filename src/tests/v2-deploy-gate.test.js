"use strict";

const assert = require("assert");
const { resolveV2RuntimeConfig } = require("../v2/runtime");
const { evaluateV2DeployGate } = require("../v2/deployGate");
const { REQUIRED_REPLAY_TRANSITION_EVENTS } = require("../v2/replayGate");

function cleanReplayReport() {
  return {
    pass: true,
    blockers: [],
    episode_n: 4,
    transition_event_coverage: Object.fromEntries(REQUIRED_REPLAY_TRANSITION_EVENTS.map((event) => [event, 1])),
    required_transition_events: REQUIRED_REPLAY_TRANSITION_EVENTS,
  };
}

(function canaryFailsClosedOnComparisonBlocker() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    comparisonReport: {
      pass: false,
      blockers: ["ETHUSDT__SHORT__15M:PROPOSAL_VERDICT_MISMATCH"],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("COMPARISON:ETHUSDT__SHORT__15M:PROPOSAL_VERDICT_MISMATCH")));
})();

(function canaryFailsClosedOnWarningsAboveLimit() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    comparisonReport: {
      pass: true,
      blockers: [],
      warnings: [
        "SOLUSDT__LONG__15M:QUALITY_SCORE_DRIFT",
      ],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("WARNING_LIMIT_EXCEEDED")));
})();

(function shadowAllowsWarningsButStillBlocksReplayFailure() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "SHADOW",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: {
      pass: false,
      blockers: ["PASS_EPISODE:FINAL_STAGE_MISMATCH"],
    },
    comparisonReport: {
      pass: true,
      blockers: [],
      warnings: [
        "BTCUSDT__LONG__15M:QUALITY_SCORE_DRIFT",
        "BTCUSDT__LONG__15M:RANK_SCORE_DRIFT",
      ],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("REPLAY:PASS_EPISODE:FINAL_STAGE_MISMATCH")));
})();

(function livePassRequiresReplayAndComparisonClean() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "LIVE",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    comparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.failClosed, false);
  assert.strictEqual(report.warning_n, 0);
})();

(function staleReplayReportWithoutEventCoverageFailsClosed() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "LIVE",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: {
      pass: true,
      blockers: [],
    },
    comparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.includes("REPLAY:REPLAY_TRANSITION_EVENT_COVERAGE_REQUIRED"));
})();

(function runtimeCandidateReplayCanSkipGlobalEventCoverage() {
  const cfg = resolveV2RuntimeConfig({});
  const report = evaluateV2DeployGate({
    mode: "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: {
      pass: true,
      blockers: [],
      transition_event_coverage_required: false,
      transition_event_coverage: {
        TP1_REACHED: 1,
        TRAIL_ACTIVATED: 1,
        TRAIL_HIT: 1,
      },
      required_transition_events: REQUIRED_REPLAY_TRANSITION_EVENTS,
    },
    comparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, true);
})();

console.log("V2_DEPLOY_GATE_TEST_OK");
