"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// egress-proxy-stale-pool-retry.test.js
//
// 2026-04-19 RCA regression: exit-worker (minScale=1 long-running container)
// accumulated half-open TCP connections in Node's global undici keep-alive
// pool. Cloud Run's ingress LB kills idle connections without a TCP FIN,
// so the client reused dead sockets → writes succeed-looking but the
// response never arrives → AbortController timeout at 20s. Symptom: only
// the most-frequent action (`fetchBinanceFuturesAccount`) fails visibly.
//
// This regression guards:
//   (1) Transient transport errors (TIMEOUT / FETCH_FAIL / "fetch failed")
//       are classified by `isTransientEgressFetchError`.
//   (2) `callEgressProxy` retries ONCE on transient failure and surfaces
//       the recovery via `[egress][RETRY_RECOVERED]`.
//   (3) `callEgressProxy` does NOT retry on non-transient HTTP status
//       errors (those are caller-layer concerns).
//   (4) Retry uses a fresh `request_id` (…__retry2) so Cloud Logging can
//       correlate attempts.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// `undici` is not a direct dependency in this repo; Node ships it bundled
// so the production code loads it lazily. In tests we bypass the lazy-load
// entirely by setting the disable flag so getEgressDispatcher() short-
// circuits and tests exercise the fallback (global fetch) path. The
// transient-retry logic is independent of the dispatcher and is what we
// care about here.
process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER = "1";

// Env: force the proxy to believe it's in "client" mode with a base URL,
// and provide the required token.
process.env.EGRESS_PROXY_MODE = "client";
process.env.EGRESS_PROXY_URL = "https://stub.egress.example/";
process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL = "https://stub.egress.private.example/";
process.env.EGRESS_PROXY_TOKEN = "test-token";
// Keep the timeout tight so a buggy test doesn't hang.
process.env.EGRESS_PROXY_TIMEOUT_MS = "2000";

const { callEgressProxy, __test } = require("../utils/egressProxy");

assert.ok(__test, "__test export missing");
assert.strictEqual(
  typeof __test.isTransientEgressFetchError,
  "function",
  "isTransientEgressFetchError export missing"
);
assert.strictEqual(
  typeof __test.resolveEgressBaseCandidatesFor,
  "function",
  "resolveEgressBaseCandidatesFor export missing"
);

// ── Transient-classifier unit tests ─────────────────────────────────
assert.strictEqual(
  __test.isTransientEgressFetchError({ code: "EGRESS_PROXY_TIMEOUT" }),
  true,
  "timeout must be classified transient"
);
assert.strictEqual(
  __test.isTransientEgressFetchError({ code: "EGRESS_PROXY_FETCH_FAIL" }),
  true,
  "fetch-fail must be classified transient"
);
assert.strictEqual(
  __test.isTransientEgressFetchError({ message: "fetch failed" }),
  true,
  "bare 'fetch failed' message must be classified transient"
);
assert.strictEqual(
  __test.isTransientEgressFetchError({ message: "ECONNRESET" }),
  true,
  "ECONNRESET must be classified transient"
);
assert.strictEqual(
  __test.isTransientEgressFetchError({ message: "socket hang up" }),
  true,
  "socket hang up must be classified transient"
);
assert.strictEqual(
  __test.isTransientEgressFetchError({ code: "EGRESS_HTTP_500", message: "server error" }),
  false,
  "HTTP status errors must NOT be classified transient (caller-layer concern)"
);
assert.strictEqual(
  __test.isTransientEgressFetchError(null),
  false,
  "null must not crash the classifier"
);
assert.deepStrictEqual(
  __test.resolveEgressBaseCandidatesFor("binancefut", "fetchBinanceFuturesAccount"),
  ["https://stub.egress.private.example", "https://stub.egress.example"],
  "private binance actions must prefer private egress and keep public egress as transport fallback"
);
assert.deepStrictEqual(
  __test.resolveEgressBaseCandidatesFor("binancefut", "fetchFuturesPrices"),
  ["https://stub.egress.example"],
  "public binance actions must stay on the public egress base"
);

(async () => {
  // ── Retry integration: fail once then succeed ───────────────────────
  {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, requestId: opts && opts.headers && opts.headers["x-egress-request-id"] });
      if (calls.length === 1) {
        const err = new TypeError("fetch failed");
        throw err;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data: { recovered: true } }),
      };
    };
    try {
      const result = await callEgressProxy({
        provider: "binancefut",
        action: "fetchBinanceFuturesAccount",
        payload: { apiKey: "k", apiSecret: "s" },
      });
      assert.deepStrictEqual(
        result,
        { recovered: true },
        "retry must return the attempt-2 payload data"
      );
      assert.strictEqual(calls.length, 2, "fetch must be called exactly twice (1 fail + 1 retry)");
      assert.strictEqual(calls[0].url, "https://stub.egress.private.example/egress/binancefut",
        "attempt 1 must use private egress for private binance actions");
      assert.strictEqual(calls[1].url, "https://stub.egress.example/egress/binancefut",
        "attempt 2 must fail over to public egress when the private transport fails");
      assert.ok(/^EGR__\d+__[0-9a-f]+$/.test(calls[0].requestId),
        "attempt 1 must use the root request_id");
      assert.ok(calls[1].requestId.endsWith("__retry2"),
        "attempt 2 must use a fresh `__retry2` suffix for Cloud Logging correlation");
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ── No retry on non-transient (HTTP 400) ────────────────────────────
  {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, requestId: opts && opts.headers && opts.headers["x-egress-request-id"] });
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ ok: false, message: "bad request" }),
      };
    };
    try {
      let caught = null;
      try {
        await callEgressProxy({
          provider: "binancefut",
          action: "fetchBinanceFuturesAccount",
          payload: {},
        });
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, "non-transient HTTP error must still throw");
      assert.strictEqual(caught.status, 400, "error must preserve HTTP status");
      assert.strictEqual(calls.length, 1, "non-transient error must NOT be retried");
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ── Exhausted retries re-throw the last transient error ─────────────
  {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url });
      throw new TypeError("fetch failed");
    };
    try {
      let caught = null;
      try {
        await callEgressProxy({
          provider: "binancefut",
          action: "fetchBinanceFuturesAccount",
          payload: {},
        });
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, "exhausted retries must throw");
      assert.strictEqual(caught.code, "EGRESS_PROXY_FETCH_FAIL",
        "final thrown error must preserve transport-failure code");
      assert.strictEqual(calls.length, 2,
        "default totalAttempts=2: both attempts must fire before giving up");
      assert.ok(String(caught.message).includes("attempt=2"),
        "final error message must carry attempt index so ops can grep retry-exhaust");
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ── Overridable via maxAttempts argument ─────────────────────────────
  {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async () => { calls.push(1); throw new TypeError("fetch failed"); };
    try {
      try {
        await callEgressProxy({
          provider: "binancefut",
          action: "fetchBinanceFuturesAccount",
          payload: {},
          maxAttempts: 4,
        });
      } catch (_) {}
      assert.strictEqual(calls.length, 4,
        "maxAttempts=4 must run exactly 4 attempts before re-throwing");
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("EGRESS_PROXY_STALE_POOL_RETRY_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
