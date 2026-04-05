#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildTruthPreservationAudit } = require("../src/utils/truthPreservationAudit");

const INPUTS = Object.freeze({
  signalLineageHealth: path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json"),
  modelReadiness: path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.json"),
  featureStore: path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json"),
  executionModelDataset: path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
  executionBottleneckDelta: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_bottleneck_delta_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Truth Preservation Audit",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- truth_preservation_ready: ${summary.truth_preservation_ready ? "YES" : "NO"}`,
    `- dataset_version_id: ${summary.dataset_version_id || "N/A"}`,
    `- feature_store_version_id: ${summary.feature_store_version_id || "N/A"}`,
    `- execution_dataset_version_id: ${summary.execution_dataset_version_id || "N/A"}`,
    `- experiment_id: ${summary.experiment_id || "N/A"}`,
    `- lineage_status: ${summary.lineage_status || "N/A"} / fills_intent_null_rate=${summary.lineage_fills_intent_id_null_rate != null ? summary.lineage_fills_intent_id_null_rate : "N/A"}`,
    `- model_readiness_status: ${summary.model_readiness_status || "N/A"} / rows=${summary.rows_n != null ? summary.rows_n : "N/A"} / realized=${summary.realized_n != null ? summary.realized_n : "N/A"} / invalid=${summary.invalid_n != null ? summary.invalid_n : "N/A"}`,
    `- execution_dataset_status: ${summary.execution_model_dataset_status || "N/A"} / signal_scope_filter=${summary.signal_scope_filter || "N/A"} / legacy_webhook_outcome_only_rows_n=${summary.legacy_webhook_outcome_only_rows_n != null ? summary.legacy_webhook_outcome_only_rows_n : "N/A"}`,
    `- version_alignment: dataset=${summary.dataset_version_aligned ? "YES" : "NO"} / feature_store=${summary.feature_store_version_aligned ? "YES" : "NO"} / execution=${summary.execution_dataset_version_aligned ? "YES" : "NO"}`,
    `- bottleneck_delta: ${summary.execution_bottleneck_delta_status || "N/A"} / comparable=${summary.execution_bottleneck_delta_comparable ? "YES" : "NO"} / stale=${summary.stale_comparison_active ? "YES" : "NO"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    `- warning_reasons: ${Array.isArray(summary.warning_reasons) && summary.warning_reasons.length ? summary.warning_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildTruthPreservationAudit({
    signalLineageHealth: readJsonRawSafe(INPUTS.signalLineageHealth, null),
    modelReadiness: readJsonRawSafe(INPUTS.modelReadiness, null),
    featureStore: readJsonRawSafe(INPUTS.featureStore, null),
    executionModelDataset: readJsonRawSafe(INPUTS.executionModelDataset, null),
    experimentRegistry: readJsonRawSafe(INPUTS.experimentRegistry, null),
    executionBottleneckDelta: readJsonRawSafe(INPUTS.executionBottleneckDelta, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_truth_preservation_audit`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_truth_preservation_audit_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_truth_preservation_audit_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    status: summary.status,
    truth_preservation_ready: summary.truth_preservation_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_TRUTH_PRESERVATION_AUDIT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
