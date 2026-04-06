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
const { buildMlEvReplayMarketContribution } = require("../src/utils/mlEvReplayMarketContribution");

const INPUTS = Object.freeze({
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  mlEvReplayDeltaDiagnostics: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_delta_diagnostics_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML EV Replay Market Contribution",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- candidate: ${summary.candidate_id || "N/A"} / display=${summary.display_candidate_id || "N/A"} / driver=${summary.driver_class || "N/A"}`,
    `- overall: objective=${summary.overall_objective_delta ?? "N/A"} / count=${summary.overall_count_delta ?? "N/A"} / avg_ret_net=${summary.overall_avg_ret_net_delta ?? "N/A"}`,
    `- before_after_avg_ret_net: ${summary.before_avg_ret_net ?? "N/A"} -> ${summary.after_avg_ret_net ?? "N/A"}`,
    `- market_split: total=${summary.market_n ?? "N/A"} / positive=${summary.positive_objective_market_n ?? "N/A"} / flat=${summary.flat_objective_market_n ?? "N/A"} / strict_negative=${summary.strict_negative_objective_market_n ?? "N/A"}`,
    `- drag_split: return_drag=${summary.return_drag_market_n ?? "N/A"} / count_up_return_down=${summary.count_up_return_down_market_n ?? "N/A"} / positive_with_return_drag=${summary.positive_objective_with_return_drag_market_n ?? "N/A"}`,
    `- dominant_drag_pattern: ${summary.dominant_drag_pattern || "N/A"}`,
    `- top_positive_market: ${summary.top_positive_market || "N/A"}:${summary.top_positive_market_delta ?? "N/A"}`,
    `- top_return_drag_market: ${summary.top_return_drag_market || "N/A"}:${summary.top_return_drag_market_avg_ret_net_delta ?? "N/A"}`,
    `- top_mixed_market: ${summary.top_mixed_market || "N/A"} / objective=${summary.top_mixed_market_objective_delta ?? "N/A"} / avg_ret_net=${summary.top_mixed_market_avg_ret_net_delta ?? "N/A"}`,
    `- top_positive_markets: ${Array.isArray(summary.top_positive_markets) && summary.top_positive_markets.length ? summary.top_positive_markets.join(", ") : "none"}`,
    `- top_return_drag_markets: ${Array.isArray(summary.top_return_drag_markets) && summary.top_return_drag_markets.length ? summary.top_return_drag_markets.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlEvReplayMarketContribution({
    replay: readJsonRawSafe(INPUTS.replay, null),
    mlEvReplayDeltaDiagnostics: readJsonRawSafe(INPUTS.mlEvReplayDeltaDiagnostics, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_ev_replay_market_contribution`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_market_contribution_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_market_contribution_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    dominant_drag_pattern: summary.dominant_drag_pattern,
    top_return_drag_market: summary.top_return_drag_market,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EV_REPLAY_MARKET_CONTRIBUTION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
