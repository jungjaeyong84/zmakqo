"use strict";

const assert = require("assert");

const { __test } = require("../../scripts/run-v3-paper-exit-ledger.js");

function buildFakeKlineFetch(intervalMs) {
  let callCount = 0;
  async function fetchImpl(url) {
    callCount += 1;
    const parsed = new URL(String(url));
    const startTime = Number(parsed.searchParams.get("startTime"));
    const endTime = Number(parsed.searchParams.get("endTime"));
    const limit = Number(parsed.searchParams.get("limit"));
    const rows = [];
    let openTime = startTime;
    while (rows.length < limit && openTime <= endTime) {
      rows.push([
        openTime,
        "100",
        "101",
        "99",
        "100",
        "1",
        openTime + intervalMs - 1,
      ]);
      openTime += intervalMs;
    }
    return {
      ok: true,
      async json() {
        return rows;
      },
    };
  }
  return Object.freeze({
    fetchImpl,
    getCallCount() {
      return callCount;
    },
  });
}

(() => {
  assert.strictEqual(__test.parseKlineIntervalMs("1m"), 60 * 1000);
  assert.strictEqual(__test.parseKlineIntervalMs("15m"), 15 * 60 * 1000);
  assert.strictEqual(__test.parseKlineIntervalMs("1h"), 60 * 60 * 1000);
  assert.strictEqual(__test.parseKlineIntervalMs("bad"), null);

  const requiredPages = __test.computeRequiredKlinePages({
    startTimeMs: 0,
    endTimeMs: (31 * 60 * 1000),
    intervalMs: 60 * 1000,
    klineLimit: 2,
  });
  assert.strictEqual(requiredPages, 16);

  const budget = __test.resolveKlinePageBudget({
    startTimeMs: 0,
    endTimeMs: (31 * 60 * 1000),
    interval: "1m",
    klineLimit: 2,
    configuredMaxPages: null,
    hardCapPages: 100,
  });
  assert.strictEqual(budget.mode, "ADAPTIVE_REQUIRED_RANGE");
  assert.strictEqual(budget.required_pages, 16);
  assert.strictEqual(budget.page_budget, 17);
})();

async function main() {
  {
    const intervalMs = 60 * 1000;
    const createdAt = new Date("2026-05-11T00:00:00.000Z").toISOString();
    const nowMs = Date.parse("2026-05-11T00:30:00.000Z");
    const { fetchImpl, getCallCount } = buildFakeKlineFetch(intervalMs);
    const candles = await __test.fetchKlinesForEntry({
      signal_id: "sig-long-window",
      symbol: "BTCUSDT",
      created_at: createdAt,
    }, nowMs, {
      fetchImpl,
      klineInterval: "1m",
      klineLimit: 2,
      klineMaxPages: null,
      klineHardCapPages: 100,
    });
    assert.strictEqual(candles.length, 32);
    assert.strictEqual(getCallCount(), 16);
  }

  {
    const intervalMs = 60 * 1000;
    const createdAt = new Date("2026-05-11T00:00:00.000Z").toISOString();
    const nowMs = Date.parse("2026-05-11T00:30:00.000Z");
    const { fetchImpl } = buildFakeKlineFetch(intervalMs);
    await assert.rejects(
      () => __test.fetchKlinesForEntry({
        signal_id: "sig-cap-hit",
        symbol: "ETHUSDT",
        created_at: createdAt,
      }, nowMs, {
        fetchImpl,
        klineInterval: "1m",
        klineLimit: 2,
        klineMaxPages: 12,
        klineHardCapPages: 100,
      }),
      /V3_EXIT_KLINE_PAGE_CAP_REACHED:ETHUSDT:sig-cap-hit:12/,
    );
  }

  console.log("run-v3-paper-exit-ledger.test.js PASS");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
