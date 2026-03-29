const assert = require("assert");
const { buildImprovementPackDataQuality } = require("../utils/improvementPackDataQuality");

function toKstStub(ms) {
  return `KST:${ms}`;
}

const data = buildImprovementPackDataQuality(
  {
    BTCUSDT: [
      { close_ms: 1000, created_at_ms: 1000, high: 12, low: 10, volume: 1 },
      { close_ms: 2000, created_at_ms: 2000, high: 13, low: 11, volume: 1 },
      { close_ms: 4000, created_at_ms: 4000, high: 14, low: 12, volume: 1 },
      { close_ms: 4000, created_at_ms: 4000, high: 14, low: 12, volume: 1 },
    ],
  },
  1000,
  toKstStub
);

assert.strictEqual(data.summary.missing, 1);
assert.strictEqual(data.summary.duplicate, 1);
assert.strictEqual(data.summary.misaligned, 0);
assert.strictEqual(data.markets.BTCUSDT.gaps.length, 1);
assert.strictEqual(data.markets.BTCUSDT.gaps[0].from_kst, "KST:3000");
assert.strictEqual(data.markets.BTCUSDT.gaps[0].missing_bars, 1);

console.log("IMPROVEMENT_PACK_DATA_QUALITY_TEST_OK");
