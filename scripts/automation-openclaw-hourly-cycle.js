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

function toStepResult(step, result = {}, context = {}) {
  return {
    id: step.id,
    status: result.status || "FAIL",
    summary: result.summary || "N/A",
    reason: result.reason || null,
    run_id: context.runId || null,
    duration_ms: Number.isFinite(Number(context.durationMs)) ? Number(context.durationMs) : null,
    criticality: step.criticality || "HIGH",
    depends_on: Array.isArray(step.depends_on) ? step.depends_on : [],
    produces_artifact: step.produces_artifact || null,
  };
}

function executeStep(step, context = {}) {
  const startedAtMs = Date.now();
  const result = step.run();
  const durationMs = Date.now() - startedAtMs;
  return toStepResult(step, result, {
    runId: context.runId || null,
    durationMs,
  });
}

function buildStepRegistry() {
  const postRemediationReports = [
    "report-best-self-evolution-canonical-engine-parity.js",
    "report-server-signal-authority.js",
    "report-server-signal-quality.js",
    "report-server-signal-runtime.js",
    "report-server-signal-cutover-readiness.js",
    "report-server-signal-observation-24h.js",
  ];

  return [
    {
      id: "analytics_local_cache",
      kind: "inline",
      criticality: "MEDIUM",
      depends_on: [],
      produces_artifact: "analytics_local_cache_refresh_latest.json",
      run() {
        const analytics = runAnalyticsLocalCacheRefresh({ trigger: "openclaw_hourly_cycle", force: false });
        return {
          status: analytics.ok ? (analytics.skipped ? "SKIP" : "PASS") : "FAIL",
          summary: analytics.reason || (analytics.parsed && (analytics.parsed.reason || analytics.parsed.status)) || "OK",
          reason: analytics.reason || null,
        };
      },
    },
    {
      id: "signal_lineage_health",
      kind: "script",
      script: "report-signal-lineage-health.js",
      criticality: "HIGH",
      depends_on: [],
      produces_artifact: "signal_lineage_health_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.verdict || res.parsed.reason || res.parsed.status) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "doc_artifact_parity",
      kind: "script",
      script: "check-doc-artifact-parity.js",
      criticality: "HIGH",
      depends_on: [],
      produces_artifact: "doc_artifact_parity_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed ? `mismatch_n=${res.parsed.mismatch_n ?? "N/A"}` : "N/A",
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "server_signal_drift_remediation_plan",
      kind: "script",
      script: "report-server-signal-drift-remediation-plan.js",
      criticality: "HIGH",
      depends_on: [],
      produces_artifact: "server_signal_drift_remediation_plan_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.status || res.parsed.reason || (res.parsed.ok === true ? "OK" : null)) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "server_signal_drift_remediation_apply",
      kind: "script",
      script: "apply-server-signal-drift-remediation-plan.js",
      criticality: "HIGH",
      depends_on: ["server_signal_drift_remediation_plan"],
      produces_artifact: "server_signal_drift_remediation_apply_latest.json",
      run() {
        const res = runScript(this.script, {
          APPLY: String(process.env.OPENCLAW_DRIFT_REMEDIATION_APPLY || "0"),
        });
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed
            && (`applied=${res.parsed.applied ? "YES" : "NO"} ev_patch=${res.parsed.ev_patch_n ?? "N/A"} cooldown_patch=${res.parsed.cooldown_patch_n ?? "N/A"} other_watch_only_patch=${res.parsed.other_server_policy_watch_only_patch_n ?? "N/A"}`),
          reason: res.parsed && (res.parsed.reason || (res.parsed.applied ? "APPLIED" : "DRY_RUN")) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "server_signal_post_remediation_refresh",
      kind: "script_bundle",
      criticality: "HIGH",
      depends_on: ["server_signal_drift_remediation_apply"],
      produces_artifact: "server_signal_observation_24h_latest.json",
      run() {
        const results = postRemediationReports.map((script) => runScript(script));
        const ok = results.every((row) => row.ok);
        return {
          status: ok ? "PASS" : "FAIL",
          summary: results.map((row, idx) => `${postRemediationReports[idx]}=${row.ok ? "OK" : "FAIL"}`).join(" / "),
          reason: ok ? null : "POST_REMEDIATION_REFRESH_FAILED",
        };
      },
    },
    {
      id: "automation_watchdog",
      kind: "script",
      script: "automation-automation-watchdog.js",
      criticality: "HIGH",
      depends_on: ["server_signal_post_remediation_refresh"],
      produces_artifact: "automation_watchdog_latest.json",
      run() {
        const res = runScript(this.script, { SKIP_ALERT: process.env.SKIP_ALERT || "" });
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.verdict || res.parsed.reason || res.parsed.status) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.verdict || res.parsed.status) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "self_evolution_loop",
      kind: "inline",
      criticality: "HIGH",
      depends_on: ["automation_watchdog"],
      produces_artifact: null,
      run() {
        const loop = runSelfEvolutionLoop({ trigger: "openclaw_hourly_cycle", force: false });
        return {
          status: loop.ok ? (loop.skipped ? "SKIP" : "PASS") : "FAIL",
          summary: loop.reason || (loop.parsed && (loop.parsed.status || loop.parsed.reason)) || "OK",
          reason: loop.reason || (loop.parsed && (loop.parsed.reason || loop.parsed.status)) || null,
        };
      },
    },
    {
      id: "current_version_pine_sync",
      kind: "script",
      script: "automation-sync-current-version-pine.js",
      criticality: "MEDIUM",
      depends_on: ["self_evolution_loop"],
      produces_artifact: null,
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.status || res.parsed.reason) || (res.ok ? "OK" : "FAIL"),
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
    {
      id: "hourly_overall_report",
      kind: "script",
      script: "automation-hourly-overall-report.js",
      criticality: "MEDIUM",
      depends_on: ["current_version_pine_sync"],
      produces_artifact: "hourly_overall_report_latest.json",
      run() {
        const res = runScript(this.script, { SKIP_ALERT: process.env.SKIP_ALERT || "" });
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.status || res.parsed.reason || (res.parsed.ok === true ? "OK" : null)) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? `EXIT_${res.exit_code}` : null),
        };
      },
    },
  ];
}

function renderMarkdown(report = {}) {
  const lines = [
    "# OpenClaw Hourly Cycle",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- run_id: ${report.run_id || "N/A"}`,
    "",
    "## Steps",
  ];
  for (const row of Array.isArray(report.steps) ? report.steps : []) {
    lines.push(`- ${row.id}: ${row.status} / duration_ms=${row.duration_ms == null ? "N/A" : row.duration_ms} / reason=${row.reason || "N/A"} / summary=${row.summary || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const runId = `openclaw_hourly_cycle_${Date.now()}`;
  const registry = buildStepRegistry();
  const steps = registry.map((step) => executeStep(step, { runId }));

  const report = {
    ok: steps.every((row) => row.status !== "FAIL"),
    generated_at_kst: meta.kst,
    run_id: runId,
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
} else {
  module.exports = {
    __test: {
      buildStepRegistry,
      toStepResult,
      executeStep,
    },
  };
}
