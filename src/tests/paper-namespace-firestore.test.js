"use strict";

const assert = require("assert");
const { __test } = require("../storage/firestore");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(__test.normalizePaperNamespace("shadow15m"), "shadow15m");
  assert.strictEqual(__test.normalizePaperNamespace(" Shadow-15m "), "shadow_15m");

  assert.strictEqual(__test.resolvePaperCollectionName("positions_paper", ""), "positions_paper");
  assert.strictEqual(__test.resolvePaperCollectionName("positions_paper", "shadow15m"), "positions_paper__shadow15m");
  assert.strictEqual(__test.resolvePaperCollectionName("fills_paper", "shadow-15m"), "fills_paper__shadow_15m");
  assert.strictEqual(__test.resolvePaperCollectionName("signals", "shadow15m"), "signals");
}

try {
  run();
  console.log("PAPER_NAMESPACE_FIRESTORE_TEST_OK");
} catch (err) {
  console.error("PAPER_NAMESPACE_FIRESTORE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
