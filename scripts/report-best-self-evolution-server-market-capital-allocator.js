#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { deriveServerMarketCapitalAllocator } = require("../src/utils/serverMarketCapitalAllocator");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const MARKET_OBJECTIVE_SCORE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const REVERSE_POLICY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
const EXPLORATION_BUDGET_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
const SERVER_PRIMARY_LEARNING_EPOCH_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");
const FAILURE_LEARNING_LOOP_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_failure_learning_loop_latest.json");
const FEE_PNL_KPI_AUTHORITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.json");
const EVENT_TRUTH_ALPHA_VALIDATION_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_event_truth_alpha_validation_latest.json");
const INPUT_MAX_AGE_HOURS = Object.freeze({
  market_objective_score: 24,
  execution_quality: 24,
  reverse_policy: 24,
  exploration_budget: 24,
  server_primary_learning_epoch: 24,
  failure_learning_loop: 24,
  fee_pnl_kpi_authority: 24,
  event_truth_alpha_validation: 24,
});

function parseArtifactTimestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.endsWith(" KST")
    ? `${raw.slice(0, -4).replace(" ", "T")}+09:00`
    : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function extractArtifactGeneratedAtMs(data = null) {
  const raw = data && data.raw && typeof data.raw === "object" ? data.raw : data;
  const display = data && data.display && typeof data.display === "object" ? data.display : null;
  return (
    parseArtifactTimestampMs(raw && (raw.generated_at_kst || raw.generated_at))
    || parseArtifactTimestampMs(display && (display.generated_at_kst || display.generated_at))
    || null
  );
}

