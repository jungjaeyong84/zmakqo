#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { deriveServerSignalDriftRemediationPlan } = require("../src/utils/serverSignalDriftRemediationPlan");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const PROVIDER = String(process.env.SERVER_SIGNAL_DRIFT_PLAN_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
const INPUTS = Object.freeze({
  parity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  evGateRescue: path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_rescue_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rec = report.recommendations || {};
  const patch = rec.settings_patch || {};
  const evRows = Array.isArray(rec.ev_policy_by_market) ? rec.ev_policy_by_market : [];
  const cooldownRows = Array.isArray(rec.cooldown_policy_by_market) ? rec.cooldown_policy_by_market : [];
  const otherRows = Array.isArray(rec.other_server_policy_by_market) ? rec.other_server_policy_by_market : [];
  const lines = [
    "# Server Signal Drift Remediation Plan",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- ev_policy_mismatch_n: ${summary.ev_policy_mismatch_n ?? 0}`,
    `- cooldown_policy_mismatch_n: ${summary.cooldown_policy_mismatch_n ?? 0}`,
    `- other_server_policy_mismatch_n: ${summary.other_server_policy_mismatch_n ?? 0}`,
    `- market_patch_n: ev=${summary.ev_policy_market_patch_n ?? 0} / cooldown=${summary.cooldown_policy_market_patch_n ?? 0}`,
    "",
    "## Settings Patch",
    "```json",
    JSON.stringify(patch, null, 2),
    "```",
    "",
    "## EV Policy By Market",
  ];
  if (!evRows.length) lines.push("- none");
  for (const row of evRows) {
    lines.push(`- ${row.market}: mismatch=${row.mismatch_n} / min ${row.current_min} -> ${row.proposed_min} / delta=${row.delta} / rescue_rate=${row.rescue_rate ?? "N/A"} / changed=${row.changed ? "YES" : "NO"}`);
  }
  lines.push("", "## Cooldown Policy By Market");
  if (!cooldownRows.length) lines.push("- none");
  for (const row of cooldownRows) {
    lines.push(`- ${row.market}: mismatch=${row.mismatch_n} / bars ${row.current_bars} -> ${row.proposed_bars} / delta=${row.delta} / changed=${row.changed ? "YES" : "NO"}`);
  }
  lines.push("", "## Other Server Policy By Market");
  if (!otherRows.length) lines.push("- none");
  for (const row of otherRows) {
    lines.push(`- ${row.market}: mismatch=${row.mismatch_n} / mode=${row.recommended_mode || "MONITOR_ONLY"} / changed=${row.changed ? "YES" : "NO"}`);
  }
  lines.push("", "## Next Actions");
  for (const line of Array.isArray(summary.next_actions) ? summary.next_actions : []) {
    lines.push(`- ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const [systemRes] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
  ]);
  const plan = deriveServerSignalDriftRemediationPlan({
    parity: readJsonRawSafe(INPUTS.parity, null),
    evGateRescue: readJsonRawSafe(INPUTS.evGateRescue, null),
    systemSettings: systemRes && systemRes.data ? systemRes.data : {},
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    inputs: { ...INPUTS },
    ...plan,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_server_signal_drift_remediation_plan.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_server_signal_drift_remediation_plan.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_plan_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_plan_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  console.log(JSON.stringify({
    ok: true,
    status: report.summary && report.summary.status,
    ev_policy_market_patch_n: report.summary && report.summary.ev_policy_market_patch_n,
    cooldown_policy_market_patch_n: report.summary && report.summary.cooldown_policy_market_patch_n,
    latest_json: latestJson,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
