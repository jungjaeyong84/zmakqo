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
const { buildExecutionServingContract } = require("../src/utils/executionServingContract");

const INPUTS = Object.freeze({
  truthPreservationAudit: path.join(OPS_DAILY_DIR, "best_self_evolution_truth_preservation_audit_latest.json"),
  executionScopeTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json"),
  executionScopeInference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json"),
  executionFillTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_latest.json"),
  executionFillInference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_fill_inference_latest.json"),
  mlModelContract: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_contract_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Execution Serving Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- serving_stage: ${summary.serving_stage || "N/A"}`,
    `- serving_decision: ${summary.serving_decision || "N/A"}`,
    `- shadow_ready: ${summary.shadow_ready ? "YES" : "NO"}`,
    `- preferred_model_family: ${summary.preferred_model_family || "N/A"}`,
    `- preferred_model_kind: ${summary.preferred_model_kind || "N/A"}`,
    `- preferred_train_run_id: ${summary.preferred_train_run_id || "N/A"}`,
    `- preferred_model_artifact_id: ${summary.preferred_model_artifact_id || "N/A"}`,
    `- scope_quality: ${summary.scope_quality_gate_status || "N/A"} / ready=${summary.scope_quality_gate_ready ? "YES" : "NO"}`,
    `- scope_inference: ${summary.scope_inference_status || "N/A"} / mismatch=${summary.scope_inference_mismatch_rate != null ? summary.scope_inference_mismatch_rate : "N/A"} / artifact_aligned=${summary.scope_model_artifact_aligned ? "YES" : "NO"}`,
    `- fill_quality: ${summary.fill_quality_gate_status || "N/A"} / ready=${summary.fill_quality_gate_ready ? "YES" : "NO"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    `- warning_reasons: ${Array.isArray(summary.warning_reasons) && summary.warning_reasons.length ? summary.warning_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildExecutionServingContract({
    truthPreservationAudit: readJsonRawSafe(INPUTS.truthPreservationAudit, null),
    executionScopeTrainRun: readJsonRawSafe(INPUTS.executionScopeTrainRun, null),
    executionScopeInference: readJsonRawSafe(INPUTS.executionScopeInference, null),
    executionFillTrainRun: readJsonRawSafe(INPUTS.executionFillTrainRun, null),
    executionFillInference: readJsonRawSafe(INPUTS.executionFillInference, null),
    mlModelContract: readJsonRawSafe(INPUTS.mlModelContract, null),
    experimentRegistry: readJsonRawSafe(INPUTS.experimentRegistry, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_serving_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    serving_stage: summary.serving_stage,
    serving_decision: summary.serving_decision,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXECUTION_SERVING_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
