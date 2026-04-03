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
const { deriveServerSignalObservation24h } = require("../src/utils/serverSignalObservation24h");

loadLocalEnv();

const INPUTS = {
  runtime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  quality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  policy_plan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
  remediation_apply: path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_apply_latest.json"),
};

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = report.rows || {};
  const lines = [
    "# Server Signal Observation 24h",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- runtime/readiness/quality: ${summary.runtime_status || "N/A"} / ${summary.readiness_status || "N/A"} / ${summary.quality_status || "N/A"}`,
    `- watchdog/live_policy: ${summary.watchdog_verdict || "N/A"} / ${summary.live_execution_policy_mode || "N/A"}`,
    `- flow_24h: entry=${summary.authoritative_entry_signal_24h_n ?? "N/A"} / intent=${summary.order_intent_24h_n ?? "N/A"} / fill=${summary.fill_24h_n ?? "N/A"} / trade=${summary.trade_24h_n ?? "N/A"}`,
    `- mismatch_24h: parity=${summary.parity_mismatch_n ?? "N/A"} / final_downstream=${summary.final_downstream_mismatch_n ?? "N/A"}`,
    `- policy_plan: ${summary.policy_plan_status || "N/A"} / ${summary.policy_plan_mode || "N/A"} / execution_quality=${summary.execution_quality_status || "N/A"}`,
    `- watch_only_markets: ${Array.isArray(summary.top_other_server_policy_watch_only_markets) && summary.top_other_server_policy_watch_only_markets.length ? summary.top_other_server_policy_watch_only_markets.join(", ") : "none"}`,
    `- drift_remediation: ${summary.drift_remediation_applied ? `applied at ${summary.drift_remediation_last_applied_at_kst || "N/A"}` : "not applied"}`,
    "",
    "## Final Downstream Family Actions",
  ];
  for (const row of Array.isArray(rows.final_downstream_family_actions) ? rows.final_downstream_family_actions : []) {
    lines.push(`- ${row.family}: mismatch=${row.mismatch_n} / action=${row.recommended_action || "N/A"}`);
  }
  lines.push("", "## Other Server Policy Reasons");
  for (const row of Array.isArray(rows.other_server_policy_reason_actions) ? rows.other_server_policy_reason_actions : []) {
    const markets = Array.isArray(row.top_markets) && row.top_markets.length
      ? row.top_markets.map((marketRow) => `${marketRow.market}(${marketRow.mismatch_n})`).join(", ")
      : "none";
    lines.push(`- ${row.reason}: mismatch=${row.mismatch_n} / action=${row.recommended_action || "N/A"} / markets=${markets}`);
  }
  lines.push("", "## Next Actions");
  for (const line of Array.isArray(rows.next_actions) ? rows.next_actions : []) {
    lines.push(`- ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const report = deriveServerSignalObservation24h({
    runtime: readJsonRawSafe(INPUTS.runtime, null),
    quality: readJsonRawSafe(INPUTS.quality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    policyPlan: readJsonRawSafe(INPUTS.policy_plan, null),
    remediationApply: readJsonRawSafe(INPUTS.remediation_apply, null),
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    ...report,
  };

  const datedJson = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_observation_24h.json`);
  const datedMd = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_observation_24h.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "server_signal_observation_24h_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "server_signal_observation_24h_latest.md");
  writeJson(datedJson, payload);
  writeText(datedMd, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_markdown: latestMd,
    status: payload.summary && payload.summary.status || "N/A",
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SERVER_SIGNAL_OBSERVATION_24H_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
