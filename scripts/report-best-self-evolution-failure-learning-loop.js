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
const { buildFailureLearningLoop } = require("../src/utils/failureLearningLoop");

const INPUTS = Object.freeze({
  featureLabelDataset: path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Failure Learning Loop",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- learning_ready: ${summary.learning_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- rows/executed/failure: ${summary.rows_n ?? "N/A"} / ${summary.executed_rows_n ?? "N/A"} / ${summary.failure_rows_n ?? "N/A"}`,
    `- fail_rate: ${summary.fail_rate != null ? Number(summary.fail_rate).toFixed(4) : "N/A"}`,
    `- dominant_failure_pattern: ${summary.dominant_failure_pattern || "N/A"} / top_failure_market: ${summary.top_failure_market || "N/A"}`,
    `- recommendations: ${Array.isArray(summary.recommendations) && summary.recommendations.length ? summary.recommendations.map((row) => row.key).join(", ") : "none"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildFailureLearningLoop({
    dataset: readJsonRawSafe(INPUTS.featureLabelDataset, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_failure_learning_loop`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_failure_learning_loop_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_failure_learning_loop_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    learning_ready: summary.learning_ready === true,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_FAILURE_LEARNING_LOOP_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
