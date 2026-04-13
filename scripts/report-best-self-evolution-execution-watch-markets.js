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
const { buildExecutionQualityWatchReport } = require("../src/utils/executionQualityWatchReport");

const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const EXECUTION_MODEL_DATASET_PATH = path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const markets = Array.isArray(report.markets) ? report.markets : [];
  const lines = [
    "# BEST Self-Evolution Execution Watch Markets",
    "",
    `- status: ${summary.status || "N/A"}`,
    `- review_market_n: ${summary.review_market_n != null ? summary.review_market_n : "N/A"}`,
    `- top_watch_market: ${summary.top_watch_market || "N/A"}`,
    `- top_partial_driver_market: ${summary.top_partial_driver_market || "N/A"}`,
    `- top_slippage_driver_market: ${summary.top_slippage_driver_market || "N/A"}`,
    `- top_no_fill_bucket: ${summary.top_no_fill_bucket && summary.top_no_fill_bucket.key ? summary.top_no_fill_bucket.key : "N/A"}`,
    "",
    "## Markets",
  ];
  if (!markets.length) lines.push("- none");
  for (const row of markets) {
    lines.push(`- ${row.market}: latency=${row.avg_created_to_fill_ms ?? "N/A"}ms(${row.latency_severity}) / slippage=${row.avg_slippage_bps ?? "N/A"}bps(${row.slippage_severity}) / partial=${row.partial_fill_rate_pct ?? "N/A"}%(${row.partial_fill_severity}) / actions=${Array.isArray(row.recommended_actions) && row.recommended_actions.length ? row.recommended_actions.join("|") : "none"}`);
    if (row.top_operational_signal_to_intent_group) {
      lines.push(`  signal_to_intent=${row.top_operational_signal_to_intent_group.key} / p95=${row.top_operational_signal_to_intent_group.signal_to_intent_p95_ms ?? "N/A"} / rows=${row.top_operational_signal_to_intent_group.rows_n ?? "N/A"}`);
    }
    if (row.top_entry_measured_latency_group) {
      lines.push(`  measured_latency=${row.top_entry_measured_latency_group.key} / p95=${row.top_entry_measured_latency_group.created_to_fill_p95_ms ?? "N/A"} / rows=${row.top_entry_measured_latency_group.rows_n ?? "N/A"}`);
    }
    if (row.top_entry_fallback_latency_group) {
      lines.push(`  fallback_latency=${row.top_entry_fallback_latency_group.key} / p95=${row.top_entry_fallback_latency_group.created_to_fill_p95_ms ?? "N/A"} / rows=${row.top_entry_fallback_latency_group.rows_n ?? "N/A"}`);
    }
    if (row.top_no_fill_market_bucket) {
      lines.push(`  no_fill=${row.top_no_fill_market_bucket.key} / rows=${row.top_no_fill_market_bucket.rows_n ?? "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const report = buildExecutionQualityWatchReport({
    executionQuality: readJsonRawSafe(EXECUTION_QUALITY_PATH, null),
    executionModelDataset: readJsonRawSafe(EXECUTION_MODEL_DATASET_PATH, null),
    limit: Number(process.env.EXECUTION_WATCH_MARKETS_LIMIT || 6),
  });

  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    generated_at_kst: meta.kst,
    inputs: {
      execution_quality_latest_path: EXECUTION_QUALITY_PATH,
      execution_model_dataset_latest_path: EXECUTION_MODEL_DATASET_PATH,
    },
    summary: report.summary,
    markets: report.markets,
  };

  const base = `${meta.dateKey}_${meta.hhmm}_best_self_evolution_execution_watch_markets`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_watch_markets_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_watch_markets_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  console.log(JSON.stringify({
    ok: true,
    status: payload.summary.status,
    review_market_n: payload.summary.review_market_n,
    top_watch_market: payload.summary.top_watch_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXECUTION_WATCH_MARKETS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
