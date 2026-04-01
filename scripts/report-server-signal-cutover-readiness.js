#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveServerSignalCutoverReadiness } = require("../src/utils/serverSignalCutoverReadiness");

const INPUTS = Object.freeze({
  authority: path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json"),
  quality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  parity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  runtime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const status = report.current_status || {};
  const lines = [
    "# Server Signal Cutover Readiness",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- readiness_status: ${summary.readiness_status || "N/A"}`,
    `- promotion_ready: ${summary.promotion_ready ? "YES" : "NO"}`,
    `- source_mode: ${summary.source_mode || "N/A"}`,
    `- runtime: ${status.runtime_status || "N/A"} / tf=${status.runtime_exec_tf || "N/A"} / markets=${status.runtime_market_count ?? "N/A"}`,
    `- parity: ${status.drift_status || "N/A"} / shadow=${status.shadow_observed_24h_n ?? "N/A"} / mismatch=${status.parity_mismatch_n ?? "N/A"}`,
    `- parity_detail: source=${status.source_parity_mismatch_n ?? "N/A"} / downstream=${status.final_downstream_mismatch_n ?? "N/A"} / ev=${status.ev_policy_mismatch_n ?? "N/A"} / cooldown=${status.cooldown_policy_mismatch_n ?? "N/A"} / strategy_gate=${status.strategy_gate_mismatch_n ?? "N/A"}`,
    `- execution: entry=${status.entry_24h_n ?? "N/A"} / intent=${status.intent_24h_n ?? "N/A"} / fill=${status.fill_24h_n ?? "N/A"} / quality=${status.quality_status || "N/A"}`,
    `- dominant_mismatch_family: ${status.dominant_mismatch_family || "N/A"}`,
    `- canary: ${status.canary_acceptance_ready ? "READY" : "PENDING"} / ${status.canary_acceptance_reason || "N/A"}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join(", ") : "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: { ...INPUTS },
    ...deriveServerSignalCutoverReadiness({
      authority: readJsonRawSafe(INPUTS.authority, null),
      quality: readJsonRawSafe(INPUTS.quality, null),
      parity: readJsonRawSafe(INPUTS.parity, null),
      runtime: readJsonRawSafe(INPUTS.runtime, null),
      serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
    }),
  };
  const datedJson = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_cutover_readiness.json`);
  const datedMd = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_cutover_readiness.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.md");
  writeJson(datedJson, payload);
  writeText(datedMd, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_markdown: latestMd }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SERVER_SIGNAL_CUTOVER_READINESS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
