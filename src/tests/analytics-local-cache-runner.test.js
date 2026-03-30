"use strict";

const assert = require("assert");
const runner = require("../scheduler/analyticsLocalCacheRunner");

function minutesAgo(minutes) {
  return new Date(Date.now() - (minutes * 60 * 1000)).toISOString();
}

function run() {
  const fresh = { generated_at: minutesAgo(5) };
  const stale = { generated_at: minutesAgo(40) };

  assert.strictEqual(runner.isFreshAnalyticsLocalCache(fresh, Date.now(), 15 * 60 * 1000), true);
  assert.strictEqual(runner.isFreshAnalyticsLocalCache(stale, Date.now(), 15 * 60 * 1000), false);

  const parsed = runner.__test.parseLastJsonLine("hello\n{\"ok\":true,\"generated_at_kst\":\"2026-03-30 10:00:00 KST\"}\n");
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.generated_at_kst, "2026-03-30 10:00:00 KST");

  console.log("ANALYTICS_LOCAL_CACHE_RUNNER_TEST_OK");
}

if (require.main === module) {
  run();
}

module.exports = run;
