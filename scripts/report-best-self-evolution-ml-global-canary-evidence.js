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
const { buildMlGlobalCanaryEvidence } = require("../src/utils/mlGlobalCanaryEvidence");

const INPUTS = Object.freeze({
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  replayEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_evidence_latest.json"),
  evReplaySampleGap: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Global Canary Evidence",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- global_canary_ready: ${summary.global_canary_ready ? "YES" : "NO"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- dominant_blocker: ${summary.dominant_blocker || "N/A"}`,
    `- replay_evidence: ${summary.replay_evidence_status || "N/A"} / issue=${summary.replay_dominant_issue || "N/A"}`,
    `- replay_sample_gap: ${summary.replay_sample_gap_status || "N/A"} / required=${summary.replay_sample_required_realized_n ?? "N/A"} / current=${summary.replay_sample_current_effective_realized_n ?? "N/A"} / gap=${summary.replay_sample_gap_n ?? "N/A"} / dimension=${summary.replay_sample_dominant_dimension || "N/A"}`,
    `- blocked/ready/rollback: ${summary.blocked_n ?? "N/A"} / ${summary.ready_n ?? "N/A"} / ${summary.rollback_ready_n ?? "N/A"}`,
    `- shadow_global_drift/golden_global_drift: ${summary.shadow_global_drift ?? "N/A"} / ${summary.golden_global_drift ?? "N/A"}`,
    `- model: ${summary.model_binding_source || "N/A"} / ${summary.model_artifact_id || "N/A"} / ${summary.train_run_id || "N/A"}`,
    `- blocking_reasons: ${Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length ? summary.blocking_reasons.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlGlobalCanaryEvidence({
    canary: readJsonRawSafe(INPUTS.canary, null),
    replayEvidence: readJsonRawSafe(INPUTS.replayEvidence, null),
    evReplaySampleGap: readJsonRawSafe(INPUTS.evReplaySampleGap, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_global_canary_evidence`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_global_canary_evidence_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_global_canary_evidence_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    evidence_status: summary.evidence_status,
    dominant_blocker: summary.dominant_blocker,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_GLOBAL_CANARY_EVIDENCE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
