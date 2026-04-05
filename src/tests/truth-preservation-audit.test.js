"use strict";

const assert = require("assert");
const { buildTruthPreservationAudit } = require("../utils/truthPreservationAudit");

(() => {
  const ready = buildTruthPreservationAudit({
    signalLineageHealth: {
      summary: {
        verdict: "PASS",
        fills_intent_id_null_rate: 0.02,
        fills_signal_doc_id_null_rate: 0,
        intents_signal_doc_id_null_rate: 0,
      },
    },
    modelReadiness: {
      summary: {
        status: "MODEL_READINESS_READY",
        dataset_version_id: "ML_TRAINING_DATASET__abc123",
        rows_n: 355,
        realized_n: 17,
        invalid_n: 0,
      },
    },
    featureStore: {
      summary: {
        status: "FEATURE_STORE_READY",
        version_id: "ML_FEATURE_STORE__def456",
      },
    },
    executionModelDataset: {
      summary: {
        status: "EXECUTION_MODEL_DATASET_READY",
        version_id: "EXECUTION_MODEL_DATASET__xyz789",
        signal_scope_filter: "EARLY_CORE_ONLY",
        top_operational_webhook_delay_causes: [
          { key: "LEGACY_WEBHOOK_OUTCOME_ONLY", rows_n: 3 },
        ],
      },
    },
    experimentRegistry: {
      summary: {
        status: "ML_EXPERIMENT_REGISTRY_READY",
        experiment_id: "ML_BASELINE_ENV__0001",
        dataset_version_id: "ML_TRAINING_DATASET__abc123",
        feature_store_version_id: "ML_FEATURE_STORE__def456",
        execution_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789",
      },
    },
    executionBottleneckDelta: {
      summary: {
        status: "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON",
        comparable: true,
        same_experiment: true,
      },
    },
  });

  assert.strictEqual(ready.status, "TRUTH_PRESERVATION_AUDIT_READY");
  assert.strictEqual(ready.truth_preservation_ready, true);
  assert.strictEqual(ready.dataset_version_aligned, true);
  assert.strictEqual(ready.feature_store_version_aligned, true);
  assert.strictEqual(ready.execution_dataset_version_aligned, true);
  assert.strictEqual(ready.stale_comparison_active, true);
  assert.strictEqual(ready.legacy_webhook_outcome_only_rows_n, 3);
  assert.deepStrictEqual(ready.blocking_reasons, []);
  assert.deepStrictEqual(ready.warning_reasons, [
    "STALE_COMPARISON_ACTIVE",
    "LEGACY_WEBHOOK_OUTCOME_ONLY_PRESENT",
  ]);

  const review = buildTruthPreservationAudit({
    signalLineageHealth: {
      summary: {
        verdict: "WARN",
        fills_intent_id_null_rate: 0.11,
        fills_signal_doc_id_null_rate: 0.03,
        intents_signal_doc_id_null_rate: 0.02,
      },
    },
    modelReadiness: { summary: { status: "MODEL_READINESS_REVIEW", dataset_version_id: "ML_TRAINING_DATASET__abc123" } },
    featureStore: { summary: { status: "FEATURE_STORE_READY", version_id: "ML_FEATURE_STORE__def456" } },
    executionModelDataset: { summary: { status: "EXECUTION_MODEL_DATASET_READY", version_id: "EXECUTION_MODEL_DATASET__xyz789", signal_scope_filter: "ALL" } },
    experimentRegistry: {
      summary: {
        status: "ML_EXPERIMENT_REGISTRY_READY",
        experiment_id: "ML_BASELINE_ENV__0002",
        dataset_version_id: "ML_TRAINING_DATASET__zzz999",
        feature_store_version_id: "ML_FEATURE_STORE__def456",
        execution_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789",
      },
    },
    executionBottleneckDelta: { summary: { status: "EXECUTION_BOTTLENECK_DELTA_READY", comparable: true, same_experiment: false } },
  });

  assert.strictEqual(review.status, "TRUTH_PRESERVATION_AUDIT_REVIEW");
  assert.strictEqual(review.truth_preservation_ready, false);
  assert.ok(review.warning_reasons.includes("LINEAGE_STATUS_WARN"));
  assert.ok(review.blocking_reasons.includes("MODEL_READINESS_NOT_READY"));
  assert.ok(review.blocking_reasons.includes("DATASET_VERSION_MISMATCH"));
  assert.ok(review.blocking_reasons.includes("LINEAGE_FILLS_INTENT_NULL_RATE_HIGH"));
  assert.ok(review.blocking_reasons.includes("SIGNAL_SCOPE_FILTER_NOT_PRIMARY"));

  console.log("TRUTH_PRESERVATION_AUDIT_TEST_OK");
})();
