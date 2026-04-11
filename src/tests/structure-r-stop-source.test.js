"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

(() => {
  const stop = __test.resolveStructureInitialStopPrice({
    avgPrice: 100,
    side: "SHORT",
    features: { stop_price: 103.6 },
    nativeProtectionStopPrice: 104.2,
  });
  assert.strictEqual(stop, 103.6);
  const source = __test.resolveInitialStopSource({
    avgPrice: 100,
    side: "SHORT",
    features: { stop_price: 103.6 },
    nativeProtectionStopPrice: 104.2,
  });
  assert.strictEqual(source, "STRUCTURE_STOP_FEATURE");
})();

(() => {
  const stop = __test.resolveStructureInitialStopPrice({
    avgPrice: 100,
    side: "LONG",
    features: { stop_price: 101.2 },
    nativeProtectionStopPrice: 96.5,
  });
  assert.strictEqual(stop, 96.5);
  const source = __test.resolveInitialStopSource({
    avgPrice: 100,
    side: "LONG",
    features: { stop_price: 101.2 },
    nativeProtectionStopPrice: 96.5,
  });
  assert.strictEqual(source, "STRUCTURE_STOP_NATIVE");
})();

console.log("STRUCTURE_R_STOP_SOURCE_TEST_OK");
