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
const { deriveObjectiveRecoveryEffect } = require("../src/utils/objectiveRecoveryEffect");

loadLocalEnv();

const INPUTS = Object.freeze({
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objective: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json"),
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  retrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
});

function signed(value, digits = 4) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Objective Recovery Effect",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- tracking_status: ${summary.tracking_status || "N/A"}`,
    `- tracking_reason: ${summary.tracking_reason || "N/A"}`,
    `- target: ${summary.display_candidate_id || summary.target_candidate_id || "N/A"}`,
    `- objective score/delta/projected: ${signed(summary.current_objective_score)} / ${signed(summary.target_candidate_objective_delta)} / ${signed(summary.projected_objective_score)}`,
    `- gap close: ${signed(summary.gap_closed)} / ${pct(summary.gap_closure_rate)}`,
    `- projected win/ret: ${pct(summary.projected_win_rate)} / ${signed(summary.projected_avg_ret_net)}`,
    `- dominant market/match: ${summary.dominant_negative_market || "N/A"} / ${summary.target_matches_dominant_negative_market ? "YES" : "NO"}`,
    `- best ready/best replay: ${(summary.best_ready_display_candidate_id || summary.best_ready_candidate_id || "N/A")} ${signed(summary.best_ready_candidate_objective_delta)} / ${(summary.best_replay_display_candidate_id || summary.best_replay_candidate_id || "N/A")} ${signed(summary.best_replay_objective_delta)}`,
    `- higher delta unready: ${summary.higher_delta_candidate_available ? `${summary.higher_delta_display_candidate_id || summary.higher_delta_candidate_id} ${signed(summary.higher_delta_candidate_objective_delta)} / ${summary.higher_delta_candidate_hold_reason || "N/A"}` : "none"}`,
    `- monthly failed checks/top drop: ${Array.isArray(summary.retrospective_monthly_failed_checks) && summary.retrospective_monthly_failed_checks.length ? summary.retrospective_monthly_failed_checks.join("|") : "none"} / ${summary.retrospective_monthly_top_drop_reason || "N/A"}`,
    "",
    "## Next Actions",
    ...(Array.isArray(summary.next_actions) && summary.next_actions.length ? summary.next_actions.map((line) => `- ${line}`) : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const autonomyContract = readJsonRawSafe(INPUTS.autonomyContract, null);
  const objective = readJsonRawSafe(INPUTS.objective, null);
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);
  const objectiveRecoveryGovernor = readJsonRawSafe(INPUTS.objectiveRecoveryGovernor, null);
  const candidates = readJsonRawSafe(INPUTS.candidates, null);
  const replay = readJsonRawSafe(INPUTS.replay, null);
  const retrospective = readJsonRawSafe(INPUTS.retrospective, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objectiveRecoveryGovernor, objectiveSupervisor, objective],
  });
  const report = deriveObjectiveRecoveryEffect({
    autonomyContract,
    objective,
    objectiveSupervisor,
    objectiveRecoveryGovernor,
    candidates,
    replay,
    retrospective,
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    ...report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective_recovery_effect.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective_recovery_effect.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("objective_recovery_effect_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("objective_recovery_effect_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson && selfEvolutionLatestJson !== latestJsonPath) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd && selfEvolutionLatestMd !== latestMdPath) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_OBJECTIVE_RECOVERY_EFFECT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
