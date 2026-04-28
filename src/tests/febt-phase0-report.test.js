"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-febt-phase0-baseline");

function run() {
  assert.strictEqual(typeof __test.renderWaitBaselineMarkdown, "function");
  assert.strictEqual(typeof __test.renderOverlapMarkdown, "function");
  assert.strictEqual(typeof __test.renderLatencyMarkdown, "function");
  assert.strictEqual(typeof __test.renderMainMarkdown, "function");

  const report = {
    generated_at_kst: "2026-03-29 12:34:56 KST",
    provider: "BINANCEFUT",
    tf: "15m",
    window: {
      from_utc: "2026-03-22T00:00:00.000Z",
      to_utc: "2026-03-29T00:00:00.000Z",
    },
    legacy_wait_baseline: {
      candidate_signals_n: 42,
      immediate_win_rate: 0.57,
      immediate_avg_ret_net: 0.0123,
      timing_drop_signal_n: 8,
      timing_drop_counterfactual_matured_n: 5,
      saved_loss_pct: 0.31,
      missed_gain_pct: 0.12,
      saved_loss_minus_missed_gain: 0.19,
      timing_drop_avg_horizon_ret_net: -0.02,
      wait_trigger_path_breakdown: [{ value: "PHYSICS_HARD", n: 4 }],
      market_action_breakdown: [{ value: "ALLOW", n: 9 }],
      entry_exec_timing_breakdown: [{ value: "IMMEDIATE", n: 12 }],
    },
    legacy_wait_overlap: {
      compared_n: 13,
      wait_action_breakdown: [{ value: "ALLOW", n: 9 }],
      market_state_action_pairs: [{ wait_action: "WAIT_ONE_BAR", value: "DROP", n: 3 }],
      entry_exec_timing_pairs: [{ wait_action: "ALLOW", value: "IMMEDIATE", n: 9 }],
      ev_policy_source_pairs: [{ wait_action: "ALLOW", value: "DEFAULT", n: 8 }],
    },
    bridge_latency: {
      outcome_n: 10,
      matched_intent_n: 9,
      matched_fill_n: 8,
      duplicate_count: 1,
      stale_count: 0,
      reject_count: 2,
      webhook_to_fill_ms: { n: 8, avg: 350, p50: 300, p95: 700, max: 900 },
      webhook_to_intent_ms: { n: 9, avg: 120, p50: 100, p95: 240, max: 300 },
      intent_to_fill_ms: { n: 8, avg: 220, p50: 180, p95: 500, max: 600 },
      bar_close_to_webhook_ms_proxy: { n: 10, avg: 80, p50: 70, p95: 130, max: 150 },
    },
    artifacts: {
      wait_baseline_md: "/tmp/wait.md",
      overlap_md: "/tmp/overlap.md",
      bridge_md: "/tmp/bridge.md",
    },
  };

  const mainMd = __test.renderMainMarkdown(report);
  const baselineMd = __test.renderWaitBaselineMarkdown(report);
  const overlapMd = __test.renderOverlapMarkdown(report);
  const latencyMd = __test.renderLatencyMarkdown(report);

  assert.ok(mainMd.includes("FEBT Phase 0 Baseline"));
  assert.ok(mainMd.includes("immediate win 57.00%"));
  // 2026-04-28 senior audit Step 12 — drift fix. The renderer now emits
  // two separate `bridge latency(...) webhook->fill` lines (active
  // LONG/SHORT vs all tiers); the original assertion looked for the
  // pre-split contiguous "bridge latency webhook->fill" substring which
  // no longer exists. Assert on the active-LONG/SHORT line directly,
  // which is the canonical contract the renderer guarantees.
  assert.ok(
    mainMd.includes("bridge latency(active LONG/SHORT) webhook->fill"),
    "main markdown must include active LONG/SHORT bridge latency line"
  );
  assert.ok(
    mainMd.includes("bridge latency(all tiers) webhook->fill"),
    "main markdown must include all-tiers bridge latency line"
  );
  assert.ok(baselineMd.includes("saved_loss 31.00%"));
  assert.ok(overlapMd.includes("Wait × Exec Timing"));
  assert.ok(latencyMd.includes("webhook_to_fill_ms"));

  console.log("FEBT_PHASE0_REPORT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FEBT_PHASE0_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
