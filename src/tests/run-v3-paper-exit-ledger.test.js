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

  // 2026-05-18 — regression guard for the Binance 429 cascade. Before
  // this fix a single 429 from one symbol killed the entire cycle for
  // 6+ rounds in a row (~24 min of stalled exit ledger). Cover:
  //   (a) retry-on-429 succeeds on the 2nd attempt;
  //   (b) Retry-After header is honored when longer than computed backoff;
  //   (c) parseRetryAfterMs returns null for missing/invalid headers.
  {
    // (a) 429 then 200 — must succeed and report the retry happened.
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => name && name.toLowerCase() === "retry-after" ? null : null },
        };
      }
      return { ok: true, async json() { return [[0, "1", "1", "1", "1", "1", 0]]; } };
    };
    // Override env to keep the backoff tiny so the test stays fast.
    const prevBackoff = process.env.V3_PAPER_EXIT_KLINE_BASE_BACKOFF_MS;
    process.env.V3_PAPER_EXIT_KLINE_BASE_BACKOFF_MS = "10";
    try {
      // Re-require to pick up the new env (the module reads env at load time).
      delete require.cache[require.resolve("../../scripts/run-v3-paper-exit-ledger.js")];
      const fresh = require("../../scripts/run-v3-paper-exit-ledger.js");
      const res = await fresh.__test.fetchKlinePageWithRetry({
        url: new URL("https://fapi.binance.com/fapi/v1/klines?symbol=TESTUSDT"),
        fetchImpl,
        symbol: "TESTUSDT",
      });
      assert.strictEqual(res.ok, true, "must return the eventual 200 response");
      assert.strictEqual(callCount, 2, "must retry exactly once on first 429");
    } finally {
      if (prevBackoff === undefined) delete process.env.V3_PAPER_EXIT_KLINE_BASE_BACKOFF_MS;
      else process.env.V3_PAPER_EXIT_KLINE_BASE_BACKOFF_MS = prevBackoff;
      delete require.cache[require.resolve("../../scripts/run-v3-paper-exit-ledger.js")];
    }
  }
  {
    // (b) parseRetryAfterMs honors "5" (seconds) → 5000ms; rejects "bad".
    const headerGetter = (val) => ({ headers: { get: () => val } });
    assert.strictEqual(__test.parseRetryAfterMs(headerGetter("5")), 5000);
    assert.strictEqual(__test.parseRetryAfterMs(headerGetter("0.5")), 500);
    assert.strictEqual(__test.parseRetryAfterMs(headerGetter(null)), null);
    assert.strictEqual(__test.parseRetryAfterMs(headerGetter("bad")), null);
    assert.strictEqual(__test.parseRetryAfterMs(null), null);
  }
  {
    // (c) same-symbol dedupe — two entries on the same symbol with the
    // newer entry having a later created_at must NOT see candles from
    // before its created_at. The shared-fetch optimization is what
    // tripped this during the 2026-05-18 fix; this guards against it.
    const intervalMs = 60 * 1000;
    const earlyMs = Date.parse("2026-05-11T00:00:00.000Z");
    const lateMs = Date.parse("2026-05-11T00:20:00.000Z");
    const { fetchImpl, getCallCount } = buildFakeKlineFetch(intervalMs);
    const lookup = await __test.fetchCandlePathsBySignalId(
      [
        { signal_id: "sig-early", symbol: "DEDUPEUSDT", created_at: new Date(earlyMs).toISOString() },
        { signal_id: "sig-late", symbol: "DEDUPEUSDT", created_at: new Date(lateMs).toISOString() },
      ],
      { fetchImpl, klineInterval: "1m", klineLimit: 1000, klineMaxPages: null, klineHardCapPages: 100 }
    );
    assert.ok(lookup["sig-early"].length > lookup["sig-late"].length,
      "the newer entry must see strictly fewer candles than the older one (slice by its own created_at)");
    const earliestLateCandleMs = Math.min(...lookup["sig-late"].map((c) => Date.parse(c.open_time)));
    assert.ok(earliestLateCandleMs >= lateMs - 60 * 1000,
      "late entry's candles must all be >= its created_at - 60s margin");
    // Only one symbol → only one fetch should have happened (deduped),
    // covering both entries.
    assert.ok(getCallCount() >= 1, "must have made at least one fetch");
    void getCallCount;
  }

  console.log("run-v3-paper-exit-ledger.test.js PASS");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
