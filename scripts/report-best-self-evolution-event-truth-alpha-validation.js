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
const { buildEventTruthAlphaValidation } = require("../src/utils/eventTruthAlphaValidation");

const INPUTS = Object.freeze({
  featureLabelDataset: path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const periods = summary.periods && typeof summary.periods === "object" ? summary.periods : {};
  return [
    "# BEST Self-Evolution Event Truth Alpha Validation",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- alpha_ready: ${summary.alpha_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- event_truth_only: ${summary.strict_event_truth_only ? "YES" : "NO"}`,
    `- rows/executed/realized: ${summary.rows_n ?? "N/A"} / ${summary.executed_rows_n ?? "N/A"} / ${summary.realized_rows_n ?? "N/A"}`,
    `- positive_rate: ${summary.positive_rate != null ? Number(summary.positive_rate).toFixed(4) : "N/A"} / avg_realized_ret_net: ${summary.avg_realized_ret_net != null ? Number(summary.avg_realized_ret_net).toFixed(6) : "N/A"}`,
    `- tp0_hit_rate: ${summary.tp0_hit_rate != null ? Number(summary.tp0_hit_rate).toFixed(4) : "N/A"} / tp0_to_tp1_conversion_rate: ${summary.tp0_to_tp1_conversion_rate != null ? Number(summary.tp0_to_tp1_conversion_rate).toFixed(4) : "N/A"}`,
    `- top_positive_market: ${summary.top_positive_market || "N/A"} / top_negative_market: ${summary.top_negative_market || "N/A"}`,
    `- top_positive_strategy: ${summary.top_positive_strategy || "N/A"} / top_negative_strategy: ${summary.top_negative_strategy || "N/A"}`,
    `- top_positive_regime: ${summary.top_positive_regime || "N/A"} / top_negative_regime: ${summary.top_negative_regime || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
    "## Rolling Windows",
    ...(Object.entries(periods).map(([key, row]) => `- ${key} (${row.label || key}): ${row.evidence_status || "N/A"} / realized=${row.realized_rows_n ?? "N/A"} / positive_rate=${row.positive_rate != null ? Number(row.positive_rate).toFixed(4) : "N/A"} / avg_ret=${row.avg_realized_ret_net != null ? Number(row.avg_realized_ret_net).toFixed(6) : "N/A"}`)),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildEventTruthAlphaValidation({
    dataset: readJsonRawSafe(INPUTS.featureLabelDataset, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_event_truth_alpha_validation`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_event_truth_alpha_validation_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_event_truth_alpha_validation_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    alpha_ready: summary.alpha_ready === true,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EVENT_TRUTH_ALPHA_VALIDATION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
