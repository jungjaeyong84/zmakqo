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
const { buildMlModelSpecificCanary } = require("../src/utils/mlModelSpecificCanary");

const INPUTS = Object.freeze({
  executionServingContract: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json"),
  executionScopeTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Model-Specific Canary",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- preferred_model_family: ${summary.preferred_model_family || "N/A"}`,
    `- preferred_model_kind: ${summary.preferred_model_kind || "N/A"}`,
    `- preferred_model_artifact_id: ${summary.preferred_model_artifact_id || "N/A"}`,
    `- preferred_train_run_id: ${summary.preferred_train_run_id || "N/A"}`,
    `- binding_mode: ${summary.binding_mode || "N/A"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- model_specific_canary_ready: ${summary.model_specific_canary_ready ? "YES" : "NO"}`,
    `- global/apply: ${summary.global_canary_pass ? "PASS" : "BLOCK"} / ${summary.apply_pass ? "PASS" : "BLOCK"}`,
    `- bound_model_artifact_id: ${summary.bound_model_artifact_id || "N/A"}`,
    `- bound_train_run_id: ${summary.bound_train_run_id || "N/A"}`,
    `- candidate_scope_top: ${summary.candidate_scope_top || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlModelSpecificCanary({
    executionServingContract: readJsonRawSafe(INPUTS.executionServingContract, null),
    executionScopeTrainRun: readJsonRawSafe(INPUTS.executionScopeTrainRun, null),
    canary: readJsonRawSafe(INPUTS.canary, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_model_specific_canary`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_specific_canary_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_specific_canary_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    model_specific_canary_ready: summary.model_specific_canary_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_MODEL_SPECIFIC_CANARY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
