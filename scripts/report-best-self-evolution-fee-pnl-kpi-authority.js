#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { buildFeePnlKpiAuthority } = require("../src/utils/feePnlKpiAuthority");
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

const FEATURE_LABEL_DATASET_PATH = path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Fee PnL KPI Authority",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- kpi_ready: ${summary.kpi_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- event_truth_only: ${summary.immutable_event_truth_only ? "YES" : "NO"} / strict=${summary.strict_event_truth_only ? "YES" : "NO"}`,
    `- realized_n: ${summary.realized_n ?? "N/A"} / threshold=${summary.thresholds && summary.thresholds.min_realized_n != null ? summary.thresholds.min_realized_n : "N/A"}`,
    `- realized_pnl_sum_quote: ${summary.realized_pnl_sum_quote ?? "N/A"} / abs_realized_pnl_sum_quote: ${summary.abs_realized_pnl_sum_quote ?? "N/A"}`,
    `- fee_sum_quote: ${summary.fee_sum_quote ?? "N/A"} / funding_sum_quote: ${summary.funding_sum_quote ?? "N/A"} / total_cost_quote: ${summary.total_cost_quote ?? "N/A"}`,
    `- fee_to_abs_realized_ratio: ${summary.fee_to_abs_realized_ratio != null ? Number(summary.fee_to_abs_realized_ratio).toFixed(4) : "N/A"}`,
    `- cost_to_abs_realized_ratio: ${summary.cost_to_abs_realized_ratio != null ? Number(summary.cost_to_abs_realized_ratio).toFixed(4) : "N/A"} / cost_to_notional_bps: ${summary.cost_to_notional_bps != null ? Number(summary.cost_to_notional_bps).toFixed(2) : "N/A"}`,
    `- top_fee_drag_market: ${summary.top_fee_drag_market || "N/A"} / ratio=${summary.top_fee_drag_ratio != null ? Number(summary.top_fee_drag_ratio).toFixed(4) : "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
    "## Worst Fee Drag Markets",
    ...(Array.isArray(summary.worst_fee_drag_markets) && summary.worst_fee_drag_markets.length
      ? summary.worst_fee_drag_markets.map((row) => `- ${row.market}: ${row.evidence_status} / realized=${row.realized_count} / ratio=${row.cost_to_abs_realized_ratio != null ? Number(row.cost_to_abs_realized_ratio).toFixed(4) : "N/A"} / pnl=${row.realized_pnl_sum_quote != null ? Number(row.realized_pnl_sum_quote).toFixed(4) : "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildFeePnlKpiAuthority({
    dataset: readJsonRawSafe(FEATURE_LABEL_DATASET_PATH, null),
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      feature_label_dataset: FEATURE_LABEL_DATASET_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_fee_pnl_kpi_authority`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("fee_pnl_kpi_authority_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("fee_pnl_kpi_authority_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    status: summary.status,
    evidence_status: summary.evidence_status,
    kpi_ready: summary.kpi_ready === true,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_FEE_PNL_KPI_AUTHORITY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