function buildInputFreshnessRow({ key, filePath, data, maxAgeHours, nowMs }) {
  if (!data) {
    return {
      key,
      file_path: filePath,
      exists: false,
      fresh: false,
      age_hours: null,
      max_age_hours: maxAgeHours,
      generated_at_kst: null,
      stale_reason: "MISSING",
    };
  }
  let mtimeMs = null;
  try {
    const st = fs.statSync(filePath);
    mtimeMs = Number(st.mtimeMs || 0);
  } catch (_err) {}
  const generatedAtMs = extractArtifactGeneratedAtMs(data);
  const referenceMs = Number.isFinite(generatedAtMs) ? generatedAtMs : mtimeMs;
  const ageHours = Number.isFinite(referenceMs) ? (nowMs - referenceMs) / (60 * 60 * 1000) : null;
  const fresh = Number.isFinite(ageHours) && ageHours <= maxAgeHours;
  return {
    key,
    file_path: filePath,
    exists: true,
    fresh,
    age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(4)) : null,
    max_age_hours: maxAgeHours,
    generated_at_kst: data && (data.generated_at_kst || (data.raw && data.raw.generated_at_kst) || null),
    stale_reason: fresh ? null : (Number.isFinite(ageHours) ? "AGE_EXCEEDED" : "TIMESTAMP_UNKNOWN"),
  };
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const freshness = report.freshness || {};
  const lines = [
    "# BEST Self-Evolution Server Market Capital Allocator",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- input_freshness: ${freshness.status || "N/A"} / stale_n=${freshness.stale_input_n != null ? freshness.stale_input_n : "N/A"} / max_input_age_hours=${freshness.max_input_age_hours != null ? freshness.max_input_age_hours : "N/A"}`,
    `- increase: ${summary.top_increase_market || "N/A"} / ${summary.top_increase_score != null ? summary.top_increase_score : "N/A"}`,
    `- reduce: ${summary.top_reduce_market || "N/A"} / ${summary.top_reduce_score != null ? summary.top_reduce_score : "N/A"}`,
    `- quarantine: ${summary.top_quarantine_market || "N/A"} / ${summary.top_quarantine_score != null ? summary.top_quarantine_score : "N/A"}`,
    `- explore: ${summary.top_explore_market || "N/A"} / ${summary.top_explore_score != null ? summary.top_explore_score : "N/A"}`,
    `- learning_epoch: ${summary.learning_epoch_status || "N/A"} / penalty_weight=${summary.learning_epoch_penalty_weight != null ? summary.learning_epoch_penalty_weight : "N/A"}`,
    `- fee_pnl_hard_penalty_markets: ${Array.isArray(summary.fee_pnl_hard_penalty_markets) && summary.fee_pnl_hard_penalty_markets.length ? summary.fee_pnl_hard_penalty_markets.join(", ") : "none"}`,
    `- alpha_hard_penalty_markets: ${Array.isArray(summary.alpha_hard_penalty_markets) && summary.alpha_hard_penalty_markets.length ? summary.alpha_hard_penalty_markets.join(", ") : "none"}`,
    "",
    "## Input Freshness",
    ...(Array.isArray(freshness.rows) && freshness.rows.length
      ? freshness.rows.map((row) => `- ${row.key}: fresh=${row.fresh ? "YES" : "NO"} / age_hours=${row.age_hours != null ? row.age_hours : "N/A"} / max=${row.max_age_hours != null ? row.max_age_hours : "N/A"} / generated=${row.generated_at_kst || "N/A"} / reason=${row.stale_reason || "OK"}`)
      : ["- none"]),
    "",
    "## Markets",
    ...(Array.isArray(summary.top_watch_markets) && summary.top_watch_markets.length
      ? summary.top_watch_markets.map((row) => `- ${row.market}: ${row.recommended_action} / score=${row.allocation_score != null ? row.allocation_score : "N/A"} / prod=${row.production_slot ? "YES" : "NO"} / explore=${row.exploration_slot ? "YES" : "NO"} / deferred=${row.deferred_penalty ? "YES" : "NO"} / penalties=${Array.isArray(row.penalty_reasons) && row.penalty_reasons.length ? row.penalty_reasons.join("|") : "none"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const nowMs = Date.now();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_SCORE_PATH, null);
  const executionQuality = readJsonRawSafe(EXECUTION_QUALITY_PATH, null);
  const reversePolicy = readJsonRawSafe(REVERSE_POLICY_PATH, null);
  const explorationBudget = readJsonRawSafe(EXPLORATION_BUDGET_PATH, null);
  const serverPrimaryLearningEpoch = readJsonRawSafe(SERVER_PRIMARY_LEARNING_EPOCH_PATH, null);
  const failureLearningLoop = readJsonRawSafe(FAILURE_LEARNING_LOOP_PATH, null);
  const feePnlKpiAuthority = readJsonRawSafe(FEE_PNL_KPI_AUTHORITY_PATH, null);
  const eventTruthAlphaValidation = readJsonRawSafe(EVENT_TRUTH_ALPHA_VALIDATION_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [marketObjectiveScore, executionQuality, reversePolicy, explorationBudget, serverPrimaryLearningEpoch, failureLearningLoop, feePnlKpiAuthority, eventTruthAlphaValidation],
  });

  const summary = deriveServerMarketCapitalAllocator({
    marketObjectiveScore,
    executionQuality,
    reversePolicy,
    explorationBudget,
    serverPrimaryLearningEpoch,
    failureLearningLoop,
    feePnlKpiAuthority,
    eventTruthAlphaValidation,
  });
  const freshnessRows = [
    buildInputFreshnessRow({ key: "market_objective_score", filePath: MARKET_OBJECTIVE_SCORE_PATH, data: marketObjectiveScore, maxAgeHours: INPUT_MAX_AGE_HOURS.market_objective_score, nowMs }),
    buildInputFreshnessRow({ key: "execution_quality", filePath: EXECUTION_QUALITY_PATH, data: executionQuality, maxAgeHours: INPUT_MAX_AGE_HOURS.execution_quality, nowMs }),
    buildInputFreshnessRow({ key: "reverse_policy", filePath: REVERSE_POLICY_PATH, data: reversePolicy, maxAgeHours: INPUT_MAX_AGE_HOURS.reverse_policy, nowMs }),
    buildInputFreshnessRow({ key: "exploration_budget", filePath: EXPLORATION_BUDGET_PATH, data: explorationBudget, maxAgeHours: INPUT_MAX_AGE_HOURS.exploration_budget, nowMs }),
    buildInputFreshnessRow({ key: "server_primary_learning_epoch", filePath: SERVER_PRIMARY_LEARNING_EPOCH_PATH, data: serverPrimaryLearningEpoch, maxAgeHours: INPUT_MAX_AGE_HOURS.server_primary_learning_epoch, nowMs }),
    buildInputFreshnessRow({ key: "failure_learning_loop", filePath: FAILURE_LEARNING_LOOP_PATH, data: failureLearningLoop, maxAgeHours: INPUT_MAX_AGE_HOURS.failure_learning_loop, nowMs }),
    buildInputFreshnessRow({ key: "fee_pnl_kpi_authority", filePath: FEE_PNL_KPI_AUTHORITY_PATH, data: feePnlKpiAuthority, maxAgeHours: INPUT_MAX_AGE_HOURS.fee_pnl_kpi_authority, nowMs }),
    buildInputFreshnessRow({ key: "event_truth_alpha_validation", filePath: EVENT_TRUTH_ALPHA_VALIDATION_PATH, data: eventTruthAlphaValidation, maxAgeHours: INPUT_MAX_AGE_HOURS.event_truth_alpha_validation, nowMs }),
  ];
  const staleRows = freshnessRows.filter((row) => row.fresh !== true);
  const maxInputAgeHours = freshnessRows.reduce((acc, row) => (
    Number.isFinite(row.age_hours) ? Math.max(acc, row.age_hours) : acc
  ), 0);
  const freshness = {
    status: staleRows.length > 0 ? "STALE_INPUTS" : "FRESH",
    inputs_fresh: staleRows.length === 0,
    stale_input_n: staleRows.length,
    stale_input_keys: staleRows.map((row) => row.key),
    max_input_age_hours: Number.isFinite(maxInputAgeHours) ? Number(maxInputAgeHours.toFixed(4)) : null,
    rows: freshnessRows,
  };
  summary.input_freshness_status = freshness.status;
  summary.inputs_fresh = freshness.inputs_fresh;
  summary.input_stale = !freshness.inputs_fresh;
  summary.stale = !freshness.inputs_fresh;
  summary.stale_input_n = freshness.stale_input_n;
  summary.stale_input_keys = freshness.stale_input_keys.slice();
  summary.max_input_age_hours = freshness.max_input_age_hours;
  summary.evidence_status = freshness.inputs_fresh
    ? "SERVER_MARKET_CAPITAL_ALLOCATOR_FRESH"
    : "SERVER_MARKET_CAPITAL_ALLOCATOR_STALE_INPUTS";
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      market_objective_score: MARKET_OBJECTIVE_SCORE_PATH,
      execution_quality: EXECUTION_QUALITY_PATH,
      reverse_policy: REVERSE_POLICY_PATH,
      exploration_budget: EXPLORATION_BUDGET_PATH,
      server_primary_learning_epoch: SERVER_PRIMARY_LEARNING_EPOCH_PATH,
      failure_learning_loop: FAILURE_LEARNING_LOOP_PATH,
      fee_pnl_kpi_authority: FEE_PNL_KPI_AUTHORITY_PATH,
      event_truth_alpha_validation: EVENT_TRUTH_ALPHA_VALIDATION_PATH,
    },
    freshness,
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_market_capital_allocator`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_market_capital_allocator_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_market_capital_allocator_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    top_increase_market: summary.top_increase_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_MARKET_CAPITAL_ALLOCATOR_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
