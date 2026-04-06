#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildMlEvProfileReviewTracking } = require("../src/utils/mlEvProfileReviewTracking");

const INPUTS = Object.freeze({
  policyParameterPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
  mlReplayEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.json"),
  mlEvReplayProfileContribution: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_profile_contribution_latest.json"),
  mlEvReplayStalePosDiagnostics: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_stale_pos_diagnostics_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const targets = Array.isArray(summary.targets) ? summary.targets : [];
  return [
    "# BEST Self-Evolution ML EV Profile Review Tracking",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- review_mode: ${summary.review_mode || "N/A"}`,
    `- target_n: ${summary.target_n ?? 0}`,
    `- split_ready: ${summary.split_ready ? "YES" : "NO"} / blocker=${summary.split_blocker || "N/A"}`,
    "",
    "## Targets",
    ...(targets.length
      ? targets.map((row) => `- ${row.role || "N/A"} / ${row.profile || "N/A"} / ${row.driver || "N/A"} / rows_delta=${row.rows_delta ?? "N/A"} / avg_ret_delta=${row.avg_ret_net_delta ?? "N/A"} / ev_lb=${row.avg_ev_lb ?? "N/A"} / delay=${row.avg_delay_cost ?? "N/A"} / late=${row.avg_late_risk ?? "N/A"} / failure=${row.avg_failure_risk ?? "N/A"}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvProfileReviewTracking({
    policyParameterPlan: readJsonRawSafe(INPUTS.policyParameterPlan, null),
    mlReplayEvidence: readJsonRawSafe(INPUTS.mlReplayEvidence, null),
    mlEvReplayProfileContribution: readJsonRawSafe(INPUTS.mlEvReplayProfileContribution, null),
    mlEvReplayStalePosDiagnostics: readJsonRawSafe(INPUTS.mlEvReplayStalePosDiagnostics, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_profile_review_tracking`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_profile_review_tracking_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_profile_review_tracking_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_md: latestMd, review_mode: summary.review_mode, target_n: summary.target_n }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_PROFILE_REVIEW_TRACKING_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

