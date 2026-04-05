"use strict";

const assert = require("assert");
const { deriveModelReadiness } = require("../utils/modelReadiness");

function run() {
  const ready = deriveModelReadiness({
    summary: {
      rows_n: 200,
      valid_n: 200,
      invalid_n: 0,
      realized_n: 20,
      schema_version: "2026-04-05.v1",
    },
  });
  assert.strictEqual(ready.status, "MODEL_READINESS_READY");

  const bootstrapping = deriveModelReadiness({
    summary: {
      rows_n: 150,
      valid_n: 150,
      invalid_n: 0,
      realized_n: 3,
      schema_version: "2026-04-05.v1",
    },
  });
  assert.strictEqual(bootstrapping.status, "MODEL_READINESS_BOOTSTRAPPING");

  const blocked = deriveModelReadiness({
    summary: {
      rows_n: 20,
      valid_n: 18,
      invalid_n: 2,
      realized_n: 1,
    },
  });
  assert.strictEqual(blocked.status, "MODEL_READINESS_BLOCKED");

  console.log("MODEL_READINESS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("MODEL_READINESS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
