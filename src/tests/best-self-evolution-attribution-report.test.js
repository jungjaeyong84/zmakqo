"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-attribution");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 21:10:00 KST",
    dataset_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json",
    attribution: {
      summary: {
        drop_top_layer: { key: "QUALITY", count: 12 },
        late_loss_top_market: { key: "DOGEUSDT", count: 5 },
        false_fire_top_market: { key: "ETHUSDT", count: 2 },
        missed_recovery_top_reason: { key: "DROP_WAIT_ONE_BAR_TIMING", count: 4 },
        fallback_cost_top_market: { key: "SOLUSDT", count: 1 },
      },
      drop_attribution: [
        { layer: "QUALITY", market: "DOGEUSDT", reason: "DROP_WAIT_ONE_BAR_TIMING", sample_n: 4, net_pnl_quote: -120, avg_ret_net: -0.01, missed_gain_pct: 0.2, saved_loss_pct: 0.5 },
      ],
      late_loss_attribution: [
        { layer: "TIMING", market: "DOGEUSDT", reason: "LATE", sample_n: 5, net_pnl_quote: -300, avg_ret_net: -0.02, missed_gain_pct: 0.1, saved_loss_pct: 0.7 },
      ],
      false_fire_attribution: [],
      missed_recovery_attribution: [],
      fallback_cost_attribution: [],
    },
  });

  assert.ok(markdown.includes("BEST Self-Evolution Attribution"));
  assert.ok(markdown.includes("drop_top_layer: QUALITY 12"));
  assert.ok(markdown.includes("late_loss_top_market: DOGEUSDT 5"));
  assert.ok(markdown.includes("QUALITY/DOGEUSDT/DROP_WAIT_ONE_BAR_TIMING"));

  console.log("BEST_SELF_EVOLUTION_ATTRIBUTION_REPORT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_ATTRIBUTION_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
