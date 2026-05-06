"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const barsSnapshots = require("../storage/barsSnapshots");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "storage", "barsSnapshots.js"),
  "utf8"
);

(function testSourceDocumentsConfirmedHeadroom() {
  assert.ok(
    /in-progress candle/.test(SRC) || /future candle/.test(SRC),
    "queryBars must document why confirmed-only reads need query headroom"
  );
  assert.ok(
    /BARS_SNAPSHOT_CONFIRMED_SCAN_HEADROOM/.test(SRC),
    "queryBars must expose a dedicated confirmed-scan headroom env"
  );
})();

(function testResolveQueryBarsScanLimit() {
  const fn = barsSnapshots && barsSnapshots.__test && barsSnapshots.__test.resolveQueryBarsScanLimit;
  assert.strictEqual(typeof fn, "function", "resolveQueryBarsScanLimit test helper must be exported");

  const base = fn({ limit: 220, hardLimit: 3000, scanHeadroom: 3 });
  assert.deepStrictEqual(
    base,
    { limitSafe: 220, cap: 3000, scanLimit: 223 },
    "220 confirmed bars should scan past the latest in-progress candle"
  );

  const capped = fn({ limit: 2999, hardLimit: 3000, scanHeadroom: 10 });
  assert.deepStrictEqual(
    capped,
    { limitSafe: 2999, cap: 3000, scanLimit: 3000 },
    "scan limit must respect the hard ceiling"
  );

  const zeroHeadroom = fn({ limit: 220, hardLimit: 3000, scanHeadroom: 0 });
  assert.deepStrictEqual(
    zeroHeadroom,
    { limitSafe: 220, cap: 3000, scanLimit: 220 },
    "explicit zero headroom must be honored for controlled tests"
  );
})();

console.log("BARS_SNAPSHOTS_QUERY_LIMIT_TEST_OK");
