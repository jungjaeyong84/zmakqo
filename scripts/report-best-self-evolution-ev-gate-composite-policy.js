#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { buildEvGateCompositePolicy } = require("../src/utils/evGateCompositePolicy");

const PROVIDER = String(process.env.EV_GATE_POLICY_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution EV Gate Composite Policy",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- provider: ${summary.provider || "N/A"}`,
    `- policy_basis: ${summary.policy_basis || "N/A"}`,
    `- canonical_policy_version: ${summary.canonical_policy_version || "N/A"} / compatibility=${summary.compatibility_policy_version || "N/A"}`,
    `- threshold_metric: ${summary.threshold_metric || "N/A"}`,
    `- compatibility_drop_reason: ${summary.compatibility_drop_reason || "N/A"}`,
    `- ev_gate_enabled: ${summary.ev_gate_enabled ? "YES" : "NO"}`,
    `- ev_gate_early_enabled: ${summary.ev_gate_early_enabled ? "YES" : "NO"} / core=${summary.ev_gate_core_enabled ? "YES" : "NO"}`,
    `- default_tp0_pct: ${summary.default_tp0_pct != null ? summary.default_tp0_pct : "N/A"} / default_tp0_qty_ratio=${summary.default_tp0_qty_ratio != null ? summary.default_tp0_qty_ratio : "N/A"}`,
    `- default_tp1_pct: ${summary.default_tp1_pct != null ? summary.default_tp1_pct : "N/A"} / default_sl_pct=${summary.default_sl_pct != null ? summary.default_sl_pct : "N/A"}`,
    `- composite thresholds: min=${summary.composite_lb_min_global != null ? summary.composite_lb_min_global : "N/A"} / early=${summary.composite_lb_min_early != null ? summary.composite_lb_min_early : "N/A"} / core=${summary.composite_lb_min_core != null ? summary.composite_lb_min_core : "N/A"} / full=${summary.composite_lb_full != null ? summary.composite_lb_full : "N/A"} / kill=${summary.composite_lb_kill != null ? summary.composite_lb_kill : "N/A"}`,
    `- legacy threshold keys: ${Array.isArray(summary.legacy_threshold_setting_keys) ? summary.legacy_threshold_setting_keys.join(", ") : "N/A"}`,
    `- components: ${Array.isArray(summary.composite_components) ? summary.composite_components.join(", ") : "N/A"}`,
    `- interpretation_notes: ${Array.isArray(summary.interpretation_notes) ? summary.interpretation_notes.join(" | ") : "N/A"}`,
    "",
  ].join("\n");
}

async function main() {
  const nowMeta = nowKstMeta();
  const systemSettings = await getSystemSettingsForProvider(PROVIDER, 0);
  const summary = buildEvGateCompositePolicy({
    provider: PROVIDER,
    systemSettings: systemSettings && systemSettings.data ? systemSettings.data : null,
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      provider: PROVIDER,
      system_settings_source: systemSettings && systemSettings.source ? systemSettings.source : "unknown",
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ev_gate_composite_policy`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_composite_policy_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_composite_policy_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    status: summary.status,
    policy_basis: summary.policy_basis,
    threshold_metric: summary.threshold_metric,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_EV_GATE_COMPOSITE_POLICY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
