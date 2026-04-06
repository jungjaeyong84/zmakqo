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
const { buildMlEvReplayDeltaDiagnostics } = require("../src/utils/mlEvReplayDeltaDiagnostics");

const INPUTS = Object.freeze({
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  evReplaySampleGap: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML EV Replay Delta Diagnostics",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- candidate: ${summary.candidate_id || "N/A"} / display=${summary.display_candidate_id || "N/A"} / verdict=${summary.validation_verdict || "N/A"}`,
    `- objective_delta: ${summary.objective_delta ?? "N/A"} / projected=${summary.projected_objective_score ?? "N/A"} / driver=${summary.driver_class || "N/A"}`,
    `- count_delta: ${summary.count_delta ?? "N/A"} / avg_ret_net_delta=${summary.avg_ret_net_delta ?? "N/A"} / before=${summary.before_avg_ret_net ?? "N/A"} / after=${summary.after_avg_ret_net ?? "N/A"}`,
    `- win_rate: before=${summary.before_win_rate ?? "N/A"} / after=${summary.after_win_rate ?? "N/A"}`,
    `- historical_applied: n=${summary.historical_applied_n ?? "N/A"} / gap=${summary.historical_applied_gap_n ?? "N/A"} / role=${summary.historical_applied_gap_role || "N/A"}`,
    `- top_positive_market: ${summary.top_positive_market || "N/A"}:${summary.top_positive_market_delta ?? "N/A"}`,
    `- top_negative_market: ${summary.top_negative_market || "N/A"}:${summary.top_negative_market_delta ?? "N/A"}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvReplayDeltaDiagnostics({
    replay: readJsonRawSafe(INPUTS.replay, null),
    evReplaySampleGap: readJsonRawSafe(INPUTS.evReplaySampleGap, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_replay_delta_diagnostics`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_delta_diagnostics_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_delta_diagnostics_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    driver_class: summary.driver_class,
    historical_applied_gap_role: summary.historical_applied_gap_role,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_REPLAY_DELTA_DIAGNOSTICS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
