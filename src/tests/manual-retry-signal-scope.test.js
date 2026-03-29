"use strict";

const assert = require("assert");
const fs = require("fs");

function run() {
  const src = fs.readFileSync(require.resolve("../engine/paperUpbitRunner"), "utf8");
  const anchor = "for (const s of signals) {";
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0, "signal loop must exist");
  const window = src.slice(idx, idx + 400);
  assert.ok(
    window.includes("const manualRetryIntent = intentIsEntry && isManualRetryFeatures(s.features);"),
    "signal loop must declare manualRetryIntent before use"
  );
}

try {
  run();
  console.log("MANUAL_RETRY_SIGNAL_SCOPE_TEST_OK");
} catch (err) {
  console.error("MANUAL_RETRY_SIGNAL_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
