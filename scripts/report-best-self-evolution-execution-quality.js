#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { summarizeExecutionQuality } = require("../src/utils/executionQuality");

const OBJECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
const EXECUTION_MICROSTRUCTURE_PATH = path.join(OPS_DAILY_DIR, "execution_microstructure_latest.json");
const FEBT_BRIDGE_LATENCY_PATH = path.join(OPS_DAILY_DIR, "febt_bridge_latency_latest.json");
const EXECUTION_MODEL_DATASET_PATH = path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json");
const EXECUTION_SCOPE_INFERENCE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json");
const EXECUTION_SCOPE_TRAIN_RUN_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json");
const FILLS_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "fills_paper.json");
const INTENTS_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution Execution Quality",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- status: ${summary.status || "N/A"}`,
    `- execution_venue: ${summary.execution_venue || "N/A"}`,
    `- created_to_fill_p95_ms: ${summary.created_to_fill_p95_ms ?? "N/A"}`,
    `- adverse_slippage_p95_bps: ${summary.adverse_slippage_p95_bps ?? "N/A"}`,
    `- partial_fill_rate_pct: ${summary.partial_fill_rate_pct ?? "N/A"}`,
    `- webhook_to_fill_p95_ms: ${summary.webhook_to_fill_p95_ms ?? "N/A"}`,
    `- top_latency_market: ${summary.top_latency_market || "N/A"}`,
    `- top_slippage_market: ${summary.top_slippage_market || "N/A"}`,
    `- top_partial_market: ${summary.top_partial_market || "N/A"}`,
    `- top_operational_webhook_delay_cause: ${summary.top_operational_webhook_delay_cause || "N/A"}`,
    `- top_operational_immediate_intent_delay_group: ${summary.top_operational_immediate_intent_delay_group || "N/A"}`,
    `- top_no_fill_reason: ${summary.top_no_fill_reason || "N/A"}`,
    `- top_no_fill_subtype: ${summary.top_no_fill_subtype || "N/A"}`,
    `- execution_scope_quality_gate: ${summary.execution_scope_quality_gate_status || "N/A"} / ready=${summary.execution_scope_quality_gate_ready ? "YES" : "NO"}`,
    `- execution_scope_mismatch_rate: ${summary.execution_scope_inference_mismatch_rate ?? "N/A"}`,
    `- execution_scope_top_false_positive_group: ${summary.execution_scope_top_false_positive_group || "N/A"}`,
    `- review_reasons: ${Array.isArray(summary.review_reasons) && summary.review_reasons.length ? summary.review_reasons.join("|") : "none"}`,
    "",
    "## Markets",
  ];
  if (!rows.length) lines.push("- none");
  for (const row of rows) {
    lines.push(`- ${row.market}: latency=${row.avg_created_to_fill_ms ?? "N/A"}ms / slippage=${row.avg_slippage_bps ?? "N/A"}bps / partial=${row.partial_fill_rate_pct ?? "N/A"}% / fill=${row.fill_n ?? 0}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objective = readJsonRawSafe(OBJECTIVE_LATEST_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objective],
  });
  const micro = readJsonRawSafe(EXECUTION_MICROSTRUCTURE_PATH, null);
  const bridge = readJsonRawSafe(FEBT_BRIDGE_LATENCY_PATH, null);
  const executionModelDataset = readJsonRawSafe(EXECUTION_MODEL_DATASET_PATH, null);
  const executionScopeInference = readJsonRawSafe(EXECUTION_SCOPE_INFERENCE_PATH, null);
  const executionScopeTrainRun = readJsonRawSafe(EXECUTION_SCOPE_TRAIN_RUN_PATH, null);
  const fills = readJsonRawSafe(FILLS_PATH, null);
  const intents = readJsonRawSafe(INTENTS_PATH, null);

  const result = summarizeExecutionQuality({
    microstructure: micro,
    bridgeLatency: bridge,
    executionModelDataset,
    executionScopeInference,
    executionScopeTrainRun,
    fills: fills && Array.isArray(fills.docs) ? fills.docs : [],
    intents: intents && Array.isArray(intents.docs) ? intents.docs : [],
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      objective_latest_path: OBJECTIVE_LATEST_PATH,
      execution_microstructure_latest_path: EXECUTION_MICROSTRUCTURE_PATH,
      febt_bridge_latency_latest_path: FEBT_BRIDGE_LATENCY_PATH,
      execution_model_dataset_latest_path: EXECUTION_MODEL_DATASET_PATH,
      execution_scope_inference_latest_path: EXECUTION_SCOPE_INFERENCE_PATH,
      execution_scope_train_run_latest_path: EXECUTION_SCOPE_TRAIN_RUN_PATH,
      fills_path: FILLS_PATH,
      intents_path: INTENTS_PATH,
    },
    summary: result.summary,
    by_market: result.by_market,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_quality`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copyLatest(jsonPath, selfEvolutionSnapshotLatestPath("execution_quality_latest.json"));
  copyLatest(mdPath, selfEvolutionSnapshotLatestPath("execution_quality_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: cycleMeta.cycle_id,
    status: report.summary.status,
    top_latency_market: report.summary.top_latency_market,
    top_slippage_market: report.summary.top_slippage_market,
    latest_json: latestJsonPath,
  }));
}

main();
