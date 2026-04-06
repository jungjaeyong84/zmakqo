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
const { buildMlModelContract } = require("../src/utils/mlModelContract");

const INPUTS = Object.freeze({
  trainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  mlRollbackArm: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Model Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- deployment_stage: ${summary.deployment_stage || "N/A"}`,
    `- train_run_id: ${summary.train_run_id || "N/A"}`,
    `- model_artifact_id: ${summary.model_artifact_id || "N/A"}`,
    `- model_kind: ${summary.model_kind || "N/A"}`,
    `- canary_gate_status: ${summary.canary_gate_status || "N/A"}`,
    `- server_primary_gate_status: ${summary.server_primary_gate_status || "N/A"}`,
    `- rollback_status: ${summary.rollback_status || "N/A"} / evidence=${summary.rollback_evidence_status || "N/A"} / source=${summary.rollback_binding_source || "N/A"}`,
    `- promotion_status: ${summary.promotion_status || "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlModelContract({
    trainRun: readJsonRawSafe(INPUTS.trainRun, null),
    experimentRegistry: readJsonRawSafe(INPUTS.experimentRegistry, null),
    canary: readJsonRawSafe(INPUTS.canary, null),
    mlRollbackArm: readJsonRawSafe(INPUTS.mlRollbackArm, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_model_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_contract_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_contract_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    status: summary.status,
    model_artifact_id: summary.model_artifact_id,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_MODEL_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
