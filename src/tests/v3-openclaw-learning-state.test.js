"use strict";

const assert = require("assert");

const { buildV3OpenClawLearningState } = require("../v3/openclawLearningState");

(() => {
  const state = buildV3OpenClawLearningState({
    bootstrap: {
      retained_sample_n: 31,
      retained_metrics: {
        win_rate_pct: 54.84,
        expectancy_usdt: 0.1892,
        profit_factor: 1.6283,
      },
      target_hit: false,
      recommendation: "KEEP_SHADOW_ONLY",
    },
    performance: {
      open_position_n: 1,
      today_closed_trade_n: 4,
      today_metrics_r: {
        win_rate_pct: 50,
        expectancy: 0.15,
      },
      all_time_metrics_r: {
        sample_n: 12,
        win_rate_pct: 58.33,
        expectancy: 0.21,
        profit_factor: 1.7,
      },
    },
    validation: {
      readiness: "WAIT_PAPER_SAMPLE_ACCUMULATION",
      paper_gate: {
        ok: false,
        sample_ok: false,
        quality_ok: true,
        rolling_ok: true,
        closed_trade_n: 12,
        min_required_n: 30,
        win_rate_pct: 58.33,
        expectancy_r: 0.21,
        min_win_rate_pct: 52,
        min_expectancy_r: 0,
      },
      summary_lines: ["paper closed trade 18건 추가 필요"],
    },
  });

  assert.strictEqual(state.learning_scope, "V3_PAPER_ONLY");
  assert.strictEqual(state.learning_enabled, true);
  assert.strictEqual(state.v1_learning_blocked, true);
  assert.strictEqual(state.v2_learning_blocked, true);
  assert.strictEqual(state.status, "WARN");
  assert.strictEqual(state.reason, "V3_PAPER_SAMPLE_ACCUMULATING");
  assert.strictEqual(state.shadow_observation_ready, true);
  assert.strictEqual(state.shadow_evaluation_ready, false);
  assert.strictEqual(state.shadow_ready, false);
  assert.strictEqual(state.live_serving_allowed, false);
})();

(() => {
  const state = buildV3OpenClawLearningState({
    bootstrap: {
      retained_sample_n: 49,
      retained_metrics: {
        win_rate_pct: 55.1,
        expectancy_usdt: 0.2009,
        profit_factor: 1.64,
      },
      target_hit: true,
      recommendation: "READY_FOR_PARALLEL_PAPER_LANE",
    },
    performance: {
      open_position_n: 0,
      today_closed_trade_n: 2,
      today_metrics_r: {
        win_rate_pct: 50,
        expectancy: 0.1,
      },
      all_time_metrics_r: {
        sample_n: 2,
        win_rate_pct: 50,
        expectancy: 0.1,
        profit_factor: 1.2,
      },
    },
    validation: {
      readiness: "WAIT_BOOTSTRAP_EXPANSION",
      bootstrap_gate: {
        min_required_n: 50,
      },
      summary_lines: ["bootstrap retained sample 1건 추가 필요"],
    },
  });

  assert.strictEqual(state.status, "WARN");
  assert.strictEqual(state.reason, "V3_PAPER_BOOTSTRAP_NEAR_READY");
  assert.strictEqual(state.shadow_observation_ready, true);
  assert.strictEqual(state.shadow_evaluation_ready, false);
  assert.strictEqual(state.shadow_ready, false);
  assert.strictEqual(state.promotion_ready, false);
})();

(() => {
  const state = buildV3OpenClawLearningState({
    bootstrap: {
      retained_sample_n: 55,
      retained_metrics: {
        win_rate_pct: 58.5,
        expectancy_usdt: 0.23,
      },
      target_hit: true,
    },
    performance: {
      all_time_metrics_r: {
        sample_n: 6,
        win_rate_pct: 50,
        expectancy: 0.11,
        profit_factor: 1.3,
      },
    },
    validation: {
      readiness: "WAIT_LIVE_SEED_MIX_EXPANSION",
      seed_mix_gate: {
        active: true,
        ok: false,
        mature: false,
        live_seed_source_n: 5,
        static_seed_source_n: 399,
        effective_static_reference_n: 50,
        effective_live_seed_share_pct: 9.09,
        min_live_seed_share_pct: 10,
        remaining_to_mature_n: 5,
      },
      summary_lines: ["live seed 비중 9.09% / 최소 10%"],
    },
  });

  assert.strictEqual(state.status, "WARN");
  assert.strictEqual(state.reason, "V3_PAPER_LIVE_SEED_MIX_BELOW_TARGET");
  assert.strictEqual(state.shadow_observation_ready, true);
  assert.strictEqual(state.shadow_evaluation_ready, false);
  assert.strictEqual(state.shadow_ready, false);
  assert.strictEqual(state.seed_mix_metrics.live_seed_source_n, 5);
  assert.strictEqual(state.validation_gate.seed_mix_active, true);
  assert.strictEqual(state.validation_gate.seed_mix_ok, false);
})();

(() => {
  const state = buildV3OpenClawLearningState({
    bootstrap: {
      retained_sample_n: 49,
      retained_metrics: {
        win_rate_pct: 55.1,
        expectancy_usdt: 0.2009,
        profit_factor: 1.64,
      },
      target_hit: true,
      recommendation: "READY_FOR_PARALLEL_PAPER_LANE",
    },
    performance: {
      all_time_metrics_r: {
        sample_n: 12,
        win_rate_pct: 50,
        expectancy: -0.05,
        profit_factor: 0.9,
      },
    },
    validation: {
      readiness: "WAIT_BOOTSTRAP_EXPANSION",
      bootstrap_gate: {
        min_required_n: 50,
        live_positive_expectancy: false,
      },
      summary_lines: ["bootstrap live expectancy -0.11R로 양수 아님"],
    },
  });

  assert.strictEqual(state.status, "HOLD");
  assert.strictEqual(state.reason, "V3_PAPER_BOOTSTRAP_BELOW_TARGET");
  assert.strictEqual(state.shadow_observation_ready, false);
  assert.strictEqual(state.shadow_evaluation_ready, false);
})();

console.log("v3-openclaw-learning-state.test.js PASS");
