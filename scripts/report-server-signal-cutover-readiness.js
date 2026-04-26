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
  evGateRescue: path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_rescue_latest.json"),
  driftRemediationApply: path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_apply_latest.json"),
  strategyAlignment: path.join(OPS_DAILY_DIR, "strategy_id_alignment_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const status = report.current_status || {};
  const rows = report.rows || {};
  const lines = [
    "# Server Signal Cutover Readiness",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- readiness_status: ${summary.readiness_status || "N/A"}`,
    `- promotion_ready: ${summary.promotion_ready ? "YES" : "NO"}`,
    `- source_mode: ${summary.source_mode || "N/A"}`,
    `- runtime: ${status.runtime_status || "N/A"} / tf=${status.runtime_exec_tf || "N/A"} / markets=${status.runtime_market_count ?? "N/A"}`,
    `- parity: ${status.drift_status || "N/A"} / shadow=${status.shadow_observed_24h_n ?? "N/A"} / mismatch=${status.parity_mismatch_n ?? "N/A"}`,
    `- parity_detail: source=${status.source_parity_mismatch_n ?? "N/A"} / downstream=${status.final_downstream_mismatch_n ?? "N/A"} / ev=${status.ev_policy_mismatch_n ?? "N/A"} / cooldown=${status.cooldown_policy_mismatch_n ?? "N/A"} / strategy_gate=${status.strategy_gate_mismatch_n ?? "N/A"} / other_server_policy=${status.other_server_policy_mismatch_n ?? "N/A"}`,
    `- parity_block_thresholds: ev>=${status.ev_policy_block_min ?? "N/A"} (${status.ev_policy_drift_blocked ? "BLOCK" : "PASS"}) / cooldown>=${status.cooldown_policy_block_min ?? "N/A"} (${status.cooldown_policy_drift_blocked ? "BLOCK" : "PASS"}) / strategy_gate>=${status.strategy_gate_block_min ?? "N/A"} (${status.strategy_gate_drift_blocked ? "BLOCK" : "PASS"}) / other_server_policy>=${status.other_server_policy_block_min ?? "N/A"} (${status.other_server_policy_drift_blocked ? "BLOCK" : "PASS"})`,
    `- ev_remediation: applied=${status.ev_policy_remediation_applied ? "YES" : "NO"} / grace=${status.ev_policy_grace_active ? "YES" : "NO"} / post_samples=${status.ev_policy_post_apply_comparable_n ?? "N/A"} / post_mismatch=${status.ev_policy_post_apply_mismatch_n ?? "N/A"} / min_post=${status.ev_policy_remediation_min_post_samples ?? "N/A"} / effective_block=${status.ev_policy_drift_blocked_effective ? "YES" : "NO"}`,
    `- execution: entry=${status.entry_24h_n ?? "N/A"} / intent=${status.intent_24h_n ?? "N/A"} / fill=${status.fill_24h_n ?? "N/A"} / quality=${status.quality_status || "N/A"}`,
    `- dominant_mismatch_family: ${status.dominant_mismatch_family || "N/A"}`,
    `- recommended_action: ${status.recommended_action || "N/A"}`,
    `- ev_policy_rescue: rate=${status.ev_policy_rescue_rate ?? "N/A"} / top_market=${status.ev_policy_top_rescue_market || "N/A"} / action=${status.ev_policy_recommended_action || "N/A"}`,
    `- blocker_actions: ${Array.isArray(status.blocker_actions) && status.blocker_actions.length ? status.blocker_actions.map((row) => `${row.family}:${row.action}`).join(", ") : "none"}`,
    `- strategy_gate_alignment: historical_only=${status.strategy_gate_historical_only ? "YES" : "NO"} / fresh_status=${status.strategy_gate_freshness_status || "N/A"} / guard=${status.strategy_gate_guard_count ?? "N/A"} / after_live_revision=${status.strategy_gate_after_live_revision_count ?? "N/A"}`,
    `- artifact_coherence: ${status.artifact_coherence_status || "N/A"} / ready=${status.artifact_coherence_ready ? "YES" : "NO"} / stale_required=${status.artifact_stale_required_n ?? "N/A"} / missing_generated=${status.artifact_missing_generated_required_n ?? "N/A"} / skew_ms=${status.artifact_generated_at_skew_ms ?? "N/A"} / cycle=${status.artifact_cycle_alignment_status || "N/A"}`,
    `- canary: ${status.canary_acceptance_ready ? "READY" : "PENDING"} / ${status.canary_acceptance_reason || "N/A"}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join(", ") : "none"}`,
    `- top_mismatch_market: ${Array.isArray(rows.top_mismatch_market) && rows.top_mismatch_market.length ? rows.top_mismatch_market.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
  ];
  if (Array.isArray(rows.artifact_coherence) && rows.artifact_coherence.length) {
    lines.push("", "## Artifact Coherence");
    for (const row of rows.artifact_coherence) {
      lines.push(`- ${row.key} / required=${row.required ? "YES" : "NO"} / fresh=${row.fresh ? "YES" : "NO"} / age_ms=${row.age_ms ?? "N/A"} / generated_at=${row.generated_at_kst || "N/A"} / cycle=${row.cycle_id || "N/A"}`);
    }
  }
  if (Array.isArray(rows.mismatch_examples) && rows.mismatch_examples.length) {
    lines.push("", "## Recent Mismatch Examples");
    for (const row of rows.mismatch_examples) {
      lines.push(`- ${row.market} / ${row.tier} / ${row.regime} / ${row.family} / ${row.reason} / ${row.scope} / ${row.observed_at_kst || "N/A"}`);
    }
  }
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
      evGateRescue: readJsonRawSafe(INPUTS.evGateRescue, null),
      driftRemediationApply: readJsonRawSafe(INPUTS.driftRemediationApply, null),
      strategyAlignment: readJsonRawSafe(INPUTS.strategyAlignment, null),
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

module.exports = { main };
