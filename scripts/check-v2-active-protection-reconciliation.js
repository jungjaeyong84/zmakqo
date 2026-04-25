#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { auditBinanceExitIntegrity } = require("../src/services/exitIntegrityAudit");
const { sendAlert } = require("../src/utils/alerts");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

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
    issues: issues.slice(0, 50),
  };
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
  return lines.join("\n");
}

function shouldSendActiveProtectionAlert(summary = {}, env = process.env) {
  if (Number(summary.critical_issue_n || 0) > 0 || summary.ok !== true) return true;
  return boolEnv(env.V2_ACTIVE_PROTECTION_RECONCILIATION_SEND_ALERT, false) === true;
}

async function maybeSendAlert(summary = {}, env = process.env, sendAlertFn = sendAlert) {
  if (shouldSendActiveProtectionAlert(summary, env) !== true) {
    return { skipped: true, reason: "ALERT_DISABLED" };
  }
  const channel = trimOrNull(env.ALERT_CHANNEL || env.TRADE_ALERT_CHANNEL || env.TELEGRAM_ALERT_CHANNEL);
  if (!channel) return { skipped: true, reason: "ALERT_CHANNEL_MISSING" };
  return sendAlertFn({
    channel,
    title: summary.ok ? "V2 active protection reconciliation PASS" : "V2 active protection reconciliation BLOCKED",
    body: buildAlertBody(summary),
    severity: summary.ok ? "INFO" : "WARN",
  });
}

async function run({ auditFn = auditBinanceExitIntegrity, env = process.env, sendAlertFn = sendAlert } = {}) {
  const integrity = await auditFn({ includeFlat: false });
  const summary = summarizeActiveProtection(integrity);
  fs.mkdirSync(OPS_DAILY_DIR, { recursive: true });
  const latestPath = path.join(OPS_DAILY_DIR, "v2_active_protection_reconciliation_latest.json");
  const datedPath = path.join(OPS_DAILY_DIR, `${isoDate()}_v2_active_protection_reconciliation.json`);
  fs.writeFileSync(latestPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const alert = await maybeSendAlert(summary, env, sendAlertFn).catch((error) => ({
    ok: false,
    reason: "ALERT_SEND_FAILED",
    error: error && error.message ? error.message : String(error),
  }));
  return { ...summary, output_json: latestPath, output_dated_json: datedPath, alert };
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
      buildAlertBody,
      shouldSendActiveProtectionAlert,
      maybeSendAlert,
      boolEnv,
      trimOrNull,
    },
  };
}
