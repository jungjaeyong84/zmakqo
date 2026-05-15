"use strict";

const assert = require("assert");

const { __test } = require("../v3/controlPlane");

(() => {
  const status = __test.buildV3ControlStatus({
    artifacts: {
      bootstrap: {
        recommendation: "KEEP_SHADOW_ONLY",
        seed_mix: {
          live_seed_source_n: 0,
        },
        retained_summary: {
          sample_n: 31,
          win_rate_pct: 54.84,
          profit_factor: 1.62,
          expectancy_usdt: 0.18,
          net_pnl_usdt: 5.8,
        },
        active_allowlist: [1, 2, 3],
      },
      lane: {
        source_signal_n: 5,
        active_signal_n: 1,
        blocked_signal_n: 4,
        allowed_signals: [{ symbol: "SUIUSDT" }],
      },
      entry: {
        source_queue_n: 1,
        open_position_n: 1,
      },
      exit: {
        appended_exit_n: 0,
        remaining_open_position_n: 1,
      },
      performance: {
        open_position_n: 1,
        today_closed_trade_n: 0,
        today_metrics_r: {
          win_rate_pct: 50,
        },
      },
      validation: {
        readiness: "WAIT_BOOTSTRAP_EXPANSION",
        seed_mix_gate: {
          active: false,
          ok: true,
        },
        summary_lines: ["bootstrap retained sample 1건 추가 필요"],
      },
      learning: {
        learning_scope: "V3_PAPER_ONLY",
        strategy_family: "OPENCLAW_V3_PAPER",
        source_lane: "V3_LOCAL_PAPER",
        status: "HOLD",
        reason: "V3_PAPER_BOOTSTRAP_BELOW_TARGET",
        learning_enabled: true,
        shadow_observation_ready: true,
        shadow_evaluation_ready: false,
        shadow_ready: false,
        promotion_ready: false,
        live_serving_allowed: false,
        v1_learning_blocked: true,
        v2_learning_blocked: true,
        seed_mix_metrics: {
          live_seed_source_n: 0,
        },
      },
    },
  });

  assert.strictEqual(status.learning_scope, "V3_PAPER_ONLY");
  assert.strictEqual(status.bootstrap.retained_sample_n, 31);
  assert.strictEqual(status.lane.active_signal_n, 1);
  assert.strictEqual(status.lane.active_signals[0].symbol, "SUIUSDT");
  assert.strictEqual(status.performance.today_closed_trade_n, 0);
  assert.strictEqual(status.performance.today_win_rate_pct, 50);
  assert.strictEqual(status.bootstrap.seed_mix.live_seed_source_n, 0);
  assert.strictEqual(status.learning_seed_mix.live_seed_source_n, 0);
  assert.strictEqual(status.shadow_observation_ready, true);
  assert.strictEqual(status.shadow_evaluation_ready, false);
  assert.strictEqual(status.shadow_ready, false);
  assert.ok(Array.isArray(status.validation.summary));
})();

console.log("v3-control-plane.test.js PASS");
