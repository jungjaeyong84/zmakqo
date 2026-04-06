"use strict";

const assert = require("assert");
const { buildMlModelSpecificCanary } = require("../utils/mlModelSpecificCanary");

(() => {
  const missingBinding = buildMlModelSpecificCanary({
    executionServingContract: {
      summary: {
        preferred_model_family: "EXECUTION_SCOPE",
        preferred_model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1",
        preferred_model_artifact_id: "MODEL_SCOPE__1",
        preferred_train_run_id: "TRAIN_SCOPE__1",
        experiment_id: "EXP__1",
      },
    },
    executionScopeTrainRun: {
      summary: {
        model_artifact_id: "MODEL_SCOPE__1",
        train_run_id: "TRAIN_SCOPE__1",
      },
    },
    canary: {
      cycle_id: "cycle-1",
      generated_at_kst: "2026-04-06 09:00:00 KST",
      summary: {
        apply_pass: false,
        global_canary_pass: false,
        rollback_ready_n: 0,
      },
      rows: [
        { market: "BTCUSDT", candidate_id: "EV_TP1_THRESHOLD_TUNE", candidate_scope: "EV" },
      ],
    },
  });

  assert.strictEqual(missingBinding.status, "ML_MODEL_SPECIFIC_CANARY_READY");
  assert.strictEqual(missingBinding.binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(missingBinding.evidence_status, "MODEL_SPECIFIC_CANARY_GLOBAL_NOT_READY");
  assert.strictEqual(missingBinding.model_specific_canary_ready, false);
  assert.ok(missingBinding.blocking_reasons.includes("MODEL_SPECIFIC_CANARY_BINDING_MISSING"));

  const boundSummary = buildMlModelSpecificCanary({
    executionServingContract: {
      summary: {
        preferred_model_family: "EXECUTION_SCOPE",
        preferred_model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1",
        preferred_model_artifact_id: "MODEL_SCOPE__2",
        preferred_train_run_id: "TRAIN_SCOPE__2",
      },
    },
    executionScopeTrainRun: { summary: {} },
    canary: {
      cycle_id: "cycle-2",
      summary: {
        apply_pass: true,
        global_canary_pass: true,
        rollback_ready_n: 1,
        model_artifact_id: "MODEL_SCOPE__2",
        train_run_id: "TRAIN_SCOPE__2",
      },
      rows: [
        { market: "BTCUSDT", candidate_id: "AUTO_CORE", candidate_scope: "ML", model_artifact_id: "MODEL_SCOPE__2", train_run_id: "TRAIN_SCOPE__2" },
      ],
    },
  });

  assert.strictEqual(boundSummary.binding_mode, "CANARY_SUMMARY_BINDING");
  assert.strictEqual(boundSummary.model_specific_canary_artifact_aligned, true);
  assert.strictEqual(boundSummary.model_specific_canary_train_run_aligned, true);
  assert.strictEqual(boundSummary.model_specific_canary_ready, true);
  assert.strictEqual(boundSummary.evidence_status, "MODEL_SPECIFIC_CANARY_EVIDENCE_READY");

  console.log("ML_MODEL_SPECIFIC_CANARY_TEST_OK");
})();
