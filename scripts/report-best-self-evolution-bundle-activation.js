#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  shouldWriteSelfEvolutionLatest,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { deriveBundleActivation } = require("../src/utils/bestSelfEvolutionBundleActivation");
const {
  resolveSelfEvolutionRuntimeState,
  writeSelfEvolutionRuntimeState,
} = require("../src/utils/selfEvolutionRuntimeState");

loadLocalEnv();

const PROVIDER = String(process.env.SELF_EVOLUTION_BUNDLE_ACTIVATION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const INPUTS = Object.freeze({
  runtime: path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json"),
  signalsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  dropsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json"),
  postApplyProbe: path.join(OPS_DAILY_DIR, "post_apply_signal_probe_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Bundle Activation",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- provider: ${summary.provider || "N/A"}`,
    `- strategy: ${summary.applied_strategy_id || "N/A"}`,
    `- engine_bundle_loaded: ${summary.engine_bundle_loaded ? "YES" : "NO"}`,
    `- policy_bundle_loaded: ${summary.policy_bundle_loaded ? "YES" : "NO"}`,
    `- market_data_flow_ok: ${summary.market_data_flow_ok ? "YES" : "NO"}`,
    `- first_decision_seen: ${summary.first_decision_seen ? "YES" : "NO"} / ${summary.first_decision_kind || "N/A"}`,
    `- timeout: ${summary.confirmation_timeout_minutes ?? "N/A"}m / elapsed ${summary.timeout_elapsed ? "YES" : "NO"}`,
    `- activation: ${summary.activation_status || "N/A"} / ${summary.activation_reason || "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtimeState = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const runtimeData = runtimeState && runtimeState.data ? runtimeState.data : readJsonRawSafe(INPUTS.runtime, null);
  const systemSettings = await getSystemSettingsForProvider(PROVIDER, 0);
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.cycle_id,
    inputs: { ...INPUTS },
    ...deriveBundleActivation({
      manualPasteAck: runtimeData,
      systemSettings: systemSettings && systemSettings.data ? systemSettings.data : null,
      signalsCache: readJsonRawSafe(INPUTS.signalsCache, null),
      dropsCache: readJsonRawSafe(INPUTS.dropsCache, null),
      postApplyProbe: readJsonRawSafe(INPUTS.postApplyProbe, null),
      provider: PROVIDER,
      defaultTimeoutMinutes: Math.max(30, Number(process.env.SELF_EVOLUTION_BUNDLE_CONFIRM_TIMEOUT_MINUTES || 180)),
      flowMaxAgeMinutes: Math.max(30, Number(process.env.SELF_EVOLUTION_MARKET_DATA_FLOW_MAX_AGE_MINUTES || 360)),
    }),
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_bundle_activation.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_bundle_activation.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  if (shouldWriteSelfEvolutionLatest()) {
    const summary = report.summary || {};
    await writeSelfEvolutionRuntimeState({
      engine_bundle_loaded: summary.engine_bundle_loaded === true,
      policy_bundle_loaded: summary.policy_bundle_loaded === true,
      market_data_flow_ok: summary.market_data_flow_ok === true,
      first_decision_seen: summary.first_decision_seen === true,
      first_decision_kind: summary.first_decision_kind || null,
      first_decision_id: summary.first_decision_id || null,
      first_decision_created_at: summary.first_decision_created_at || null,
      first_decision_event: summary.first_decision_event || null,
      first_decision_reason: summary.first_decision_reason || null,
      confirmation_timeout_minutes: summary.confirmation_timeout_minutes,
      confirmation_deadline_iso: summary.confirmation_deadline_iso || null,
      confirmation_deadline_kst: summary.confirmation_deadline_kst || null,
      bundle_activation_confirmed: summary.activation_confirmed === true,
      bundle_activation_status: summary.activation_status || null,
      bundle_activation_reason: summary.activation_reason || null,
    }, { updatedBy: "bundle_activation_report" });
  }

  console.log(JSON.stringify({
    ok: true,
    json: jsonPath,
    markdown: mdPath,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_BUNDLE_ACTIVATION_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
