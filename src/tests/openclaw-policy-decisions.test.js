"use strict";

const assert = require("assert");

const { __test } = require("../storage/openclawPolicyDecisions");

(() => {
  const record = __test.buildDecisionRecord({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    side: "LONG",
    requestedQtyPct: "0.5",
    finalQtyPct: 0.25,
    blocked: true,
  });
  assert.strictEqual(record.exchange, "BINANCEFUT");
  assert.strictEqual(record.symbol, "BTCUSDT");
  assert.strictEqual(record.requested_qty_pct, 0.5);
  assert.strictEqual(record.final_qty_pct, 0.25);
  assert.strictEqual(record.blocked, true);
  assert.ok(record.id);
})();

console.log("openclaw-policy-decisions.test.js PASS");
