"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(typeof __test.resolveEventRefMs, "function", "resolveEventRefMs export missing");

  const realNow = Date.now;
  try {
    Date.now = () => 123456789;

    assert.strictEqual(
      __test.resolveEventRefMs(Date.parse("2026-03-10T14:59:59.999Z")),
      Date.parse("2026-03-10T14:59:59.999Z"),
      "bar timestamp must win over wall clock"
    );

    assert.strictEqual(
      __test.resolveEventRefMs(null, undefined, "1773154799999"),
      1773154799999,
      "string timestamps should normalize to numeric ms"
    );

    assert.strictEqual(
      __test.resolveEventRefMs(null, undefined, 0, NaN),
      123456789,
      "missing event timestamps should fall back to wall clock"
    );
  } finally {
    Date.now = realNow;
  }
}

try {
  run();
  console.log("OPPOSITE_TIME_COOLDOWN_REPLAY_REF_TEST_OK");
} catch (err) {
  console.error("OPPOSITE_TIME_COOLDOWN_REPLAY_REF_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
