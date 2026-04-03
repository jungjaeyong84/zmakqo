#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { runSelfEvolutionLoop } = require("../src/scheduler/selfEvolutionRunner");
const { runAnalyticsLocalCacheRefresh } = require("../src/scheduler/analyticsLocalCacheRunner");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "openclaw_hourly_cycle_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "openclaw_hourly_cycle_latest.md");

function extractJson(stdout = "") {
  const lines = String(stdout || "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_err) {
      // continue
    }
  }
  return null;
}

function runScript(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 16,
  });
  return {
    ok: child.status === 0,
    exit_code: child.status,
    parsed: extractJson(child.stdout),
    stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
    stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# OpenClaw Hourly Cycle",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    "",
    "## Steps",
  ];
  for (const row of Array.isArray(report.steps) ? report.steps : []) {
    lines.push(`- ${row.id}: ${row.status} / summary=${row.summary || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const steps = [];

  const analytics = runAnalyticsLocalCacheRefresh({ trigger: "openclaw_hourly_cycle", force: false });
  steps.push({
    id: "analytics_local_cache",
    status: analytics.ok ? (analytics.skipped ? "SKIP" : "PASS") : "FAIL",
    summary: analytics.reason || (analytics.parsed && (analytics.parsed.reason || analytics.parsed.status)) || "OK",
  });

  const lineageHealth = runScript("report-signal-lineage-health.js");
  steps.push({
    id: "signal_lineage_health",
    status: lineageHealth.ok ? "PASS" : "FAIL",
    summary: lineageHealth.parsed && (lineageHealth.parsed.verdict || lineageHealth.parsed.reason || lineageHealth.parsed.status) || "OK",
  });

  const docArtifactParity = runScript("check-doc-artifact-parity.js");
  steps.push({
    id: "doc_artifact_parity",
    status: docArtifactParity.ok ? "PASS" : "FAIL",
    summary: docArtifactParity.parsed
      ? `mismatch_n=${docArtifactParity.parsed.mismatch_n ?? "N/A"}`
      : "N/A",
  });

  const driftRemediationPlan = runScript("report-server-signal-drift-remediation-plan.js");
  steps.push({
    id: "server_signal_drift_remediation_plan",
    status: driftRemediationPlan.ok ? "PASS" : "FAIL",
    summary: driftRemediationPlan.parsed && (driftRemediationPlan.parsed.status || driftRemediationPlan.parsed.reason || driftRemediationPlan.parsed.ok === true && "OK") || "OK",
  });

  const driftRemediationApply = runScript("apply-server-signal-drift-remediation-plan.js", {
    APPLY: String(process.env.OPENCLAW_DRIFT_REMEDIATION_APPLY || "0"),
  });
  steps.push({
    id: "server_signal_drift_remediation_apply",
    status: driftRemediationApply.ok ? "PASS" : "FAIL",
    summary: driftRemediationApply.parsed
      && (`applied=${driftRemediationApply.parsed.applied ? "YES" : "NO"} ev_patch=${driftRemediationApply.parsed.ev_patch_n ?? "N/A"} cooldown_patch=${driftRemediationApply.parsed.cooldown_patch_n ?? "N/A"} other_watch_only_patch=${driftRemediationApply.parsed.other_server_policy_watch_only_patch_n ?? "N/A"}`),
  });

  const postRemediationReports = [
    "report-best-self-evolution-canonical-engine-parity.js",
    "report-server-signal-authority.js",
    "report-server-signal-quality.js",
    "report-server-signal-runtime.js",
    "report-server-signal-cutover-readiness.js",
  ];
  const postRemediationResults = postRemediationReports.map((script) => runScript(script));
  const postRemediationOk = postRemediationResults.every((row) => row.ok);
  steps.push({
    id: "server_signal_post_remediation_refresh",
    status: postRemediationOk ? "PASS" : "FAIL",
    summary: postRemediationResults
      .map((row, idx) => `${postRemediationReports[idx]}=${row.ok ? "OK" : "FAIL"}`)
      .join(" / "),
  });

  const watchdog = runScript("automation-automation-watchdog.js", { SKIP_ALERT: process.env.SKIP_ALERT || "" });
  steps.push({
    id: "automation_watchdog",
    status: watchdog.ok ? "PASS" : "FAIL",
    summary: watchdog.parsed && (watchdog.parsed.verdict || watchdog.parsed.reason || watchdog.parsed.status) || "OK",
  });

  const loop = runSelfEvolutionLoop({ trigger: "openclaw_hourly_cycle", force: false });
  steps.push({
    id: "self_evolution_loop",
    status: loop.ok ? (loop.skipped ? "SKIP" : "PASS") : "FAIL",
    summary: loop.reason || (loop.parsed && (loop.parsed.status || loop.parsed.reason)) || "OK",
  });

  const pineSync = runScript("automation-sync-current-version-pine.js");
  steps.push({
    id: "current_version_pine_sync",
    status: pineSync.ok ? "PASS" : "FAIL",
    summary: pineSync.parsed && (pineSync.parsed.status || pineSync.parsed.reason) || (pineSync.ok ? "OK" : "FAIL"),
  });

  const hourly = runScript("automation-hourly-overall-report.js", { SKIP_ALERT: process.env.SKIP_ALERT || "" });
  steps.push({
    id: "hourly_overall_report",
    status: hourly.ok ? "PASS" : "FAIL",
    summary: hourly.parsed && (hourly.parsed.status || hourly.parsed.reason || hourly.parsed.ok === true && "OK") || "OK",
  });

  const report = {
    ok: steps.every((row) => row.status !== "FAIL"),
    generated_at_kst: meta.kst,
    status: steps.every((row) => row.status !== "FAIL") ? "PASS" : "FAIL",
    steps,
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_openclaw_hourly_cycle.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_openclaw_hourly_cycle.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    jsonPath,
    mdPath,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("automation-openclaw-hourly-cycle failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
