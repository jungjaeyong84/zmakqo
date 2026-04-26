"use strict";

const {
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
} = require("./discoveryCanaryNotionalPolicy");
const { evaluateV2RiskGovernor, resolveRiskGovernorPolicy } = require("./riskGovernor");

const DEFAULT_BTC_BETA_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT"]);

function sumNotionalForSymbols(map, symbols) {
  return symbols.reduce((sum, symbol) => sum + (Number(map[symbol]) || 0), 0);
}

function buildPositionsFromSymbols(map, symbols) {
  return symbols.map((symbol) => Object.freeze({
    symbol,
    side: "LONG",
    notional_quote: Number(map[symbol]) || 0,
  })).filter((row) => row.notional_quote > 0);
}

function buildLargestNotionalBasket(map, maxPositionCount) {
  return Object.entries(map)
    .map(([symbol, notional]) => Object.freeze({
      symbol,
      side: "LONG",
      notional_quote: Number(notional) || 0,
    }))
    .filter((row) => row.notional_quote > 0)
    .sort((left, right) => right.notional_quote - left.notional_quote)
    .slice(0, Math.max(0, Number(maxPositionCount) || 0));
}

function dryRunSequentialRiskGovernor({
  map = DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
  symbols = DEFAULT_BTC_BETA_SYMBOLS,
  env = {},
  equityQuote = 10000,
} = {}) {
  const policy = resolveRiskGovernorPolicy({
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
    DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "300",
    DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "155",
    DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: "300",
    DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY: "UNLIMITED",
    DONBEOLJA_V2_RISK_DAILY_LOSS_HALT_QUOTE: "10",
    ...env,
  });
  const positions = [];
  const steps = [];
  for (const symbol of symbols) {
    const candidateNotional = Number(map[symbol]) || 0;
    const result = evaluateV2RiskGovernor({
      policy,
      account: {
        equity_quote: equityQuote,
        daily_loss_quote: 0,
        consecutive_loss_n: 0,
        trade_count_24h: 0,
      },
      positions,
      candidate: {
        symbol,
        notional_quote: candidateNotional,
      },
      market: {
        volatility_bps: 0,
      },
    });
    steps.push(Object.freeze({
      symbol,
      candidate_notional_quote: candidateNotional,
      ok: result.ok,
      reason: result.reason,
      blockers: result.blockers,
      total_after_notional_quote: result.metrics.total_after_notional_quote,
      group_after_notional_quote: result.metrics.group_after_notional_quote,
      symbol_after_notional_quote: result.metrics.symbol_after_notional_quote,
    }));
    if (result.ok === true) {
      positions.push(Object.freeze({
        symbol,
        side: "LONG",
        notional_quote: candidateNotional,
      }));
    }
  }
  return Object.freeze({
    ok: steps.every((step) => step.ok === true),
    policy,
    symbols: Object.freeze(symbols.slice()),
    steps: Object.freeze(steps),
    final_positions: Object.freeze(positions.slice()),
  });
}

function buildDiscoveryNotionalCapConsistencyArtifact({
  map = DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
  generatedAt = new Date().toISOString(),
  maxPositionCount = 5,
  riskTotalCap = 300,
  riskSymbolCap = 155,
  riskCorrelatedGroupCap = 300,
} = {}) {
  const symbols = Object.keys(map);
  const btcBetaNotional = sumNotionalForSymbols(map, DEFAULT_BTC_BETA_SYMBOLS);
  const totalConfiguredNotional = sumNotionalForSymbols(map, symbols);
  const largestConfiguredSymbolNotional = Math.max(...symbols.map((symbol) => Number(map[symbol]) || 0));
  const btcBetaDryRun = dryRunSequentialRiskGovernor({
    map,
    symbols: DEFAULT_BTC_BETA_SYMBOLS,
    env: {
      DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: String(riskTotalCap),
      DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: String(riskSymbolCap),
      DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: String(riskCorrelatedGroupCap),
    },
  });
  const configuredPositionDistribution = buildPositionsFromSymbols(
    map,
    symbols.slice(0, maxPositionCount),
  );
  const largestNotionalBasket = buildLargestNotionalBasket(map, maxPositionCount);
  const largestBasketNotional = largestNotionalBasket.reduce(
    (sum, row) => sum + row.notional_quote,
    0,
  );
  const blockers = [];
  if (largestConfiguredSymbolNotional > riskSymbolCap) {
    blockers.push("DISCOVERY_CAP:SINGLE_SYMBOL_EXCEEDS_RISK_SYMBOL_CAP");
  }
  if (largestBasketNotional > riskTotalCap) {
    blockers.push("DISCOVERY_CAP:MAX_POSITION_BASKET_EXCEEDS_RISK_TOTAL_CAP");
  }
  if (btcBetaNotional > riskCorrelatedGroupCap) {
    blockers.push("DISCOVERY_CAP:BTC_BETA_GROUP_EXCEEDS_RISK_GROUP_CAP");
  }
  if (btcBetaDryRun.ok !== true) {
    blockers.push("DISCOVERY_CAP:RISK_GOVERNOR_DRY_RUN_BLOCKED");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_PASS"
      : "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_BLOCKED",
    generated_at: generatedAt,
    blockers: Object.freeze(blockers),
    symbol_notional_quote_map: Object.freeze({ ...map }),
    policy: Object.freeze({
      max_position_count: maxPositionCount,
      risk_total_cap_quote: riskTotalCap,
      risk_symbol_cap_quote: riskSymbolCap,
      risk_correlated_group_cap_quote: riskCorrelatedGroupCap,
      correlated_groups: Object.freeze({
        BTC_BETA: DEFAULT_BTC_BETA_SYMBOLS,
      }),
    }),
    evidence: Object.freeze({
      active_position_count_source: "STATIC_POLICY_SIMULATION_BEFORE_CAP_CHANGE",
      configured_position_distribution: Object.freeze(configuredPositionDistribution),
      largest_notional_position_basket: Object.freeze(largestNotionalBasket),
      largest_notional_position_basket_quote: largestBasketNotional,
      total_configured_notional_quote: totalConfiguredNotional,
      largest_configured_symbol_notional_quote: largestConfiguredSymbolNotional,
      btc_beta_configured_notional_quote: btcBetaNotional,
      btc_beta_group_cap_headroom_quote: riskCorrelatedGroupCap - btcBetaNotional,
      max_position_count_limits_total_all_symbol_usage: symbols.length > maxPositionCount,
      risk_governor_btc_beta_dry_run: btcBetaDryRun,
    }),
  });
}

module.exports = {
  DEFAULT_BTC_BETA_SYMBOLS,
  sumNotionalForSymbols,
  buildLargestNotionalBasket,
  dryRunSequentialRiskGovernor,
  buildDiscoveryNotionalCapConsistencyArtifact,
};
