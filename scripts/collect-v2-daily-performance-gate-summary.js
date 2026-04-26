#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateV2PerformanceStageMatrix } = require("../src/v2/performanceGate");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_PERFORMANCE_GATE_FILE = path.join(OPS_DAILY_DIR, "v2_performance_gate_latest.json");
const DEFAULT_PERFORMANCE_REPORT_FILE = path.join(OPS_DAILY_DIR, "v2_openclaw_daily_performance_report_latest.json");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_daily_performance_gate_summary_latest.json");
const DEFAULT_HISTORY_FILE = path.join(OPS_DAILY_DIR, "v2_daily_performance_gate_summary_history.jsonl");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return null;
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

function appendJsonl(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
}

function metricFromGate(gate = {}, key) {
  const metrics = gate && gate.metrics && typeof gate.metrics === "object" ? gate.metrics : {};
  return toNumberOrNull(metrics[key] ?? gate[key]);
}

function resolveCostInclusion(report = {}, gate = {}) {
  const perf = report.performance && typeof report.performance === "object" ? report.performance : {};
  const costs = report.costs && typeof report.costs === "object" ? report.costs : {};
  const gateCosts = gate.costs && typeof gate.costs === "object" ? gate.costs : {};
  return Object.freeze({
    fee_included: boolOrNull(report.fee_included ?? perf.fee_included ?? costs.fee_included ?? gate.fee_included ?? gateCosts.fee_included),
    funding_included: boolOrNull(report.funding_included ?? perf.funding_included ?? costs.funding_included ?? gate.funding_included ?? gateCosts.funding_included),
    slippage_included: boolOrNull(report.slippage_included ?? perf.slippage_included ?? costs.slippage_included ?? gate.slippage_included ?? gateCosts.slippage_included),
  });
}

function summarizeStage(stageResult = null) {
  if (!stageResult || typeof stageResult !== "object") {
    return Object.freeze({ ok: false, status: "UNKNOWN", blockers: Object.freeze(["PERFORMANCE_DAILY:STAGE_RESULT_MISSING"]), thresholds: null });
  }
  return Object.freeze({
    ok: stageResult.ok === true,
    status: stageResult.ok === true ? "PASS" : "BLOCKED",
    blockers: Object.freeze(Array.isArray(stageResult.blockers) ? stageResult.blockers : []),
    thresholds: stageResult.thresholds || null,
  });
}

function buildSummary({ performanceGate = null, performanceReport = null, env = process.env, nowMs = Date.now(), gateFile = DEFAULT_PERFORMANCE_GATE_FILE, reportFile = DEFAULT_PERFORMANCE_REPORT_FILE } = {}) {
  const blockers = [];
  const warnings = [];
  const gate = performanceGate && typeof performanceGate === "object" ? performanceGate : null;
  const report = performanceReport && typeof performanceReport === "object" ? performanceReport : null;

  if (!gate) blockers.push("PERFORMANCE_DAILY:GATE_ARTIFACT_MISSING");
  if (!report) warnings.push("PERFORMANCE_DAILY:REPORT_ARTIFACT_MISSING");

  const stageMatrix = gate && gate.stage_matrix && typeof gate.stage_matrix === "object"
    ? gate.stage_matrix
    : (gate ? evaluateV2PerformanceStageMatrix({ metrics: gate.metrics || gate, env, mode: gate.mode || "LIVE" }) : null);
  const costs = resolveCostInclusion(report || {}, gate || {});
  if (costs.fee_included !== true) warnings.push("PERFORMANCE_DAILY:FEE_INCLUSION_NOT_PROVEN");
  if (costs.funding_included !== true) warnings.push("PERFORMANCE_DAILY:FUNDING_INCLUSION_NOT_PROVEN");
  if (costs.slippage_included !== true) warnings.push("PERFORMANCE_DAILY:SLIPPAGE_INCLUSION_NOT_PROVEN");

  const sampleN = metricFromGate(gate || {}, "sample_n");
  const profitFactor = metricFromGate(gate || {}, "profit_factor");
  const expectancyR = metricFromGate(gate || {}, "expectancy_r") ?? metricFromGate(gate || {}, "avg_ret_net");
  const netPnlPct = metricFromGate(gate || {}, "net_pnl_pct");
  const currentGateOk = gate ? gate.ok === true : false;
  const currentStage = trimOrNull(gate && gate.stage) || "LIVE";
  const currentStatus = !gate
    ? "UNKNOWN"
    : (currentGateOk ? "PASS" : (Array.isArray(gate.blockers) && gate.blockers.includes("PERFORMANCE_GATE:SAMPLE_INSUFFICIENT") ? "ACCUMULATING" : "BLOCKED"));

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_DAILY_PERFORMANCE_GATE_SUMMARY_COLLECTED" : "V2_DAILY_PERFORMANCE_GATE_SUMMARY_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    date: new Date(nowMs).toISOString().slice(0, 10),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(Array.from(new Set(warnings))),
    current_stage: currentStage,
    current_status: currentStatus,
    highest_passed_stage: stageMatrix && stageMatrix.highest_passed_stage || null,
    sample_n: sampleN,
    profit_factor: profitFactor,
    expectancy_r: expectancyR,
    net_pnl_pct: netPnlPct,
    fee_included: costs.fee_included,
    funding_included: costs.funding_included,
    slippage_included: costs.slippage_included,
    stages: Object.freeze({
      discovery: summarizeStage(stageMatrix && stageMatrix.discovery),
      canary: summarizeStage(stageMatrix && stageMatrix.canary),
      live: summarizeStage(stageMatrix && stageMatrix.live),
    }),
    source_files: Object.freeze({
      performance_gate: gateFile,
      performance_report: reportFile,
    }),
  });
}

