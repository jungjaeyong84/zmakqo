"use strict";

const assert = require("assert");
const { buildFeePnlKpiAuthority } = require("../utils/feePnlKpiAuthority");

(() => {
  const summary = buildFeePnlKpiAuthority({
    dataset: {
      dataset: {
        source_collection: "UNIFIED_EVENT_TIMELINE",
        immutable_source: true,
        source_manifest: {
          strict_event_truth_only: true,
        },
        rows: [
          {
            market: "BTCUSDT",
            feature_snapshot: { fee_value: 1, funding_paid: 0.2, notional_krw: 1000 },
            label_snapshot: { is_executed: true, is_realized: true, realized_pnl_quote: 10, realized_ret_net: 0.01 },
          },
          {
            market: "BTCUSDT",
            feature_snapshot: { fee_value: 1.5, funding_paid: 0.3, notional_krw: 1200 },
            label_snapshot: { is_executed: true, is_realized: true, realized_pnl_quote: -4, realized_ret_net: -0.004 },
          },
          {
            market: "DOGEUSDT",
            feature_snapshot: { fee_value: 2, funding_paid: 0, notional_krw: 800 },
            label_snapshot: { is_executed: true, is_realized: true, realized_pnl_quote: 1, realized_ret_net: 0.001 },
          },
        ],
      },
    },
    minRealizedN: 2,
    softCostToAbsRealizedRatio: 0.2,
    hardCostToAbsRealizedRatio: 0.5,
  });

  assert.strictEqual(summary.status, "FEE_PNL_KPI_AUTHORITY_READY");
  assert.strictEqual(summary.kpi_ready, true);
  assert.strictEqual(summary.immutable_event_truth_only, true);
  assert.strictEqual(summary.strict_event_truth_only, true);
  assert.strictEqual(summary.realized_n, 3);
  assert.ok(summary.cost_to_abs_realized_ratio > 0);
  assert.ok(summary.worst_fee_drag_markets.length >= 1);
  assert.ok(summary.fee_pnl_hard_penalty_markets.includes("DOGEUSDT"));
})();

console.log("FEE_PNL_KPI_AUTHORITY_TEST_OK");
