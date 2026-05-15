"use strict";

function normText(value) {
  const text = String(value == null ? "" : value).trim().toUpperCase();
  return text || null;
}

function buildPlan(action, options = {}) {
  switch (action) {
    case "V3_PAPER_ONLY":
      return {
        env_patch: {
          DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "V3_PAPER_ONLY",
          OPENCLAW_PRIMARY_LEARNING_LANE: "V3_PAPER",
          ML_LIVE_SERVING_ARMED: "0",
          OPENCLAW_AGENT_APPLY_ENABLED: "0",
        },
        rationale: "Pin OpenClaw learning and serving decisions to the local v3 paper lane only.",
      };
    case "REDUCE_DISCOVERY_EXPOSURE":
      return {
        env_patch: {
          DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: String(options.max_position_count || 1),
          DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: String(options.max_trades_per_day || 2),
          DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: String(options.daily_loss_halt_quote || 3),
        },
        rationale: "Tighten discovery canary exposure without changing strategy logic.",
      };
    case "PAUSE_DISCOVERY":
      return {
        env_patch: {
          DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "0",
          DONBEOLJA_V2_CANARY_ONLY: "1",
        },
        rationale: "Stop discovery lane generation while preserving the rest of the control plane.",
      };
    default:
      return null;
  }
}

function planOperatorSafeModeAction({ action, options = null, confirm = false } = {}) {
  const normalizedAction = normText(action);
  const plan = buildPlan(normalizedAction, options && typeof options === "object" ? options : {});
  if (!plan) {
    return {
      ok: false,
      reason: "OPERATOR_SAFE_MODE_ACTION_UNSUPPORTED",
      action: normalizedAction,
      applied: false,
      blockers: ["UNSUPPORTED_ACTION"],
    };
  }
  return {
    ok: true,
    reason: confirm ? "OPERATOR_SAFE_MODE_PLAN_CONFIRMED" : "OPERATOR_SAFE_MODE_PLAN_ONLY",
    action: normalizedAction,
    applied: false,
    plan_only: true,
    confirm_required: true,
    env_patch: plan.env_patch,
    rationale: plan.rationale,
    blockers: [],
  };
}

module.exports = {
  planOperatorSafeModeAction,
  __test: {
    planOperatorSafeModeAction,
  },
};
