#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { summarizeExecutionScopeTierComparison } = require("../src/utils/executionScopeTierComparison");

const INPUTS = Object.freeze({
  inference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json"),
  trainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json"),
});

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  const tiers = Array.isArray(s.tiers) ? s.tiers : [];
  return [
    "# BEST Self-Evolution Execution Scope Tier Comparison",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- train_run_id: ${s.train_run_id || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- weaker_tier: ${s.weaker_tier || "N/A"}`,
    `- mismatch_rate_gap: ${s.mismatch_rate_gap != null ? s.mismatch_rate_gap : "N/A"}`,
    `- macro_recall_gap: ${s.macro_recall_gap != null ? s.macro_recall_gap : "N/A"}`,
    ...tiers.map((row) => `- ${row.tier}: inference_mismatch=${row.inference_mismatch_rate != null ? row.inference_mismatch_rate : "N/A"} / test_macro_recall=${row.test_macro_recall != null ? row.test_macro_recall : "N/A"}`),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    ...summarizeExecutionScopeTierComparison({
      inference: readJsonRawSafe(INPUTS.inference, null),
      trainRun: readJsonRawSafe(INPUTS.trainRun, null),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_scope_tier_comparison`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_tier_comparison_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_tier_comparison_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    status: payload.summary && payload.summary.status,
    weaker_tier: payload.summary && payload.summary.weaker_tier,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("REPORT_EXECUTION_SCOPE_TIER_COMPARISON_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
