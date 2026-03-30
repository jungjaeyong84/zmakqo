#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
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
const STALE_RANGE_MAX_AGE_MS = Math.max(1, Number(process.env.BEST_SELF_EVOLUTION_STALE_RANGE_MAX_HOURS || 6)) * 60 * 60 * 1000;
const WEEKLY_LATEST_JSON = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
const EV_TUNER_LATEST_JSON = path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json");
const ANALYTICS_CACHE_LATEST_JSON = path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json");
const CACHE_ONLY = String(process.env.BEST_SELF_EVOLUTION_CACHE_ONLY || "1") !== "0";
const CACHE_MAX_AGE_MS = Math.max(1, Number(process.env.BEST_SELF_EVOLUTION_CACHE_MAX_AGE_HOURS || 6)) * 60 * 60 * 1000;

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
    `- window_source: ${report.window_source || "N/A"}`,
    "",
    "## Core",
    `- rows: ${summary.rows_n || 0}`,
    `- executed/drop/missed: ${summary.executed_n || 0} / ${summary.drop_n || 0} / ${summary.missed_n || 0}`,
    `- fallback/rejected/partial: ${summary.fallback_n || 0} / ${summary.rejected_n || 0} / ${summary.partial_n || 0}`,
    `- realized_n: ${summary.realized_n || 0} / all_realized_n: ${summary.all_realized_n || 0} / features ${pct(summary.features_coverage_rate)} / FEBT all ${pct(summary.febt_coverage_rate)} / eligible ${pct(summary.febt_coverage_rate_eligible)} (${summary.febt_eligible_n || 0})`,
    `- entry_pending_total_n: ${summary.entry_pending_total_n || 0} / executed_null_realized ${summary.entry_executed_null_realized_n || 0} / fallback_pending ${summary.entry_fallback_pending_n || 0} / exit_present_unlabeled ${summary.entry_exit_present_unlabeled_n || 0} / open_pending ${summary.entry_open_pending_n || 0} / link_missing ${summary.entry_link_missing_n || 0}`,
    `- executed_exit_only_n: ${summary.executed_exit_only_n || 0} / exit_only_n: ${summary.exit_only_n || 0} / exit_only_realized_n: ${summary.exit_only_realized_n || 0}`,
    `- avg_realized_ret_net: ${signedPct(summary.avg_realized_ret_net)}`,
    `- avg_realized_pnl_quote: ${signedNum(summary.avg_realized_pnl_quote, 0)}`,
    `- avg_hold_minutes: ${summary.avg_hold_minutes != null ? Number(summary.avg_hold_minutes).toFixed(1) : "N/A"}`,
    "",
    "## Breakdowns",
    `- source_row_type: ${renderSummaryLine(summary.by_source_row_type)}`,
    `- market: ${renderSummaryLine(summary.by_market)}`,
    `- side: ${renderSummaryLine(summary.by_side)}`,
    `- event: ${renderSummaryLine(summary.by_event)}`,
    `- outcome_state: ${renderSummaryLine(summary.by_outcome_state)}`,
    `- drop_stage: ${renderSummaryLine(summary.by_drop_stage)}`,
    `- drop_reason: ${renderSummaryLine(summary.by_drop_reason)}`,
    `- fallback_reason: ${renderSummaryLine(summary.by_fallback_reason)}`,
    `- realized_source: ${renderSummaryLine(summary.realized_source_counts)}`,
    `- all_realized_source: ${renderSummaryLine(summary.all_realized_source_counts)}`,
    `- ev_counterfactual_n: ${summary.ev_counterfactual_n ?? 0}`,
    `- exit_only_event: ${renderSummaryLine(summary.exit_only_by_event)}`,
    `- exit_only_outcome_state: ${renderSummaryLine(summary.exit_only_by_outcome_state)}`,
    `- exit_only_realized_source: ${renderSummaryLine(summary.exit_only_realized_source_counts)}`,
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
        + ` / state=${row.outcome_state || "N/A"} / stage=${row.drop_stage_key || "N/A"} / febt=${row.febt_phase || "N/A"}`
        + ` / ret=${signedPct(row.realized_ret_net)} / pnl=${signedNum(row.realized_pnl_quote, 0)}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function resolveDatasetWindow({ nowMs, weeklyRange, windowDays = WINDOW_DAYS, staleRangeMaxAgeMs = STALE_RANGE_MAX_AGE_MS } = {}) {
  const rollingToMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const rollingFromMs = rollingToMs - (Math.max(1, Number(windowDays) || 7) * 24 * 60 * 60 * 1000);
  const weeklyFromMs = toNum(weeklyRange && weeklyRange.from_ms);
  const weeklyToMs = toNum(weeklyRange && weeklyRange.to_ms);
  const weeklyUsable = Number.isFinite(weeklyFromMs) && Number.isFinite(weeklyToMs) && weeklyToMs > weeklyFromMs;
  if (!weeklyUsable) {
    return { fromMs: rollingFromMs, toMs: rollingToMs, source: "ROLLING_FALLBACK_MISSING_WEEKLY_RANGE" };
  }
  if (rollingToMs - weeklyToMs > staleRangeMaxAgeMs) {
    return { fromMs: rollingFromMs, toMs: rollingToMs, source: "ROLLING_FALLBACK_STALE_WEEKLY_RANGE" };
  }
  return { fromMs: weeklyFromMs, toMs: weeklyToMs, source: "WEEKLY_RANGE" };
}

function parseGeneratedAtMs(artifact = null, filePath = null) {
  const raw = artifact && typeof artifact === "object" ? artifact : null;
  const candidates = [
    raw && raw.generated_at,
    raw && raw.generated_at_utc,
    raw && raw.generated_at_kst,
    raw && raw.updated_at,
  ];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }
  try {
    if (filePath) return require("fs").statSync(filePath).mtimeMs;
  } catch (_err) {
    // noop
  }
  return null;
}

function resolveAnalyticsCachePolicy({ nowMs, latestArtifact = null, cacheOnly = CACHE_ONLY, maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  const generatedAtMs = parseGeneratedAtMs(latestArtifact, ANALYTICS_CACHE_LATEST_JSON);
  const ageMs = Number.isFinite(generatedAtMs) && Number.isFinite(nowMs) ? (nowMs - generatedAtMs) : null;
  const fresh = Number.isFinite(ageMs) ? ageMs <= maxAgeMs : false;
  return {
    cache_only: cacheOnly,
    latest_path: ANALYTICS_CACHE_LATEST_JSON,
    generated_at_ms: generatedAtMs,
    age_hours: Number.isFinite(ageMs) ? Number((ageMs / (60 * 60 * 1000)).toFixed(3)) : null,
    fresh,
    reason: cacheOnly ? (fresh ? "CACHE_ONLY_FRESH" : "CACHE_ONLY_STALE") : "CACHE_REFRESH_ALLOWED",
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const weekly = readJsonRawSafe(WEEKLY_LATEST_JSON, null);
  const evTuner = readJsonRawSafe(EV_TUNER_LATEST_JSON, null);
  const analyticsCache = readJsonRawSafe(ANALYTICS_CACHE_LATEST_JSON, null);
  const cachePolicy = resolveAnalyticsCachePolicy({
    nowMs: nowMeta.nowMs,
    latestArtifact: analyticsCache,
    cacheOnly: CACHE_ONLY,
  });
  if (cachePolicy.cache_only && !cachePolicy.fresh) {
    throw new Error(`ANALYTICS_LOCAL_CACHE_STALE:${ANALYTICS_CACHE_LATEST_JSON}`);
  }
  const windowMeta = resolveDatasetWindow({
    nowMs: nowMeta.nowMs,
    weeklyRange: weekly && weekly.current && weekly.current.range,
    windowDays: WINDOW_DAYS,
  });
  const windowFromMs = windowMeta.fromMs;
  const windowToMs = windowMeta.toMs;

  const [signalsCache, dropsCache, intentsCache, fillsCache, tradesCache] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: !cachePolicy.cache_only }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: !cachePolicy.cache_only }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: !cachePolicy.cache_only }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: !cachePolicy.cache_only }),
    getCachedRecentByCreatedAt("trades_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: !cachePolicy.cache_only }),
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
    evTunerReport: evTuner,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    provider: PROVIDER,
    tf: TF,
    window_source: windowMeta.source,
    cache_policy: cachePolicy,
    window: {
      from_ms: windowFromMs,
      to_ms: windowToMs,
      from_utc: new Date(windowFromMs).toISOString(),
      to_utc: new Date(windowToMs).toISOString(),
    },
    summary: dataset.summary,
    quality_meta: dataset.quality && dataset.quality.meta ? dataset.quality.meta : null,
    exit_only_rows: Array.isArray(dataset.exit_only_rows) ? dataset.exit_only_rows : [],
    rows: dataset.rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_dataset.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_dataset.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);

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
    resolveDatasetWindow,
    resolveAnalyticsCachePolicy,
  },
};
