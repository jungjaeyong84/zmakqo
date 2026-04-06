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
const { buildMlReplayUnblockProjection } = require("../src/utils/mlReplayUnblockProjection");

const INPUTS = Object.freeze({
  replayEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.json"),
  evReplaySampleGap: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Replay Unblock Projection",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- sample_gap_active: ${summary.sample_gap_active ? "YES" : "NO"} / gap=${summary.governance_effective_gap_n ?? "N/A"}`,
    `- current_replay: ${summary.current_replay_evidence_status || "N/A"} / issue=${summary.current_replay_dominant_issue || "N/A"} / delta=${summary.current_best_objective_delta ?? "N/A"}`,
    `- projected_replay_ready_if_sample_gap_closed: ${summary.projected_replay_ready_if_sample_gap_closed ? "YES" : "NO"}`,
    `- projected_residual_issue_after_sample_gap_closed: ${summary.projected_residual_issue_after_sample_gap_closed || "N/A"}`,
    `- projected_residual_blocking_reasons: ${Array.isArray(summary.projected_residual_blocking_reasons) && summary.projected_residual_blocking_reasons.length ? summary.projected_residual_blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlReplayUnblockProjection({
    replayEvidence: readJsonRawSafe(INPUTS.replayEvidence, null),
    evReplaySampleGap: readJsonRawSafe(INPUTS.evReplaySampleGap, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_replay_unblock_projection`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_unblock_projection_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_unblock_projection_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    projected_replay_ready_if_sample_gap_closed: summary.projected_replay_ready_if_sample_gap_closed,
    projected_residual_issue_after_sample_gap_closed: summary.projected_residual_issue_after_sample_gap_closed,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_REPLAY_UNBLOCK_PROJECTION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
