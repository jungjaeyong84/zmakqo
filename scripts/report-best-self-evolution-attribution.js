#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveAttribution } = require("../src/utils/bestSelfEvolutionAnalysis");

loadLocalEnv();

const DATASET_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");

function pct(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "N/A";
}

function signedNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderRows(lines, title, rows = []) {
  lines.push(`## ${title}`);
  if (!Array.isArray(rows) || !rows.length) {
    lines.push("- none", "");
    return;
  }
  for (const row of rows.slice(0, 12)) {
    lines.push(
      `- ${row.layer}/${row.market}/${row.reason}: n=${row.sample_n} / net=${signedNum(row.net_pnl_quote, 0)} / avg_ret=${pct(row.avg_ret_net)} / missed_gain=${pct(row.missed_gain_pct)} / saved_loss=${pct(row.saved_loss_pct)}`
    );
  }
  lines.push("");
}

function renderMarkdown(report = {}) {
  const attribution = report.attribution || {};
  const summary = attribution.summary || {};
  const lines = [
    "# BEST Self-Evolution Attribution",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- dataset: ${report.dataset_path || "N/A"}`,
    "",
    "## Summary",
    `- drop_top_layer: ${summary.drop_top_layer ? `${summary.drop_top_layer.key} ${summary.drop_top_layer.count}` : "N/A"}`,
    `- late_loss_top_market: ${summary.late_loss_top_market ? `${summary.late_loss_top_market.key} ${summary.late_loss_top_market.count}` : "N/A"}`,
    `- false_fire_top_market: ${summary.false_fire_top_market ? `${summary.false_fire_top_market.key} ${summary.false_fire_top_market.count}` : "N/A"}`,
    `- missed_recovery_top_reason: ${summary.missed_recovery_top_reason ? `${summary.missed_recovery_top_reason.key} ${summary.missed_recovery_top_reason.count}` : "N/A"}`,
    `- fallback_cost_top_market: ${summary.fallback_cost_top_market ? `${summary.fallback_cost_top_market.key} ${summary.fallback_cost_top_market.count}` : "N/A"}`,
    "",
  ];
  renderRows(lines, "Drop Attribution", attribution.drop_attribution);
  renderRows(lines, "Late Loss Attribution", attribution.late_loss_attribution);
  renderRows(lines, "False FIRE Attribution", attribution.false_fire_attribution);
  renderRows(lines, "Missed Recovery Attribution", attribution.missed_recovery_attribution);
  renderRows(lines, "Fallback Cost Attribution", attribution.fallback_cost_attribution);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const dataset = readJsonRawSafe(DATASET_LATEST_PATH, null);
  if (!dataset) throw new Error(`SELF_EVOLUTION_DATASET_MISSING:${DATASET_LATEST_PATH}`);
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    dataset_path: DATASET_LATEST_PATH,
    attribution: deriveAttribution({ dataset }),
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_attribution.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_attribution.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_attribution_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_attribution_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_ATTRIBUTION_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
