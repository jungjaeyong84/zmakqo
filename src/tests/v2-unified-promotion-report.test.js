"use strict";

const assert = require("assert");
const { resolveV2RuntimeConfig } = require("../v2/runtime");
const { buildUnifiedPromotionReport } = require("../v2/unifiedPromotionReport");
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

(function unifiedReportPassesWhenAllInputsClean() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildUnifiedPromotionReport({
    mode: "SHADOW",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    shadowLiveComparisonReport: {
      pass: true,
      blockers: [],
      warnings: ["BTCUSDT__LONG__15M:QUALITY_SCORE_DRIFT"],
    },
    sourceModeComparisonReport: {
      pass: true,
      blockers: [],
      warnings: ["BTCUSDT__LONG__SOURCE_MODE:QUALITY_SCORE_DRIFT"],
    },
  });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.comparison.combined.warnings.length, 2);
})();

(function unifiedReportFailsClosedOnSourceModeBlocker() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildUnifiedPromotionReport({
    mode: "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    shadowLiveComparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
    sourceModeComparisonReport: {
      pass: false,
      blockers: ["BTCUSDT__LONG__SOURCE_MODE:DECISION_APPROVAL_MISMATCH"],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("COMPARISON:SOURCE_MODE:BTCUSDT__LONG__SOURCE_MODE:DECISION_APPROVAL_MISMATCH")));
})();

(function unifiedReportFailsClosedWhenCanaryWarningsExist() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildUnifiedPromotionReport({
    mode: "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    shadowLiveComparisonReport: {
      pass: true,
      blockers: [],
      warnings: ["ETHUSDT__SHORT__15M:RANK_SCORE_DRIFT"],
    },
    sourceModeComparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("WARNING_LIMIT_EXCEEDED")));
})();

(function unifiedReportRequiresBothComparisonReports() {
  const cfg = resolveV2RuntimeConfig({});
  const report = buildUnifiedPromotionReport({
    mode: "LIVE",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: cleanReplayReport(),
    shadowLiveComparisonReport: null,
    sourceModeComparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("COMPARISON:SHADOW_LIVE:REPORT_REQUIRED")));
})();

console.log("V2_UNIFIED_PROMOTION_REPORT_TEST_OK");
