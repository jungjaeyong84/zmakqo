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
const { buildMlRollbackArm } = require("../src/utils/mlRollbackArm");

const INPUTS = Object.freeze({
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Rollback Arm",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- rollback_binding_source: ${summary.rollback_binding_source || "N/A"}`,
    `- rollback_arm_ready: ${summary.rollback_arm_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- rollback_target_path: ${summary.rollback_target_path || "N/A"}`,
    `- rollback_target_exists: ${summary.rollback_target_exists ? "YES" : "NO"}`,
    `- rollback_engine_bundle_id: ${summary.rollback_engine_bundle_id || "N/A"}`,
    `- rollback_trigger_status: ${summary.rollback_trigger_status || "N/A"} / n=${summary.server_primary_rollback_trigger_n != null ? summary.server_primary_rollback_trigger_n : "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlRollbackArm({
    deploymentPlan: readJsonRawSafe(INPUTS.deploymentPlan, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_rollback_arm`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    rollback_arm_ready: summary.rollback_arm_ready,
    evidence_status: summary.evidence_status,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_ROLLBACK_ARM_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

