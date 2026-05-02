"use strict";

const assert = require("assert");
const {
  evaluateDiscoveryCanaryRealizedPerformanceGuard,
  summarizeRecentRealizedPerformance,
} = require("../v2/discoveryCanaryRealizedPerformanceGuard");

const nowMs = Date.parse("2026-05-02T00:00:00.000Z");
const realizedGuardEnabledEnv = Object.freeze({
  DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_ENABLED: "1",
});

function exitFill({ symbol = "DOGEUSDT", action = "EXIT_SL_1.65P", pnl = -1, fee = 0.05, minutesAgo = 10, entry = "ENTRY1" } = {}) {
  return {
    id: `${symbol}-${action}-${minutesAgo}`,
    action,
    symbol,
    side: "SELL",
    created_at: new Date(nowMs - minutesAgo * 60 * 1000).toISOString(),
    entry_event_id: entry,
    external_realized_pnl: pnl,
    fee_value: fee,
  };
}

(function summarizesByEntryEventNotByExitOrder() {
  const summary = summarizeRecentRealizedPerformance({
    nowMs,
    fills: [
      exitFill({ pnl: 0.8, fee: 0.02, action: "EXIT_TP_P1_2.5P", entry: "E1" }),
      exitFill({ pnl: 0.3, fee: 0.02, action: "EXIT_TRAIL_100P", entry: "E1", minutesAgo: 9 }),
      exitFill({ pnl: -1.2, fee: 0.02, action: "EXIT_SL_1.65P", entry: "E2" }),
    ],
  });
  assert.strictEqual(summary.by_symbol.DOGEUSDT.trade_n, 2);
  assert.strictEqual(summary.by_symbol.DOGEUSDT.win_n, 1);
  assert.strictEqual(summary.by_symbol.DOGEUSDT.loss_n, 1);
})();

(async function explicitQuarantineBlocksImmediately() {
  const result = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_QUARANTINE_SYMBOLS: "DOGEUSDT|BNBUSDT",
    },
    symbol: "DOGEUSDT",
    fills: [],
    nowMs,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_SYMBOL_QUARANTINED");
})();

(async function recentLossClusterBlocksSymbol() {
  const result = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env: {
      ...realizedGuardEnabledEnv,
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_TRADES: "4",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_NET_LOSS_QUOTE: "2",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_WIN_RATE_PCT: "35",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_SL_N: "4",
    },
    symbol: "DOGEUSDT",
    nowMs,
    fills: [
      exitFill({ entry: "E1", pnl: -1.1 }),
      exitFill({ entry: "E2", pnl: -0.8, minutesAgo: 20 }),
      exitFill({ entry: "E3", pnl: -0.9, minutesAgo: 30 }),
      exitFill({ entry: "E4", pnl: 0.2, action: "EXIT_TP_P1_2.5P", minutesAgo: 40 }),
    ],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_REALIZED_SYMBOL_GUARD_BLOCKED");
  assert.ok(result.blockers.includes("DISCOVERY_CANARY_REALIZED_GUARD:NET_LOSS_LIMIT"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY_REALIZED_GUARD:WIN_RATE_BELOW_FLOOR"));
})();

(async function insufficientSampleDoesNotBlock() {
  const result = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env: {
      ...realizedGuardEnabledEnv,
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_TRADES: "4",
    },
    symbol: "TAOUSDT",
    nowMs,
    fills: [exitFill({ symbol: "TAOUSDT", entry: "T1", pnl: -1 })],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_REALIZED_GUARD_INSUFFICIENT_SAMPLE");
})();

(async function lowWinRateWithoutNetLossOrSlClusterDoesNotBlock() {
  const result = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env: {
      ...realizedGuardEnabledEnv,
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_TRADES: "4",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_NET_LOSS_QUOTE: "2",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_WIN_RATE_PCT: "35",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_SL_N: "4",
    },
    symbol: "BTCUSDT",
    nowMs,
    fills: [
      exitFill({ symbol: "BTCUSDT", entry: "B1", pnl: 2.8, fee: 0.05, action: "EXIT_TP_P1_2.5P" }),
      exitFill({ symbol: "BTCUSDT", entry: "B2", pnl: -0.5, fee: 0.05, action: "EXIT_EXTERNAL_SYNC", minutesAgo: 20 }),
      exitFill({ symbol: "BTCUSDT", entry: "B3", pnl: -0.4, fee: 0.05, action: "EXIT_EXTERNAL_SYNC", minutesAgo: 30 }),
      exitFill({ symbol: "BTCUSDT", entry: "B4", pnl: -0.3, fee: 0.05, action: "EXIT_EXTERNAL_SYNC", minutesAgo: 40 }),
    ],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_REALIZED_GUARD_PASS");
})();

(async function defaultDisabledDoesNotBlockRecentLossCluster() {
  const result = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_TRADES: "4",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MAX_NET_LOSS_QUOTE: "2",
      DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_MIN_WIN_RATE_PCT: "35",
    },
    symbol: "DOGEUSDT",
    nowMs,
    fills: [
      exitFill({ entry: "E1", pnl: -1.1 }),
      exitFill({ entry: "E2", pnl: -0.8, minutesAgo: 20 }),
      exitFill({ entry: "E3", pnl: -0.9, minutesAgo: 30 }),
      exitFill({ entry: "E4", pnl: 0.2, action: "EXIT_TP_P1_2.5P", minutesAgo: 40 }),
    ],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_REALIZED_GUARD_DISABLED");
})();

console.log("V2_DISCOVERY_CANARY_REALIZED_PERFORMANCE_GUARD_TEST_OK");
