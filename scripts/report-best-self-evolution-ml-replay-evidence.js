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
const { buildMlReplayEvidence } = require("../src/utils/mlReplayEvidence");

const INPUTS = Object.freeze({
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Replay Evidence",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- replay_ready: ${summary.replay_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- best_candidate_id: ${summary.best_candidate_id || "N/A"} / display=${summary.best_display_candidate_id || "N/A"}`,
    `- best_validation_verdict: ${summary.best_validation_verdict || "N/A"}`,
    `- best_objective_delta: ${summary.best_objective_delta != null ? summary.best_objective_delta : "N/A"}`,
    `- dominant_issue: ${summary.dominant_issue || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlReplayEvidence({
    replay: readJsonRawSafe(INPUTS.replay, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_replay_evidence`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    dominant_issue: summary.dominant_issue,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_REPLAY_EVIDENCE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
