"use strict";

// Regression guard for src/services/binanceMakerFirstEntry.js.
//
// The service orchestrates four primitives (bookTicker, limit, fetchOrder,
// cancel, market) behind a single call. Rather than mock Binance over
// HTTP, we inject a fake primitives object via the `_primitives` hook so
// we can simulate each code path deterministically.
//
// Covered cases:
//   T1  happy path  — limit fully fills before timeout         → MAKER_FILLED
//   T2  timeout     — limit never fills, cancel + market       → MARKET_FALLBACK
//   T3  partial     — limit partially fills, market the rest   → MAKER_PARTIAL_MARKET
//   T4  post-only reject — GTX -5022 → immediate market        → MARKET_POST_ONLY_REJECTED
//   T5  book missing     — no bid/ask → market                 → MARKET_BOOK_UNAVAILABLE
//   T6  flag off (default)                                     → MARKET_DISABLED
//   T7  savings bps math is correct for BUY and SELL
//   T8  cancel race — order fills between poll and cancel      → MAKER_FILLED
//
// When adding a new code path to the service, add a matching case here.

const assert = require("assert");

// Force the flag on before loading the module so resolveXXX() reads our
// value. Individual tests that need it off restore it explicitly.
const ORIGINAL_FLAG = process.env.ENTRY_MAKER_FIRST_ENABLED;
process.env.ENTRY_MAKER_FIRST_ENABLED = "1";
process.env.ENTRY_MAKER_TIMEOUT_MS = "800";       // short so tests are fast
process.env.ENTRY_MAKER_POLL_INTERVAL_MS = "100";

const {
  placeFuturesEntryMakerFirst,
  __test,
} = require("../services/binanceMakerFirstEntry");

function makeFakePrimitives(overrides = {}) {
  return {
    placeFuturesMarketOrder: async () => ({
      orderId: 90001,
      clientOrderId: "fakeMkt",
      status: "FILLED",
      executedQty: "1.0",
      origQty: "1.0",
      avgPrice: "100.50",
      side: "BUY",
      symbol: "TESTUSDT",
    }),
    placeFuturesLimitOrder: async () => ({
      orderId: 80001,
      clientOrderId: "fakeLmt",
      status: "NEW",
      executedQty: "0",
      origQty: "1.0",
      avgPrice: "0",
      side: "BUY",
      symbol: "TESTUSDT",
    }),
    cancelFuturesOrder: async () => ({ orderId: 80001, status: "CANCELED" }),
    fetchFuturesOrder: async () => ({
      orderId: 80001,
      status: "NEW",
      executedQty: "0",
      origQty: "1.0",
      avgPrice: "0",
    }),
    fetchFuturesBookTicker: async () => ({
      symbol: "TESTUSDT",
      bidPrice: 100.00,
      askPrice: 100.10,
      bidQty: 50,
      askQty: 50,
      at: Date.now(),
    }),
    fetchFuturesExchangeInfo: async () => ({ tickSize: 0.01, pricePrecision: 2 }),
    ...overrides,
  };
}

function commonArgs(prims) {
  return {
    apiKey: "k", apiSecret: "s",
    symbol: "TESTUSDT", side: "BUY", quantity: 1.0,
    refPrice: 100.05,
    idempotencyKey: "idem-market",
    limitIdempotencyKey: "idem-limit",
    _primitives: prims,
  };
}

