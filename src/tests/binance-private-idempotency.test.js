const assert = require("assert");
const binance = require("../exchanges/binanceFuturesPrivate");

function makeHeaders(map = {}) {
  const src = {};
  Object.keys(map || {}).forEach((k) => {
    src[String(k).toLowerCase()] = map[k];
  });
  return {
    get(name) {
      return src[String(name || "").toLowerCase()] ?? null;
    },
  };
}

function makeResponse({ status = 200, body = "{}", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders(headers),
    async text() {
      return String(body);
    },
  };
}

async function withFetchMock(sequence, run) {
  const steps = Array.isArray(sequence) ? sequence.slice() : [];
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = steps.length ? steps.shift() : null;
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next({ url: String(url), options, calls });
    return makeResponse(next || {});
  };
  try {
    await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

function parseSearchParams(url) {
  return new URL(url).searchParams;
}

async function testClientOrderIdApplied() {
  await withFetchMock(
    [{ status: 200, body: JSON.stringify({ orderId: 111, status: "FILLED" }) }],
    async (calls) => {
      const out = await binance.placeFuturesMarketOrder({
        apiKey: "k",
        apiSecret: "s",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.001",
        idempotencyKey: "INTENT_TEST_001",
      });
      assert.strictEqual(out.orderId, 111);
      assert.strictEqual(calls.length, 1);
      const query = parseSearchParams(calls[0].url);
      const clientId = query.get("newClientOrderId");
      assert.ok(clientId, "newClientOrderId should exist");
      assert.ok(clientId.length <= 36, "newClientOrderId should be <= 36 chars");
    }
  );
}

async function testRetryOn429WithIdempotency() {
  process.env.BINANCE_HTTP_MAX_RETRIES = "1";
  process.env.BINANCE_HTTP_RETRY_BASE_MS = "50";
  process.env.BINANCE_HTTP_RETRY_MAX_MS = "50";
  process.env.BINANCE_HTTP_RETRY_JITTER_MS = "0";
  await withFetchMock(
    [
      { status: 429, body: JSON.stringify({ code: -1003, msg: "Too many requests" }), headers: { "retry-after": "0" } },
      { status: 200, body: JSON.stringify({ orderId: 222, status: "FILLED" }) },
    ],
    async (calls) => {
      const out = await binance.placeFuturesMarketOrder({
        apiKey: "k",
        apiSecret: "s",
        symbol: "ETHUSDT",
        side: "SELL",
        quantity: "0.01",
        idempotencyKey: "INTENT_TEST_002",
      });
      assert.strictEqual(out.orderId, 222);
      assert.strictEqual(calls.length, 2, "should retry once after 429");
    }
  );
}

async function testRetryOnInvalidJsonWithIdempotency() {
  process.env.BINANCE_HTTP_MAX_RETRIES = "1";
  process.env.BINANCE_HTTP_RETRY_BASE_MS = "10";
  process.env.BINANCE_HTTP_RETRY_MAX_MS = "10";
  process.env.BINANCE_HTTP_RETRY_JITTER_MS = "0";
  await withFetchMock(
    [
      { status: 200, body: "<html>bad gateway</html>" },
      { status: 200, body: JSON.stringify({ orderId: 223, status: "FILLED" }) },
    ],
    async (calls) => {
      const out = await binance.placeFuturesMarketOrder({
        apiKey: "k",
        apiSecret: "s",
        symbol: "ETHUSDT",
        side: "BUY",
        quantity: "0.01",
        idempotencyKey: "INTENT_TEST_INVALID_JSON_001",
      });
      assert.strictEqual(out.orderId, 223);
      assert.strictEqual(calls.length, 2, "should retry once after invalid json");
    }
  );
}

async function testNoRetryWithoutIdempotencyOnPost() {
  process.env.BINANCE_HTTP_MAX_RETRIES = "2";
  process.env.BINANCE_HTTP_RETRY_BASE_MS = "50";
  process.env.BINANCE_HTTP_RETRY_MAX_MS = "50";
  process.env.BINANCE_HTTP_RETRY_JITTER_MS = "0";
  await withFetchMock(
    [
      { status: 500, body: JSON.stringify({ code: -1008, msg: "Server busy" }) },
      { status: 200, body: JSON.stringify({ orderId: 333 }) },
    ],
    async (calls) => {
      let failed = false;
      try {
        await binance.placeFuturesMarketOrder({
          apiKey: "k",
          apiSecret: "s",
          symbol: "BNBUSDT",
          side: "BUY",
          quantity: "0.1",
        });
      } catch (e) {
        failed = true;
        assert.ok(String(e.message || "").includes("BINANCEFUT_HTTP_500"));
      }
      assert.ok(failed, "request without idempotency should fail fast");
      assert.strictEqual(calls.length, 1, "should not retry POST without idempotency key");
    }
  );
}

async function testNoRetryOnInvalidJsonWithoutIdempotency() {
  process.env.BINANCE_HTTP_MAX_RETRIES = "2";
  process.env.BINANCE_HTTP_RETRY_BASE_MS = "10";
  process.env.BINANCE_HTTP_RETRY_MAX_MS = "10";
  process.env.BINANCE_HTTP_RETRY_JITTER_MS = "0";
  await withFetchMock(
    [
      { status: 200, body: "<html>bad gateway</html>" },
      { status: 200, body: JSON.stringify({ orderId: 334 }) },
    ],
    async (calls) => {
      let failed = false;
      try {
        await binance.placeFuturesMarketOrder({
          apiKey: "k",
          apiSecret: "s",
          symbol: "BNBUSDT",
          side: "BUY",
          quantity: "0.1",
        });
      } catch (e) {
        failed = true;
        assert.ok(String(e.message || "").includes("BINANCEFUT_JSON_PARSE_FAIL"));
      }
      assert.ok(failed, "request without idempotency should fail fast on invalid json");
      assert.strictEqual(calls.length, 1, "should not retry invalid json without idempotency key");
    }
  );
}

async function testDuplicateRecoveryByClientOrderId() {
  process.env.BINANCE_HTTP_MAX_RETRIES = "0";
  await withFetchMock(
    [
      { status: 400, body: JSON.stringify({ code: -2010, msg: "Duplicate order sent." }) },
      { status: 200, body: JSON.stringify({ orderId: 444, status: "FILLED", avgPrice: "42000.0" }) },
    ],
    async (calls) => {
      const out = await binance.placeFuturesMarketOrder({
        apiKey: "k",
        apiSecret: "s",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.002",
        idempotencyKey: "INTENT_TEST_004",
      });
      assert.strictEqual(out.orderId, 444);
      assert.strictEqual(calls.length, 2);
      const firstQuery = parseSearchParams(calls[0].url);
      const secondQuery = parseSearchParams(calls[1].url);
      assert.strictEqual(secondQuery.get("origClientOrderId"), firstQuery.get("newClientOrderId"));
    }
  );
}

async function run() {
  const prevEnv = {
    EGRESS_PROXY_MODE: process.env.EGRESS_PROXY_MODE,
    EGRESS_PROXY_URL: process.env.EGRESS_PROXY_URL,
    BINANCE_HTTP_MAX_RETRIES: process.env.BINANCE_HTTP_MAX_RETRIES,
    BINANCE_HTTP_RETRY_BASE_MS: process.env.BINANCE_HTTP_RETRY_BASE_MS,
    BINANCE_HTTP_RETRY_MAX_MS: process.env.BINANCE_HTTP_RETRY_MAX_MS,
    BINANCE_HTTP_RETRY_JITTER_MS: process.env.BINANCE_HTTP_RETRY_JITTER_MS,
  };
  try {
    process.env.EGRESS_PROXY_MODE = "";
    process.env.EGRESS_PROXY_URL = "";
    await testClientOrderIdApplied();
    await testRetryOn429WithIdempotency();
    await testRetryOnInvalidJsonWithIdempotency();
    await testNoRetryWithoutIdempotencyOnPost();
    await testNoRetryOnInvalidJsonWithoutIdempotency();
    await testDuplicateRecoveryByClientOrderId();
    console.log("BINANCE_PRIVATE_IDEMPOTENCY_TEST_OK");
  } finally {
    Object.keys(prevEnv).forEach((k) => {
      const v = prevEnv[k];
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

run().catch((err) => {
  console.error("BINANCE_PRIVATE_IDEMPOTENCY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
