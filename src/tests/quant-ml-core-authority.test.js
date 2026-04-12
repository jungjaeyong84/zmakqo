"use strict";

const assert = require("assert");
const { buildQuantMlCoreAuthority } = require("../utils/quantMlCoreAuthority");

(() => {
  const nowMs = Date.parse("2026-04-12T03:00:00.000Z");
  const summary = buildQuantMlCoreAuthority({
    nowMs,
    dataset: {
      dataset: {
        immutable_source: true,
        source_collection: "UNIFIED_EVENT_TIMELINE",
        source_manifest: {
          immutable_source: true,
          strict_event_truth_only: true,
          source_collection: "UNIFIED_EVENT_TIMELINE",
        },
        rows: new Array(40).fill(null).map((_, idx) => ({
          market: idx % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
          tf: "15m",
          close_ms: nowMs - (idx * 24 * 60 * 60 * 1000),
          feature_snapshot: {
            entry_tier: idx % 3 === 0 ? "CORE" : "EARLY",
            position_side: idx % 2 === 0 ? "LONG" : "SHORT",
            fee_value: 0.3,
            funding_paid: 0.05,
            notional_krw: 200,
            openclaw_market_regime_cohort: idx % 2 === 0 ? "TREND" : "REVERSAL",
          },
          label_snapshot: {
            is_executed: true,
            is_realized: true,
            realized_direction: idx < 28 ? "POSITIVE" : "NEGATIVE",
            realized_ret_net: idx < 28 ? 0.01 : -0.003,
            realized_pnl_quote: idx < 28 ? 3 : -1,
            tp0_hit: idx < 30,
            tp0_to_tp1_converted: idx < 18,
          },
        })),
      },
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_STABLE",
        guard_created_to_fill_p95_ms: 1200,
        adverse_slippage_p95_bps: 1.4,
        partial_fill_rate_pct: 8.2,
        top_latency_market: "BTCUSDT",
      },
    },
    feePnlKpi: {
      summary: {
        evidence_status: "FEE_PNL_KPI_PASS",
        cost_to_abs_realized_ratio: 0.18,
        top_fee_drag_market: "ETHUSDT",
      },
    },
    alphaValidation: {
      summary: {
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
        top_positive_market: "BTCUSDT",
        top_negative_market: "ETHUSDT",
        top_positive_strategy: "15m|CORE|LONG",
        top_negative_strategy: "15m|EARLY|SHORT",
        top_positive_regime: "TREND",
        top_negative_regime: "REVERSAL",
        periods: {
          DAYS_7: { evidence_status: "EVENT_TRUTH_ALPHA_PASS", realized_rows_n: 7, positive_rate: 0.7, avg_realized_ret_net: 0.01 },
          DAYS_14: { evidence_status: "EVENT_TRUTH_ALPHA_PASS", realized_rows_n: 14, positive_rate: 0.65, avg_realized_ret_net: 0.008 },
          DAYS_30: { evidence_status: "EVENT_TRUTH_ALPHA_PASS", realized_rows_n: 30, positive_rate: 0.62, avg_realized_ret_net: 0.006 },
          DAYS_90: { evidence_status: "EVENT_TRUTH_ALPHA_PASS", realized_rows_n: 40, positive_rate: 0.7, avg_realized_ret_net: 0.005 },
        },
      },
    },
    openclawPolicyAuthority: {
      periods: {
        DAYS_7: { gate: { status: "PASS", reason: "OPENCLAW_POLICY_STABLE" } },
        DAYS_14: { gate: { status: "PASS", reason: "OPENCLAW_POLICY_STABLE" } },
        DAYS_30: { gate: { status: "WARN", reason: "OPENCLAW_POLICY_COST_TOO_HIGH" } },
        DAYS_90: { gate: { status: "PASS", reason: "OPENCLAW_POLICY_STABLE" } },
      },
    },
    capitalAllocator: {
      summary: {
        status: "CAPITAL_ALLOCATION_ACTIVE",
        top_quarantine_market: null,
        top_reduce_market: "ETHUSDT",
        top_increase_market: "BTCUSDT",
        alpha_hard_penalty_markets: ["ETHUSDT"],
        fee_pnl_hard_penalty_markets: [],
        execution_hard_penalty_markets: ["BTCUSDT"],
      },
    },
  });

  assert.strictEqual(summary.axes.execution_edge.status, "PASS");
  assert.strictEqual(summary.axes.fee_pnl.status, "PASS");
  assert.strictEqual(summary.axes.continuous_alpha_proof.status, "PASS");
  assert.strictEqual(summary.axes.portfolio_ml.status, "PASS");
  assert.strictEqual(summary.axes.portfolio_ml.alpha_hard_penalty_market_n, 1);
  assert.strictEqual(summary.axes.portfolio_ml.execution_hard_penalty_market_n, 1);
  assert.strictEqual(summary.axes.openclaw_single_authority.days_30_gate, "WARN");
  assert.strictEqual(summary.axes.openclaw_single_authority.days_30_reason, "OPENCLAW_POLICY_COST_TOO_HIGH");
  assert.strictEqual(summary.axes.continuous_alpha_proof.days_30_status, "EVENT_TRUTH_ALPHA_PASS");
  assert.strictEqual(summary.primary_blocking_axis, "OPENCLAW_SINGLE_AUTHORITY");
  assert.strictEqual(summary.primary_blocking_reason, "OPENCLAW_POLICY_COST_TOO_HIGH");
  assert.ok(summary.periods.DAYS_30);
  assert.strictEqual(summary.periods.DAYS_30.label, "최근 30일");
  assert.ok(summary.periods.DAYS_90);
})();

console.log("QUANT_ML_CORE_AUTHORITY_TEST_OK");
