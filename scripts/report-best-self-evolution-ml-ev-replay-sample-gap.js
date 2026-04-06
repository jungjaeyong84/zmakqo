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
const { buildMlEvReplaySampleGap } = require("../src/utils/mlEvReplaySampleGap");

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  replayEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML EV Replay Sample Gap",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- sample_gap_ready: ${summary.sample_gap_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- replay_issue: ${summary.replay_dominant_issue || "N/A"} / candidate=${summary.replay_best_candidate_id || "N/A"} / display=${summary.replay_best_display_candidate_id || "N/A"}`,
    `- requirement: ${summary.requirement_source || "N/A"} / required=${summary.required_realized_n ?? "N/A"} / governance_effective=${summary.governance_effective_realized_n ?? "N/A"} / gap=${summary.governance_effective_gap_n ?? "N/A"}`,
    `- historical: realized=${summary.best_historical_realized_match_n ?? "N/A"} / realized_gap=${summary.historical_realized_match_gap_n ?? "N/A"} / applied=${summary.best_historical_applied_n ?? "N/A"} / applied_gap=${summary.historical_applied_gap_n ?? "N/A"}`,
    `- dominant_sample_dimension: ${summary.dominant_sample_dimension || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvReplaySampleGap({
    objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
    replayEvidence: readJsonRawSafe(INPUTS.replayEvidence, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_replay_sample_gap`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    governance_effective_gap_n: summary.governance_effective_gap_n,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_REPLAY_SAMPLE_GAP_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
