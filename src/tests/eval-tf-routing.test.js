"use strict";

const assert = require("assert");
const evalDoc = require("../utils/evalDoc");
const autoEval = require("../scheduler/autoEval");
const evalWeeklyRoute = require("../routes/eval.weekly.routes");

function run() {
  assert.strictEqual(typeof evalDoc.matchesEvalTf, "function", "matchesEvalTf export missing");
  assert.strictEqual(typeof evalDoc.normalizeEvalTf, "function", "normalizeEvalTf export missing");
  assert.strictEqual(typeof evalDoc.resolveEvalDocTf, "function", "resolveEvalDocTf export missing");
  assert.ok(autoEval.__test, "__test export missing");
  assert.strictEqual(typeof autoEval.__test.isFreshEvalLatestForTf, "function", "isFreshEvalLatestForTf export missing");
  assert.ok(evalWeeklyRoute.__test, "eval.weekly __test export missing");
  assert.strictEqual(typeof evalWeeklyRoute.__test.shouldReplaceEvalLatest, "function", "shouldReplaceEvalLatest export missing");

  assert.strictEqual(evalDoc.normalizeEvalTf("15"), "15m");
  assert.strictEqual(evalDoc.normalizeEvalTf("60m"), "60m");
  assert.strictEqual(evalDoc.matchesEvalTf({ tf: "15m" }, "15m"), true);
  assert.strictEqual(evalDoc.matchesEvalTf({ universe: { tf: "60m" } }, "15m"), false);
  assert.strictEqual(evalDoc.matchesEvalTf({ data: { tf: "15m" } }, "15m"), true);
  assert.strictEqual(
    evalDoc.resolveEvalDocTf({ tf: "15m", kpi: { bar_interval_ms: 3600000 } }),
    "60m"
  );
  assert.strictEqual(
    evalDoc.matchesEvalTf({ tf: "15m", kpi: { bar_interval_ms: 3600000 } }, "15m"),
    false
  );

  const nowMs = Date.parse("2026-03-23T00:00:00.000Z");
  const maxAgeMs = 24 * 60 * 60 * 1000;
  assert.strictEqual(
    autoEval.__test.isFreshEvalLatestForTf(
      { tf: "15m", generated_at: "2026-03-22T12:00:00.000Z" },
      "15m",
      nowMs,
      maxAgeMs
    ),
    true
  );
  assert.strictEqual(
    autoEval.__test.isFreshEvalLatestForTf(
      { tf: "60m", generated_at: "2026-03-22T12:00:00.000Z" },
      "15m",
      nowMs,
      maxAgeMs
    ),
    false
  );
  assert.strictEqual(
    autoEval.__test.isFreshEvalLatestForTf(
      { tf: "15m", generated_at: "2026-03-20T12:00:00.000Z" },
      "15m",
      nowMs,
      maxAgeMs
    ),
    false
  );

  assert.strictEqual(
    evalWeeklyRoute.__test.shouldReplaceEvalLatest(
      { range: { to_ms: 1774479600000 } },
      { range: { to_ms: 1773874800000 } }
    ),
    false
  );
  assert.strictEqual(
    evalWeeklyRoute.__test.shouldReplaceEvalLatest(
      { range: { to_ms: 1773874800000 } },
      { range: { to_ms: 1774479600000 } }
    ),
    true
  );
}

try {
  run();
  console.log("EVAL_TF_ROUTING_TEST_OK");
} catch (err) {
  console.error("EVAL_TF_ROUTING_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
