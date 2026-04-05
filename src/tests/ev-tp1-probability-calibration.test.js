"use strict";

const assert = require("assert");
const {
  buildTp1CalibrationReport,
  applyTp1ProbabilityCalibration,
} = require("../utils/evTp1ProbabilityCalibration");

function run() {
  const rows = [
    { resolved_for_tune: true, lower_bound: 0.41, outcome: "TP1_HIT", realized_ret_net: 0.02 },
    { resolved_for_tune: true, lower_bound: 0.42, outcome: "TP1_HIT", realized_ret_net: 0.01 },
    { resolved_for_tune: true, lower_bound: 0.43, outcome: "NO_TP1_EXITED", realized_ret_net: -0.01 },
    { resolved_for_tune: true, lower_bound: 0.44, outcome: "NO_TP1_EXITED", realized_ret_net: -0.02 },
    { resolved_for_tune: true, lower_bound: 0.45, outcome: "NO_TP1_EXITED", realized_ret_net: -0.01 },
    { resolved_for_tune: true, lower_bound: 0.46, outcome: "NO_TP1_EXITED", realized_ret_net: -0.03 },
    { resolved_for_tune: true, lower_bound: 0.47, outcome: "NO_TP1_EXITED", realized_ret_net: -0.02 },
    { resolved_for_tune: true, lower_bound: 0.48, outcome: "NO_TP1_EXITED", realized_ret_net: -0.01 },
    { resolved_for_tune: true, lower_bound: 0.49, outcome: "NO_TP1_EXITED", realized_ret_net: -0.02 },
    { resolved_for_tune: true, lower_bound: 0.50, outcome: "NO_TP1_EXITED", realized_ret_net: -0.01 },
    { resolved_for_tune: true, lower_bound: 0.51, outcome: "NO_TP1_EXITED", realized_ret_net: -0.01 },
    { resolved_for_tune: true, lower_bound: 0.52, outcome: "NO_TP1_EXITED", realized_ret_net: -0.02 },
  ];
  const report = buildTp1CalibrationReport(rows, {
    bucketSize: 0.05,
    minBucketSample: 4,
    minGlobalSample: 8,
    applyGapMin: 0.03,
    priorStrength: 6,
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.summary.recommended_action, "APPLY_EMPIRICAL_CALIBRATION");
  const targetBucket = report.buckets.find((row) => row.bucket_min === 0.45);
  assert.ok(targetBucket);
  assert.strictEqual(targetBucket.apply_recommended, true);
  const calibrated = applyTp1ProbabilityCalibration({
    probability: 0.61,
    lowerBound: 0.47,
    calibrationReport: report,
  });
  assert.strictEqual(calibrated.applied, true);
  assert.ok(calibrated.probability < 0.61);
  assert.ok(calibrated.lowerBound < 0.47);
  console.log("EV_TP1_PROBABILITY_CALIBRATION_TEST_OK");
}

run();
