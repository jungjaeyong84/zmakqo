#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
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
const EXIT_INTEGRITY_REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "binance_exit_integrity_cycle_latest.json");

function envBool(value, fallback = false) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveExitIntegrityMinIntervalMs() {
  const explicitMs = Number(process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_MIN_INTERVAL_MS || "");
  if (Number.isFinite(explicitMs) && explicitMs >= 0) return Math.trunc(explicitMs);
  const explicitHours = Number(process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_MIN_INTERVAL_HOURS || "");
  if (Number.isFinite(explicitHours) && explicitHours >= 0) return Math.trunc(explicitHours * 60 * 60 * 1000);
  return 4 * 60 * 60 * 1000;
}

function readExitIntegrityCycleGeneratedAtMs(reportPath = EXIT_INTEGRITY_REPORT_LATEST_JSON) {
  try {
    const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const candidate = raw && (raw.generated_at || raw.generated_at_iso || raw.generated_at_kst || null);
    const parsed = Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) return parsed;
  } catch (_err) {
    // ignore json parse errors and fall back to mtime
  }
  try {
    const stat = fs.statSync(reportPath);
    if (Number.isFinite(stat.mtimeMs)) return stat.mtimeMs;
  } catch (_err) {
    // missing file
  }
  return null;
}

function shouldRunExitIntegrityCycle({
  enabled = true,
  force = false,
  nowMs = Date.now(),
  lastRunMs = null,
  minIntervalMs = resolveExitIntegrityMinIntervalMs(),
} = {}) {
  if (enabled !== true) {
    return {
      shouldRun: false,
      reason: "EXIT_INTEGRITY_CYCLE_DISABLED",
      wait_ms: null,
    };
  }
  if (force === true) {
    return {
      shouldRun: true,
      reason: "EXIT_INTEGRITY_CYCLE_FORCED",
      wait_ms: 0,
    };
  }
  if (!Number.isFinite(lastRunMs) || !Number.isFinite(minIntervalMs) || minIntervalMs <= 0) {
    return {
      shouldRun: true,
      reason: "EXIT_INTEGRITY_CYCLE_READY",
      wait_ms: 0,
    };
  }
  const elapsedMs = nowMs - lastRunMs;
  if (elapsedMs >= minIntervalMs) {
    return {
      shouldRun: true,
      reason: "EXIT_INTEGRITY_CYCLE_READY",
      wait_ms: 0,
    };
  }
  return {
    shouldRun: false,
    reason: "EXIT_INTEGRITY_CYCLE_THROTTLED",
    wait_ms: Math.max(0, minIntervalMs - elapsedMs),
  };
}

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

