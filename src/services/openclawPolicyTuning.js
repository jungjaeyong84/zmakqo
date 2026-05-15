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

function normText(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function buildOpenClawPolicyTuningReport({
  bootstrap = null,
  validation = null,
  learning = null,
  performance = null,
} = {}) {
  const retained = bootstrap && typeof bootstrap.retained_summary === "object"
    ? bootstrap.retained_summary
    : {};
  const learningState = learning && typeof learning === "object" ? learning : {};
  const validationState = validation && typeof validation === "object" ? validation : {};
  const performanceState = performance && typeof performance === "object" ? performance : {};
  const warnings = [];

  if (validationState.readiness === "WAIT_BOOTSTRAP_EXPANSION") warnings.push("BOOTSTRAP_EXPANSION_REQUIRED");
  if (validationState.readiness === "WAIT_LIVE_SEED_MIX_EXPANSION") warnings.push("LIVE_SEED_MIX_EXPANSION_REQUIRED");
  if ((learningState.shadow_evaluation_ready === true || learningState.shadow_ready === true) !== true) {
    warnings.push("SHADOW_NOT_READY");
  }
  if (learningState.promotion_ready !== true) warnings.push("PROMOTION_NOT_READY");

  return {
    ok: true,
    reason: "OPENCLAW_POLICY_TUNING_V3_PAPER_ONLY",
    learning_scope: normText(learningState.learning_scope) || "V3_PAPER_ONLY",
    source_lane: normText(learningState.source_lane) || "V3_LOCAL_PAPER",
    recommendation: normText(bootstrap && bootstrap.recommendation) || "KEEP_SHADOW_ONLY",
    status: normText(learningState.status) || "HOLD",
    blockers: [],
    warnings,
    metrics: {
      retained_sample_n: toNum(retained.sample_n),
      retained_win_rate_pct: toNum(retained.win_rate_pct),
      retained_profit_factor: toNum(retained.profit_factor),
      retained_expectancy_usdt: toNum(retained.expectancy_usdt),
      paper_closed_trade_n: toNum(performanceState.today_closed_trade_n),
      open_position_n: toNum(performanceState.open_position_n),
    },
    validation: validationState,
    learning_state: learningState,
    generated_at: new Date().toISOString(),
  };
}

async function runOpenClawPolicyTuningReport() {
  const bootstrap = safeReadJson(path.join(OPS_DAILY_DIR, "v3_paper_bootstrap_latest.json"));
  const validation = safeReadJson(path.join(OPS_DAILY_DIR, "v3_paper_validation_latest.json"));
  const learning = safeReadJson(path.join(OPS_DAILY_DIR, "v3_openclaw_learning_state_latest.json"));
  const performance = safeReadJson(path.join(OPS_DAILY_DIR, "v3_paper_performance_latest.json"));
  return buildOpenClawPolicyTuningReport({ bootstrap, validation, learning, performance });
}

module.exports = {
  runOpenClawPolicyTuningReport,
  __test: {
    buildOpenClawPolicyTuningReport,
  },
};
