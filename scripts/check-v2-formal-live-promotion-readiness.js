#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_INPUT_FILE = path.join(OPS_DAILY_DIR, "v2_evidence_snapshot_latest.json");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_formal_live_promotion_readiness_latest.json");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrFalse(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(text);
}

function numberFromEnv(env, key, fallback) {
  const n = toNumberOrNull(env[key]);
  return n == null ? fallback : n;
}

function normalizeRate(value) {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function readJsonSafe(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, error };
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveThresholds(env = process.env) {
  return Object.freeze({
    min_sample_n_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_SAMPLE_N_30D", 200),
    min_profit_factor_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_PROFIT_FACTOR_30D", 1.15),
    min_bootstrap_pf_lower_ci: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_BOOTSTRAP_PF_LOWER_CI", 1.0),
    min_expectancy_r_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_EXPECTANCY_R_30D", 0),
    min_net_pnl_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_NET_PNL_30D", 0),
    min_win_rate_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_WIN_RATE_30D", 0.40),
    max_drawdown_ratio: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_DRAWDOWN_RATIO", 0.05),
    min_active_protection_streak_days: numberFromEnv(env, "V2_FORMAL_LIVE_MIN_ACTIVE_PROTECTION_STREAK_DAYS", 30),
    max_post_fill_critical_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_POST_FILL_CRITICAL_30D", 0),
    max_repair_queue_lag_p95_ms: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_REPAIR_QUEUE_LAG_P95_MS", 60000),
    max_v1_writer_calls_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_V1_WRITER_CALLS_30D", 0),
    max_cloud_run_revision_drift_n: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_CLOUD_RUN_REVISION_DRIFT_N", 0),
    max_unprotected_position_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_UNPROTECTED_POSITION_30D", 0),
    max_algo_endpoint_crit_30d: numberFromEnv(env, "V2_FORMAL_LIVE_MAX_ALGO_ENDPOINT_CRIT_30D", 0),
  });
}

function readBootstrapPfLowerCi(snapshot = {}) {
  return toNumberOrNull(snapshot.bootstrap_pf_lower_ci)
    ?? toNumberOrNull(snapshot.profit_factor_bootstrap_lower_ci)
    ?? toNumberOrNull(snapshot.bootstrap_profit_factor_lower_ci)
    ?? toNumberOrNull(snapshot.pf_bootstrap_lower_ci_95)
    ?? toNumberOrNull(snapshot.profit_factor_95ci_lower);
}

function readDrawdownRatio(snapshot = {}, env = process.env) {
  const explicit = normalizeRate(snapshot.max_drawdown_30d_ratio ?? snapshot.max_drawdown_ratio_30d);
  if (explicit != null) return Math.abs(explicit);
  const pct = normalizeRate(snapshot.max_drawdown_30d_pct);
  if (pct != null) return Math.abs(pct);
  const quote = toNumberOrNull(snapshot.max_drawdown_30d_quote);
  const equity = toNumberOrNull(snapshot.equity_quote) ?? toNumberOrNull(snapshot.equity_usdt) ?? toNumberOrNull(env.V2_FORMAL_LIVE_EQUITY_QUOTE);
  if (quote != null && equity != null && equity > 0) return Math.abs(quote) / equity;
  return null;
}

function hasTailLossOrMaeReport(snapshot = {}) {
  return snapshot.tail_loss_report_present === true
    || snapshot.mae_report_present === true
    || snapshot.tail_loss_mae_report_present === true
    || snapshot.adverse_excursion_report_present === true;
}

function addIf(blockers, condition, code) {
  if (condition) blockers.push(code);
}

function evaluateFormalLivePromotionReadiness({ snapshot = null, env = process.env, inputFile = DEFAULT_INPUT_FILE, nowMs = Date.now() } = {}) {
  const thresholds = resolveThresholds(env);
  const blockers = [];
  const warnings = [];
  const s = snapshot && typeof snapshot === "object" ? snapshot : null;

  if (!s) {
    blockers.push("FORMAL_LIVE_PROMOTION:SNAPSHOT_MISSING");
    return Object.freeze({
      ok: false,
      reason: "FORMAL_LIVE_PROMOTION_BLOCKED",
      generated_at: new Date(nowMs).toISOString(),
      input_file: inputFile,
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      thresholds,
      metrics: Object.freeze({}),
    });
  }

  const sampleN = toNumberOrNull(s.sample_n_30d);
  const pf = toNumberOrNull(s.profit_factor_30d);
  const bootstrapPfLowerCi = readBootstrapPfLowerCi(s);
  const expectancyR = toNumberOrNull(s.expectancy_r_30d);
  const netPnl = toNumberOrNull(s.net_pnl_30d_quote) ?? toNumberOrNull(s.net_pnl_30d_pct);
  const winRate = normalizeRate(s.win_rate_30d);
  const drawdownRatio = readDrawdownRatio(s, env);
  const activeProtectionStreakDays = toNumberOrNull(s.active_protection_streak_days);
  const postFillCriticalN = toNumberOrNull(s.post_fill_critical_30d);
  const repairQueueLagP95Ms = toNumberOrNull(s.repair_queue_lag_p95_ms);
  const v1WriterCallN = toNumberOrNull(s.v1_place_futures_call_n_30d);
  const revisionDriftN = toNumberOrNull(s.cloud_run_revision_drift_n);
  const maxUnprotectedN = toNumberOrNull(s.max_unprotected_position_30d);
  const algoEndpointCritN = toNumberOrNull(s.algo_endpoint_degraded_crit_n_30d);
  const snapshotBlockers = Array.isArray(s.blockers) ? s.blockers : [];
  const perfGateStatus = String(s.performance_gate_status || "").trim().toUpperCase();

  addIf(blockers, s.ok !== true, "FORMAL_LIVE_PROMOTION:EVIDENCE_SNAPSHOT_NOT_OK");
  addIf(blockers, snapshotBlockers.length > 0, "FORMAL_LIVE_PROMOTION:EVIDENCE_SNAPSHOT_BLOCKERS_PRESENT");
  addIf(blockers, !Number.isFinite(sampleN) || sampleN < thresholds.min_sample_n_30d, "FORMAL_LIVE_PROMOTION:SAMPLE_INSUFFICIENT");
  addIf(blockers, !Number.isFinite(pf) || pf < thresholds.min_profit_factor_30d, "FORMAL_LIVE_PROMOTION:PROFIT_FACTOR_BELOW_FLOOR");
  addIf(blockers, !Number.isFinite(bootstrapPfLowerCi) || bootstrapPfLowerCi <= thresholds.min_bootstrap_pf_lower_ci, "FORMAL_LIVE_PROMOTION:BOOTSTRAP_PF_CI_NOT_PROVEN");
  addIf(blockers, !Number.isFinite(expectancyR) || expectancyR <= thresholds.min_expectancy_r_30d, "FORMAL_LIVE_PROMOTION:EXPECTANCY_NOT_POSITIVE");
  addIf(blockers, !Number.isFinite(netPnl) || netPnl <= thresholds.min_net_pnl_30d, "FORMAL_LIVE_PROMOTION:NET_PNL_NOT_POSITIVE");
  addIf(blockers, !Number.isFinite(winRate) || winRate < thresholds.min_win_rate_30d, "FORMAL_LIVE_PROMOTION:WIN_RATE_BELOW_FLOOR");
  addIf(blockers, !Number.isFinite(drawdownRatio) || drawdownRatio >= thresholds.max_drawdown_ratio, "FORMAL_LIVE_PROMOTION:DRAWDOWN_LIMIT_EXCEEDED_OR_MISSING");
  addIf(blockers, !Number.isFinite(activeProtectionStreakDays) || activeProtectionStreakDays < thresholds.min_active_protection_streak_days, "FORMAL_LIVE_PROMOTION:ACTIVE_PROTECTION_STREAK_SHORT");
  addIf(blockers, !Number.isFinite(postFillCriticalN) || postFillCriticalN > thresholds.max_post_fill_critical_30d, "FORMAL_LIVE_PROMOTION:POST_FILL_CRITICAL_PRESENT");
  addIf(blockers, !Number.isFinite(repairQueueLagP95Ms) || repairQueueLagP95Ms >= thresholds.max_repair_queue_lag_p95_ms, "FORMAL_LIVE_PROMOTION:REPAIR_QUEUE_LAG_P95_EXCEEDED_OR_MISSING");
  addIf(blockers, !Number.isFinite(v1WriterCallN) || v1WriterCallN > thresholds.max_v1_writer_calls_30d, "FORMAL_LIVE_PROMOTION:V1_WRITER_CALLS_PRESENT");
  addIf(blockers, !Number.isFinite(revisionDriftN) || revisionDriftN > thresholds.max_cloud_run_revision_drift_n, "FORMAL_LIVE_PROMOTION:CLOUD_RUN_REVISION_DRIFT_PRESENT_OR_UNKNOWN");
  addIf(blockers, !Number.isFinite(maxUnprotectedN) || maxUnprotectedN > thresholds.max_unprotected_position_30d, "FORMAL_LIVE_PROMOTION:UNPROTECTED_POSITION_PRESENT");
  addIf(blockers, !Number.isFinite(algoEndpointCritN) || algoEndpointCritN > thresholds.max_algo_endpoint_crit_30d, "FORMAL_LIVE_PROMOTION:ALGO_ENDPOINT_CRIT_PRESENT_OR_UNKNOWN");
  addIf(blockers, s.fee_included !== true || s.funding_included !== true || s.slippage_included !== true, "FORMAL_LIVE_PROMOTION:COST_COMPONENTS_NOT_PROVEN");
  addIf(blockers, s.symbol_breakdown_present !== true, "FORMAL_LIVE_PROMOTION:SYMBOL_BREAKDOWN_MISSING");
  addIf(blockers, s.regime_breakdown_present !== true, "FORMAL_LIVE_PROMOTION:REGIME_BREAKDOWN_MISSING");
  addIf(blockers, !hasTailLossOrMaeReport(s), "FORMAL_LIVE_PROMOTION:TAIL_LOSS_MAE_REPORT_MISSING");
  addIf(blockers, perfGateStatus !== "PASS", "FORMAL_LIVE_PROMOTION:PERFORMANCE_GATE_NOT_PASS");

  if (blockers.length === 0) warnings.push("FORMAL_LIVE_PROMOTION:OPERATOR_MULTI_EYE_APPROVAL_AND_24H_COOLDOWN_REQUIRED");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "FORMAL_LIVE_PROMOTION_READY_REQUIRES_OPERATOR_APPROVAL" : "FORMAL_LIVE_PROMOTION_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    input_file: inputFile,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(warnings),
    thresholds,
    metrics: Object.freeze({
      sample_n_30d: sampleN,
      profit_factor_30d: pf,
      bootstrap_pf_lower_ci: bootstrapPfLowerCi,
      expectancy_r_30d: expectancyR,
      net_pnl_30d: netPnl,
      win_rate_30d: winRate,
      drawdown_ratio_30d: drawdownRatio,
      active_protection_streak_days: activeProtectionStreakDays,
      post_fill_critical_30d: postFillCriticalN,
      repair_queue_lag_p95_ms: repairQueueLagP95Ms,
      v1_place_futures_call_n_30d: v1WriterCallN,
      cloud_run_revision_drift_n: revisionDriftN,
      max_unprotected_position_30d: maxUnprotectedN,
      algo_endpoint_degraded_crit_n_30d: algoEndpointCritN,
      fee_included: s.fee_included === true,
      funding_included: s.funding_included === true,
      slippage_included: s.slippage_included === true,
      symbol_breakdown_present: s.symbol_breakdown_present === true,
      regime_breakdown_present: s.regime_breakdown_present === true,
      tail_loss_mae_report_present: hasTailLossOrMaeReport(s),
      performance_gate_status: perfGateStatus || null,
    }),
  });
}

