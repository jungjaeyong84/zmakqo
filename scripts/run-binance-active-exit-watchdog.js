#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { runBinanceActiveExitWatchdog } = require("../src/services/binanceActiveExitWatchdog");
const { sendAlert } = require("../src/utils/alerts");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function envBool(value, fallback = false) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Binance Active Exit Watchdog");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- exchange: ${report.exchange || "N/A"}`);
  lines.push(`- apply: ${report.apply === true ? "YES" : "NO"}`);
  lines.push(`- status: ${report.status || "UNKNOWN"}`);
  lines.push(`- active_symbol_n: ${report.active_symbol_n ?? "N/A"}`);
  lines.push(`- target_symbol_n: ${report.target_symbol_n ?? "N/A"}`);
  lines.push(`- issue_symbol_n: ${report.issue_symbol_n ?? "N/A"}`);
  lines.push(`- repaired_symbol_n: ${report.repaired_symbol_n ?? "N/A"}`);
  lines.push("");
  lines.push("## Actionable Rows");
  if (!Array.isArray(report.actionable_rows) || !report.actionable_rows.length) {
    lines.push("- none");
  } else {
    for (const row of report.actionable_rows.slice(0, 50)) {
      lines.push(`- ${row.symbol} | stage=${row.stage} | issues=${(row.actionable_issue_codes || []).join(", ")} | stop=${row.actual_stop_price ?? "N/A"} | floor=${row.expected_floor_stop_price ?? "N/A"} | tp_ratio=${row.actual_tp_qty_ratio ?? "N/A"} expected=${row.expected_tp1_remaining_ratio ?? "N/A"}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function buildIssueSignature(report = {}) {
  const rows = Array.isArray(report.actionable_rows) ? report.actionable_rows : [];
  if (!rows.length) return "NONE";
  return rows
    .slice()
    .sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")))
    .map((row) => `${row.symbol}:${row.stage}:${(row.actionable_issue_codes || []).join(",")}`)
    .join("|");
}

async function emitWatchdogAlertIfNeeded(report = {}) {
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const runtimeDir = path.join(process.cwd(), "ops", "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const statePath = path.join(runtimeDir, "binance_active_exit_watchdog_alert_state.json");
  const prev = readJsonSafe(statePath, {}) || {};
  const nextSignature = buildIssueSignature(report);
  const prevSignature = String(prev.issue_signature || "NONE");
  const nextCount = Number(report.issue_symbol_n || 0);
  const prevCount = Number(prev.issue_symbol_n || 0);
  const hadIssues = prevCount > 0 && prevSignature !== "NONE";
  const hasIssues = nextCount > 0 && nextSignature !== "NONE";

  let alert = null;
  if (hasIssues && nextSignature !== prevSignature) {
    alert = {
      severity: "WARN",
      title: "Binance active exit watchdog issue",
      body: [
        `issue_symbol_n: ${nextCount}`,
        `symbols: ${(report.issue_symbols || []).join(", ") || "NONE"}`,
        ...((report.actionable_rows || []).slice(0, 10).map((row) => `${row.symbol} ${row.stage} ${(row.actionable_issue_codes || []).join(",")}`)),
      ].join("\n"),
    };
  } else if (!hasIssues && hadIssues) {
    alert = {
      severity: "PASS",
      title: "Binance active exit watchdog recovered",
      body: [
        `prev_issue_symbol_n: ${prevCount}`,
        `prev_symbols: ${(prev.issue_symbols || []).join(", ") || "NONE"}`,
        "current_issue_symbol_n: 0",
      ].join("\n"),
    };
  }

  let alertResult = { ok: false, skipped: true, reason: "NO_STATE_CHANGE" };
  if (alert) {
    alertResult = await sendAlert({
      channel,
      title: alert.title,
      body: alert.body,
      severity: alert.severity,
    }).catch((error) => ({
      ok: false,
      error: error && error.message ? error.message : String(error),
    }));
  }

  fs.writeFileSync(statePath, `${JSON.stringify({
    updated_at: new Date().toISOString(),
    issue_symbol_n: nextCount,
    issue_symbols: Array.isArray(report.issue_symbols) ? report.issue_symbols : [],
    issue_signature: nextSignature,
    alert_sent: alert ? alertResult.ok === true : false,
  }, null, 2)}\n`, "utf8");
  return alertResult;
}

async function main() {
  const apply = envBool(process.env.APPLY, false);
  const report = await runBinanceActiveExitWatchdog({
    exchange: process.env.EXCHANGE || "BINANCEFUT",
    apply,
    maxRepairCount: Number(process.env.ACTIVE_EXIT_WATCHDOG_MAX_REPAIR_COUNT || 10),
  });
  const outDir = path.join(process.cwd(), "ops", "daily");
  ensureDir(outDir);
  const latestJson = path.join(outDir, "binance_active_exit_watchdog_latest.json");
  const latestMd = path.join(outDir, "binance_active_exit_watchdog_latest.md");
  const datedJson = path.join(outDir, `${isoDate()}_binance_active_exit_watchdog.json`);
  const payload = {
    ...report,
    generated_at: new Date().toISOString(),
  };
  payload.alert = await emitWatchdogAlertIfNeeded(payload);
  fs.writeFileSync(latestJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${buildMarkdown(payload)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: report.ok === true,
    status: report.status || "UNKNOWN",
    issue_symbol_n: report.issue_symbol_n || 0,
    repaired_symbol_n: report.repaired_symbol_n || 0,
    issue_symbols: report.issue_symbols || [],
    alert_ok: payload.alert && payload.alert.ok === true,
    output_json: latestJson,
    output_md: latestMd,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("RUN_BINANCE_ACTIVE_EXIT_WATCHDOG_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
