"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildMlRollbackArm } = require("../utils/mlRollbackArm");

(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-rollback-arm-"));
  const rollbackPath = path.join(tmpDir, "rollback.pine");
  fs.writeFileSync(rollbackPath, "// rollback");

  const ready = buildMlRollbackArm({
    deploymentPlan: {
      summary: {
        plan_status: "PREPARE_ROLLBACK",
        target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
        rollback_file_path: rollbackPath,
        rollback_engine_bundle_id: "strategy:donbeolja_v6.0.3.2",
        rollback_engine_bundle: { bundle_id: "strategy:donbeolja_v6.0.3.2", strategy_id: "donbeolja_v6.0.3.2", ready: true },
      },
    },
    serverPrimaryCanary: {
      summary: {
        apply_pass: true,
        acceptance_ready: true,
        rollback_trigger_n: 0,
        rollback_trigger_markets: [],
      },
    },
  });

  assert.strictEqual(ready.status, "ML_ROLLBACK_ARM_READY");
  assert.strictEqual(ready.rollback_arm_ready, true);
  assert.strictEqual(ready.evidence_status, "ROLLBACK_ARM_EVIDENCE_READY");
  assert.strictEqual(ready.rollback_trigger_status, "NOT_TRIGGERED");

  const missing = buildMlRollbackArm({
    deploymentPlan: {
      summary: {
        plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY",
      },
    },
    serverPrimaryCanary: {
      summary: {
        apply_pass: false,
        acceptance_ready: false,
        rollback_trigger_n: 2,
        rollback_trigger_markets: ["BTCUSDT", "ETHUSDT"],
      },
    },
  });

  assert.strictEqual(missing.rollback_arm_ready, false);
  assert.strictEqual(missing.evidence_status, "ROLLBACK_ARM_TARGET_MISSING");
  assert.ok(missing.blocking_reasons.includes("ROLLBACK_TARGET_MISSING"));
  assert.strictEqual(missing.rollback_trigger_status, "TRIGGERED");

  console.log("ML_ROLLBACK_ARM_TEST_OK");
})();
