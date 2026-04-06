#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveValidationDeploymentPipelineContract } = require("../src/utils/validationDeploymentPipelineContract");

loadLocalEnv();

const INPUTS = Object.freeze({
  executionServingContract: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json"),
  mlPromotionGate: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_promotion_gate_latest.json"),
  mlRollbackArm: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.json"),
  mlGlobalCanaryEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_global_canary_evidence_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Validation Deployment Pipeline Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- contract_mode: ${summary.contract_mode || "N/A"}`,
    `- current_deployment_stage: ${summary.current_deployment_stage || "N/A"}`,
    `- numeric_gates: shadow=${summary.shadow_numeric_gate_ready ? "YES" : "NO"} / canary=${summary.canary_numeric_gate_ready ? "YES" : "NO"} / live=${summary.live_numeric_gate_ready ? "YES" : "NO"} / judgement=${summary.numeric_judgement_ready ? "YES" : "NO"} / rollback=${summary.automatic_rollback_ready ? "YES" : "NO"}`,
    `- serving: ${summary.serving_stage || "N/A"} / ${summary.serving_decision || "N/A"}`,
    `- promotion: ${summary.promotion_stage || "N/A"} / ${summary.promotion_decision || "N/A"} / replay=${summary.replay_gate_status || "N/A"} / shadow=${summary.shadow_gate_status || "N/A"} / global_canary=${summary.global_canary_gate_status || "N/A"} / model_canary=${summary.model_specific_canary_gate_status || "N/A"} / rollback=${summary.rollback_gate_status || "N/A"}`,
    `- blocker: ${summary.global_canary_evidence_status || "N/A"} / ${summary.global_canary_dominant_blocker || "N/A"} / replay_gap=${summary.replay_sample_gap_n != null ? summary.replay_sample_gap_n : "N/A"} / projected_ready_if_gap_closed=${summary.replay_projected_ready_if_gap_closed ? "YES" : "NO"} / residual=${summary.replay_projected_residual_issue_after_sample_gap_closed || "N/A"}`,
    `- model: ${summary.preferred_model_family || "N/A"} / ${summary.preferred_model_artifact_id || "N/A"} / train_run=${summary.preferred_train_run_id || "N/A"}`,
    `- blocking_reason_n: ${summary.blocking_reason_n != null ? summary.blocking_reason_n : "N/A"}`,
  ];
  if (Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length) {
    lines.push("", "## Blocking Reasons");
    for (const reason of summary.blocking_reasons) lines.push(`- ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = deriveValidationDeploymentPipelineContract({
    executionServingContract: readJsonRawSafe(INPUTS.executionServingContract, null),
    mlPromotionGate: readJsonRawSafe(INPUTS.mlPromotionGate, null),
    mlRollbackArm: readJsonRawSafe(INPUTS.mlRollbackArm, null),
    mlGlobalCanaryEvidence: readJsonRawSafe(INPUTS.mlGlobalCanaryEvidence, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_validation_deployment_pipeline_contract.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_validation_deployment_pipeline_contract.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_validation_deployment_pipeline_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_validation_deployment_pipeline_contract_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("validation_deployment_pipeline_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("validation_deployment_pipeline_contract_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    status: report.status,
    shadow_numeric_gate_ready: report.shadow_numeric_gate_ready,
    canary_numeric_gate_ready: report.canary_numeric_gate_ready,
    live_numeric_gate_ready: report.live_numeric_gate_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
