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
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildCooldownPolicyReview } = require("../src/utils/openclawCooldownPolicyReview");

loadLocalEnv();

const INPUTS = Object.freeze({
  quality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  driftRemediationPlan: path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_plan_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = report.rows || {};
  const lines = [
    "# BEST Self-Evolution COOLDOWN_POLICY Review",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- mismatch_n: ${summary.cooldown_policy_mismatch_n ?? 0}`,
    `- recommended_action: ${summary.recommended_action || "N/A"}`,
    "",
    "## Next Actions",
  ];
  for (const line of Array.isArray(rows.next_actions) ? rows.next_actions : []) {
    lines.push(`- ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildCooldownPolicyReview({
    quality: readJsonRawSafe(INPUTS.quality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    driftRemediationPlan: readJsonRawSafe(INPUTS.driftRemediationPlan, null),
  });

  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: INPUTS,
    ...report,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_cooldown_policy_review.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_cooldown_policy_review.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_cooldown_policy_review_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_cooldown_policy_review_latest.md");

  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("cooldown_policy_review_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("cooldown_policy_review_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: output.cycle_id,
    status: output.summary.status,
    recommended_action: output.summary.recommended_action,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_COOLDOWN_POLICY_REVIEW_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
