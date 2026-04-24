"use strict";

const assert = require("assert");
const binance = require("../exchanges/binanceFuturesPrivate");
const { __test } = require("../routes/egress.proxy.routes");

(async () => {
  assert(__test && __test.handlers && __test.handlers.binancefut, "egress route handlers must be exposed for contract tests");
  const handlers = __test.handlers.binancefut;

  const original = {
    createFuturesListenKey: binance.createFuturesListenKey,
    keepaliveFuturesListenKey: binance.keepaliveFuturesListenKey,
    deleteFuturesListenKey: binance.deleteFuturesListenKey,
  };

  const calls = [];
  try {
    binance.createFuturesListenKey = async (payload) => {
      calls.push({ action: "create", payload });
      return { listenKey: "listen-key-1" };
    };
    binance.keepaliveFuturesListenKey = async (payload) => {
      calls.push({ action: "keepalive", payload });
      return { ok: true };
    };
    binance.deleteFuturesListenKey = async (payload) => {
      calls.push({ action: "delete", payload });
      return { ok: true };
    };

    assert.strictEqual(typeof handlers.createFuturesListenKey, "function");
    assert.strictEqual(typeof handlers.keepaliveFuturesListenKey, "function");
    assert.strictEqual(typeof handlers.deleteFuturesListenKey, "function");

    assert.deepStrictEqual(
      await handlers.createFuturesListenKey({ apiKey: "k" }),
      { listenKey: "listen-key-1" }
    );
    assert.deepStrictEqual(
      await handlers.keepaliveFuturesListenKey({ apiKey: "k", listenKey: "listen-key-1" }),
      { ok: true }
    );
    assert.deepStrictEqual(
      await handlers.deleteFuturesListenKey({ apiKey: "k", listenKey: "listen-key-1" }),
      { ok: true }
    );
    assert.deepStrictEqual(calls.map((row) => row.action), ["create", "keepalive", "delete"]);
  } finally {
    binance.createFuturesListenKey = original.createFuturesListenKey;
    binance.keepaliveFuturesListenKey = original.keepaliveFuturesListenKey;
    binance.deleteFuturesListenKey = original.deleteFuturesListenKey;
  }

  console.log("EGRESS_PROXY_ROUTES_TEST_OK");
})();
