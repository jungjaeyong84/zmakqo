#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const INPUTS = Object.freeze({
  htfComparison: path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_comparison_latest.json"),
  changeResultAttribution: path.join(OPS_DAILY_DIR, "best_self_evolution_change_result_attribution_latest.json"),
  serverSignalAuthority: path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
});

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function deriveSummary({ htfComparison, changeResultAttribution, serverSignalAuthority, serverSignalQuality } = {}) {
  const htfSummary = htfComparison && typeof htfComparison.summary === "object" ? htfComparison.summary : {};
  const quality = serverSignalQuality || {};
  const authority = serverSignalAuthority || {};
  const changeSummary = changeResultAttribution && typeof changeResultAttribution.summary === "object"
    ? changeResultAttribution.summary
    : {};

  const selectedMode = String(htfSummary.selected_mode || htfComparison && htfComparison.selected_mode || "PINE_PARITY");
  const divergenceBarN = num(htfSummary.divergence_bar_n, 0) || 0;
  const comparedBarN = num(htfSummary.compared_bar_n, 0) || 0;
  const entryN = num(quality.authoritative_entry_signal_24h_n, 0) || 0;
  const intentN = num(quality.order_intent_24h_n, 0) || 0;
  const tradeN = num(quality.trade_24h_n, 0) || 0;
  const authoritativeSignalN = num(authority.authoritative_server_24h_n, 0) || 0;
  const topDivergenceSymbol = String(htfSummary.top_divergence_symbol || "").trim() || null;
  const attributionReady = (num(changeSummary.tracked_change_n, 0) || 0) > 0;

  let recommendation = "HOLD_SELECTED_MODE";
  let reason = "LOW_DIVERGENCE";
  if (!htfComparison || !htfComparison.status) {
    recommendation = "WAIT_COMPARE_DATA";
    reason = "HTF_COMPARISON_MISSING";
  } else if (divergenceBarN <= 0) {
    recommendation = "HOLD_SELECTED_MODE";
    reason = "NO_DIVERGENCE";
  } else if (entryN <= 0 || intentN <= 0 || tradeN <= 0 || authoritativeSignalN <= 0) {
    recommendation = `HOLD_${selectedMode}_NEED_LIVE_SAMPLE`;
    reason = "DIRECT_OUTCOME_SAMPLE_SHORT";
  } else if (!attributionReady) {
    recommendation = `HOLD_${selectedMode}_TRACK_OUTCOME`;
    reason = "MODE_ATTRIBUTION_NOT_READY";
  } else {
    recommendation = `HOLD_${selectedMode}_TRACK_OUTCOME`;
    reason = "OUTCOME_GATED_SELECTION";
  }

  const nextActions = [
    `keep server_native_htf_mode=${selectedMode}`,
    topDivergenceSymbol ? `watch divergence market=${topDivergenceSymbol}` : "watch divergence markets",
    "do not switch HTF mode without direct signal->intent->trade outcome evidence",
  ];

  return {
    status: "SERVER_NATIVE_HTF_MODE_GOVERNOR_ACTIVE",
    selected_mode: selectedMode,
    divergence_bar_n: divergenceBarN,
    compared_bar_n: comparedBarN,
    authoritative_server_24h_n: authoritativeSignalN,
    authoritative_entry_signal_24h_n: entryN,
    order_intent_24h_n: intentN,
    trade_24h_n: tradeN,
    top_divergence_symbol: topDivergenceSymbol,
    attribution_ready: attributionReady,
    change_result_tracked_change_n: num(changeSummary.tracked_change_n, 0) || 0,
    recommendation,
    reason,
    next_actions: nextActions,
  };
}

function renderMarkdown(report = {}) {
  const s = report.summary || {};
  const lines = [
    "# Server Native HTF Mode Governor",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- selected_mode: ${s.selected_mode || "N/A"}`,
    `- divergence/compared: ${s.divergence_bar_n != null ? s.divergence_bar_n : "N/A"} / ${s.compared_bar_n != null ? s.compared_bar_n : "N/A"}`,
    `- server signals/intents/trades: ${s.authoritative_server_24h_n != null ? s.authoritative_server_24h_n : "N/A"} / ${s.order_intent_24h_n != null ? s.order_intent_24h_n : "N/A"} / ${s.trade_24h_n != null ? s.trade_24h_n : "N/A"}`,
    `- top_divergence_symbol: ${s.top_divergence_symbol || "N/A"}`,
    `- recommendation: ${s.recommendation || "N/A"}`,
    `- reason: ${s.reason || "N/A"}`,
    "",
    "## Next Actions",
    ...(Array.isArray(s.next_actions) && s.next_actions.length ? s.next_actions.map((row) => `- ${row}`) : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const htfComparison = readJsonRawSafe(INPUTS.htfComparison, null);
  const changeResultAttribution = readJsonRawSafe(INPUTS.changeResultAttribution, null);
  const serverSignalAuthority = readJsonRawSafe(INPUTS.serverSignalAuthority, null);
  const serverSignalQuality = readJsonRawSafe(INPUTS.serverSignalQuality, null);
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);

  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objectiveSupervisor, htfComparison, changeResultAttribution],
  });

  const summary = deriveSummary({
    htfComparison,
    changeResultAttribution,
    serverSignalAuthority,
    serverSignalQuality,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_native_htf_mode_governor`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_governor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_governor_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_native_htf_mode_governor_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_native_htf_mode_governor_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    recommendation: summary.recommendation,
    selected_mode: summary.selected_mode,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_GOVERNOR_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    deriveSummary,
    renderMarkdown,
  },
};