function resolveFiles(env = process.env) {
  return Object.freeze({
    gateFile: trimOrNull(env.V2_DAILY_PERFORMANCE_GATE_SUMMARY_GATE_FILE) || DEFAULT_PERFORMANCE_GATE_FILE,
    reportFile: trimOrNull(env.V2_DAILY_PERFORMANCE_GATE_SUMMARY_REPORT_FILE) || DEFAULT_PERFORMANCE_REPORT_FILE,
    outputFile: trimOrNull(env.V2_DAILY_PERFORMANCE_GATE_SUMMARY_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE,
    historyFile: trimOrNull(env.V2_DAILY_PERFORMANCE_GATE_SUMMARY_HISTORY_FILE) || DEFAULT_HISTORY_FILE,
  });
}

function collect(env = process.env) {
  const files = resolveFiles(env);
  const gate = readJsonSafe(files.gateFile);
  const report = readJsonSafe(files.reportFile);
  return buildSummary({
    performanceGate: gate.ok ? gate.data : null,
    performanceReport: report.ok ? report.data : null,
    env,
    gateFile: files.gateFile,
    reportFile: files.reportFile,
  });
}

function writeSummary({ summary, env = process.env } = {}) {
  const files = resolveFiles(env);
  writeJson(files.outputFile, summary);
  appendJsonl(files.historyFile, summary);
  return Object.freeze({ outputFile: files.outputFile, historyFile: files.historyFile });
}

function main(env = process.env) {
  const summary = collect(env);
  const files = writeSummary({ summary, env });
  const line = JSON.stringify({
    ok: summary.ok,
    reason: summary.reason,
    current_stage: summary.current_stage,
    current_status: summary.current_status,
    highest_passed_stage: summary.highest_passed_stage,
    sample_n: summary.sample_n,
    profit_factor: summary.profit_factor,
    expectancy_r: summary.expectancy_r,
    net_pnl_pct: summary.net_pnl_pct,
    warnings: summary.warnings,
    output_file: files.outputFile,
    history_file: files.historyFile,
  });
  if (summary.ok) console.log(line);
  else {
    console.error(line);
    process.exitCode = 1;
  }
  return Object.freeze({ ...summary, output_file: files.outputFile, history_file: files.historyFile });
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_DAILY_PERFORMANCE_GATE_SUMMARY_FAILED",
      blockers: ["PERFORMANCE_DAILY:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    collect,
    buildSummary,
    resolveCostInclusion,
    summarizeStage,
    resolveFiles,
    __test: { trimOrNull, toNumberOrNull, boolOrNull, metricFromGate },
  };
}
