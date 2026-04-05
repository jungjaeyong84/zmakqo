"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function delta(current, previous) {
  const cur = toNum(current);
  const prev = toNum(previous);
  if (cur == null || prev == null) return null;
  return cur - prev;
}

function buildExecutionBottleneckDelta({
  currentExecutionQuality = null,
  previousExecutionQuality = null,
  currentStageLatency = null,
  previousStageLatency = null,
  currentExperimentRegistry = null,
  previousExperimentRegistry = null,
} = {}) {
  const currentQuality = readSummary(currentExecutionQuality);
  const previousQuality = readSummary(previousExecutionQuality);
  const currentLatency = readSummary(currentStageLatency);
  const previousLatency = readSummary(previousStageLatency);
  const currentRegistry = readSummary(currentExperimentRegistry);
  const previousRegistry = readSummary(previousExperimentRegistry);

  const currentCause = String(currentQuality.top_operational_webhook_delay_cause || "").trim() || null;
  const previousCause = String(previousQuality.top_operational_webhook_delay_cause || "").trim() || null;
  const currentSignalGroup = String(
    (currentLatency.top_operational_signal_to_intent_groups && currentLatency.top_operational_signal_to_intent_groups[0] && currentLatency.top_operational_signal_to_intent_groups[0].key)
    || currentLatency.top_operational_signal_to_intent_group
    || ""
  ).trim() || null;
  const previousSignalGroup = String(
    (previousLatency.top_operational_signal_to_intent_groups && previousLatency.top_operational_signal_to_intent_groups[0] && previousLatency.top_operational_signal_to_intent_groups[0].key)
    || previousLatency.top_operational_signal_to_intent_group
    || ""
  ).trim() || null;

  const signalToIntentDelta = delta(
    currentLatency.signal_to_intent_p95_ms,
    previousLatency.signal_to_intent_p95_ms
  );
  const webhookSavedToIntentDelta = delta(
    currentLatency.webhook_saved_to_intent_p95_ms,
    previousLatency.webhook_saved_to_intent_p95_ms
  );
  const createdToFillDelta = delta(
    currentQuality.created_to_fill_p95_ms,
    previousQuality.created_to_fill_p95_ms
  );
  const currentExperimentId = String(currentRegistry.experiment_id || "").trim() || null;
  const previousExperimentId = String(previousRegistry.experiment_id || "").trim() || null;
  const currentDatasetVersionId = String(currentRegistry.dataset_version_id || "").trim() || null;
  const previousDatasetVersionId = String(previousRegistry.dataset_version_id || "").trim() || null;
  const currentFeatureStoreVersionId = String(currentRegistry.feature_store_version_id || "").trim() || null;
  const previousFeatureStoreVersionId = String(previousRegistry.feature_store_version_id || "").trim() || null;
  const sameExperiment =
    Boolean(currentExperimentId && previousExperimentId && currentExperimentId === previousExperimentId)
    || Boolean(
      currentDatasetVersionId
      && previousDatasetVersionId
      && currentFeatureStoreVersionId
      && previousFeatureStoreVersionId
      && currentDatasetVersionId === previousDatasetVersionId
      && currentFeatureStoreVersionId === previousFeatureStoreVersionId
    );

  const comparable =
    previousCause != null
    || previousSignalGroup != null
    || previousQuality.status != null
    || previousLatency.status != null
    || previousExperimentId != null;

  return {
    status: !comparable
      ? "EXECUTION_BOTTLENECK_DELTA_INSUFFICIENT_HISTORY"
      : (sameExperiment ? "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON" : "EXECUTION_BOTTLENECK_DELTA_READY"),
    comparable,
    same_experiment: sameExperiment,
    current_experiment_id: currentExperimentId,
    previous_experiment_id: previousExperimentId,
    current_dataset_version_id: currentDatasetVersionId,
    previous_dataset_version_id: previousDatasetVersionId,
    current_feature_store_version_id: currentFeatureStoreVersionId,
    previous_feature_store_version_id: previousFeatureStoreVersionId,
    current_execution_quality_status: toUpper(currentQuality.status),
    previous_execution_quality_status: toUpper(previousQuality.status),
    current_stage_latency_status: toUpper(currentLatency.status),
    previous_stage_latency_status: toUpper(previousLatency.status),
    current_top_operational_webhook_delay_cause: currentCause,
    previous_top_operational_webhook_delay_cause: previousCause,
    webhook_delay_cause_changed: comparable ? currentCause !== previousCause : null,
    current_top_operational_signal_to_intent_group: currentSignalGroup,
    previous_top_operational_signal_to_intent_group: previousSignalGroup,
    operational_signal_group_changed: comparable ? currentSignalGroup !== previousSignalGroup : null,
    signal_to_intent_p95_ms: toNum(currentLatency.signal_to_intent_p95_ms),
    previous_signal_to_intent_p95_ms: toNum(previousLatency.signal_to_intent_p95_ms),
    signal_to_intent_p95_delta_ms: signalToIntentDelta,
    webhook_saved_to_intent_p95_ms: toNum(currentLatency.webhook_saved_to_intent_p95_ms),
    previous_webhook_saved_to_intent_p95_ms: toNum(previousLatency.webhook_saved_to_intent_p95_ms),
    webhook_saved_to_intent_p95_delta_ms: webhookSavedToIntentDelta,
    created_to_fill_p95_ms: toNum(currentQuality.created_to_fill_p95_ms),
    previous_created_to_fill_p95_ms: toNum(previousQuality.created_to_fill_p95_ms),
    created_to_fill_p95_delta_ms: createdToFillDelta,
    top_no_fill_reason: String(currentQuality.top_no_fill_reason || "").trim() || null,
    previous_top_no_fill_reason: String(previousQuality.top_no_fill_reason || "").trim() || null,
  };
}

module.exports = {
  buildExecutionBottleneckDelta,
};
