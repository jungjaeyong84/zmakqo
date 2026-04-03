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
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { resolveSelfEvolutionRuntimeState } = require("../src/utils/selfEvolutionRuntimeState");
const { deriveDeploymentProbe } = require("../src/utils/bestSelfEvolutionDeploymentProbe");

loadLocalEnv();

const PROVIDER = String(process.env.SELF_EVOLUTION_DEPLOYMENT_PROBE_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const INPUTS = Object.freeze({
  runtime: path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json"),
  signalsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  dropsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json"),
  postApplyProbe: path.join(OPS_DAILY_DIR, "post_apply_signal_probe_latest.json"),
  serverRuntime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  cutoverReadiness: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Deployment Probe",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- provider: ${summary.provider || "N/A"}`,
    `- strategy: ${summary.applied_strategy_id || "N/A"}`,
    `- engine_bundle_loaded: ${summary.engine_bundle_loaded ? "YES" : "NO"}`,
    `- policy_bundle_loaded: ${summary.policy_bundle_loaded ? "YES" : "NO"}`,
    `- market_data_flow_ok: ${summary.market_data_flow_ok ? "YES" : "NO"}`,
    `- feature_snapshot_ready: ${summary.feature_snapshot_ready ? "YES" : "NO"}`,
    `- canonical_decision_ready: ${summary.canonical_decision_ready ? "YES" : "NO"}`,
    `- probe: ${summary.probe_status || "N/A"} / ${summary.probe_reason || "N/A"}`,
  ].join("\n") + "\n";
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
    ...deriveDeploymentProbe({
      manualPasteAck: runtimeData,
      systemSettings: systemSettings && systemSettings.data ? systemSettings.data : null,
      signalsCache: readJsonRawSafe(INPUTS.signalsCache, null),
      dropsCache: readJsonRawSafe(INPUTS.dropsCache, null),
      postApplyProbe: readJsonRawSafe(INPUTS.postApplyProbe, null),
      serverRuntime: readJsonRawSafe(INPUTS.serverRuntime, null),
      cutoverReadiness: readJsonRawSafe(INPUTS.cutoverReadiness, null),
      serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
      provider: PROVIDER,
      flowMaxAgeMinutes: Math.max(30, Number(process.env.SELF_EVOLUTION_MARKET_DATA_FLOW_MAX_AGE_MINUTES || 360)),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_probe.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_probe.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_probe_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_probe_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
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
    console.error("BEST_SELF_EVOLUTION_DEPLOYMENT_PROBE_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
