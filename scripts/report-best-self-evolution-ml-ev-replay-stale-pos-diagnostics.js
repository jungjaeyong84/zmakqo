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
const { buildMlEvReplayStalePosDiagnostics } = require("../src/utils/mlEvReplayStalePosDiagnostics");

const INPUTS = Object.freeze({
  dataset: path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json"),
  mlEvReplayProfileContribution: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_profile_contribution_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML EV Replay Stale-Pos Diagnostics",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"} / evidence=${summary.evidence_status || "N/A"}`,
    `- top_return_drag: ${summary.top_return_drag_market || "N/A"} / ${summary.top_return_drag_profile || "N/A"} / ev_lb=${summary.top_return_drag_avg_ev_lb ?? "N/A"} / delay=${summary.top_return_drag_avg_delay_cost ?? "N/A"} / late=${summary.top_return_drag_avg_late_risk ?? "N/A"} / failure=${summary.top_return_drag_avg_failure_risk ?? "N/A"} / streak=${summary.top_return_drag_avg_same_dir_streak ?? "N/A"}`,
    `- top_mixed: ${summary.top_mixed_market || "N/A"} / ${summary.top_mixed_profile || "N/A"} / ev_lb=${summary.top_mixed_avg_ev_lb ?? "N/A"} / delay=${summary.top_mixed_avg_delay_cost ?? "N/A"} / late=${summary.top_mixed_avg_late_risk ?? "N/A"} / failure=${summary.top_mixed_avg_failure_risk ?? "N/A"} / streak=${summary.top_mixed_avg_same_dir_streak ?? "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvReplayStalePosDiagnostics({
    dataset: readJsonRawSafe(INPUTS.dataset, null),
    mlEvReplayProfileContribution: readJsonRawSafe(INPUTS.mlEvReplayProfileContribution, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_replay_stale_pos_diagnostics`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_stale_pos_diagnostics_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_stale_pos_diagnostics_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    top_return_drag_profile: summary.top_return_drag_profile,
    top_mixed_profile: summary.top_mixed_profile,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_REPLAY_STALE_POS_DIAGNOSTICS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