function resolveInputFile(env = process.env) {
  return trimOrNull(env.V2_FORMAL_LIVE_PROMOTION_READINESS_INPUT_FILE) || DEFAULT_INPUT_FILE;
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_FORMAL_LIVE_PROMOTION_READINESS_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE;
}

function runCheck(env = process.env) {
  const inputFile = resolveInputFile(env);
  const outputFile = resolveOutputFile(env);
  const loaded = readJsonSafe(inputFile);
  const result = evaluateFormalLivePromotionReadiness({
    snapshot: loaded.ok ? loaded.data : null,
    env,
    inputFile,
  });
  const payload = Object.freeze({
    ...result,
    output_file: outputFile,
    ...(loaded.ok ? {} : { input_error_code: loaded.error && loaded.error.code || null, input_error: loaded.error && loaded.error.message || String(loaded.error) }),
  });
  writeJson(outputFile, payload);
  return payload;
}

function main(env = process.env) {
  const result = runCheck(env);
  const line = JSON.stringify({
    ok: result.ok,
    reason: result.reason,
    blockers: result.blockers,
    output_file: result.output_file,
    sample_n_30d: result.metrics && result.metrics.sample_n_30d,
    profit_factor_30d: result.metrics && result.metrics.profit_factor_30d,
    active_protection_streak_days: result.metrics && result.metrics.active_protection_streak_days,
  });
  if (result.ok) console.log(line);
  else {
    console.error(line);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "FORMAL_LIVE_PROMOTION_READINESS_CHECK_FAILED",
      blockers: ["FORMAL_LIVE_PROMOTION:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    runCheck,
    evaluateFormalLivePromotionReadiness,
    resolveThresholds,
    readBootstrapPfLowerCi,
    readDrawdownRatio,
    hasTailLossOrMaeReport,
    __test: { trimOrNull, toNumberOrNull, boolOrFalse, normalizeRate, resolveInputFile, resolveOutputFile },
  };
}
