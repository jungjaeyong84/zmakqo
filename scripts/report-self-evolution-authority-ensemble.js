#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  deriveAuthorityEnsemble,
  isTimeoutHoldReview,
} = require("../src/utils/selfEvolutionAuthorityEnsemble");

loadLocalEnv();

const MAX_AGE_HOURS = Math.max(12, Number(process.env.SELF_EVOLUTION_AUTHORITY_MAX_AGE_HOURS || 48));

const INPUTS = Object.freeze({
  codex: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"),
  claude: path.join(OPS_DAILY_DIR, "claude_weekly_patch_engine_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  loopMonitor: path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json"),
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
});

function renderMarkdown(report = {}) {
  const lines = [
    "# BEST Self-Evolution Authority Ensemble",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- owner: ${report.owner || "N/A"}`,
    `- authority_mode: ${report.authority_mode || "N/A"}`,
    `- review_unit: ${report.review_unit || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- candidate: ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`,
    `- rollback: ${report.recommended_rollback_file_path || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- confidence: ${report.confidence != null ? report.confidence : "N/A"}`,
    `- degraded_authority: ${report.degraded_authority_enabled ? (report.degraded_authority_applied ? "APPLIED" : (report.degraded_authority_eligible ? "READY" : (report.degraded_authority_reason || "BLOCKED"))) : "DISABLED"}`,
    `- timeout_streak_min: ${report.timeout_streak_min != null ? report.timeout_streak_min : "N/A"}`,
    "",
    "## Reviews",
    `- codex: ${report.codex_review && report.codex_review.status || "N/A"} / ${report.codex_review && report.codex_review.verdict || "N/A"} / unit ${report.codex_review && report.codex_review.review_unit || "N/A"} / ${report.codex_review && (report.codex_review.display_candidate_id || report.codex_review.recommended_candidate_id || report.codex_review.recommended_rollback_file_path) || "N/A"}`,
    `- claude: ${report.claude_review && report.claude_review.status || "N/A"} / ${report.claude_review && report.claude_review.verdict || "N/A"} / unit ${report.claude_review && report.claude_review.review_unit || "N/A"} / ${report.claude_review && (report.claude_review.display_candidate_id || report.claude_review.recommended_candidate_id || report.claude_review.recommended_rollback_file_path) || "N/A"}`,
    "",
    "## Checks",
    ...((report.checks || []).length ? report.checks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Risks",
    ...((report.risks || []).length ? report.risks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Blockers",
    ...((report.blockers || []).length ? report.blockers.map((row) => `- ${row}`) : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function readFreshReview(filePath, maxAgeHours = MAX_AGE_HOURS) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return null;
  try {
    const fs = require("fs");
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return {
      ...(data.raw && typeof data.raw === "object" ? data.raw : data),
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
      age_hours: ageHours,
    };
  } catch (_err) {
    return {
      ...(data.raw && typeof data.raw === "object" ? data.raw : data),
      fresh: false,
      age_hours: null,
    };
  }
}

function resolveReportCycleId({ preferredCycleId = null, deploymentPlan = null, codexReview = null, claudeReview = null, fallbackCycleId = null } = {}) {
  const plan = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};
  const codex = codexReview && typeof codexReview === "object" ? codexReview : {};
  const claude = claudeReview && typeof claudeReview === "object" ? claudeReview : {};
  return String(
    preferredCycleId
    || plan.source_cycle_id
    || plan.cycle_id
    || codex.cycle_id
    || claude.cycle_id
    || fallbackCycleId
    || ""
  ).trim() || null;
}

function listHistoricalReports(pattern) {
  try {
    return fs.readdirSync(OPS_DAILY_DIR)
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => path.join(OPS_DAILY_DIR, name));
  } catch (_err) {
    return [];
  }
}

function deriveTimeoutStreak(filePaths = []) {
  let streak = 0;
  let totalTimeouts = 0;
  for (let i = filePaths.length - 1; i >= 0; i -= 1) {
    const data = readJsonRawSafe(filePaths[i], null);
    if (!data) break;
    if (isTimeoutHoldReview(data)) {
      streak += 1;
      totalTimeouts += 1;
      continue;
    }
    break;
  }
  return {
    streak,
    total_timeouts: totalTimeouts,
  };
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const authorityMode = String(process.env.SELF_EVOLUTION_AUTHORITY_MODE || "CODEX_CLAUDE_ENSEMBLE").trim().toUpperCase() || "CODEX_CLAUDE_ENSEMBLE";
  const codexReview = readFreshReview(INPUTS.codex);
  const claudeReview = readFreshReview(INPUTS.claude);
  const deploymentPlan = readJsonRawSafe(INPUTS.deploymentPlan, null);
  const loopMonitor = readJsonRawSafe(INPUTS.loopMonitor, null);
  const autonomyContract = readJsonRawSafe(INPUTS.autonomyContract, null);
  const objectiveRecoveryGovernor = readJsonRawSafe(INPUTS.objectiveRecoveryGovernor, null);
  const codexHistory = deriveTimeoutStreak(listHistoricalReports(/^\d{4}-\d{2}-\d{2}_\d{4}_codex_weekly_patch_engine\.json$/));
  const claudeHistory = deriveTimeoutStreak(listHistoricalReports(/^\d{4}-\d{2}-\d{2}_\d{4}_claude_weekly_patch_engine\.json$/));
  const timeoutContext = {
    codex_timeout_streak: codexHistory.streak,
    claude_timeout_streak: claudeHistory.streak,
    ensemble_timeout_streak: Math.min(codexHistory.streak || 0, claudeHistory.streak || 0),
  };
  const derived = deriveAuthorityEnsemble({
    codexReview,
    claudeReview,
    authorityMode,
    autonomyContract,
    recoveryGovernor: objectiveRecoveryGovernor,
    deploymentPlan,
    loopMonitor,
    timeoutContext,
  });
  const reportCycleId = resolveReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    deploymentPlan,
    codexReview,
    claudeReview,
    fallbackCycleId: cycleMeta.cycle_id,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    ...derived,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: String(
      (deploymentPlan && (deploymentPlan.source_cycle_id || deploymentPlan.cycle_id))
      || reportCycleId
      || ""
    ).trim() || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    inputs: INPUTS,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_self_evolution_authority.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_self_evolution_authority.md`);
  const latestJsonPath = selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json");
  const latestMdPath = selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
    verdict: report.verdict,
    owner: report.owner,
    authority_mode: report.authority_mode,
  }));
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  __test: {
    INPUTS,
    resolveReportCycleId,
    renderMarkdown,
  },
};
