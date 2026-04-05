"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function firstMatchingCount(rows, targetKey) {
  if (!Array.isArray(rows)) return 0;
  const found = rows.find((row) => String(row && row.key || "").trim().toUpperCase() === targetKey);
  return toNum(found && found.rows_n) || 0;
}

function buildTruthPreservationAudit({
  signalLineageHealth = null,
  modelReadiness = null,
  featureStore = null,
  executionModelDataset = null,
  experimentRegistry = null,
  executionBottleneckDelta = null,
} = {}) {
  const lineage = readSummary(signalLineageHealth);
  const readiness = readSummary(modelReadiness);
  const feature = readSummary(featureStore);
  const executionDataset = readSummary(executionModelDataset);
  const registry = readSummary(experimentRegistry);
  const bottleneckDelta = readSummary(executionBottleneckDelta);

  const lineageStatus = toUpper(lineage.verdict) || "N_A";
  const modelReadinessStatus = toUpper(readiness.status) || "N_A";
  const featureStoreStatus = toUpper(feature.status) || "N_A";
  const executionDatasetStatus = toUpper(executionDataset.status) || "N_A";
  const registryStatus = toUpper(registry.status) || "N_A";
  const bottleneckDeltaStatus = toUpper(bottleneckDelta.status) || "N_A";

  const datasetVersionId = String(readiness.dataset_version_id || registry.dataset_version_id || "").trim() || null;
  const featureStoreVersionId = String(
    feature.version_id
    || (feature.feature_store_version && feature.feature_store_version.version_id)
    || registry.feature_store_version_id
    || ""
  ).trim() || null;
  const executionDatasetVersionId = String(
    executionDataset.version_id
    || (executionModelDataset && executionModelDataset.execution_dataset_version && executionModelDataset.execution_dataset_version.version_id)
    || registry.execution_dataset_version_id
    || ""
  ).trim() || null;
  const experimentId = String(registry.experiment_id || bottleneckDelta.current_experiment_id || "").trim() || null;

  const registryDatasetAligned = Boolean(
    datasetVersionId
    && registry.dataset_version_id
    && datasetVersionId === String(registry.dataset_version_id).trim()
  );
  const registryFeatureAligned = Boolean(
    featureStoreVersionId
    && registry.feature_store_version_id
    && featureStoreVersionId === String(registry.feature_store_version_id).trim()
  );
  const registryExecutionAligned = Boolean(
    executionDatasetVersionId
    && registry.execution_dataset_version_id
    && executionDatasetVersionId === String(registry.execution_dataset_version_id).trim()
  );

  const fillsIntentIdNullRate = toNum(lineage.fills_intent_id_null_rate);
  const fillsSignalDocIdNullRate = toNum(lineage.fills_signal_doc_id_null_rate);
  const intentsSignalDocIdNullRate = toNum(lineage.intents_signal_doc_id_null_rate);
  const legacyWebhookOutcomeOnlyRowsN = firstMatchingCount(
    executionDataset.top_operational_webhook_delay_causes,
    "LEGACY_WEBHOOK_OUTCOME_ONLY"
  );
  const signalScopeFilter = String(executionDataset.signal_scope_filter || "").trim().toUpperCase() || null;
  const staleComparisonActive = bottleneckDeltaStatus === "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON";

  const blockingReasons = [];
  if (lineageStatus === "FAIL") blockingReasons.push("LINEAGE_FAIL");
  if (modelReadinessStatus !== "MODEL_READINESS_READY") blockingReasons.push("MODEL_READINESS_NOT_READY");
  if (featureStoreStatus !== "FEATURE_STORE_READY") blockingReasons.push("FEATURE_STORE_NOT_READY");
  if (executionDatasetStatus !== "EXECUTION_MODEL_DATASET_READY") blockingReasons.push("EXECUTION_DATASET_NOT_READY");
  if (registryStatus !== "ML_EXPERIMENT_REGISTRY_READY") blockingReasons.push("EXPERIMENT_REGISTRY_NOT_READY");
  if (!registryDatasetAligned) blockingReasons.push("DATASET_VERSION_MISMATCH");
  if (!registryFeatureAligned) blockingReasons.push("FEATURE_STORE_VERSION_MISMATCH");
  if (!registryExecutionAligned) blockingReasons.push("EXECUTION_DATASET_VERSION_MISMATCH");
  if (fillsIntentIdNullRate != null && fillsIntentIdNullRate > 0.05) blockingReasons.push("LINEAGE_FILLS_INTENT_NULL_RATE_HIGH");
  if (signalScopeFilter && signalScopeFilter !== "EARLY_CORE_ONLY") blockingReasons.push("SIGNAL_SCOPE_FILTER_NOT_PRIMARY");

  const warningReasons = [];
  if (lineageStatus && lineageStatus !== "PASS") warningReasons.push("LINEAGE_STATUS_WARN");
  if (staleComparisonActive) warningReasons.push("STALE_COMPARISON_ACTIVE");
  if (legacyWebhookOutcomeOnlyRowsN > 0) warningReasons.push("LEGACY_WEBHOOK_OUTCOME_ONLY_PRESENT");
  if (fillsSignalDocIdNullRate != null && fillsSignalDocIdNullRate > 0) warningReasons.push("LINEAGE_FILLS_SIGNAL_NULL_PRESENT");
  if (intentsSignalDocIdNullRate != null && intentsSignalDocIdNullRate > 0) warningReasons.push("LINEAGE_INTENTS_SIGNAL_NULL_PRESENT");

  return {
    status: blockingReasons.length === 0
      ? "TRUTH_PRESERVATION_AUDIT_READY"
      : "TRUTH_PRESERVATION_AUDIT_REVIEW",
    truth_preservation_ready: blockingReasons.length === 0,
    dataset_version_id: datasetVersionId,
    feature_store_version_id: featureStoreVersionId,
    execution_dataset_version_id: executionDatasetVersionId,
    experiment_id: experimentId,
    lineage_status: lineageStatus,
    lineage_fills_intent_id_null_rate: fillsIntentIdNullRate,
    lineage_fills_signal_doc_id_null_rate: fillsSignalDocIdNullRate,
    lineage_intents_signal_doc_id_null_rate: intentsSignalDocIdNullRate,
    model_readiness_status: modelReadinessStatus,
    feature_store_status: featureStoreStatus,
    execution_model_dataset_status: executionDatasetStatus,
    ml_experiment_registry_status: registryStatus,
    execution_bottleneck_delta_status: bottleneckDeltaStatus,
    execution_bottleneck_delta_comparable: bottleneckDelta.comparable === true,
    execution_bottleneck_delta_same_experiment: bottleneckDelta.same_experiment === true,
    stale_comparison_active: staleComparisonActive,
    legacy_webhook_outcome_only_rows_n: legacyWebhookOutcomeOnlyRowsN,
    signal_scope_filter: signalScopeFilter,
    rows_n: toNum(readiness.rows_n),
    realized_n: toNum(readiness.realized_n),
    invalid_n: toNum(readiness.invalid_n),
    dataset_version_aligned: registryDatasetAligned,
    feature_store_version_aligned: registryFeatureAligned,
    execution_dataset_version_aligned: registryExecutionAligned,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
    warning_reason_n: warningReasons.length,
    warning_reasons: warningReasons,
  };
}

module.exports = {
  buildTruthPreservationAudit,
};