async function run() {
  // ── T1: happy path — limit fully fills before timeout ────────────────
  {
    const fetchCalls = [];
    const prims = makeFakePrimitives({
      fetchFuturesOrder: async () => {
        fetchCalls.push(1);
        // Return FILLED on first poll. avgPrice is a bit better than bid
        // (can happen if resting order gets price-improved by the maker).
        return {
          orderId: 80001,
          status: "FILLED",
          executedQty: "1.0",
          origQty: "1.0",
          avgPrice: "100.00",
        };
      },
      placeFuturesMarketOrder: async () => {
        throw new Error("market-should-not-be-called-in-happy-path");
      },
      cancelFuturesOrder: async () => {
        throw new Error("cancel-should-not-be-called-in-happy-path");
      },
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MAKER_FILLED", "T1 mode");
    assert.strictEqual(out.makerFirst.limitExecutedQty, 1.0, "T1 limit qty");
    assert.strictEqual(out.makerFirst.marketExecutedQty, 0, "T1 market qty");
    assert.ok(out.makerFirst.savingsBps > 0, "T1 savings bps should be positive (bought below ref)");
    assert.ok(fetchCalls.length >= 1, "T1 fetched at least once");
  }

  // ── T2: timeout — limit never fills, cancel + full market fallback ───
  {
    let cancelCalled = false;
    let marketCalled = false;
    const prims = makeFakePrimitives({
      fetchFuturesOrder: async () => ({
        orderId: 80001, status: "NEW", executedQty: "0", origQty: "1.0", avgPrice: "0",
      }),
      cancelFuturesOrder: async () => {
        cancelCalled = true;
        return { orderId: 80001, status: "CANCELED" };
      },
      placeFuturesMarketOrder: async () => {
        marketCalled = true;
        return {
          orderId: 90002, status: "FILLED", executedQty: "1.0", origQty: "1.0",
          avgPrice: "100.08", side: "BUY",
        };
      },
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MARKET_FALLBACK", "T2 mode");
    assert.ok(cancelCalled, "T2 must cancel stale limit");
    assert.ok(marketCalled, "T2 must fall back to market");
    assert.strictEqual(out.makerFirst.limitExecutedQty, 0, "T2 no limit fills");
    assert.strictEqual(out.makerFirst.marketExecutedQty, 1.0, "T2 full market qty");
  }

  // ── T3: partial fill — limit gets 0.3, market gets 0.7 ───────────────
  {
    let pollCount = 0;
    const prims = makeFakePrimitives({
      fetchFuturesOrder: async () => {
        pollCount += 1;
        return {
          orderId: 80001,
          // Still NEW so we keep polling until timeout, but with partial
          // fill reflected.
          status: "PARTIALLY_FILLED",
          executedQty: "0.3",
          origQty: "1.0",
          avgPrice: "100.00",
        };
      },
      cancelFuturesOrder: async () => ({ orderId: 80001, status: "CANCELED" }),
      placeFuturesMarketOrder: async (args) => {
        // The remainder should be qty - 0.3 = 0.7
        assert.ok(Math.abs(Number(args.quantity) - 0.7) < 1e-9, "T3 market qty = remainder");
        return {
          orderId: 90003, status: "FILLED", executedQty: "0.7", origQty: "0.7",
          avgPrice: "100.08", side: "BUY",
        };
      },
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MAKER_PARTIAL_MARKET", "T3 mode");
    assert.strictEqual(out.makerFirst.limitExecutedQty, 0.3, "T3 limit qty");
    assert.strictEqual(out.makerFirst.marketExecutedQty, 0.7, "T3 market qty");
    assert.ok(pollCount >= 1, "T3 polled at least once");
    // Weighted avg: 0.3 * 100.00 + 0.7 * 100.08 = 100.056
    const avg = Number(out.avgPrice);
    assert.ok(Math.abs(avg - 100.056) < 1e-6, "T3 weighted avg correct, got " + avg);
  }

  // ── T4: GTX post-only rejection → immediate market ───────────────────
  {
    let marketCalled = false;
    const prims = makeFakePrimitives({
      placeFuturesLimitOrder: async () => {
        const err = new Error("-5022 Post Only order will not be executed immediately.");
        err.code = -5022;
        throw err;
      },
      placeFuturesMarketOrder: async () => {
        marketCalled = true;
        return {
          orderId: 90004, status: "FILLED", executedQty: "1.0", origQty: "1.0",
          avgPrice: "100.11", side: "BUY",
        };
      },
      // These should NOT be called in this path.
      fetchFuturesOrder: async () => { throw new Error("fetch-should-not-be-called"); },
      cancelFuturesOrder: async () => { throw new Error("cancel-should-not-be-called"); },
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MARKET_POST_ONLY_REJECTED", "T4 mode");
    assert.ok(marketCalled, "T4 must go to market after reject");
  }

  // ── T5: book unavailable → market ────────────────────────────────────
  {
    const prims = makeFakePrimitives({
      fetchFuturesBookTicker: async () => ({
        symbol: "TESTUSDT", bidPrice: null, askPrice: null, bidQty: null, askQty: null, at: Date.now(),
      }),
      placeFuturesLimitOrder: async () => {
        throw new Error("limit-should-not-be-called-when-book-missing");
      },
      placeFuturesMarketOrder: async () => ({
        orderId: 90005, status: "FILLED", executedQty: "1.0", origQty: "1.0",
        avgPrice: "100.12", side: "BUY",
      }),
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MARKET_BOOK_UNAVAILABLE", "T5 mode");
  }

  // ── T6: master flag off (default) → one market call, no other RPCs ───
  {
    const prevFlag = process.env.ENTRY_MAKER_FIRST_ENABLED;
    process.env.ENTRY_MAKER_FIRST_ENABLED = "0";
    // Module-level flag reader reads the env each call, so no reload needed.
    const prims = makeFakePrimitives({
      placeFuturesLimitOrder: async () => { throw new Error("must-not-call-limit"); },
      fetchFuturesBookTicker: async () => { throw new Error("must-not-fetch-book"); },
      fetchFuturesOrder: async () => { throw new Error("must-not-poll"); },
      cancelFuturesOrder: async () => { throw new Error("must-not-cancel"); },
      placeFuturesMarketOrder: async () => ({
        orderId: 90006, status: "FILLED", executedQty: "1.0", origQty: "1.0",
        avgPrice: "100.10", side: "BUY",
      }),
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MARKET_DISABLED", "T6 mode");
    process.env.ENTRY_MAKER_FIRST_ENABLED = prevFlag == null ? "1" : prevFlag;
  }

  // ── T7: savings-bps math (pure function) ─────────────────────────────
  {
    const buySavings = __test.computeSavingsBps({ side: "BUY", refPrice: 100, avgPrice: 99.5 });
    // Bought at 99.5 vs ref 100: saved 0.5 / 100 = 50 bps.
    assert.ok(Math.abs(buySavings - 50) < 1e-9, "T7 buy savings bps");

    const sellSavings = __test.computeSavingsBps({ side: "SELL", refPrice: 100, avgPrice: 100.5 });
    // Sold at 100.5 vs ref 100: captured 0.5 extra = 50 bps.
    assert.ok(Math.abs(sellSavings - 50) < 1e-9, "T7 sell savings bps");

    const buyLoss = __test.computeSavingsBps({ side: "BUY", refPrice: 100, avgPrice: 100.2 });
    // Bought worse than ref: negative bps (rare — happens if market ran).
    assert.ok(buyLoss < 0, "T7 buy worse = negative bps");

    const nullSavings = __test.computeSavingsBps({ side: "BUY", refPrice: null, avgPrice: 100 });
    assert.strictEqual(nullSavings, null, "T7 null inputs → null output");
  }

  // ── T8: cancel race — order fills AFTER cancel command lands ─────────
  // Binance may fill the order between our last poll and the cancel
  // hitting the matching engine; the cancel returns an error (already
  // filled) and the re-fetch shows FILLED. We must recognize this as a
  // maker win, not a partial.
  {
    let pollN = 0;
    const prims = makeFakePrimitives({
      fetchFuturesOrder: async () => {
        pollN += 1;
        // First polls: NEW. After cancel call (pollN>=3): FILLED.
        if (pollN <= 2) {
          return { orderId: 80001, status: "NEW", executedQty: "0", origQty: "1.0", avgPrice: "0" };
        }
        return { orderId: 80001, status: "FILLED", executedQty: "1.0", origQty: "1.0", avgPrice: "100.00" };
      },
      cancelFuturesOrder: async () => {
        // Binance returns -2011 when the order has already been filled.
        const err = new Error("Unknown order sent.");
        err.code = -2011;
        throw err;
      },
      placeFuturesMarketOrder: async () => {
        throw new Error("market-should-not-fire-after-race-fill");
      },
    });
    const out = await placeFuturesEntryMakerFirst(commonArgs(prims));
    assert.strictEqual(out.makerFirst.mode, "MAKER_FILLED", "T8 race → MAKER_FILLED");
    assert.strictEqual(out.makerFirst.limitExecutedQty, 1.0, "T8 race full maker qty");
  }

  process.env.ENTRY_MAKER_FIRST_ENABLED = ORIGINAL_FLAG == null ? "" : ORIGINAL_FLAG;
  console.log("MAKER_FIRST_ENTRY_TEST_OK");
}

run().catch((e) => {
  console.error("MAKER_FIRST_ENTRY_TEST_FAIL", e && e.stack ? e.stack : e);
  process.exit(1);
});
