"use strict";

const assert = require("assert");
const { resolveRiskGovernorPolicy, evaluateV2RiskGovernor } = require("../v2/riskGovernor");

{
  const result = evaluateV2RiskGovernor({
    env: {
      DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "250",
      DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "100",
      DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: "180",
    },
    account: { equity_quote: 200, daily_loss_quote: 0, consecutive_loss_n: 0, trade_count_24h: 1 },
    positions: [{ symbol: "BTCUSDT", notional_quote: 50 }],
    candidate: { symbol: "ETHUSDT", notional_quote: 40 },
    market: { volatility_bps: 80 },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_RISK_GOVERNOR_PASS");
  assert.strictEqual(result.metrics.group, "BTC_BETA");
}

{
  const result = evaluateV2RiskGovernor({
    env: {
      DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "100",
      DONBEOLJA_V2_RISK_DAILY_LOSS_HALT_QUOTE: "10",
      DONBEOLJA_V2_RISK_VOLATILITY_HALT_BPS: "150",
    },
    account: { equity_quote: 50, daily_loss_quote: 12, consecutive_loss_n: 0, trade_count_24h: 0 },
    positions: [{ symbol: "BTCUSDT", notional_quote: 60 }],
    candidate: { symbol: "ETHUSDT", notional_quote: 60 },
    market: { volatility_bps: 180 },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("RISK_GOVERNOR:DAILY_LOSS_HALT"));
  assert.ok(result.blockers.includes("RISK_GOVERNOR:TOTAL_NOTIONAL_EXCEEDED"));
  assert.ok(result.blockers.includes("RISK_GOVERNOR:ACCOUNT_LEVERAGE_EXCEEDED"));
  assert.ok(result.blockers.includes("RISK_GOVERNOR:VOLATILITY_HALT"));
}

{
  const policy = resolveRiskGovernorPolicy({
    DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "0",
    DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY: "0",
  });
  assert.strictEqual(policy.max_total_notional_quote, 0);
  assert.strictEqual(policy.max_trades_per_day, 0);
  const result = evaluateV2RiskGovernor({
    policy,
    account: { equity_quote: 100, daily_loss_quote: 0, consecutive_loss_n: 0, trade_count_24h: 0 },
    candidate: { symbol: "ETHUSDT", notional_quote: 1 },
    market: { volatility_bps: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("RISK_GOVERNOR:TOTAL_NOTIONAL_EXCEEDED"));
  assert.ok(result.blockers.includes("RISK_GOVERNOR:MAX_TRADES_PER_DAY"));
}

console.log("V2_RISK_GOVERNOR_TEST_OK");
