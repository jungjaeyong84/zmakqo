"use strict";

const assert = require("assert");
const {
  buildV2EntrySizingDecision,
  buildEntryQuantityResolverFromSizingDecision,
} = require("../v2/entrySizingDecision");
const { buildBinanceEntryOrderTransport } = require("../v2/binanceEntryOrderTransport");

function entryIntent(extra = {}) {
  return {
    entry_intent_id: "EINTV2__SIZING",
    signal_intent_id: "SIGINTV2__SIZING",
    openclaw_decision_id: "OCDV2__SIZING",
    signal_source_mode: "SERVER_NATIVE_ML_AI",
    decision_mode: "CANARY",
    policy_scope: "ETH_15M",
    symbol: "ETHUSDT",
    side: "LONG",
    ...extra,
  };
}

function liveCfg() {
  return {
    apiKey: "key",
    apiSecret: "secret",
    liveEnabled: true,
    liveDryRun: false,
    leverage: 3,
  };
}

(function approvedSizingRoundsUpToStepAndFeedsQuantityResolver() {
  const intent = entryIntent();
  const decision = buildV2EntrySizingDecision({
    entryIntent: intent,
    referencePrice: 2500,
    requestedNotionalQuote: 100,
    maxNotionalQuote: 120,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    createdAt: "2026-04-21T07:00:00.000Z",
  });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.entry_qty_abs, 0.04);
  assert.strictEqual(decision.notional_quote, 100);
  const resolver = buildEntryQuantityResolverFromSizingDecision(decision);
  assert.strictEqual(resolver({ entryIntent: intent }), 0.04);
})();

(function minOrderCanBumpOnlyWithinMaxBudget() {
  const blocked = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 4,
    maxNotionalQuote: 8,
    minNotionalQuote: 10,
    stepSize: 0.001,
    allowMinOrderBump: true,
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "MIN_ORDER_EXCEEDS_BUDGET");

  const bumped = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 4,
    maxNotionalQuote: 10,
    minNotionalQuote: 10,
    stepSize: 0.001,
    allowMinOrderBump: true,
  });
  assert.strictEqual(bumped.ok, true);
  assert.strictEqual(bumped.reason, "MIN_NOTIONAL_BUMPED");
  assert.strictEqual(bumped.entry_qty_abs, 0.004);
})();

(function stepRoundingCannotExceedBudgetSilently() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 3333,
    requestedNotionalQuote: 10,
    maxNotionalQuote: 10,
    minNotionalQuote: 5,
    stepSize: 0.01,
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.reason, "STEP_SIZE_EXCEEDS_BUDGET");
})();

(function minQtyCannotExceedBudgetSilently() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 10,
    maxNotionalQuote: 20,
    minNotionalQuote: 5,
    minQtyAbs: 0.02,
    stepSize: 0.001,
    allowMinOrderBump: true,
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.reason, "MIN_QTY_EXCEEDS_BUDGET");
})();

(function mlMaxSizeRatioCapsApprovedNotionalBeforeQuantityResolution() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 1000,
    maxNotionalQuote: 2000,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    maxSizeRatio: 0.3,
  });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.reason, "ML_SIZE_RATIO_CAPPED");
  assert.strictEqual(decision.max_size_ratio, 0.3);
  assert.strictEqual(decision.sizing_cap_notional_quote, 600);
  assert.strictEqual(decision.entry_qty_abs, 0.24);
  assert.strictEqual(decision.notional_quote, 600);
})();

(function invalidMlMaxSizeRatioFailsClosed() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 100,
    maxNotionalQuote: 200,
    minNotionalQuote: 5,
    stepSize: 0.001,
    maxSizeRatio: 1.2,
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.reason, "ML_MAX_SIZE_RATIO_INVALID");
})();

(function blockedSizingCannotCreateResolver() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 0,
    maxNotionalQuote: 20,
  });
  let err = null;
  try {
    buildEntryQuantityResolverFromSizingDecision(decision);
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_SIZING_DECISION_NOT_APPROVED");
})();

(function partialTp1MinNotionalIsRequiredWhenEnabled() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent({ symbol: "DOGEUSDT" }),
    referencePrice: 0.1,
    requestedNotionalQuote: 6,
    maxNotionalQuote: 6,
    minNotionalQuote: 5,
    minQtyAbs: 1,
    stepSize: 1,
    requirePartialTp1MinNotional: true,
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.reason, "PARTIAL_TP1_MIN_NOTIONAL_REQUIRED");
  assert.strictEqual(decision.detail.tp1_qty_abs, 30);
  assert.ok(decision.detail.tp1_notional_quote < 5);

  const accepted = buildV2EntrySizingDecision({
    entryIntent: entryIntent({ symbol: "DOGEUSDT" }),
    referencePrice: 0.1,
    requestedNotionalQuote: 11,
    maxNotionalQuote: 11,
    minNotionalQuote: 5,
    minQtyAbs: 1,
    stepSize: 1,
    requirePartialTp1MinNotional: true,
  });
  assert.strictEqual(accepted.ok, true);
  assert.ok(accepted.notional_quote >= 10);
})();

(function sizingResolverIsBoundToOneIntentSymbolAndSide() {
  const decision = buildV2EntrySizingDecision({
    entryIntent: entryIntent(),
    referencePrice: 2500,
    requestedNotionalQuote: 100,
    maxNotionalQuote: 120,
    stepSize: 0.001,
  });
  const resolver = buildEntryQuantityResolverFromSizingDecision(decision);
  for (const [patch, reason] of [
    [{ entry_intent_id: "EINTV2__OTHER" }, "ENTRY_SIZING_INTENT_MISMATCH"],
    [{ symbol: "BTCUSDT" }, "ENTRY_SIZING_SYMBOL_MISMATCH"],
    [{ side: "SHORT" }, "ENTRY_SIZING_SIDE_MISMATCH"],
  ]) {
    let err = null;
    try {
      resolver({ entryIntent: entryIntent(patch) });
    } catch (error) {
      err = error;
    }
    assert.ok(err);
    assert.strictEqual(err.message, reason);
  }
})();

async function binanceEntryTransportConsumesSizingDecisionOnly() {
  const intent = entryIntent();
  const decision = buildV2EntrySizingDecision({
    entryIntent: intent,
    referencePrice: 2500,
    requestedNotionalQuote: 100,
    maxNotionalQuote: 120,
    stepSize: 0.001,
  });
  const resolver = buildEntryQuantityResolverFromSizingDecision(decision);
  const calls = [];
  const leverageCalls = [];
  const transport = buildBinanceEntryOrderTransport({
    liveCfg: liveCfg(),
    quantityResolver: resolver,
    setLeverage: async (payload) => {
      leverageCalls.push(payload);
      return { leverage: payload.leverage };
    },
    placeMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "ENTRY_ORDER__SIZING",
        status: "FILLED",
        symbol: payload.symbol,
        avgPrice: "2500",
        executedQty: String(payload.quantity),
      };
    },
  });
  const receipt = await transport.submitEntryOrder({ entryIntent: intent });
  assert.strictEqual(leverageCalls.length, 1);
  assert.strictEqual(leverageCalls[0].symbol, "ETHUSDT");
  assert.strictEqual(leverageCalls[0].leverage, 3);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].quantity, decision.entry_qty_abs);
  assert.strictEqual(receipt.executed_qty_abs, decision.entry_qty_abs);
}

async function main() {
  await binanceEntryTransportConsumesSizingDecisionOnly();
}

main()
  .then(() => {
    console.log("V2_ENTRY_SIZING_DECISION_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
