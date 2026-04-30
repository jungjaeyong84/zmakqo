"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/build-ml-training-dataset");

function run() {
  assert.deepStrictEqual(
    __test.readRecentCacheDocs({ docs: [{ id: 1 }, { id: 2 }] }),
    [{ id: 1 }, { id: 2 }]
  );
  assert.deepStrictEqual(
    __test.readRecentCacheDocs({ rows: [{ id: 3 }] }),
    [{ id: 3 }]
  );
  assert.deepStrictEqual(
    __test.readRecentCacheDocs({}),
    []
  );

  const referenceWindow = __test.resolveReferenceWindow({
    window: {
      from_ms: 1000,
      to_ms: 2000,
    },
  }, 3000);
  assert.strictEqual(referenceWindow.source, "REFERENCE_DATASET");
  assert.strictEqual(referenceWindow.fromMs, 1000);
  assert.strictEqual(referenceWindow.toMs, 2000);

  const fallbackWindow = __test.resolveReferenceWindow(null, Date.parse("2026-04-05T00:00:00.000Z"));
  assert.strictEqual(fallbackWindow.source, "ROLLING_FALLBACK");
  assert.strictEqual(fallbackWindow.toMs, Date.parse("2026-04-05T00:00:00.000Z"));
  assert.ok(fallbackWindow.fromMs < fallbackWindow.toMs);

  assert.doesNotThrow(() => __test.assertV2OpenClawLearningScope({
    summary: {
      learning_scope: "V2_ONLY_OPENCLAW",
      v1_learning_blocked: true,
    },
  }));
  assert.throws(
    () => __test.assertV2OpenClawLearningScope({ summary: { learning_scope: "LEGACY_MIXED" } }),
    /ML_TRAINING_DATASET_LEARNING_SCOPE_BLOCKED:LEGACY_MIXED/
  );
  assert.throws(
    () => __test.assertV2OpenClawLearningScope({ summary: {} }),
    /ML_TRAINING_DATASET_LEARNING_SCOPE_BLOCKED:MISSING/
  );

  console.log("BUILD_ML_TRAINING_DATASET_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BUILD_ML_TRAINING_DATASET_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
