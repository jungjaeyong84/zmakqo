const assert = require("assert");
const { buildTradeQualitySummary } = require("../services/tradeQualitySummary");

const trades = [
  {
    market: "BTCUSDT",
    close_ms: 1000,
    pnl_krw: 90,
    pnl_krw_gross: 100,
    fee_value: 8,
    funding_paid: 2,
    notional_krw: 10000,
    close_type: "FULL_CLOSE",
  },
  {
    market: "BTCUSDT",
    close_ms: 2000,
    pnl_krw: -55,
    pnl_krw_gross: -50,
    fee_value: 5,
    funding_paid: 0,
    notional_krw: 5000,
    close_type: "PARTIAL_CLOSE",
  },
  {
    market: "ETHUSDT",
    close_ms: 3000,
    pnl_krw: 36,
    pnl_krw_gross: 40,
    fee_value: 3,
    funding_paid: 1,
    notional_krw: 4000,
    close_type: "PARTIAL_CLOSE",
  },
];

const built = buildTradeQualitySummary(trades, { fromMs: 1000, toMs: 4000, topN: 2 });

assert.strictEqual(built.summary.trade_count, 3);
assert.strictEqual(built.summary.gross_pnl_krw, 90);
assert.strictEqual(built.summary.net_pnl_krw, 71);
assert.strictEqual(built.summary.fee_paid_krw, 16);
assert.strictEqual(built.summary.funding_paid_krw, 3);
assert.strictEqual(built.summary.total_cost_krw, 19);
assert.strictEqual(built.summary.notional_krw, 19000);
assert.strictEqual(built.summary.win_count, 2);
assert.strictEqual(built.summary.loss_count, 1);
assert.strictEqual(built.summary.close_type_breakdown.FULL_CLOSE, 1);
assert.strictEqual(built.summary.close_type_breakdown.PARTIAL_CLOSE, 2);
assert.ok(Math.abs(built.summary.fee_to_gross_pnl_ratio - (16 / 190)) < 1e-12);
assert.ok(Math.abs(built.summary.cost_to_notional_bps - ((19 * 10000) / 19000)) < 1e-12);

assert.strictEqual(built.by_market.length, 2);
assert.strictEqual(built.by_market[0].market, "BTCUSDT");
assert.strictEqual(built.by_market[0].trade_count, 2);
assert.strictEqual(built.by_market[1].market, "ETHUSDT");
assert.strictEqual(built.by_market[1].trade_count, 1);
assert.strictEqual(built.worst_fee_drag_markets.length, 2);

console.log("TRADE_QUALITY_SUMMARY_TEST_OK");
