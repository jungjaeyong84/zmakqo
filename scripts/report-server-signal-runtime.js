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
const { getLiveExecutionPolicyRuntimeConfig } = require("../src/utils/liveExecutionPolicy");

loadLocalEnv();

const PROVIDER = String(process.env.SERVER_SIGNAL_RUNTIME_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
const WATCHDOG_PATH = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json");
const OBJECTIVE_SUPERVISOR_PATH = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const PARITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");

function readCycleId(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const candidates = [
    doc.cycle_id,
    doc.source_cycle_id,
    doc.generation_id,
    doc.raw && doc.raw.cycle_id,
    doc.raw && doc.raw.source_cycle_id,
    doc.raw && doc.raw.generation_id,
    doc.summary && doc.summary.cycle_id,
  ];
  for (const value of candidates) {
    const s = String(value || "").trim();
    if (s) return s;
  }
  return null;
}

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
    `- cycle_id: ${summary.cycle_id || "N/A"}`,
    `- watchdog_generated_at_kst: ${summary.watchdog_generated_at_kst || "N/A"}`,
    `- live_exec_policy: mode=${summary.live_execution_policy_mode || "N/A"} / enabled=${summary.live_execution_policy_enabled ? "YES" : "NO"} / plan_apply=${summary.live_execution_policy_policy_plan_apply ? "YES" : "NO"} / quarantine_hard_block=${summary.live_execution_policy_quarantine_hard_block ? "YES" : "NO"} / quality_hard_block=${summary.live_execution_policy_quality_hard_block ? "YES" : "NO"}`,
    `- ev_report_only_patch: enabled=${summary.ev_gate_tp1_prob_min_by_market_report_only_enabled ? "YES" : "NO"} / report_only_n=${summary.ev_gate_tp1_prob_min_by_market_report_only_n ?? "N/A"} / direct_n=${summary.ev_gate_tp1_prob_min_by_market_n ?? "N/A"}`,
    `- pine_shadow_transition: ${summary.pine_shadow_transition_status || "N/A"} / ${summary.pine_shadow_transition_progress_pct != null ? `${summary.pine_shadow_transition_progress_pct}%` : "N/A"}`,
    "",
    "## Current Status",
    `- scheduler_enabled: ${status.scheduler_enabled ? "YES" : "NO"} / interval=${status.scheduler_interval_sec != null ? status.scheduler_interval_sec : "N/A"}s`,
    `- canonical_engine_shadow_enabled: ${status.canonical_engine_shadow_enabled ? "YES" : "NO"}`,
    `- execution_shadow_policy: ${status.execution_shadow_policy || "N/A"}`,
    `- pine_ingress_shadow_only: ${status.pine_ingress_shadow_only ? "YES" : "NO"}`,
    `- live_execution_policy.profile: ${status.live_execution_policy && status.live_execution_policy.policy_profile ? status.live_execution_policy.policy_profile : "N/A"}`,
    `- live_execution_policy.flags: ${status.live_execution_policy ? `enabled=${status.live_execution_policy.enabled ? "YES" : "NO"}, plan_enabled=${status.live_execution_policy.policy_plan_enabled ? "YES" : "NO"}, plan_apply=${status.live_execution_policy.policy_plan_apply ? "YES" : "NO"}, watch_only_block=${status.live_execution_policy.policy_plan_watch_only_block ? "YES" : "NO"}, hold_block=${status.live_execution_policy.policy_plan_hold_block ? "YES" : "NO"}, mode=${status.live_execution_policy.effective_mode || "N/A"}` : "N/A"}`,
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
  const objectiveSupervisor = readJsonRawSafe(OBJECTIVE_SUPERVISOR_PATH, null);
  const parity = readJsonRawSafe(PARITY_PATH, null);
  const cycleId = readCycleId(parity) || readCycleId(objectiveSupervisor);
  const report = deriveServerSignalRuntime({
    provider: PROVIDER,
    systemSettings: systemRes && systemRes.data ? systemRes.data : {},
    exchangeSettings: exchangeSettings || {},
    watchdog: readJsonRawSafe(WATCHDOG_PATH, null),
    livePolicyConfig: getLiveExecutionPolicyRuntimeConfig(),
    cycleId,
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      provider: PROVIDER,
      watchdog: WATCHDOG_PATH,
      objective_supervisor: OBJECTIVE_SUPERVISOR_PATH,
      parity: PARITY_PATH,
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
