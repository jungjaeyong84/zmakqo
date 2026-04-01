#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { deriveServerSignalRuntime } = require("../src/utils/serverSignalRuntime");

loadLocalEnv();

const PROVIDER = String(process.env.SERVER_SIGNAL_RUNTIME_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
const WATCHDOG_PATH = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const status = report.current_status || {};
  const lines = [
    "# Server Signal Runtime",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    `- runtime_status: ${summary.runtime_status || "N/A"}`,
    `- source_mode: ${summary.canonical_engine_source_mode || "N/A"}`,
    `- exec_tf: ${summary.exec_tf || "N/A"}`,
    `- market_count: ${summary.market_count != null ? summary.market_count : "N/A"}`,
    `- scheduler: ${summary.scheduler_status || "N/A"} / watchdog=${summary.watchdog_verdict || "N/A"}`,
    `- pine_shadow_transition: ${summary.pine_shadow_transition_status || "N/A"} / ${summary.pine_shadow_transition_progress_pct != null ? `${summary.pine_shadow_transition_progress_pct}%` : "N/A"}`,
    "",
    "## Current Status",
    `- scheduler_enabled: ${status.scheduler_enabled ? "YES" : "NO"} / interval=${status.scheduler_interval_sec != null ? status.scheduler_interval_sec : "N/A"}s`,
    `- canonical_engine_shadow_enabled: ${status.canonical_engine_shadow_enabled ? "YES" : "NO"}`,
    `- execution_shadow_policy: ${status.execution_shadow_policy || "N/A"}`,
    `- pine_ingress_shadow_only: ${status.pine_ingress_shadow_only ? "YES" : "NO"}`,
    `- tf_allowlist: ${Array.isArray(status.tf_allowlist) && status.tf_allowlist.length ? status.tf_allowlist.join(", ") : "N/A"}`,
    `- markets_preview: ${Array.isArray(status.markets_preview) && status.markets_preview.length ? status.markets_preview.join(", ") : "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const [systemRes, exchangeSettings] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getExchangeSettingsForProvider(PROVIDER, 0),
  ]);
  const report = deriveServerSignalRuntime({
    provider: PROVIDER,
    systemSettings: systemRes && systemRes.data ? systemRes.data : {},
    exchangeSettings: exchangeSettings || {},
    watchdog: readJsonRawSafe(WATCHDOG_PATH, null),
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      provider: PROVIDER,
      watchdog: WATCHDOG_PATH,
    },
    ...report,
  };

  const datedJson = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_runtime.json`);
  const datedMd = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_runtime.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.md");
  writeJson(datedJson, payload);
  writeText(datedMd, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_markdown: latestMd }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SERVER_SIGNAL_RUNTIME_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
