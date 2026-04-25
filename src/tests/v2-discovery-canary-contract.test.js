"use strict";

const assert = require("assert");
const {
  DISCOVERY_CONFIRM_PHRASE,
  resolveDiscoveryCanaryPolicy,
  evaluateDiscoveryCanaryContract,
} = require("../v2/discoveryCanaryContract");

const env = {
  DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
  DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "ETHUSDT",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "6",
  DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "ETHUSDT:50",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "1",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "5",
  DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "5",
};

(function policyDefaultsAreBounded() {
  const policy = resolveDiscoveryCanaryPolicy({ DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1", DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "BTCUSDT" });
  assert.strictEqual(policy.enabled, true);
  assert.deepStrictEqual(policy.allowed_symbols, ["BTCUSDT"]);
  assert.strictEqual(policy.max_symbol_count, 2);
  assert.strictEqual(policy.max_notional_quote, 25);
  assert.strictEqual(policy.symbol_notional_quote_map.BTCUSDT, 230);
  assert.strictEqual(policy.max_position_count, 1);
  assert.strictEqual(policy.max_trades_per_day, 5);
  assert.strictEqual(policy.daily_loss_halt_quote, 10);
})();

(function policyCanAllowTwoDiscoverySymbolsWithGlobalCaps() {
  const result = evaluateDiscoveryCanaryContract({
    env: {
      ...env,
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "SOLUSDT:15|XRPUSDT:15",
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "XRPUSDT",
        side: "LONG",
        notional_quote: 15,
        entry_qty_abs: 8,
        reference_price: 1.44,
        min_notional_quote: 5,
        step_size: 0.1,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.policy.allowed_symbols, ["SOLUSDT", "XRPUSDT"]);
  assert.strictEqual(result.policy.max_position_count, 1);
  assert.strictEqual(result.policy.max_trades_per_day, 5);
})();

(function blocksTooManyDiscoverySymbols() {
  const result = evaluateDiscoveryCanaryContract({
    env: {
      ...env,
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "BTCUSDT,ETHUSDT,SOLUSDT",
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "BTCUSDT",
        side: "LONG",
        notional_quote: 12,
        entry_qty_abs: 0.001,
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:MAX_SYMBOL_COUNT_EXCEEDED"));
})();

(function policyCanAllowFullDiscoverySymbolUniverseWithGlobalCaps() {
  const symbols = "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT";
  const result = evaluateDiscoveryCanaryContract({
    env: {
      ...env,
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: symbols,
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "8",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "6",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "BTCUSDT:230|ETHUSDT:50|LINKUSDT:50|BNBUSDT:15|XRPUSDT:15|SOLUSDT:15|AXSUSDT:15|DOGEUSDT:15",
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "DOGEUSDT",
        side: "LONG",
        notional_quote: 15,
        entry_qty_abs: 151,
        reference_price: 0.099,
        min_notional_quote: 5,
        step_size: 1,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.policy.allowed_symbols.length, 8);
  assert.strictEqual(result.policy.max_symbol_count, 8);
  assert.strictEqual(result.policy.max_notional_quote, 6);
  assert.strictEqual(result.effective_symbol_notional_quote, 15);
  assert.strictEqual(result.policy.max_position_count, 1);
  assert.strictEqual(result.policy.max_trades_per_day, 5);
})();

(function passRequiresOneSymbolOnePositionOneTradeAndHardNotional() {
  const result = evaluateDiscoveryCanaryContract({
    env,
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "ETHUSDT",
        side: "LONG",
        notional_quote: 50,
        entry_qty_abs: 0.022,
        reference_price: 2315,
        min_notional_quote: 20,
        step_size: 0.001,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_CONTRACT_PASS");
  assert.strictEqual(result.blocker_n, 0);
})();

(function allowsStepSafeNotionalBelowPolicyWhenTp1MinNotionalPasses() {
  const result = evaluateDiscoveryCanaryContract({
    env: {
      ...env,
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "LINKUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "LINKUSDT:50",
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "LINKUSDT",
        side: "LONG",
        notional_quote: 49.9680721017,
        entry_qty_abs: 5.31,
        reference_price: 9.41018307,
        min_notional_quote: 20,
        step_size: 0.01,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_CONTRACT_PASS");
})();

(function blocksUnsafeDiscoveryInputs() {
  const result = evaluateDiscoveryCanaryContract({
    env,
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 1,
        trade_count_24h: 5,
        daily_loss_quote: 6,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "BTCUSDT",
        side: "LONG",
        notional_quote: 130,
        entry_qty_abs: 0.001,
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:SYMBOL_NOT_ALLOWED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:MAX_POSITION_COUNT_REACHED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:MAX_TRADES_PER_DAY_REACHED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:DAILY_LOSS_HALT_REACHED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:MAX_NOTIONAL_EXCEEDED"));
})();

(function blocksBelowPartialTp1MinimumNotional() {
  const result = evaluateDiscoveryCanaryContract({
    env: {
      ...env,
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "DOGEUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "DOGEUSDT:10",
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    runtime: { enabled: true, dry_run: false, canary_only: true },
    decisionMode: "CANARY",
    body: {
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
      entrySizingDecision: {
        ok: true,
        status: "APPROVED",
        symbol: "DOGEUSDT",
        side: "LONG",
        notional_quote: 6,
        entry_qty_abs: 60,
        reference_price: 0.098,
        min_notional_quote: 5,
        step_size: 1,
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:PARTIAL_TP1_MIN_NOTIONAL_REQUIRED"));
})();

(function blocksWhenEvidenceMissingOrNotCanaryOnly() {
  const result = evaluateDiscoveryCanaryContract({
    env,
    confirm: "EXECUTE_V2_LIVE_ENTRY",
    runtime: { enabled: true, dry_run: false, canary_only: false },
    decisionMode: "LIVE",
    body: {},
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:CONFIRM_REQUIRED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:CANARY_ONLY_REQUIRED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:CANARY_DECISION_REQUIRED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:STATE_REQUIRED"));
  assert.ok(result.blockers.includes("DISCOVERY_CANARY:SIZING_DECISION_REQUIRED"));
})();

console.log("V2_DISCOVERY_CANARY_CONTRACT_TEST_OK");
