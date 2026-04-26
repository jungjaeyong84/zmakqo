#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { auditBinanceExitIntegrity } = require("../src/services/exitIntegrityAudit");
const { sendAlert } = require("../src/utils/alerts");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME_DIR = path.join(REPO_ROOT, "ops", "runtime");
const DEFAULT_ALERT_STATE_FILE = path.join(OPS_RUNTIME_DIR, "v2_active_protection_reconciliation_alert_state.json");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function boolEnv(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveOutputDir(env = process.env) {
  return trimOrNull(env.V2_ACTIVE_PROTECTION_RECONCILIATION_OUTPUT_DIR) || OPS_DAILY_DIR;
}

function resolveAlertStateFile(env = process.env) {
  return trimOrNull(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STATE_FILE) || DEFAULT_ALERT_STATE_FILE;
}

function summarizeActiveProtection(integrity = {}) {
  const markets = Array.isArray(integrity.markets) ? integrity.markets : [];
  const activeMarkets = markets.filter((row) => row && (row.internal_active === true || row.external_active === true));
  const issues = Array.isArray(integrity.issues) ? integrity.issues : [];
  const critIssues = issues.filter((issue) => String(issue && issue.severity || "").toUpperCase() === "CRIT");
  const critSymbols = new Set(critIssues.map((issue) => String(issue && issue.symbol || "").toUpperCase()).filter(Boolean));
  const unprotectedMarkets = activeMarkets.filter((row) => critSymbols.has(String(row && row.symbol || "").toUpperCase()));
  const ok = critIssues.length === 0;
  return {
    generated_at: nowIso(),
    ok,
    reason: ok
      ? "V2_ACTIVE_PROTECTION_RECONCILIATION_PASS"
      : "V2_ACTIVE_PROTECTION_RECONCILIATION_BLOCKED",
    exchange: integrity.exchange || "BINANCEFUT",
    active_position_n: activeMarkets.length,
    protected_position_n: Math.max(0, activeMarkets.length - unprotectedMarkets.length),
    unprotected_position_n: unprotectedMarkets.length,
    issue_count: Number(integrity.issue_count || issues.length || 0),
    critical_issue_n: critIssues.length,
    active_symbols: activeMarkets.map((row) => String(row && row.symbol || "").toUpperCase()).filter(Boolean),
    unprotected_symbols: unprotectedMarkets.map((row) => String(row && row.symbol || "").toUpperCase()).filter(Boolean),
    issue_fingerprint: buildIssueFingerprint({ issues: critIssues }),
    issues: issues.slice(0, 50),
  };
}

function buildIssueFingerprint(summaryOrIntegrity = {}) {
  const sourceIssues = Array.isArray(summaryOrIntegrity.issues) ? summaryOrIntegrity.issues : [];
  const critical = sourceIssues
    .filter((issue) => String(issue && issue.severity || "").toUpperCase() === "CRIT")
    .map((issue) => [
      String(issue && issue.symbol || "").trim().toUpperCase() || "UNKNOWN",
      String(issue && issue.code || issue && issue.reason || "").trim().toUpperCase() || "CRIT",
    ].join(":"))
    .sort();
  return critical.length ? critical.join("|") : null;
}

function resolveBackoffSequenceMs(env = process.env) {
  const raw = trimOrNull(env.V2_ACTIVE_PROTECTION_RECONCILIATION_ALERT_BACKOFF_MS_SEQUENCE)
    || trimOrNull(env.V2_ACTIVE_PROTECTION_RECONCILIATION_ALERT_BACKOFF_MS)
    || "3600000,14400000,43200000";
  const values = String(raw).split(/[|,]/).map((x) => toNumberOrNull(x)).filter((x) => Number.isFinite(x) && x >= 0);
  return values.length ? values : [3600000, 14400000, 43200000];
}

function resolveBackoffMsForAlertCount(alertSentN = 0, env = process.env) {
  const seq = resolveBackoffSequenceMs(env);
  const index = Math.max(0, Math.min(seq.length - 1, Math.max(0, Number(alertSentN || 0) - 1)));
  return seq[index];
}

function resolveActiveProtectionAlertDecision({ summary = {}, previousState = null, env = process.env, nowMs = Date.now() } = {}) {
  const sendPassAlert = boolEnv(env.V2_ACTIVE_PROTECTION_RECONCILIATION_SEND_ALERT, false) === true;
  if (summary.ok === true) {
    return Object.freeze({
      should_send: sendPassAlert,
      reason: sendPassAlert ? "PASS_ALERT_ENABLED" : "ALERT_DISABLED",
      severity: "INFO",
      fingerprint: null,
      backoff_ms: null,
      next_alert_after: null,
    });
  }

  const fingerprint = trimOrNull(summary.issue_fingerprint) || buildIssueFingerprint(summary) || "UNKNOWN_CRITICAL_ISSUE";
  const prev = previousState && typeof previousState === "object" ? previousState : {};
  const sameIssue = trimOrNull(prev.fingerprint) === fingerprint;
  const previousAlertSentN = sameIssue ? Math.max(0, Number(prev.alert_sent_n || 0)) : 0;
  const lastAlertMs = sameIssue ? Date.parse(prev.last_alert_at || "") : NaN;
  if (!sameIssue || previousAlertSentN <= 0 || !Number.isFinite(lastAlertMs)) {
    return Object.freeze({
      should_send: true,
      reason: "CRIT_IMMEDIATE",
      severity: "CRITICAL",
      fingerprint,
      backoff_ms: 0,
      next_alert_after: null,
    });
  }

  const backoffMs = resolveBackoffMsForAlertCount(previousAlertSentN, env);
  const elapsedMs = nowMs - lastAlertMs;
  if (elapsedMs >= backoffMs) {
    return Object.freeze({
      should_send: true,
      reason: "CRIT_BACKOFF_EXPIRED",
      severity: "CRITICAL",
      fingerprint,
      backoff_ms: backoffMs,
      next_alert_after: null,
    });
  }

  return Object.freeze({
    should_send: false,
    reason: "CRIT_BACKOFF_ACTIVE",
    severity: "CRITICAL",
    fingerprint,
    backoff_ms: backoffMs,
    next_alert_after: new Date(lastAlertMs + backoffMs).toISOString(),
  });
}

function buildAlertBody(summary = {}) {
  const lines = [
    `exchange=${summary.exchange || "BINANCEFUT"}`,
    `active=${summary.active_position_n || 0}`,
    `protected=${summary.protected_position_n || 0}/${summary.active_position_n || 0}`,
    `unprotected=${summary.unprotected_position_n || 0}`,
    `critical_issue_n=${summary.critical_issue_n || 0}`,
  ];
  if (Array.isArray(summary.unprotected_symbols) && summary.unprotected_symbols.length) {
    lines.push(`unprotected_symbols=${summary.unprotected_symbols.join("|")}`);
  }
  if (summary.alert_decision && summary.alert_decision.reason) {
    lines.push(`alert_policy=${summary.alert_decision.reason}`);
  }
  if (summary.alert_decision && summary.alert_decision.next_alert_after) {
    lines.push(`next_alert_after=${summary.alert_decision.next_alert_after}`);
  }
  return lines.join("\n");
}

function shouldSendActiveProtectionAlert(summary = {}, env = process.env, previousState = null) {
  const decision = resolveActiveProtectionAlertDecision({ summary, env, previousState });
  return decision.should_send === true;
}

async function maybeSendAlert(summary = {}, env = process.env, sendAlertFn = sendAlert, alertDecision = null) {
  const decision = alertDecision || resolveActiveProtectionAlertDecision({ summary, env });
  if (decision.should_send !== true) {
    return { skipped: true, reason: decision.reason, alert_decision: decision };
  }
  const channel = trimOrNull(env.ALERT_CHANNEL || env.TRADE_ALERT_CHANNEL || env.TELEGRAM_ALERT_CHANNEL);
  if (!channel) return { skipped: true, reason: "ALERT_CHANNEL_MISSING" };
  return sendAlertFn({
    channel,
    title: summary.ok ? "V2 active protection reconciliation PASS" : "V2 active protection reconciliation BLOCKED",
    body: buildAlertBody({ ...summary, alert_decision: decision }),
    severity: decision.severity || (summary.ok ? "INFO" : "CRITICAL"),
  });
}

function buildNextAlertState({ previousState = null, summary = {}, alertDecision = {}, alert = {}, nowMs = Date.now() } = {}) {
  if (summary.ok === true) {
    return Object.freeze({
      status: "CLEAR",
      fingerprint: null,
      last_clear_at: new Date(nowMs).toISOString(),
      last_summary: {
        active_position_n: summary.active_position_n || 0,
        protected_position_n: summary.protected_position_n || 0,
        unprotected_position_n: summary.unprotected_position_n || 0,
      },
    });
  }
  const prev = previousState && typeof previousState === "object" ? previousState : {};
  const sameIssue = trimOrNull(prev.fingerprint) === trimOrNull(alertDecision.fingerprint);
  const sent = alertDecision.should_send === true && !(alert && alert.skipped === true) && !(alert && alert.ok === false);
  const alertSentN = (sameIssue ? Math.max(0, Number(prev.alert_sent_n || 0)) : 0) + (sent ? 1 : 0);
  return Object.freeze({
    status: "BLOCKED",
    fingerprint: trimOrNull(alertDecision.fingerprint) || trimOrNull(summary.issue_fingerprint) || buildIssueFingerprint(summary),
    first_seen_at: sameIssue && trimOrNull(prev.first_seen_at) ? prev.first_seen_at : new Date(nowMs).toISOString(),
    last_seen_at: new Date(nowMs).toISOString(),
    seen_n: (sameIssue ? Math.max(0, Number(prev.seen_n || 0)) : 0) + 1,
    alert_sent_n: alertSentN,
    last_alert_at: sent ? new Date(nowMs).toISOString() : (sameIssue ? trimOrNull(prev.last_alert_at) : null),
    last_alert_reason: sent ? trimOrNull(alertDecision.reason) : (sameIssue ? trimOrNull(prev.last_alert_reason) : null),
    last_alert_skipped_reason: sent ? null : trimOrNull(alert && alert.reason),
    next_alert_after: alertDecision.next_alert_after || null,
    last_summary: {
      active_position_n: summary.active_position_n || 0,
      protected_position_n: summary.protected_position_n || 0,
      unprotected_position_n: summary.unprotected_position_n || 0,
      unprotected_symbols: Array.isArray(summary.unprotected_symbols) ? summary.unprotected_symbols : [],
      critical_issue_n: summary.critical_issue_n || 0,
    },
  });
}

async function run({ auditFn = auditBinanceExitIntegrity, env = process.env, sendAlertFn = sendAlert } = {}) {
  const integrity = await auditFn({ includeFlat: false });
  const outputDir = resolveOutputDir(env);
  const stateFile = resolveAlertStateFile(env);
  const previousAlertState = readJsonSafe(stateFile);
  const baseSummary = summarizeActiveProtection(integrity);
  const alertDecision = resolveActiveProtectionAlertDecision({
    summary: baseSummary,
    previousState: previousAlertState,
    env,
  });
  const summary = {
    ...baseSummary,
    cadence: "HOURLY",
    scheduler_job_id: "v2-active-protection-reconciliation",
    producer_script: "check-v2-active-protection-reconciliation",
    alert_decision: alertDecision,
    alert_state_file: stateFile,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const latestPath = path.join(outputDir, "v2_active_protection_reconciliation_latest.json");
  const datedPath = path.join(outputDir, `${isoDate()}_v2_active_protection_reconciliation.json`);
  writeJson(latestPath, summary);
  writeJson(datedPath, summary);
  const alert = await maybeSendAlert(summary, env, sendAlertFn, alertDecision).catch((error) => ({
    ok: false,
    reason: "ALERT_SEND_FAILED",
    error: error && error.message ? error.message : String(error),
  }));
  const nextAlertState = buildNextAlertState({
    previousState: previousAlertState,
    summary,
    alertDecision,
    alert,
  });
  writeJson(stateFile, nextAlertState);
  return { ...summary, output_json: latestPath, output_dated_json: datedPath, alert, alert_state: nextAlertState };
}

async function main() {
  const result = await run();
  const line = JSON.stringify(result);
  if (result.ok !== true && boolEnv(process.env.V2_ACTIVE_PROTECTION_RECONCILIATION_SOFT, false) !== true) {
    console.error(line);
    process.exitCode = 1;
    return result;
  }
  console.log(line);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_ACTIVE_PROTECTION_RECONCILIATION_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    run,
    __test: {
      summarizeActiveProtection,
      buildIssueFingerprint,
      resolveBackoffSequenceMs,
      resolveBackoffMsForAlertCount,
      resolveActiveProtectionAlertDecision,
      buildNextAlertState,
      buildAlertBody,
      shouldSendActiveProtectionAlert,
      maybeSendAlert,
      resolveOutputDir,
      resolveAlertStateFile,
      boolEnv,
      trimOrNull,
    },
  };
}
