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
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const { buildBestSelfEvolutionDataset } = require("../src/utils/bestSelfEvolutionDataset");

loadLocalEnv();

const PROVIDER = String(process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.BEST_SELF_EVOLUTION_TF || "15m").trim();
const WINDOW_DAYS = Math.max(7, Number(process.env.BEST_SELF_EVOLUTION_WINDOW_DAYS || 7));
const SCAN_LIMIT = Math.max(3000, Number(process.env.BEST_SELF_EVOLUTION_SCAN_LIMIT || 30000));
const WEEKLY_LATEST_JSON = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function signedNum(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function renderSummaryLine(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row) => `${row.key} ${row.count}`)
    .join(" / ") || "N/A";
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Dataset",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- 윈도우: ${report.window && report.window.from_utc || "N/A"} -> ${report.window && report.window.to_utc || "N/A"}`,
    "",
    "## Core",
    `- rows: ${summary.rows_n || 0}`,
    `- executed/drop/missed: ${summary.executed_n || 0} / ${summary.drop_n || 0} / ${summary.missed_n || 0}`,
    `- fallback/rejected/partial: ${summary.fallback_n || 0} / ${summary.rejected_n || 0} / ${summary.partial_n || 0}`,
    `- realized_n: ${summary.realized_n || 0} / features ${pct(summary.features_coverage_rate)} / FEBT ${pct(summary.febt_coverage_rate)}`,
    `- avg_realized_ret_net: ${signedPct(summary.avg_realized_ret_net)}`,
    `- avg_realized_pnl_quote: ${signedNum(summary.avg_realized_pnl_quote, 0)}`,
    `- avg_hold_minutes: ${summary.avg_hold_minutes != null ? Number(summary.avg_hold_minutes).toFixed(1) : "N/A"}`,
    "",
    "## Breakdowns",
    `- source_row_type: ${renderSummaryLine(summary.by_source_row_type)}`,
    `- market: ${renderSummaryLine(summary.by_market)}`,
    `- side: ${renderSummaryLine(summary.by_side)}`,
    `- event: ${renderSummaryLine(summary.by_event)}`,
    `- drop_stage: ${renderSummaryLine(summary.by_drop_stage)}`,
    `- drop_reason: ${renderSummaryLine(summary.by_drop_reason)}`,
    `- fallback_reason: ${renderSummaryLine(summary.by_fallback_reason)}`,
    "",
    "## Sample Rows",
  ];

  const sampleRows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
  if (!sampleRows.length) {
    lines.push("- none");
  } else {
    for (const row of sampleRows) {
      lines.push(
        `- ${row.market || "N/A"} ${row.tf || "N/A"} ${row.event || "N/A"} ${row.source_row_type || "N/A"}`
        + ` / stage=${row.drop_stage_key || "N/A"} / febt=${row.febt_phase || "N/A"}`
        + ` / ret=${signedPct(row.realized_ret_net)} / pnl=${signedNum(row.realized_pnl_quote, 0)}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const weekly = readJsonRawSafe(WEEKLY_LATEST_JSON, null);
  const windowFromMs = toNum(weekly && weekly.current && weekly.current.range && weekly.current.range.from_ms)
    || (nowMeta.nowMs - (WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const windowToMs = toNum(weekly && weekly.current && weekly.current.range && weekly.current.range.to_ms)
    || nowMeta.nowMs;

  const [signalsCache, dropsCache, intentsCache, fillsCache, tradesCache] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("trades_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);

  const signals = Array.isArray(signalsCache.rows) ? signalsCache.rows : [];
  const drops = Array.isArray(dropsCache.rows) ? dropsCache.rows : [];
  const intents = Array.isArray(intentsCache.rows) ? intentsCache.rows : [];
  const fills = Array.isArray(fillsCache.rows) ? fillsCache.rows : [];
  const trades = Array.isArray(tradesCache.rows) ? tradesCache.rows : [];

  const dataset = await buildBestSelfEvolutionDataset({
    signals,
    drops,
    intents,
    fills,
    trades,
    provider: PROVIDER,
    tf: TF,
    fromMs: windowFromMs,
    toMs: windowToMs,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    provider: PROVIDER,
    tf: TF,
    window: {
      from_ms: windowFromMs,
      to_ms: windowToMs,
      from_utc: new Date(windowFromMs).toISOString(),
      to_utc: new Date(windowToMs).toISOString(),
    },
    summary: dataset.summary,
    quality_meta: dataset.quality && dataset.quality.meta ? dataset.quality.meta : null,
    rows: dataset.rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_dataset.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_dataset.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  console.log(JSON.stringify({
    ok: true,
    json: jsonPath,
    markdown: mdPath,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
    rows_n: report.summary && report.summary.rows_n || 0,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_DATASET_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
