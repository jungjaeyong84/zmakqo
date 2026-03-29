"use strict";

const assert = require("assert");
const fs = require("fs");

function run() {
  const src = fs.readFileSync(require.resolve("../engine/paperUpbitRunner"), "utf8");
  const anchor = "const executeIntentList = async (intentsList) => {";
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0, "executeIntentList block must exist");
  const window = src.slice(idx, idx + 1400);
  assert.ok(
    window.includes('const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);'),
    "executeIntentList must declare manualRetryIntent before use"
  );
  assert.ok(
    window.includes('const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;'),
    "executeIntentList must declare manualRetryQtyBase before live execution"
  );
}

try {
  run();
  console.log("MANUAL_RETRY_INTENT_EXEC_SCOPE_TEST_OK");
} catch (err) {
  console.error("MANUAL_RETRY_INTENT_EXEC_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
