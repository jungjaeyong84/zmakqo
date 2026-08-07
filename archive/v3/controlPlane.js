"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normText(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function artifactMap(baseDir = OPS_DAILY_DIR) {
  return {
    bootstrap: safeReadJson(path.join(baseDir, "v3_paper_bootstrap_latest.json")),
    lane: safeReadJson(path.join(baseDir, "v3_paper_lane_latest.json")),
    entry: safeReadJson(path.join(baseDir, "v3_paper_entry_ledger_latest.json")),
    exit: safeReadJson(path.join(baseDir, "v3_paper_exit_ledger_latest.json")),
    performance: safeReadJson(path.join(baseDir, "v3_paper_performance_latest.json")),
    validation: safeReadJson(path.join(baseDir, "v3_paper_validation_latest.json")),
    learning: safeReadJson(path.join(baseDir, "v3_openclaw_learning_state_latest.json")),
  };
}

function buildV3ControlStatus({ artifacts = artifactMap() } = {}) {
  const bootstrap = artifacts.bootstrap || {};
  const retained = bootstrap.retained_metrics && typeof bootstrap.retained_metrics === "object"
    ? bootstrap.retained_metrics
    : bootstrap.retained_summary && typeof bootstrap.retained_summary === "object"
      ? bootstrap.retained_summary
      : {};
  const lane = artifacts.lane || {};
  const entry = artifacts.entry || {};
  const exit = artifacts.exit || {};
  const performance = artifacts.performance || {};
  const validation = artifacts.validation || {};
  const learning = artifacts.learning || {};

  const learningEnabled = learning.learning_enabled === true;
  const shadowObservationReady = learning.shadow_observation_ready === true;
  const shadowEvaluationReady = learning.shadow_evaluation_ready === true
    || (learning.shadow_evaluation_ready == null && learning.shadow_ready === true);
  const promotionReady = learning.promotion_ready === true;

  return {
    ok: true,
    service: "DONBEOLJA_V3_LOCAL_CONTROL",
    generated_at: new Date().toISOString(),
    learning_scope: normText(learning.learning_scope) || "V3_PAPER_ONLY",
    strategy_family: normText(learning.strategy_family) || "OPENCLAW_V3_PAPER",
    source_lane: normText(learning.source_lane) || "V3_LOCAL_PAPER",
    status: normText(learning.status) || "HOLD",
    reason: normText(learning.reason) || "V3_STATE_UNAVAILABLE",
    learning_enabled: learningEnabled,
    shadow_observation_ready: shadowObservationReady,
    shadow_evaluation_ready: shadowEvaluationReady,
    shadow_ready: shadowEvaluationReady,
    promotion_ready: promotionReady,
    live_serving_allowed: learning.live_serving_allowed === true,
    v1_learning_blocked: learning.v1_learning_blocked === true,
    v2_learning_blocked: learning.v2_learning_blocked === true,
    bootstrap: {
      recommendation: normText(bootstrap.recommendation) || "UNKNOWN",
      retained_sample_n: toNum(retained.sample_n != null ? retained.sample_n : bootstrap.retained_sample_n),
      retained_win_rate_pct: toNum(retained.win_rate_pct),
      retained_profit_factor: toNum(retained.profit_factor),
      retained_expectancy_usdt: toNum(retained.expectancy_usdt),
      retained_net_pnl_usdt: toNum(retained.net_pnl_usdt),
      active_allowlist_n: asArray(bootstrap.active_allowlist || bootstrap.active_profiles || bootstrap.retained_top_cohorts).length,
      seed_mix: bootstrap.seed_mix || null,
    },
    lane: {
      source_signal_n: toNum(lane.source_signal_n),
      active_signal_n: toNum(lane.active_signal_n),
      blocked_signal_n: toNum(lane.blocked_signal_n),
      active_signals: asArray(lane.active_signals || lane.allowed_signals).slice(0, 5),
    },
    entry_ledger: {
      source_queue_n: toNum(entry.source_queue_n),
      existing_entry_n: toNum(entry.existing_entry_n),
      appended_entry_n: toNum(entry.appended_entry_n),
      open_position_n: toNum(entry.open_position_n),
      open_entries: asArray(entry.open_entries).slice(0, 5),
    },
    exit_ledger: {
      eligible_open_entry_n: toNum(exit.eligible_open_entry_n),
      hydrated_open_entry_n: toNum(exit.hydrated_open_entry_n),
      appended_exit_n: toNum(exit.appended_exit_n),
      remaining_open_position_n: toNum(exit.remaining_open_position_n),
      recent_exits: asArray(exit.recent_exits).slice(0, 5),
    },
    performance: {
      open_position_n: toNum(performance.open_position_n),
      today_closed_trade_n: toNum(performance.today_closed_trade_n),
      today_win_rate_pct: toNum(
        performance.today_win_rate_pct != null
          ? performance.today_win_rate_pct
          : performance.today_metrics_r && performance.today_metrics_r.win_rate_pct
      ),
      source_entry_n: toNum(performance.source_entry_n),
      source_exit_n: toNum(performance.source_exit_n),
    },
    validation: {
      readiness: normText(validation.readiness) || "UNKNOWN",
      bootstrap_gate: validation.bootstrap_gate || null,
      seed_mix_gate: validation.seed_mix_gate || null,
      paper_gate: validation.paper_gate || null,
      summary: validation.summary || validation.summary_lines || null,
    },
    learning_seed_mix: learning.seed_mix_metrics || null,
  };
}

function loadV3ControlStatus() {
  return buildV3ControlStatus({ artifacts: artifactMap() });
}

module.exports = {
  loadV3ControlStatus,
  __test: {
    artifactMap,
    buildV3ControlStatus,
  },
};
