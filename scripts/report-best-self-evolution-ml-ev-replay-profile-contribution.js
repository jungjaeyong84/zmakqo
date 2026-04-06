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
const { buildMlEvReplayProfileContribution } = require("../src/utils/mlEvReplayProfileContribution");

const INPUTS = Object.freeze({
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  dataset: path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json"),
  mlEvReplayMarketContribution: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_market_contribution_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML EV Replay Profile Contribution",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"} / evidence=${summary.evidence_status || "N/A"}`,
    `- candidate: ${summary.candidate_id || "N/A"} / display=${summary.display_candidate_id || "N/A"}`,
    `- top_return_drag: ${summary.top_return_drag_market || "N/A"} / profile=${summary.top_return_drag_profile || "N/A"} / rows_delta=${summary.top_return_drag_profile_rows_delta ?? "N/A"} / avg_ret_net_delta=${summary.top_return_drag_profile_avg_ret_net_delta ?? "N/A"}`,
    `- top_mixed: ${summary.top_mixed_market || "N/A"} / profile=${summary.top_mixed_profile || "N/A"} / rows_delta=${summary.top_mixed_profile_rows_delta ?? "N/A"} / avg_ret_net_delta=${summary.top_mixed_profile_avg_ret_net_delta ?? "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvReplayProfileContribution({
    candidates: readJsonRawSafe(INPUTS.candidates, null),
    dataset: readJsonRawSafe(INPUTS.dataset, null),
    mlEvReplayMarketContribution: readJsonRawSafe(INPUTS.mlEvReplayMarketContribution, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_replay_profile_contribution`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_profile_contribution_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_profile_contribution_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    top_return_drag_market: summary.top_return_drag_market,
    top_return_drag_profile: summary.top_return_drag_profile,
    top_mixed_market: summary.top_mixed_market,
    top_mixed_profile: summary.top_mixed_profile,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_REPLAY_PROFILE_CONTRIBUTION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