function toNonNegativeInteger(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function resolveScriptTimeoutMs(script, env = process.env) {
  const name = String(script || "").trim();
  if (name === "automation-hourly-overall-report.js") {
    return toNonNegativeInteger(
      env.OPENCLAW_HOURLY_OVERALL_REPORT_TIMEOUT_MS,
      toNonNegativeInteger(env.OPENCLAW_HOURLY_STEP_TIMEOUT_MS, 120000)
    );
  }
  return toNonNegativeInteger(env.OPENCLAW_HOURLY_STEP_TIMEOUT_MS, 180000);
}

function runNodeScript(scriptPath, env = {}, options = {}) {
  const timeoutMs = toNonNegativeInteger(options.timeoutMs, 0);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 16,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  const timedOut = child.error && child.error.code === "ETIMEDOUT";
  return {
    ok: child.status === 0 && !timedOut,
    exit_code: child.status,
    signal: child.signal || null,
    timed_out: Boolean(timedOut),
    timeout_ms: timeoutMs,
    error_code: child.error && child.error.code ? child.error.code : null,
    parsed: extractJson(child.stdout),
    stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
    stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
  };
}

function runScript(script, env = {}, options = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  return runNodeScript(scriptPath, env, {
    ...options,
    timeoutMs: options.timeoutMs != null ? options.timeoutMs : resolveScriptTimeoutMs(script),
  });
}

function scriptFailureReason(res) {
  if (!res) return "SCRIPT_FAILED";
  if (res.timed_out === true) return `TIMEOUT_${res.timeout_ms || 0}MS`;
  if (res.error_code) return res.error_code;
  return `EXIT_${res.exit_code}`;
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
        const analytics = runAnalyticsLocalCacheRefresh({
          trigger: "openclaw_hourly_cycle",
          force: false,
          skipDependentReports: true,
        });
        return {
          status: analytics.ok ? (analytics.skipped ? "SKIP" : "PASS") : "FAIL",
          summary: analytics.reason || (analytics.parsed && (analytics.parsed.reason || analytics.parsed.status)) || "OK",
          reason: analytics.reason || null,
        };
      },
    },
    {
      id: "v2_outcome_adjudication_collector",
      kind: "script",
      script: "collect-v2-openclaw-outcome-adjudications.js",
      criticality: "HIGH",
      depends_on: ["analytics_local_cache"],
      produces_artifact: "v2_openclaw_outcome_adjudication_collector_latest.json",
      run() {
        const res = runScript(this.script, {
          V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE || "AUTO",
          V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE || "1",
        });
        const summary = res.parsed && res.parsed.summary ? res.parsed.summary : {};
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed
            ? `source=${res.parsed.source || "N/A"} adjudication_n=${summary.adjudication_n ?? "N/A"} write_n=${res.parsed.write_n ?? "N/A"}`
            : "N/A",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "execution_quality",
      kind: "script",
      script: "report-best-self-evolution-execution-quality.js",
      criticality: "HIGH",
      depends_on: ["v2_outcome_adjudication_collector"],
      produces_artifact: "best_self_evolution_execution_quality_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.status || res.parsed.reason || "OK") || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "v2_openclaw_root_cause_analysis",
      kind: "script",
      script: "analyze-v2-openclaw-root-cause.js",
      criticality: "HIGH",
      depends_on: ["v2_outcome_adjudication_collector"],
      produces_artifact: "v2_openclaw_root_cause_analysis_latest.json",
      run() {
        const res = runScript(this.script, {
          DONBEOLJA_V2_COLLECTION_PREFIX: process.env.DONBEOLJA_V2_COLLECTION_PREFIX || "v2__",
          V2_OPENCLAW_DAILY_PERFORMANCE_LIMIT: process.env.V2_OPENCLAW_DAILY_PERFORMANCE_LIMIT || "500",
        });
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed
            ? `sample_n=${res.parsed.sample_n ?? "N/A"} pf=${res.parsed.profit_factor ?? "N/A"} finding_n=${res.parsed.finding_n ?? "N/A"}`
            : "N/A",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "v2_openclaw_policy_candidate_from_root_cause",
      kind: "script",
      script: "generate-v2-openclaw-policy-candidate-from-root-cause.js",
      criticality: "HIGH",
      depends_on: ["v2_openclaw_root_cause_analysis"],
      produces_artifact: "v2_openclaw_policy_candidate_from_root_cause_latest.json",
      run() {
        const res = runScript(this.script, {
          V2_OPENCLAW_POLICY_CANDIDATE_SOFT: "1",
          DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: process.env.DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED || "0",
        });
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed
            ? `decision=${res.parsed.decision || "N/A"} actions=${res.parsed.action_n ?? "N/A"} blockers=${Array.isArray(res.parsed.blockers) ? res.parsed.blockers.length : "N/A"}`
            : "N/A",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "execution_watch_markets",
      kind: "script",
      script: "report-best-self-evolution-execution-watch-markets.js",
      criticality: "HIGH",
      depends_on: ["execution_quality"],
      produces_artifact: "best_self_evolution_execution_watch_markets_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (`status=${res.parsed.status || "N/A"} top=${res.parsed.top_watch_market || "N/A"} market_n=${res.parsed.review_market_n ?? "N/A"}`) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "signal_lineage_health",
      kind: "script",
      script: "report-signal-lineage-health.js",
      criticality: "HIGH",
      depends_on: ["execution_quality", "execution_watch_markets"],
      produces_artifact: "signal_lineage_health_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.verdict || res.parsed.reason || res.parsed.status) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "binance_exit_integrity_cycle",
      kind: "script",
      script: "run-binance-exit-integrity-cycle.js",
      criticality: "HIGH",
      depends_on: ["signal_lineage_health"],
      produces_artifact: "binance_exit_integrity_cycle_latest.json",
      run() {
        const enabled = envBool(
          process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED != null
            ? process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED
            : process.env.EXIT_INTEGRITY_CYCLE_ENABLED,
          true
        );
        const force = envBool(process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_FORCE, false);
        const minIntervalMs = resolveExitIntegrityMinIntervalMs();
        const cadence = shouldRunExitIntegrityCycle({
          enabled,
          force,
          lastRunMs: readExitIntegrityCycleGeneratedAtMs(),
          minIntervalMs,
        });
        if (cadence.shouldRun !== true) {
          return {
            status: "SKIP",
            summary: `${cadence.reason} wait_ms=${cadence.wait_ms == null ? "N/A" : cadence.wait_ms}`,
            reason: cadence.reason,
          };
        }
        const res = runScript(this.script, {
          APPLY: String(process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_APPLY || "0"),
          EXIT_INTEGRITY_SKIP_WHEN_NO_ACTIVE_POSITIONS: String(
            process.env.EXIT_INTEGRITY_SKIP_WHEN_NO_ACTIVE_POSITIONS || "1"
          ),
        });
        return {
          status: res.ok ? ((res.parsed && res.parsed.skipped === true) ? "SKIP" : "PASS") : "FAIL",
          summary: res.parsed && (`status=${res.parsed.status || "N/A"} live_issue_count=${res.parsed.summary && res.parsed.summary.live_issue_count != null ? res.parsed.summary.live_issue_count : "N/A"}`) || "N/A",
          reason: res.parsed && (res.parsed.status || res.parsed.reason) || (!res.ok ? scriptFailureReason(res) : null),
        };
      },
    },
    {
      id: "openclaw_policy_authority",
      kind: "script",
      script: "report-openclaw-policy-authority.js",
      criticality: "HIGH",
      depends_on: ["signal_lineage_health", "binance_exit_integrity_cycle"],
      produces_artifact: "openclaw_policy_authority_latest.json",
      run() {
        const res = runScript(this.script);
        return {
          status: res.ok ? "PASS" : "FAIL",
          summary: res.parsed && (res.parsed.reason || res.parsed.status || "OK") || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.error) || (!res.ok ? scriptFailureReason(res) : null),
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
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? scriptFailureReason(res) : null),
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
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? scriptFailureReason(res) : null),
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
          reason: res.parsed && (res.parsed.reason || (res.parsed.applied ? "APPLIED" : "DRY_RUN")) || (!res.ok ? scriptFailureReason(res) : null),
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
          reason: res.parsed && (res.parsed.reason || res.parsed.verdict || res.parsed.status) || (!res.ok ? scriptFailureReason(res) : null),
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
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? scriptFailureReason(res) : null),
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
          status: res.ok ? "PASS" : (res.timed_out ? "WARN" : "FAIL"),
          summary: res.parsed && (res.parsed.status || res.parsed.reason || (res.parsed.ok === true ? "OK" : null)) || "OK",
          reason: res.parsed && (res.parsed.reason || res.parsed.status) || (!res.ok ? scriptFailureReason(res) : null),
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
      readExitIntegrityCycleGeneratedAtMs,
      resolveExitIntegrityMinIntervalMs,
      shouldRunExitIntegrityCycle,
      resolveScriptTimeoutMs,
      runNodeScript,
      scriptFailureReason,
    },
  };
}
