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
const { buildMlPromotionGate } = require("../src/utils/mlPromotionGate");

const INPUTS = Object.freeze({
  truthPreservationAudit: path.join(OPS_DAILY_DIR, "best_self_evolution_truth_preservation_audit_latest.json"),
  executionServingContract: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json"),
  executionScopeTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json"),
  mlGlobalCanaryEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_global_canary_evidence_latest.json"),
  modelSpecificCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_specific_canary_latest.json"),
  mlRollbackArm: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
  eventTruthAlphaValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_event_truth_alpha_validation_latest.json"),
  feePnlKpiAuthority: path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.json"),
  failureLearningLoop: path.join(OPS_DAILY_DIR, "best_self_evolution_failure_learning_loop_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Promotion Gate",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- promotion_stage: ${summary.promotion_stage || "N/A"}`,
    `- promotion_decision: ${summary.promotion_decision || "N/A"}`,
    `- preferred_model_family: ${summary.preferred_model_family || "N/A"}`,
    `- preferred_model_kind: ${summary.preferred_model_kind || "N/A"}`,
    `- preferred_model_artifact_id: ${summary.preferred_model_artifact_id || "N/A"}`,
    `- replay_gate: ${summary.replay_gate_status || "N/A"}`,
    `- event_truth_alpha_gate: ${summary.event_truth_alpha_gate_status || "N/A"} / ${summary.event_truth_alpha_evidence_status || "N/A"} / positive_rate=${summary.event_truth_alpha_positive_rate ?? "N/A"} / avg_ret=${summary.event_truth_alpha_avg_realized_ret_net ?? "N/A"}`,
    `- fee_pnl_gate: ${summary.fee_pnl_gate_status || "N/A"} / ${summary.fee_pnl_evidence_status || "N/A"} / realized_n=${summary.fee_pnl_realized_n ?? "N/A"} / cost_to_abs_realized_ratio=${summary.fee_pnl_cost_to_abs_realized_ratio ?? "N/A"} / top_fee_drag=${summary.fee_pnl_top_fee_drag_market || "N/A"}`,
    `- failure_learning_gate: ${summary.failure_learning_gate_status || "N/A"} / ${summary.failure_learning_evidence_status || "N/A"} / fail_rate=${summary.failure_learning_fail_rate ?? "N/A"} / pattern=${summary.failure_learning_dominant_pattern || "N/A"}`,
    `- shadow_gate: ${summary.shadow_gate_status || "N/A"}`,
    `- global_canary_gate: ${summary.global_canary_gate_status || "N/A"} / evidence=${summary.global_canary_evidence_status || "N/A"} / blocker=${summary.global_canary_dominant_blocker || "N/A"} / replay=${summary.global_canary_replay_evidence_status || "N/A"}:${summary.global_canary_replay_dominant_issue || "N/A"} / sample_gap=${summary.global_canary_replay_sample_gap_status || "N/A"}:${summary.global_canary_replay_sample_gap_n ?? "N/A"} / projected_ready_if_gap_closed=${summary.global_canary_replay_projected_ready_if_sample_gap_closed ? "YES" : "NO"} / residual=${summary.global_canary_replay_projected_residual_issue_after_sample_gap_closed || "N/A"}`,
    `- model_specific_canary_status: ${summary.model_specific_canary_status || "N/A"}`,
    `- model_specific_canary_binding_mode: ${summary.model_specific_canary_binding_mode || "N/A"}`,
    `- model_specific_canary_evidence_status: ${summary.model_specific_canary_evidence_status || "N/A"}`,
    `- model_specific_canary_gate: ${summary.model_specific_canary_gate_status || "N/A"}`,
    `- server_primary_gate: ${summary.server_primary_gate_status || "N/A"}`,
    `- rollback_gate: ${summary.rollback_gate_status || "N/A"} / source=${summary.rollback_binding_source || "N/A"} / evidence=${summary.rollback_evidence_status || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlPromotionGate({
    truthPreservationAudit: readJsonRawSafe(INPUTS.truthPreservationAudit, null),
    executionServingContract: readJsonRawSafe(INPUTS.executionServingContract, null),
    executionScopeTrainRun: readJsonRawSafe(INPUTS.executionScopeTrainRun, null),
    mlGlobalCanaryEvidence: readJsonRawSafe(INPUTS.mlGlobalCanaryEvidence, null),
    modelSpecificCanary: readJsonRawSafe(INPUTS.modelSpecificCanary, null),
    mlRollbackArm: readJsonRawSafe(INPUTS.mlRollbackArm, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
    eventTruthAlphaValidation: readJsonRawSafe(INPUTS.eventTruthAlphaValidation, null),
    feePnlKpiAuthority: readJsonRawSafe(INPUTS.feePnlKpiAuthority, null),
    failureLearningLoop: readJsonRawSafe(INPUTS.failureLearningLoop, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_promotion_gate`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_promotion_gate_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_promotion_gate_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    promotion_stage: summary.promotion_stage,
    promotion_decision: summary.promotion_decision,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_PROMOTION_GATE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
