"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");
const { normalizeTf, filterSupportedTf } = require("../utils/marketConfig");

function run() {
  assert.strictEqual(typeof __test.scaleBaseBarCountByTf, "function", "scaleBaseBarCountByTf export missing");
  assert.strictEqual(typeof __test.resolveBinanceMaxHoldBars, "function", "resolveBinanceMaxHoldBars export missing");
  assert.strictEqual(typeof __test.resolveTfFromMs, "function", "resolveTfFromMs export missing");

  const fifteenMs = 15 * 60 * 1000;
  const sixtyMs = 60 * 60 * 1000;

  assert.strictEqual(normalizeTf("15"), "15m");
  assert.strictEqual(normalizeTf("15m"), "15m");
  assert.deepStrictEqual(filterSupportedTf(["15m", "60m", "4h"]).supported, ["15m", "60m"]);

  assert.strictEqual(__test.scaleBaseBarCountByTf(18, sixtyMs), 18);
  assert.strictEqual(__test.scaleBaseBarCountByTf(18, fifteenMs), 72);
  assert.strictEqual(__test.resolveBinanceMaxHoldBars({ max_hold_bars: 18 }, sixtyMs), 18);
  assert.strictEqual(__test.resolveBinanceMaxHoldBars({ max_hold_bars: 18 }, fifteenMs), 72);
  assert.strictEqual(__test.resolveTfFromMs(fifteenMs), "15m");
  assert.strictEqual(__test.resolveTfFromMs(sixtyMs), "60m");
}

try {
  run();
  console.log("TF_15M_TIME_STOP_SCALE_TEST_OK");
} catch (err) {
  console.error("TF_15M_TIME_STOP_SCALE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
