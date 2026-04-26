"use strict";

const assert = require("assert");
const {
  normalizeForceOrderEvent,
  aggregateLiquidationEvents,
  buildLiquidationSnapshotDoc,
  latestSnapshotDocId,
  writeLatestLiquidationSnapshot,
  loadLatestLiquidationSnapshot,
  createBinanceLiquidationStreamCollector,
} = require("../v2/binanceLiquidationStreamCollector");
const { collectMarketDataQuality } = require("../v2/discoveryCanaryServerSignalBridge");

function createMemoryDb() {
  const store = new Map();
  return {
    _store: store,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async set(payload, options = {}) {
              const previous = options.merge === true ? (store.get(key) || {}) : {};
              store.set(key, { ...previous, ...payload });
            },
            async get() {
              const data = store.get(key);
              return {
                exists: Boolean(data),
                data: () => ({ ...data }),
              };
            },
          };
        },
      };
    },
  };
}

function forceOrder(overrides = {}) {
  return {
    e: "forceOrder",
    E: 1770000000000,
    o: {
      s: "SOLUSDT",
      S: "SELL",
      o: "LIMIT",
      f: "IOC",
      q: "12",
      p: "100",
      ap: "101",
      X: "FILLED",
      l: "12",
      z: "12",
      T: 1770000000000,
      ...overrides,
    },
  };
}

(function normalizesForceOrderEvent() {
  const event = normalizeForceOrderEvent(forceOrder());
  assert.strictEqual(event.symbol, "SOLUSDT");
  assert.strictEqual(event.order_side, "SELL");
  assert.strictEqual(event.liquidation_side, "LONG_LIQUIDATED");
  assert.strictEqual(event.notional_quote, 1212);
})();

(function aggregatesFiveMinuteWindow() {
  const nowMs = 1770000300000;
  const rows = [
    normalizeForceOrderEvent(forceOrder({ s: "SOLUSDT", S: "SELL", z: "10", ap: "100", T: 1770000200000 })),
    normalizeForceOrderEvent(forceOrder({ s: "SOLUSDT", S: "BUY", z: "5", ap: "100", T: 1770000250000 })),
    normalizeForceOrderEvent(forceOrder({ s: "XRPUSDT", S: "SELL", z: "99", ap: "1", T: 1770000250000 })),
    normalizeForceOrderEvent({ ...forceOrder({ s: "SOLUSDT", S: "SELL", z: "1", ap: "100", T: 1769990000000 }), E: 1769990000000 }),
  ];
  const snapshot = aggregateLiquidationEvents({ events: rows, symbol: "SOLUSDT", nowMs, windowMs: 5 * 60 * 1000 });
  assert.strictEqual(snapshot.liquidation_event_count_5m, 2);
  assert.strictEqual(snapshot.liquidation_notional_5m_quote, 1500);
  assert.strictEqual(snapshot.liquidation_long_notional_5m_quote, 1000);
  assert.strictEqual(snapshot.liquidation_short_notional_5m_quote, 500);
})();

async function writesAndLoadsLatestSnapshot() {
  const db = createMemoryDb();
  const nowMs = 1770000300000;
  const snapshot = aggregateLiquidationEvents({
    events: [normalizeForceOrderEvent(forceOrder())],
    symbol: "SOLUSDT",
    nowMs,
    windowMs: 5 * 60 * 1000,
  });
  const doc = buildLiquidationSnapshotDoc({ snapshot, nowMs });
  assert.strictEqual(doc.liquidation_snapshot_id, latestSnapshotDocId("SOLUSDT"));
  await writeLatestLiquidationSnapshot({ db, snapshot, nowMs });
  const loaded = await loadLatestLiquidationSnapshot({ db, symbol: "SOLUSDT" });
  assert.strictEqual(loaded.symbol, "SOLUSDT");
  assert.strictEqual(loaded.liquidation_event_count_5m, 1);
}

async function collectorHandlesMessageAndWritesSnapshot() {
  const db = createMemoryDb();
  const collector = createBinanceLiquidationStreamCollector({
    db,
    env: {
      DONBEOLJA_V2_LIQUIDATION_STREAM_ENABLED: "0",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
    },
    now: () => 1770000300000,
    logger: { error() {} },
  });
  const result = await collector.handleMessage(JSON.stringify(forceOrder()));
  assert.strictEqual(result.reason, "LIQUIDATION_STREAM_SNAPSHOT_WRITTEN");
  const loaded = await loadLatestLiquidationSnapshot({ db, symbol: "SOLUSDT" });
  assert.strictEqual(loaded.liquidation_event_count_5m, 1);
}

async function marketDataQualityReadsLatestLiquidationSnapshot() {
  const result = await collectMarketDataQuality({
    symbol: "SOLUSDT",
    candleCloseMs: 1770000000000,
    nowMs: 1770000060000,
    fetchBookTicker: async () => ({ bidPrice: "100", askPrice: "100.1" }),
    fetchPublicJson: async (path) => {
      if (path === "/fapi/v1/premiumIndex") return { markPrice: "100", indexPrice: "100" };
      if (path === "/fapi/v1/ticker/24hr") return { quoteVolume: "10000000" };
      if (path === "/fapi/v1/fundingRate") return [{ fundingRate: "0.0001", fundingTime: 10, markPrice: "100" }];
      if (path === "/fapi/v1/openInterest") return { openInterest: "1234.5", time: 11 };
      if (path === "/fapi/v1/depth") return { bids: [["100", "2"]], asks: [["100.1", "1"]] };
      throw new Error(`unexpected ${path}`);
    },
    loadLiquidationSnapshot: async () => ({
      source: "BINANCE_FORCE_ORDER_STREAM",
      liquidation_notional_5m_quote: 12000000,
      liquidation_event_count_5m: 4,
    }),
  });
  assert.strictEqual(result.quality.metrics.liquidation_notional_5m_quote, 12000000);
  assert.strictEqual(result.quality.metrics.liquidation_event_count_5m, 4);
}

writesAndLoadsLatestSnapshot()
  .then(collectorHandlesMessageAndWritesSnapshot)
  .then(marketDataQualityReadsLatestLiquidationSnapshot)
  .then(() => {
    console.log("V2_BINANCE_LIQUIDATION_STREAM_COLLECTOR_TEST_OK");
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
