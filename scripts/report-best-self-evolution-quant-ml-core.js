#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { buildQuantMlCoreAuthority } = require("../src/utils/quantMlCoreAuthority");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const INPUTS = Object.freeze({
  featureLabelDataset: path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  feePnlKpiAuthority: path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.json"),
  eventTruthAlphaValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_event_truth_alpha_validation_latest.json"),
  openclawPolicyAuthority: path.join(OPS_DAILY_DIR, "openclaw_policy_authority_latest.json"),
  serverMarketCapitalAllocator: path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json"),
});

function renderAxis(axis = {}) {
  return [
    `- status: ${axis.status || "N/A"}`,
    ...Object.entries(axis)
      .filter(([key]) => key !== "status")
      .slice(0, 6)
      .map(([key, value]) => `- ${key}: ${value == null ? "N/A" : value}`),
  ].join("\n");
}

function renderMarkdown(payload = {}) {
  const summary = payload.summary || {};
  const axes = summary.axes || {};
  const periods = summary.periods || {};
  return [
    "# BEST Self-Evolution Quant ML Core",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- overall_axis_status: ${summary.overall_axis_status || "N/A"}`,
    "",
    "## Axes",
    "### execution_edge",
    renderAxis(axes.execution_edge || {}),
    "",
    "### fee_pnl",
    renderAxis(axes.fee_pnl || {}),
    "",
    "### openclaw_single_authority",
    renderAxis(axes.openclaw_single_authority || {}),
    "",
    "### portfolio_ml",
    renderAxis(axes.portfolio_ml || {}),
    "",
    "### continuous_alpha_proof",
    renderAxis(axes.continuous_alpha_proof || {}),
    "",
    "## Rolling Windows",
    ...(Object.entries(periods).map(([key, row]) => `- ${key} (${row.label || key}): overall=${row.overall_status || "N/A"} / exec=${row.execution_status || "N/A"} / fee=${row.fee_pnl_status || "N/A"} / openclaw=${row.openclaw_status || "N/A"} / alpha=${row.alpha_status || "N/A"} / portfolio=${row.portfolio_status || "N/A"}`)),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildQuantMlCoreAuthority({
    dataset: readJsonRawSafe(INPUTS.featureLabelDataset, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    feePnlKpi: readJsonRawSafe(INPUTS.feePnlKpiAuthority, null),
    alphaValidation: readJsonRawSafe(INPUTS.eventTruthAlphaValidation, null),
    openclawPolicyAuthority: readJsonRawSafe(INPUTS.openclawPolicyAuthority, null),
    capitalAllocator: readJsonRawSafe(INPUTS.serverMarketCapitalAllocator, null),
    nowMs: nowMeta.nowMs,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    summary,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_quant_ml_core`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_quant_ml_core_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_quant_ml_core_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("quant_ml_core_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("quant_ml_core_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    status: summary.status,
    overall_axis_status: summary.overall_axis_status,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_QUANT_ML_CORE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
