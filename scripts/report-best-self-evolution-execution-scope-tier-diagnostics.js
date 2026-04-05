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
const { summarizeExecutionScopeTierDiagnostics } = require("../src/utils/executionScopeTierDiagnostics");

const INPUTS = Object.freeze({
  executionEntryDataset: path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json"),
  executionScopeInference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json"),
  executionScopeTierComparison: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_tier_comparison_latest.json"),
});

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  return [
    "# BEST Self-Evolution Execution Scope Tier Diagnostics",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- target_tier: ${s.target_tier || "N/A"}`,
    `- mismatch_rate: ${s.mismatch_rate != null ? s.mismatch_rate : "N/A"}`,
    `- top_false_positive_group: ${s.top_false_positive_group || "N/A"}`,
    `- top_false_negative_group: ${s.top_false_negative_group || "N/A"}`,
    `- policy_blocked_top_source: ${s.policy_blocked_top_source || "N/A"}`,
    `- policy_blocked_top_no_fill_reason: ${s.policy_blocked_top_no_fill_reason || "N/A"}`,
    `- policy_blocked_lowest_coverage_feature: ${s.policy_blocked_lowest_coverage_feature || "N/A"} (${s.policy_blocked_lowest_coverage_rate != null ? s.policy_blocked_lowest_coverage_rate : "N/A"})`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    ...summarizeExecutionScopeTierDiagnostics({
      executionEntryDataset: readJsonRawSafe(INPUTS.executionEntryDataset, null),
      executionScopeInference: readJsonRawSafe(INPUTS.executionScopeInference, null),
      executionScopeTierComparison: readJsonRawSafe(INPUTS.executionScopeTierComparison, null),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_scope_tier_diagnostics`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_tier_diagnostics_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_tier_diagnostics_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    status: payload.summary && payload.summary.status,
    target_tier: payload.summary && payload.summary.target_tier,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("REPORT_EXECUTION_SCOPE_TIER_DIAGNOSTICS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
